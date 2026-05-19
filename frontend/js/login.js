const loginButton = document.getElementById("loginButton");
const loginAlert = document.getElementById("loginAlert");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");
const requestResetButton = document.getElementById("requestResetButton");
const microsoftLoginButton = document.getElementById("microsoftLoginButton");
let msalClient = null;
const MICROSOFT_REDIRECT_URI = "http://localhost:5500/frontend/auth-callback.html";
const MICROSOFT_SIGNIN_SCOPES = ["openid", "profile", "email"];
const MICROSOFT_GRAPH_SCOPES = ["User.Read", "User.ReadBasic.All", "GroupMember.Read.All"];
const MICROSOFT_LINK_PAYLOAD_KEY = "microsoftLinkPayload";

function getMicrosoftConfig() {
    const clientId = window.MICROSOFT_CLIENT_ID || "af43c128-84be-45ca-b209-915e37e0aa33";
    const authority = window.MICROSOFT_AUTHORITY || "https://login.microsoftonline.com/common";

    if (!clientId) {
        throw new Error("Microsoft login is not configured. Set window.MICROSOFT_CLIENT_ID in the page.");
    }

    return {
        clientId,
        authority,
        redirectUri: MICROSOFT_REDIRECT_URI
    };
}

function initializeMsalClient() {
    if (msalClient) return msalClient;

    if (!window.msal || !window.msal.PublicClientApplication) {
        throw new Error("Microsoft authentication library is not loaded. Ensure the MSAL script is included before login.js.");
    }

    const config = getMicrosoftConfig();
    if (!config.clientId) {
        throw new Error("Microsoft login is not configured. Set window.MICROSOFT_CLIENT_ID in the page.");
    }

    msalClient = new window.msal.PublicClientApplication({
        auth: {
            clientId: config.clientId,
            authority: config.authority,
            redirectUri: config.redirectUri
        },
        cache: {
            cacheLocation: "sessionStorage",
            storeAuthStateInCookie: false
        }
    });
    return msalClient;
}

let loginInProgress = false;
let microsoftLoginInProgress = false;

function showLoginAlert(type, message) {
    if (window.AppUX) AppUX.toast(type === "danger" ? "error" : type, message);
    loginAlert.innerHTML = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;
}

function clearLoginAlert() {
    loginAlert.innerHTML = "";
}

function setLoginDisabled(disabled) {
    if (window.AppUX) return AppUX.setButtonLoading(loginButton, disabled, "Signing in...");
    loginButton.disabled = disabled;
    loginButton.innerHTML = disabled
        ? `<span class="spinner-border spinner-border-sm me-2"></span>Signing in...`
        : `<i class="bi bi-box-arrow-in-right me-2"></i>Sign In`;
}

function persistAndRedirect(data, rememberMe = false) {
    const userPayload = data.user;
    userPayload.token = data.token;
    const userData = JSON.stringify(userPayload);
    if (rememberMe) localStorage.setItem("user", userData);
    else sessionStorage.setItem("user", userData);

    showLoginAlert("success", `${data.message || "Login successful"}. Redirecting...`);
    setTimeout(() => {
        const pages = { employee: "employee.html", manager: "manager.html", admin: "admin.html" };
        if (pages[data.user.role]) window.location.href = pages[data.user.role];
        else showLoginAlert("danger", "Invalid role assigned to this account.");
    }, 700);
}

async function login() {
    if (loginInProgress) return;
    try {
        loginInProgress = true;
        clearLoginAlert();

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const rememberMe = document.getElementById("rememberMe").checked;

        if (!email || !password) {
            showLoginAlert("warning", "Please enter both email and password.");
            return;
        }

        setLoginDisabled(true);

        const response = await fetch("https://backend-46x0.onrender.com/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
            signal: AbortSignal.timeout(30000)
        });

        const data = await response.json();

        if (response.ok) {
            persistAndRedirect(data, rememberMe);
        } else {
            showLoginAlert("danger", data.message || "Login failed. Please check your credentials.");
        }
    } catch (error) {
        showLoginAlert("danger", error.name === "TimeoutError"
            ? "Login timed out. Please check the server and try again."
            : "Unable to connect to the server. Please try again later.");
    } finally {
        loginInProgress = false;
        setLoginDisabled(false);
    }
}

async function loginWithMicrosoft() {
    if (microsoftLoginInProgress) return;

    let client;
    try {
        client = initializeMsalClient();
    } catch (err) {
        console.error(err);
        showLoginAlert("danger", err.message);
        return;
    }

    try {
        microsoftLoginInProgress = true;
        if (window.AppUX) AppUX.setButtonLoading(microsoftLoginButton, true, "Opening Microsoft");

        const msalRequest = {
            scopes: [...MICROSOFT_SIGNIN_SCOPES, ...MICROSOFT_GRAPH_SCOPES],
            prompt: "select_account"
        };

        const microsoftResult = await client.loginPopup(msalRequest);
        if (!microsoftResult || !microsoftResult.idToken) {
            throw new Error("Microsoft authentication did not return a valid ID token.");
        }

        const authPayload = {
            idToken: microsoftResult.idToken,
            accessToken: microsoftResult.accessToken || null
        };

        const response = await fetch("https://backend-46x0.onrender.com/api/auth/microsoft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(authPayload),
            signal: AbortSignal.timeout(30000)
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Microsoft login failed.");
        }

        if (data.linkRequired) {
            sessionStorage.setItem(MICROSOFT_LINK_PAYLOAD_KEY, JSON.stringify({
                idToken: authPayload.idToken,
                accessToken: authPayload.accessToken,
                email: data.email || ""
            }));
            window.location.href = "microsoft-link.html";
            return;
        }

        persistAndRedirect(data, document.getElementById("rememberMe").checked);
    } catch (error) {
        const message = error.errorCode === "popup_window_error"
            ? "Microsoft popup could not open. Please allow popups and try again."
            : error.errorCode === "user_cancelled"
                ? "Microsoft sign-in was cancelled."
                : (error.message || "Microsoft login failed.");
        showLoginAlert(error.errorCode === "user_cancelled" ? "warning" : "danger", message);
    } finally {
        microsoftLoginInProgress = false;
        if (window.AppUX) AppUX.setButtonLoading(microsoftLoginButton, false);
    }
}

function attachLoginEvents() {
    loginButton.addEventListener("click", login);
    forgotPasswordLink?.addEventListener("click", (event) => {
        event.preventDefault();
        document.getElementById("forgotPasswordAlert").innerHTML = "";
        document.getElementById("resetEmail").value = document.getElementById("email").value.trim();
        bootstrap.Modal.getOrCreateInstance(document.getElementById("forgotPasswordModal")).show();
    });

    requestResetButton?.addEventListener("click", requestPasswordReset);
    microsoftLoginButton?.addEventListener("click", loginWithMicrosoft);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            const active = document.activeElement;
            if (active && (active.id === "email" || active.id === "password")) {
                event.preventDefault();
                login();
            }
        }
    });
}

async function requestPasswordReset() {
    const email = document.getElementById("resetEmail").value.trim();
    const alert = document.getElementById("forgotPasswordAlert");

    if (!email) {
        alert.innerHTML = `<div class="alert alert-warning">Please enter your email address.</div>`;
        return;
    }

    try {
        requestResetButton.disabled = true;
        if (window.AppUX) AppUX.setButtonLoading(requestResetButton, true, "Sending");
        else requestResetButton.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Sending...`;
        const response = await fetch("https://backend-46x0.onrender.com/api/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
            signal: AbortSignal.timeout(30000)
        });
        const data = await response.json();
        const type = response.ok ? "success" : "danger";
        const message = data.message || "Request submitted.";
        alert.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
        if (window.AppUX) AppUX.toast(type === "danger" ? "error" : type, message);
    } catch (error) {
        alert.innerHTML = `<div class="alert alert-danger">Unable to submit the reset request.</div>`;
        if (window.AppUX) AppUX.toast("error", "Unable to submit the reset request.");
    } finally {
        if (window.AppUX) AppUX.setButtonLoading(requestResetButton, false);
        else {
            requestResetButton.disabled = false;
            requestResetButton.innerHTML = "Request Reset";
        }
    }
}

document.addEventListener("DOMContentLoaded", attachLoginEvents);
