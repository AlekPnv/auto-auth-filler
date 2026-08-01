// Tests for the pure logic in background.js: code extraction, PKCE, and the
// OAuth URL handling. Run with `node --test` from the project root. No
// dependencies, no test framework to install.
//
// background.js expects a browser extension environment, so it is evaluated in
// a vm context with the few chrome APIs it touches at load time stubbed out.
// Nothing here performs network access.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function loadBackground(config = { CLIENT_ID: "test-id", CLIENT_SECRET: "test-secret" }) {
  const noop = () => {};
  const listener = { addListener: noop };
  const store = { get: (k, cb) => cb && cb({}), set: (d, cb) => cb && cb() };

  const sandbox = {
    console: { error: noop, log: noop, warn: noop },
    fetch: noop,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    Uint8Array, URL, URLSearchParams, Date, Promise, Math, JSON,
    parseInt, Number, Array, Object, String, RegExp, setTimeout,
    clearTimeout, Error,
    chrome: {
      storage: { local: store, session: store },
      tabs: { onUpdated: listener, onRemoved: listener },
      runtime: { onMessage: listener, getURL: () => "moz-extension://test/" },
      identity: { getRedirectURL: () => "https://test.example/" },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // config.js normally does this, and background.js reads it at load time.
  sandbox.AAF_CONFIG = config;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "background.js"), "utf8"), sandbox);

  return {
    call: (expr) => vm.runInContext(expr, sandbox),
    extractOTP: sandbox.extractOTP,
  };
}

const bg = loadBackground();

test("extractOTP finds the code in real-world emails", async (t) => {
  const cases = [
    ["Google G-prefix", "G-417293 is your Google verification code.", "417293"],
    ["labelled code", "Here is your GitHub authentication code: 682145", "682145"],
    ["German Einmalcode", "Ihr Einmalcode lautet 934812. Er ist 10 Minuten gültig.", "934812"],
    ["German Bestätigungscode", "Ihr Bestätigungscode: 556677", "556677"],
    ["hyphenated 3-3", "Your verification code is 481-902", "481902"],
    ["HTML with a hex colour", '<td style="background:#3a3a3a">Your code is 552104</td>', "552104"],
    ["no code present", "Thanks for signing up. Welcome aboard.", null],
  ];

  for (const [name, body, expected] of cases) {
    await t.test(name, () => {
      assert.strictEqual(bg.extractOTP(body), expected);
    });
  }
});

test("extractOTP keeps looking after a match without digits", () => {
  // The alphanumeric pattern matches the word "continue" first. Abandoning the
  // pattern at that point used to lose the code entirely.
  assert.strictEqual(bg.extractOTP("Enter this code to continue: 7FK2QA"), "7FK2QA");
});

test("extractOTP prefers a labelled code over an unrelated number", () => {
  const body = "Order 12345678 shipped. Your login code: 998877";
  assert.strictEqual(bg.extractOTP(body), "998877");
});

test("extractOTP tolerates words between the label and the code", () => {
  assert.strictEqual(bg.extractOTP("Your security code is now 334455"), "334455");
});

test("extractOTP honours the field length hint", () => {
  // Two candidates of different lengths; the hint picks the matching one.
  const body = "Reference 12345678 and your code 4821";
  assert.strictEqual(bg.extractOTP(body, 4), "4821");
});

test("extractOTP ignores an empty body", () => {
  assert.strictEqual(bg.extractOTP(""), null);
  assert.strictEqual(bg.extractOTP(null), null);
});

test("PKCE challenge matches the RFC 7636 test vector", async () => {
  // Appendix B of RFC 7636. If this fails, the whole OAuth flow is wrong.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  const actual = await bg.call(`pkceChallenge(${JSON.stringify(verifier)})`);
  assert.strictEqual(actual, expected);
});

test("PKCE verifiers are random and URL-safe", () => {
  const a = bg.call("randomUrlSafe(48)");
  const b = bg.call("randomUrlSafe(48)");

  assert.notStrictEqual(a, b, "two verifiers must not be identical");
  for (const v of [a, b]) {
    assert.match(v, /^[A-Za-z0-9\-._~]+$/, "must use only unreserved characters");
    assert.ok(v.length >= 43 && v.length <= 128, `length ${v.length} outside RFC range`);
  }
});

test("the authorization URL asks for a code and a refresh token", () => {
  const url = new URL(bg.call('buildAuthUrl("https://test.example/", "CHALLENGE", "STATE")'));
  const p = url.searchParams;

  assert.strictEqual(p.get("response_type"), "code");
  assert.strictEqual(p.get("code_challenge"), "CHALLENGE");
  assert.strictEqual(p.get("code_challenge_method"), "S256");
  assert.strictEqual(p.get("state"), "STATE");
  // Without access_type=offline Google issues no refresh token at all.
  assert.strictEqual(p.get("access_type"), "offline");
  assert.strictEqual(p.get("scope"), "https://www.googleapis.com/auth/gmail.readonly");
});

test("buildAuthUrl fails loudly when the client is not configured", async (t) => {
  // A missing or unedited config.js should produce a readable message, not an
  // opaque error page from Google after the user has already clicked sign in.
  const unconfigured = {
    "no config at all": null,
    "template left unedited": { CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE" },
  };

  for (const [name, config] of Object.entries(unconfigured)) {
    await t.test(name, () => {
      const instance = loadBackground(config);
      assert.throws(
        () => instance.call('buildAuthUrl("https://test.example/", "C", "S")'),
        /No OAuth Client ID configured/,
      );
    });
  }
});

test("the redirect is parsed from the query string", () => {
  const ok = bg.call('extractAuthFromUrl("https://test.example/?code=4%2FABC&state=XYZ")');
  assert.strictEqual(ok.code, "4/ABC");
  assert.strictEqual(ok.state, "XYZ");
  assert.strictEqual(ok.error, null);

  const denied = bg.call('extractAuthFromUrl("https://test.example/?error=access_denied")');
  assert.strictEqual(denied.error, "access_denied");
  assert.strictEqual(denied.code, null);

  const junk = bg.call('extractAuthFromUrl("not a url")');
  assert.strictEqual(junk.code, null);
});
