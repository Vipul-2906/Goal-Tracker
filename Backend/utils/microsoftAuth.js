async function getMicrosoftProfile({ accessToken, idToken }) {
    if (accessToken) {
        const response = await fetch("https://graph.microsoft.com/oidc/userinfo", {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!response.ok) {
            throw new Error("Microsoft token verification failed");
        }
        const profile = await response.json();
        return {
            microsoftId: profile.sub || profile.oid,
            email: (profile.email || profile.preferred_username || profile.upn || "").toLowerCase(),
            name: profile.name || profile.email || profile.preferred_username
        };
    }

    if (!idToken) {
        throw new Error("Microsoft accessToken or idToken is required");
    }

    const [, payload] = idToken.split(".");
    if (!payload) throw new Error("Invalid Microsoft token");
    const profile = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (clientId && profile.aud !== clientId) {
        throw new Error("Microsoft token audience mismatch");
    }
    if (profile.exp && profile.exp * 1000 < Date.now()) {
        throw new Error("Microsoft token expired");
    }

    return {
        microsoftId: profile.oid || profile.sub,
        email: (profile.email || profile.preferred_username || profile.upn || "").toLowerCase(),
        name: profile.name || profile.email || profile.preferred_username
    };
}

module.exports = {
    getMicrosoftProfile
};
