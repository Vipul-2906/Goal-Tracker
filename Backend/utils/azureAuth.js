const axios = require("axios");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

const TENANT_ID = process.env.MICROSOFT_TENANT_ID || "common";
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const TENANT_ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const COMMON_ISSUER = "https://login.microsoftonline.com/common/v2.0";
const JWKS_URI = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;

const jwks = jwksClient({
    jwksUri: JWKS_URI,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 600000
});

function getSigningKey(header, callback) {
    jwks.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        const signingKey = key.getPublicKey();
        callback(null, signingKey);
    });
}

async function validateIdToken(idToken) {
    if (!idToken) {
        throw new Error("Microsoft idToken is required");
    }
    if (!CLIENT_ID) {
        throw new Error("MICROSOFT_CLIENT_ID is not configured on the backend");
    }

    return new Promise((resolve, reject) => {
        jwt.verify(idToken, getSigningKey, {
            algorithms: ["RS256"],
            audience: CLIENT_ID,
            issuer: [TENANT_ISSUER, COMMON_ISSUER]
        }, (err, decoded) => {
            if (err) return reject(err);
            resolve(decoded);
        });
    });
}

async function getGraphUserData(accessToken) {
    if (!accessToken) {
        throw new Error("Microsoft access token is required for Graph API calls");
    }

    const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
    };

    const userUrl = "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation,preferredLanguage";
    const groupsUrl = "https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$select=id,displayName,@odata.type";
    const managerUrl = "https://graph.microsoft.com/v1.0/me/manager?$select=id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation";

    const userResponse = await axios.get(userUrl, { headers });
    let manager = null;
    try {
        const managerResponse = await axios.get(managerUrl, { headers });
        manager = managerResponse.data;
    } catch (error) {
        if (error.response && error.response.status !== 404) {
            throw new Error(`Unable to fetch manager from Microsoft Graph: ${error.message}`);
        }
    }

    let groupData = [];
    try {
        const groupResponse = await axios.get(groupsUrl, { headers });
        groupData = Array.isArray(groupResponse.data.value) ? groupResponse.data.value : [];
    } catch (error) {
        throw new Error(`Unable to fetch Microsoft group membership: ${error.message}`);
    }

    const groups = groupData
        .filter(item => item["@odata.type"] && item["@odata.type"].toLowerCase().includes("group"))
        .map(item => ({
            id: item.id,
            displayName: item.displayName || ""
        }));

    return {
        user: {
            id: userResponse.data.id,
            displayName: userResponse.data.displayName,
            email: (userResponse.data.mail || userResponse.data.userPrincipalName || "").toLowerCase(),
            jobTitle: userResponse.data.jobTitle || null,
            department: userResponse.data.department || null,
            officeLocation: userResponse.data.officeLocation || null,
            preferredLanguage: userResponse.data.preferredLanguage || null
        },
        manager: manager ? {
            id: manager.id,
            displayName: manager.displayName,
            email: (manager.mail || manager.userPrincipalName || "").toLowerCase(),
            jobTitle: manager.jobTitle || null,
            department: manager.department || null,
            officeLocation: manager.officeLocation || null
        } : null,
        groups
    };
}

module.exports = {
    validateIdToken,
    getGraphUserData
};
