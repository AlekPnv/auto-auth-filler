// Auto Auth Filler

// The OAuth client ID lives in config.js, which is git-ignored. Copy
// config.template.js to config.js and put your own ID in it.
// Firefox loads config.js through manifest background.scripts; a Chromium
// service worker only gets the one entry point and has to pull it in itself.
if (!globalThis.AAF_CONFIG && typeof importScripts === "function") {
  try {
    importScripts("config.js");
  } catch {
    console.error(
      "[Auto Auth Filler] config.js is missing. Copy config.template.js to " +
        "config.js and add your Google OAuth Client ID.",
    );
  }
}

const CLIENT_ID = globalThis.AAF_CONFIG?.CLIENT_ID ?? "";
const CLIENT_SECRET = globalThis.AAF_CONFIG?.CLIENT_SECRET ?? "";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const TOKEN_LIFETIME_MS = 3600 * 1000;
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// The short-lived access token lives in session storage, which empties when the
// browser closes. The refresh token has to outlive that, so it goes to local
// storage - otherwise every restart would mean a fresh consent screen.
const tokenStore = chrome.storage.session ?? chrome.storage.local;

// MV3 service workers can be killed and revived at any time, so listeners must be
// registered at the top level on every wake-up, not inside an async callback
chrome.tabs.onUpdated.addListener(onAuthTabUpdated);
chrome.tabs.onRemoved.addListener(onAuthTabRemoved);

async function getFromLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

async function setInLocal(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

async function getFromTokenStore(keys) {
  return new Promise((resolve) => tokenStore.get(keys, resolve));
}

async function setInTokenStore(data) {
  return new Promise((resolve) => tokenStore.set(data, resolve));
}

async function getStoredToken() {
  const { googleToken, googleTokenExpiry } = await getFromTokenStore([
    "googleToken",
    "googleTokenExpiry",
  ]);
  if (googleToken && googleTokenExpiry && Date.now() < googleTokenExpiry - TOKEN_EXPIRY_BUFFER_MS) {
    return googleToken;
  }
  return null;
}

// Google returns expires_in (seconds); fall back to the default lifetime only
// if it is missing or looks unreasonable. A refresh response carries no new
// refresh_token, so the stored one is left alone unless a new one arrives.
async function saveTokens(data) {
  const expiresInSec = Number(data.expires_in);
  const lifetimeMs =
    Number.isFinite(expiresInSec) && expiresInSec > 60
      ? expiresInSec * 1000
      : TOKEN_LIFETIME_MS;

  await setInTokenStore({
    googleToken: data.access_token,
    googleTokenExpiry: Date.now() + lifetimeMs,
  });

  if (data.refresh_token) {
    await setInLocal({ googleRefreshToken: data.refresh_token });
  }
}

async function getRefreshToken() {
  const { googleRefreshToken } = await getFromLocal(["googleRefreshToken"]);
  return googleRefreshToken ?? null;
}

// Drops only the short-lived access token, leaving the refresh token intact so
// the next call can renew silently.
async function clearAccessToken() {
  await setInTokenStore({ googleToken: null, googleTokenExpiry: null });
}

async function clearToken() {
  const refreshToken = await getRefreshToken();

  await setInTokenStore({ googleToken: null, googleTokenExpiry: null });
  await setInLocal({ googleRefreshToken: null });

  // Best effort: drop the grant on Google's side too, so signing out here also
  // removes the extension from the user's Google account permissions page.
  if (refreshToken) {
    fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    }).catch(() => {});
  }
}

function isFirefox() {
  return chrome.runtime.getURL("").startsWith("moz-extension://");
}

// PKCE. The verifier is a high-entropy random string; the challenge sent to
// Google is its SHA-256. Google cannot replay the code without the verifier.
function base64Url(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafe(byteLength) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(digest);
}

async function postToken(params) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      ...params,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "Token request failed");
  }
  return data;
}

async function exchangeCodeForTokens(code, codeVerifier, redirectUri) {
  const data = await postToken({
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  await saveTokens(data);
  return data.access_token;
}

// Silent renewal. Fails permanently if the user revoked access, changed their
// Google password (which invalidates Gmail-scoped refresh tokens), or left the
// grant unused for six months - all of which need a fresh consent screen.
async function refreshAccessToken(refreshToken) {
  let data;
  try {
    data = await postToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
  } catch (err) {
    await clearToken();
    throw err;
  }
  await saveTokens(data);
  return data.access_token;
}

async function getAuthToken(forceNew = false) {
  if (!forceNew) {
    const saved = await getStoredToken();
    if (saved) return saved;

    // A valid refresh token means no consent screen: this is the whole point of
    // the authorization-code flow over the implicit one it replaced.
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      try {
        return await refreshAccessToken(refreshToken);
      } catch {
        // fall through to interactive sign-in
      }
    }
  }
  return isFirefox() ? authenticateFirefox() : authenticateChrome();
}

async function authenticateChrome() {
  const redirectUri = chrome.identity.getRedirectURL();
  const verifier = randomUrlSafe(48);
  const state = randomUrlSafe(16);
  const authUrl = buildAuthUrl(redirectUri, await pkceChallenge(verifier), state);

  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
      if (chrome.runtime.lastError || !url) {
        reject(new Error(chrome.runtime.lastError?.message ?? "Auth cancelled"));
      } else {
        resolve(url);
      }
    });
  });

  const result = extractAuthFromUrl(responseUrl);
  if (result.error) throw new Error(result.error);
  if (result.state !== state) throw new Error("OAuth state mismatch, aborting");
  if (!result.code) throw new Error("No authorization code in OAuth response");

  return exchangeCodeForTokens(result.code, verifier, redirectUri);
}

// Firefox does not reliably support launchWebAuthFlow with Google OAuth, so we open
// a real tab instead and intercept the redirect URL via the tabs.onUpdated listener
async function authenticateFirefox() {
  const redirectUri = chrome.identity.getRedirectURL();
  const verifier = randomUrlSafe(48);
  const state = randomUrlSafe(16);
  const authUrl = buildAuthUrl(redirectUri, await pkceChallenge(verifier), state);
  const reqId = Date.now().toString();

  // keyed by reqId so the tab listener can resolve the right promise if the SW restarts mid-auth
  const pending = new Promise((resolve, reject) => {
    pendingAuthCallbacks.set(reqId, { resolve, reject });
  });

  // The verifier and state go to storage as well: the worker can be killed
  // while the user is still on Google's consent screen, and the listener that
  // wakes up later needs both to complete the exchange.
  await setInTokenStore({
    pendingAuthReqId: reqId,
    pendingAuthRedirectUri: redirectUri,
    pendingAuthVerifier: verifier,
    pendingAuthState: state,
  });

  try {
    const tab = await chrome.tabs.create({ url: authUrl, active: true });
    await setInTokenStore({ pendingAuthTabId: tab.id });
  } catch (err) {
    pendingAuthCallbacks.delete(reqId);
    await clearPendingAuth();
    throw new Error("Could not open auth tab: " + err);
  }

  return pending;
}

async function clearPendingAuth() {
  await setInTokenStore({
    pendingAuthTabId: null,
    pendingAuthReqId: null,
    pendingAuthRedirectUri: null,
    pendingAuthVerifier: null,
    pendingAuthState: null,
  });
}

// in-memory map; survives for the current SW lifetime only
// state is also written to storage so the tab listeners can re-resolve it after an SW restart
const pendingAuthCallbacks = new Map();

async function onAuthTabUpdated(tabId, changeInfo) {
  if (!changeInfo.url) return;

  const {
    pendingAuthTabId,
    pendingAuthReqId,
    pendingAuthRedirectUri,
    pendingAuthVerifier,
    pendingAuthState,
  } = await getFromTokenStore([
    "pendingAuthTabId",
    "pendingAuthReqId",
    "pendingAuthRedirectUri",
    "pendingAuthVerifier",
    "pendingAuthState",
  ]);

  if (tabId !== pendingAuthTabId || !pendingAuthReqId) return;

  const url = changeInfo.url;
  if (!url.startsWith(pendingAuthRedirectUri)) return;

  await clearPendingAuth();
  chrome.tabs.remove(tabId).catch(() => {});

  const cb = pendingAuthCallbacks.get(pendingAuthReqId);
  pendingAuthCallbacks.delete(pendingAuthReqId);

  try {
    const result = extractAuthFromUrl(url);
    if (result.error) throw new Error(result.error);
    if (result.state !== pendingAuthState) throw new Error("OAuth state mismatch, aborting");
    if (!result.code) throw new Error("No authorization code in redirect");

    const token = await exchangeCodeForTokens(result.code, pendingAuthVerifier, pendingAuthRedirectUri);
    cb?.resolve(token);
    // no in-memory callback means the SW was restarted; notify all tabs so they can retry
    if (!cb) broadcastTokenReady();
  } catch (err) {
    cb?.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

async function onAuthTabRemoved(tabId) {
  const { pendingAuthTabId, pendingAuthReqId } = await getFromTokenStore([
    "pendingAuthTabId",
    "pendingAuthReqId",
  ]);
  if (tabId !== pendingAuthTabId || !pendingAuthReqId) return;

  await clearPendingAuth();
  const cb = pendingAuthCallbacks.get(pendingAuthReqId);
  pendingAuthCallbacks.delete(pendingAuthReqId);
  cb?.reject(new Error("Auth tab was closed"));
}

function broadcastTokenReady() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "AUTH_READY" }).catch(() => {});
    }
  });
}

function buildAuthUrl(redirectUri, codeChallenge, state) {
  // Fail with something readable instead of a generic OAuth error page.
  if (!CLIENT_ID || CLIENT_ID === "YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE") {
    throw new Error(
      "No OAuth Client ID configured. Copy config.template.js to config.js " +
        "and add your own (see README).",
    );
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: GMAIL_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    // access_type=offline is what makes Google issue a refresh token at all,
    // and it only re-issues one when the consent screen is actually shown.
    // The screen therefore appears once, not on every sign-in as before.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// The authorization-code flow returns ?code=...&state=... in the query string.
// The old implicit flow put an access token in the fragment instead, which is
// exactly why it could never produce a refresh token.
function extractAuthFromUrl(url) {
  try {
    const params = new URL(url).searchParams;
    return {
      code: params.get("code"),
      state: params.get("state"),
      error: params.get("error"),
    };
  } catch {
    return { code: null, state: null, error: null };
  }
}

const GMAIL_QUERY =
  'newer_than:1d (subject:code OR subject:verify OR subject:security OR subject:login ' +
  'OR subject:confirmation OR subject:authentication OR subject:account ' +
  'OR "verification" OR "one-time" OR "OTP" OR "2FA" OR "two-factor" OR "passcode" ' +
  'OR "Einmalcode" OR "Authentifizierung" OR "Bestätigungscode")';

async function fetchGmail(endpoint, token) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("GMAIL_ERROR_" + res.status);
  return res.json();
}

function extractBody(part, preferred = "text/plain") {
  if (!part) return "";
  if (part.mimeType === preferred && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const sub of part.parts) {
      const text = extractBody(sub, preferred);
      if (text) return text;
    }
    // fall back to HTML if no plain-text part exists
    if (preferred === "text/plain") {
      for (const sub of part.parts) {
        const html = extractBody(sub, "text/html");
        if (html) return stripHtml(html);
      }
    }
  }
  return "";
}

function decodeBase64Url(data) {
  try {
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

// Patterns run in priority order: labeled > Google prefix > hyphenated >
// bare digits > alphanumeric. All are /g so matchAll() can walk every
// occurrence; a fresh array per call keeps their lastIndex from leaking
// between invocations.
function otpPatterns() {
  return [
    // The label and the code may be separated by up to three words. The old
    // separator class excluded letters, so "Ihr Einmalcode lautet 934812"
    // never matched here and fell through to the bare-digit pattern.
    /(?:code|otp|pin|passcode|one[- ]?time\s*(?:password|code)?|verification\s*code|bestätigungscode|einmalcode|sicherheitscode|token)(?:\W+\w+){0,3}?\W{0,20}([A-Z0-9]{4,10})/gi,
    /\bG-([0-9]{6})\b/gi,
    /\b([0-9]{3})-([0-9]{3})\b/g,
    /\b([0-9]{6,8})\b/g,
    /(?<![A-Z0-9])([A-Z0-9]{6,8})(?![A-Z0-9])/gi,
  ];
}

function extractOTP(text, maxLen) {
  if (!text) return null;

  // hex color codes in HTML emails (e.g. #3a3a3a) would otherwise match as 6-digit codes
  const clean = text.replace(/#[0-9a-fA-F]{3,8}\b/g, " ");

  // when we know the input's maxlength, use it to prefer codes of exactly that length
  const lengthHint = maxLen >= 4 && maxLen <= 10 ? maxLen : null;

  const candidates = [];

  for (const p of otpPatterns()) {
    // Walk every occurrence, not just the first. A single word without digits
    // ("continue") used to consume the pattern and hide a real code later in
    // the same line.
    for (const m of clean.matchAll(p)) {
      const raw = m[2] ? m[1] + m[2] : (m[1] ?? m[0]);
      const code = raw.toUpperCase().replace(/-/g, "");
      if (!/\d/.test(code)) continue; // must contain at least one digit

      if (lengthHint && code.length === lengthHint) return code;
      candidates.push(code);
    }
  }

  return candidates[0] ?? null;
}

async function findLatestOTP(settings = {}) {
  const maxAge = settings.maxOTPAge ?? 10;

  let token = await getAuthToken();
  let listData;

  try {
    listData = await fetchGmail(
      `messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=10`,
      token,
    );
  } catch (e) {
    if (e.message === "UNAUTHORIZED") {
      // Token expired mid-request. Drop just the access token so getAuthToken()
      // renews it from the refresh token; calling clearToken() here would revoke
      // the grant and force the user through consent again for nothing.
      await clearAccessToken();
      token = await getAuthToken();
      listData = await fetchGmail(
        `messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=10`,
        token,
      );
    } else {
      throw e;
    }
  }

  const messageIds = (listData.messages ?? []).map((m) => m.id);
  if (messageIds.length === 0) return { otp: null };

  // fetch all candidates in parallel, then sort newest-first
  // Gmail's list order is by relevance, not chronological, so we must sort ourselves
  const details = await Promise.all(
    messageIds.map((id) => fetchGmail(`messages/${id}`, token).catch(() => null)),
  );

  const now = Date.now();
  const candidates = details
    .filter(Boolean)
    .sort((a, b) => parseInt(b.internalDate) - parseInt(a.internalDate));

  for (const msg of candidates) {
    const ageMins = (now - parseInt(msg.internalDate)) / 60000;
    // ageMins < -1 guards against slight clock skew between Gmail servers and local time
    if (ageMins < -1 || ageMins > maxAge) continue;

    const subject =
      msg.payload.headers.find((h) => h.name.toLowerCase() === "subject")?.value ??
      "(no subject)";

    const bodyText = extractBody(msg.payload);
    const combined = (msg.snippet ?? "") + " " + bodyText;
    const otp = extractOTP(combined, settings.inputMaxLen);

    if (otp) return { otp, subject, ageMins: Math.round(ageMins) };
  }

  return { otp: null };
}

// guard against multiple overlapping Gmail fetches triggered by rapid DOM mutations
let isFetching = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_OTP") {
    if (isFetching) {
      sendResponse({ status: "busy" });
      return false;
    }
    isFetching = true;
    const tabId = sender.tab?.id;

    getFromLocal(["maxOTPAge"]).then((settings) => {
      return findLatestOTP({ ...settings, inputMaxLen: msg.inputMaxLen });
    }).then((result) => {
      isFetching = false;
      if (tabId) chrome.tabs.sendMessage(tabId, { type: "OTP_RESULT", ...result }).catch(() => {});
    }).catch((err) => {
      isFetching = false;
      if (tabId) chrome.tabs.sendMessage(tabId, { type: "OTP_RESULT", otp: null, error: String(err) }).catch(() => {});
    });

    sendResponse({ status: "searching" });
    return false;
  }

  if (msg.type === "MANUAL_GET_OTP") {
    if (isFetching) { sendResponse({ status: "busy" }); return false; }
    isFetching = true;
    getFromLocal(["maxOTPAge"]).then((settings) => findLatestOTP(settings))
      .then((result) => { isFetching = false; sendResponse(result); })
      .catch((err) => { isFetching = false; sendResponse({ otp: null, error: String(err) }); });
    return true;
  }

  if (msg.type === "CHECK_AUTH") {
    // A stored refresh token counts as signed in. The access token lives in
    // session storage and is gone after every browser restart, but it can be
    // renewed silently, so its absence is not a sign-out.
    (async () => {
      const access = await getStoredToken();
      const refresh = await getRefreshToken();
      sendResponse({ authenticated: !!(access || refresh) });
    })();
    return true;
  }

  if (msg.type === "LOGIN") {
    getAuthToken(true)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "LOGOUT") {
    clearToken().then(() => sendResponse({ ok: true }));
    return true;
  }
});
