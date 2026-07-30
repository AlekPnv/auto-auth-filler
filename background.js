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
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_LIFETIME_MS = 3600 * 1000;
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// session storage clears automatically on browser close; local is the fallback for Firefox < 115
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

async function saveToken(token, expiresInSec = null) {
  // Google's redirect normally includes expires_in (seconds); fall back to the
  // default lifetime only if it is missing or looks unreasonable
  const lifetimeMs =
    Number.isFinite(expiresInSec) && expiresInSec > 60
      ? expiresInSec * 1000
      : TOKEN_LIFETIME_MS;

  await setInTokenStore({
    googleToken: token,
    googleTokenExpiry: Date.now() + lifetimeMs,
  });
}

async function clearToken() {
  await setInTokenStore({ googleToken: null, googleTokenExpiry: null });
}

function isFirefox() {
  return chrome.runtime.getURL("").startsWith("moz-extension://");
}

async function getAuthToken(forceNew = false) {
  if (!forceNew) {
    const saved = await getStoredToken();
    if (saved) return saved;
  }
  return isFirefox() ? authenticateFirefox() : authenticateChrome();
}

function authenticateChrome() {
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = buildAuthUrl(redirectUri);

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(new Error(chrome.runtime.lastError?.message ?? "Auth cancelled"));
        return;
      }
      const { token, expiresInSec } = extractAuthFromUrl(responseUrl);
      if (!token) {
        reject(new Error("No access_token in OAuth response"));
        return;
      }
      saveToken(token, expiresInSec).then(() => resolve(token));
    });
  });
}

// Firefox does not reliably support launchWebAuthFlow with Google OAuth, so we open
// a real tab instead and intercept the redirect URL via the tabs.onUpdated listener
function authenticateFirefox() {
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = buildAuthUrl(redirectUri);

  return new Promise((resolve, reject) => {
    const reqId = Date.now().toString();
    // keyed by reqId so the tab listener can resolve the right promise if the SW restarts mid-auth
    pendingAuthCallbacks.set(reqId, { resolve, reject });

    setInTokenStore({ pendingAuthReqId: reqId, pendingAuthRedirectUri: redirectUri })
      .then(() => chrome.tabs.create({ url: authUrl, active: true }))
      .then((tab) => setInTokenStore({ pendingAuthTabId: tab.id }))
      .catch((err) => {
        pendingAuthCallbacks.delete(reqId);
        reject(new Error("Could not open auth tab: " + err));
      });
  });
}

// in-memory map; survives for the current SW lifetime only
// state is also written to storage so the tab listeners can re-resolve it after an SW restart
const pendingAuthCallbacks = new Map();

async function onAuthTabUpdated(tabId, changeInfo) {
  if (!changeInfo.url) return;

  const { pendingAuthTabId, pendingAuthReqId, pendingAuthRedirectUri } =
    await getFromTokenStore(["pendingAuthTabId", "pendingAuthReqId", "pendingAuthRedirectUri"]);

  if (tabId !== pendingAuthTabId || !pendingAuthReqId) return;

  const url = changeInfo.url;
  if (!url.startsWith(pendingAuthRedirectUri)) return;

  await setInTokenStore({ pendingAuthTabId: null, pendingAuthReqId: null, pendingAuthRedirectUri: null });
  chrome.tabs.remove(tabId).catch(() => {});

  const { token, expiresInSec } = extractAuthFromUrl(url);
  const cb = pendingAuthCallbacks.get(pendingAuthReqId);
  pendingAuthCallbacks.delete(pendingAuthReqId);

  if (token) {
    await saveToken(token, expiresInSec);
    cb?.resolve(token);
    // no in-memory callback means the SW was restarted; notify all tabs so they can retry
    if (!cb) broadcastTokenReady();
  } else {
    const errMatch = url.match(/error=([^&]+)/);
    const msg = errMatch ? decodeURIComponent(errMatch[1]) : "No token in redirect";
    cb?.reject(new Error(msg));
  }
}

async function onAuthTabRemoved(tabId) {
  const { pendingAuthTabId, pendingAuthReqId } = await getFromTokenStore([
    "pendingAuthTabId",
    "pendingAuthReqId",
  ]);
  if (tabId !== pendingAuthTabId || !pendingAuthReqId) return;

  await setInTokenStore({ pendingAuthTabId: null, pendingAuthReqId: null, pendingAuthRedirectUri: null });
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

function buildAuthUrl(redirectUri) {
  // Fail with something readable instead of a generic OAuth error page.
  if (!CLIENT_ID || CLIENT_ID === "YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE") {
    throw new Error(
      "No OAuth Client ID configured. Copy config.template.js to config.js " +
        "and add your own (see README).",
    );
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "token",
    redirect_uri: redirectUri,
    scope: GMAIL_SCOPE,
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function extractAuthFromUrl(url) {
  // Google returns the token in the fragment (#access_token=...&expires_in=...), normalise it to a query string
  const normalized = url.replace("#", "?");
  try {
    const params = new URL(normalized).searchParams;
    const token = params.get("access_token") ?? null;
    const expiresInRaw = params.get("expires_in");
    const expiresInSec = expiresInRaw ? parseInt(expiresInRaw, 10) : null;
    return { token, expiresInSec: Number.isFinite(expiresInSec) ? expiresInSec : null };
  } catch {
    return { token: null, expiresInSec: null };
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
      // token expired mid-session; clear and force a fresh one
      await clearToken();
      token = await getAuthToken(true);
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
    getStoredToken().then((token) => sendResponse({ authenticated: !!token }));
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
