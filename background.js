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

// Firefox loads vocabulary.js through manifest background.scripts, ahead of
// this file. A Chromium service worker gets only the one entry point.
if (!globalThis.AAF_TERMS && typeof importScripts === "function") {
  importScripts("vocabulary.js");
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

// Firefox implements the chrome namespace with callbacks, so calling these
// without one returns undefined rather than a promise. Chrome accepts callbacks
// too, so wrapping them gives one code path that is correct in both engines.
function tabsCreate(properties) {
  return new Promise((resolve) => chrome.tabs.create(properties, resolve));
}

function tabsRemove(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => {
      // The tab may already be gone. Reading lastError marks it handled.
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function tabsSendMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      // No content script in that tab is the normal case, not a failure.
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

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
    const error = new Error(data.error_description || data.error || "Token request failed");
    // Keep the OAuth error code separate from the human-readable message, so
    // callers can tell a rejected grant apart from a temporary failure.
    error.code = data.error ?? null;
    throw error;
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
    // Only a rejected grant is permanent. Discarding the refresh token after a
    // dropped connection or a Google outage would sign the user out and send
    // them back through consent for a problem that fixes itself.
    if (err.code === "invalid_grant") await clearToken();
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
    const tab = await tabsCreate({ url: authUrl, active: true });
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
  tabsRemove(tabId);

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
      tabsSendMessage(tab.id, { type: "AUTH_READY" });
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

// Assembled from vocabulary.js. This query is a gate rather than a filter: a
// message it does not match is never fetched, so no amount of pattern matching
// further down can recover it. A new language needs its terms here before
// anything else will work.
const GMAIL_QUERY = globalThis.AAF_TERMS.gmailQuery;

// While waiting for a code the content script polls every few seconds. Without
// narrowing, every poll re-lists the same ten messages and downloads all their
// bodies again, which for a two-minute wait is around three hundred requests
// for mail that has not changed. Gmail's after: takes epoch seconds, so a poll
// that finds nothing new costs one empty list call and no downloads at all.
function gmailQueryFrom(notBefore) {
  if (!notBefore) return GMAIL_QUERY;
  return `${GMAIL_QUERY} after:${Math.floor(notBefore / 1000)}`;
}

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

const HTML_ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&#39;": "'", "&apos;": "'", "&zwnj;": "", "&shy;": "",
};

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    // Block boundaries become line breaks rather than spaces. Marketing mail
    // almost always presents the code alone in its own heading, cell or
    // paragraph, and collapsing everything to spaces destroys the only signal
    // that it stands apart from the sentence before it.
    .replace(/<\/?(?:p|div|br|tr|td|th|h[1-6]|li|ul|ol|table|section|header|footer|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;|&#\d+;/gi, (e) => HTML_ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s*\n\s*/g, "\n");
}

// Patterns run in priority order: labeled > Google prefix > hyphenated >
// bare digits > alphanumeric. All are /g so matchAll() can walk every
// occurrence; a fresh array per call keeps their lastIndex from leaking
// between invocations.
// Both come from vocabulary.js, which holds every language-dependent word in
// the extension. Add a language there, not here.
const SECURITY_LABEL = globalThis.AAF_TERMS.securityLabel;
const GENERIC_LABEL = globalThis.AAF_TERMS.genericLabel;

// Four to ten characters that may carry hyphens inside, which extractOTP
// strips. Slack sends "BYF-4UI", so a class that stops dead at the hyphen sees
// three characters and throws away a perfectly good code. It has to begin and
// end on an alphanumeric, or a trailing dash would be swallowed too.
const HYPHENATED_CODE = "([A-Za-z0-9][A-Za-z0-9-]{2,8}[A-Za-z0-9])";

// lettersOnlyOk marks the one pattern where a code containing no digits is
// accepted. Codes are not always numeric: Battle.net sends "RXCZMK". But
// [A-Za-z0-9]{6,8} also matches any ordinary word, so the relaxation is tied to
// layout rather than to spelling or capitalisation. Capitalisation would be the
// wrong test, since a lowercase code is equally valid.
function otpPatterns() {
  return [
    {
      // A security label, then the code after a colon. A few words may sit in
      // between, as in Steam's "Steam Guard code you need to login: K7Q2M".
      re: new RegExp(
        "(?:" + SECURITY_LABEL + ")(?:\\W+\\w+){0,4}?[^\\S\\n]*:\\s{0,10}" + HYPHENATED_CODE + "(?![A-Za-z0-9-])",
        "gi",
      ),
      lettersOnlyOk: true,
    },
    {
      // A security label, then the code alone on a following line, which is how
      // it appears once a heading or a bold cell has been flattened to text.
      //
      // Being alone on the line is the whole point. Without that check, a
      // subject of "Your verification code" followed by a body beginning with
      // any word would make that word look like a presented value.
      re: new RegExp(
        "(?:" + SECURITY_LABEL + ")[^\\n]{0,40}\\n[^\\S\\n]*" + HYPHENATED_CODE + "[^\\S\\n]*(?=\\n|$)",
        "gi",
      ),
      lettersOnlyOk: true,
    },
    {
      // Any label, with up to four words in between. A digit is required here.
      //
      // The old separator class excluded letters, so "Ihr Einmalcode lautet
      // 934812" matched no label at all and fell through to the bare digits.
      re: new RegExp(
        "(?:" + SECURITY_LABEL + "|" + GENERIC_LABEL + ")(?:\\W+\\w+){0,4}?\\W{0,20}" + HYPHENATED_CODE + "(?![A-Za-z0-9-])",
        "gi",
      ),
      lettersOnlyOk: false,
    },
    { re: /\bG-([0-9]{6})\b/gi, lettersOnlyOk: false },
    { re: /\b([0-9]{3})-([0-9]{3})\b/g, lettersOnlyOk: false },
    {
      // The same shape with letters in it, which is what Slack sends. Requiring
      // both a letter and a digit keeps ordinary hyphenated words out.
      re: /\b([A-Za-z0-9]{3})-([A-Za-z0-9]{3})\b/g,
      lettersOnlyOk: false,
      requireMixed: true,
    },
    { re: /\b([0-9]{6,8})\b/g, lettersOnlyOk: false },
    {
      // Unlabelled alphanumeric, down to four characters to reach Steam Guard's
      // five. Requiring both a letter and a digit is what makes that safe: it
      // excludes ordinary words and bare numbers such as a year or a price,
      // which the numeric patterns above already handle when they are codes.
      re: /(?<![A-Za-z0-9])([A-Za-z0-9]{4,8})(?![A-Za-z0-9])/gi,
      lettersOnlyOk: false,
      requireMixed: true,
    },
  ];
}

function looksLikeCode(code, { lettersOnlyOk, requireMixed }) {
  if (requireMixed) return /[A-Za-z]/.test(code) && /[0-9]/.test(code);
  return /\d/.test(code) || lettersOnlyOk;
}

// Parts of a hostname that say nothing about which service it is.
const HOST_NOISE = new Set([
  "www", "store", "shop", "accounts", "account", "login", "signin", "secure",
  "my", "app", "apps", "id", "auth", "web", "portal", "member", "members",
  "user", "users", "mail", "email", "support", "help", "checkout", "m", "en",
]);

// Not a real public suffix list, just the endings common enough to strip so a
// hostname reduces to the name of the service.
const HOST_SUFFIX = new Set([
  "com", "net", "org", "io", "tv", "co", "gg", "me", "dev", "app", "xyz",
  "info", "biz", "online", "site", "cloud", "games", "game", "live", "eu",
  "de", "at", "ch", "it", "fr", "es", "nl", "be", "pl", "uk", "us", "ca",
  "au", "jp", "cn", "ru", "br", "in",
]);

function siteTokens(host) {
  if (!host) return [];
  return host
    .toLowerCase()
    .split(".")
    .filter((part) => part && !HOST_NOISE.has(part) && !HOST_SUFFIX.has(part));
}

// One brand often owns several domains, so an exact comparison is too strict:
// steampowered.com and steamcommunity.com are the same service. A shared prefix
// of five characters is enough to treat two names as the same brand, and short
// enough that "battle" and "steampowered" stay unrelated.
function tokensRelated(a, b) {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return shared >= 5;
}

// Whether a message plausibly comes from the site the user is signing in to.
// Without this the newest code wins regardless of who sent it, and a code from
// one service gets typed into another's form.
function messageMatchesSite(pageTokens, fromHeader, subject) {
  if (pageTokens.length === 0) return true; // nothing to compare against

  const senderDomain = (fromHeader.match(/@([^\s>]+)/)?.[1] ?? "").toLowerCase();
  const senderTokens = siteTokens(senderDomain);
  if (pageTokens.some((p) => senderTokens.some((s) => tokensRelated(p, s)))) return true;

  // Some services send from an unrelated domain but name themselves in the
  // subject, as Battle.net does with "Battle.net Account Verification".
  const text = (fromHeader + " " + subject).toLowerCase();
  return pageTokens.some((token) => token.length >= 4 && text.includes(token));
}

function extractOTP(text, maxLen, exactLength) {
  if (!text) return null;

  // hex color codes in HTML emails (e.g. #3a3a3a) would otherwise match as 6-digit codes
  const clean = text.replace(/#[0-9a-fA-F]{3,8}\b/g, " ");

  // when we know the input's maxlength, use it to prefer codes of exactly that length
  const lengthHint = maxLen >= 4 && maxLen <= 10 ? maxLen : null;

  const candidates = [];

  for (const pattern of otpPatterns()) {
    const { re } = pattern;
    // Walk every occurrence, not just the first. A single word without digits
    // ("continue") used to consume the pattern and hide a real code later in
    // the same line.
    for (const m of clean.matchAll(re)) {
      const raw = m[2] ? m[1] + m[2] : (m[1] ?? m[0]);
      // Keep the original case. Most sites compare codes case-insensitively,
      // but not all, and upper-casing a lowercase code would break those.
      const code = raw.replace(/-/g, "");
      if (!looksLikeCode(code, pattern)) continue;

      // A split-digit widget has one box per character, so its box count is an
      // exact requirement rather than a preference. Filling a six-character
      // code into five boxes silently drops the last character and submits
      // something that was never the code.
      if (exactLength && code.length !== exactLength) continue;

      if (lengthHint && code.length === lengthHint) return code;
      candidates.push(code);
    }
  }

  return candidates[0] ?? null;
}

async function findLatestOTP(settings = {}) {
  const maxAge = settings.maxOTPAge ?? 10;

  const query = gmailQueryFrom(settings.notBefore);
  const listEndpoint = `messages?q=${encodeURIComponent(query)}&maxResults=10`;

  let token = await getAuthToken();
  let listData;

  try {
    listData = await fetchGmail(listEndpoint, token);
  } catch (e) {
    if (e.message === "UNAUTHORIZED") {
      // Token expired mid-request. Drop just the access token so getAuthToken()
      // renews it from the refresh token; calling clearToken() here would revoke
      // the grant and force the user through consent again for nothing.
      await clearAccessToken();
      token = await getAuthToken();
      listData = await fetchGmail(listEndpoint, token);
    } else {
      throw e;
    }
  }

  const messageIds = (listData.messages ?? []).map((m) => m.id);
  if (messageIds.length === 0) {
    return { otp: null, reason: "no mail matched the search" };
  }

  // fetch all candidates in parallel, then sort newest-first
  // Gmail's list order is by relevance, not chronological, so we must sort ourselves
  const details = await Promise.all(
    messageIds.map((id) => fetchGmail(`messages/${id}`, token).catch(() => null)),
  );

  const now = Date.now();
  const candidates = details
    .filter((m) => m && Number.isFinite(parseInt(m.internalDate)))
    .sort((a, b) => parseInt(b.internalDate) - parseInt(a.internalDate));

  const pageTokens = siteTokens(settings.siteHost);
  let unmatched = null;

  // Why nothing came back is worth reporting. From outside, mail that never
  // arrived, mail with no code in it and a code that does not fit the field
  // all look identical, and each needs a different fix.
  let examined = 0;
  let wrongLength = false;

  for (const msg of candidates) {
    const sentAt = parseInt(msg.internalDate);
    const ageMins = (now - sentAt) / 60000;
    // ageMins < -1 guards against slight clock skew between Gmail servers and local time
    if (ageMins < -1 || ageMins > maxAge) continue;

    // The caller can demand a code newer than a given moment. On a second
    // sign-in the previous code is often still inside the age limit and would
    // otherwise win, being the newest one that exists at that instant.
    if (settings.notBefore && sentAt < settings.notBefore) continue;

    const header = (name) =>
      msg.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";

    const subject = header("subject") || "(no subject)";
    const from = header("from");

    const bodyText = extractBody(msg.payload);
    // The subject is searched too. Plenty of services put the code in it, as in
    // "123456 is your verification code", and some put it nowhere else.
    // Newlines keep the three sources from running into one another and
    // forming a match that exists in neither.
    const combined = subject + "\n" + (msg.snippet ?? "") + "\n" + bodyText;
    examined++;

    const otp = extractOTP(combined, settings.inputMaxLen, settings.exactLength);
    if (!otp) {
      // Running it again without the length requirement separates "there is
      // no code here" from "the code does not fit these boxes".
      if (settings.exactLength && extractOTP(combined, settings.inputMaxLen)) {
        wrongLength = true;
      }
      continue;
    }

    // "Battle.net <noreply@battle.net>" reduced to "Battle.net", for the overlay.
    const sender = from.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || from;
    const result = { otp, subject, sender, ageMins: Math.round(ageMins) };

    if (messageMatchesSite(pageTokens, from, subject)) {
      return { ...result, matchesSite: true };
    }

    // Hold the newest code from an unrelated sender as a fallback, but keep
    // looking: a matching message further down is the better answer even though
    // it is older.
    if (!unmatched) unmatched = { ...result, matchesSite: false };
  }

  if (unmatched) return unmatched;

  let reason = `${examined} message(s) checked, no code found in them`;
  if (examined === 0) reason = "mail matched the search but all of it was too old";
  else if (wrongLength) reason = `a code was found but it does not fit ${settings.exactLength} boxes`;

  return { otp: null, reason };
}

// Guards against overlapping Gmail fetches triggered by rapid DOM mutations.
//
// The lock also expires on its own. A lookup that needs interactive sign-in
// waits on a consent tab the user may simply never finish, and without a
// ceiling that one request would hold the lock for the rest of the session and
// every later request would be told "busy".
const FETCH_LOCK_TIMEOUT_MS = 120000;

let isFetching = false;
let fetchLockTimer = null;

function acquireFetchLock() {
  if (isFetching) return false;
  isFetching = true;
  clearTimeout(fetchLockTimer);
  fetchLockTimer = setTimeout(() => { isFetching = false; }, FETCH_LOCK_TIMEOUT_MS);
  return true;
}

function releaseFetchLock() {
  isFetching = false;
  clearTimeout(fetchLockTimer);
}

// Errors reach the overlay as text, which prefixes them with "Error: ".
// Passing String(err) would render "Error: Error: ...".
function errorText(err) {
  return err?.message ?? String(err);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_OTP") {
    if (!acquireFetchLock()) {
      sendResponse({ status: "busy" });
      return false;
    }
    const tabId = sender.tab?.id;

    getFromLocal(["maxOTPAge"]).then((settings) => {
      return findLatestOTP({
        ...settings,
        inputMaxLen: msg.inputMaxLen,
        exactLength: msg.exactLength,
        notBefore: msg.notBefore,
        siteHost: msg.siteHost,
      });
    }).then((result) => {
      releaseFetchLock();
      if (tabId) tabsSendMessage(tabId, { type: "OTP_RESULT", ...result });
    }).catch((err) => {
      releaseFetchLock();
      if (tabId) tabsSendMessage(tabId, { type: "OTP_RESULT", otp: null, error: errorText(err) });
    });

    sendResponse({ status: "searching" });
    return false;
  }

  if (msg.type === "MANUAL_GET_OTP") {
    if (!acquireFetchLock()) { sendResponse({ status: "busy" }); return false; }
    getFromLocal(["maxOTPAge"]).then((settings) => findLatestOTP(settings))
      .then((result) => { releaseFetchLock(); sendResponse(result); })
      .catch((err) => { releaseFetchLock(); sendResponse({ otp: null, error: errorText(err) }); });
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
