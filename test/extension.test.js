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
  // vocabulary.js holds every language-dependent term and must load first,
  // exactly as the manifest arranges in the browser.
  vm.runInContext(fs.readFileSync(path.join(ROOT, "vocabulary.js"), "utf8"), sandbox);
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

test("extractOTP reads the wording the large services actually use", async (t) => {
  // Each of these mirrors the phrasing of a real provider. They differ enough
  // that a single pattern cannot cover them, which is why the label list is
  // long and the separator rules are loose.
  const providers = [
    ["Blizzard", "Here is your security code:\nRXCZMK", "RXCZMK"],
    ["Steam Guard", "Here is the Steam Guard code you need to login: K7Q2M", "K7Q2M"],
    ["Epic Games", "Your security code is: 481902", "481902"],
    ["Twitch", "Your Twitch verification code is 123456", "123456"],
    ["Discord", "Your Discord verification code is 934812", "934812"],
    ["Amazon", "Your one-time password (OTP) is 552104", "552104"],
    ["Microsoft", "Use this code for Microsoft account security: 1234567", "1234567"],
    ["Apple", "Your Apple Account code is: 682145", "682145"],
    ["PayPal", "Your security code is 998877", "998877"],
    ["Netflix", "Your verification code: 4821", "4821"],
    ["GitHub", "your GitHub verification code is 556677", "556677"],
    ["Google", "G-417293 is your Google verification code.", "417293"],
  ];

  for (const [name, body, expected] of providers) {
    await t.test(name, () => assert.strictEqual(bg.extractOTP(body), expected));
  }
});

test("a code counts as presented only when it stands alone", () => {
  // The subject is searched alongside the body. A subject of "Your verification
  // code" followed by a body beginning with any word puts that word directly
  // after a label and on its own line, which briefly made "Your" a valid code.
  const subjectThenBody = "Your verification code\nYour verification code: 222222";
  assert.strictEqual(bg.extractOTP(subjectThenBody), "222222");

  // Prose on the following line is not a presented value.
  assert.strictEqual(bg.extractOTP("Your verification code\nPlease wait for it"), null);
  assert.strictEqual(bg.extractOTP("Your security code\nis on its way to you"), null);
});

test("stripHtml keeps the code separate from the sentence before it", () => {
  // Providers usually put the code alone in a heading or a bold cell, with no
  // colon anywhere. Collapsing the markup to spaces would join it to the
  // preceding text and lose the only sign that it stands on its own.
  const html =
    "<html><body><p>Your verification code</p><h1><b>RXCZMK</b></h1>" +
    "<p>expires in 10 minutes</p></body></html>";

  const text = bg.call(`stripHtml(${JSON.stringify(html)})`);
  assert.match(text, /verification code\nRXCZMK/, "block boundaries must become line breaks");
  assert.strictEqual(bg.extractOTP(text), "RXCZMK");
});

test("stripHtml decodes the entities that surround a code", () => {
  const text = bg.call('stripHtml("<p>Security code:&nbsp;<b>4821</b></p>")');
  assert.ok(!text.includes("&nbsp;"), "entities must not survive into the text");
  assert.strictEqual(bg.extractOTP(text), "4821");
});

test("extractOTP handles codes of every shape", async (t) => {
  // Codes are not always numeric and not always upper case. Battle.net sends
  // "RXCZMK"; requiring a digit used to match it and then throw it away.
  const shapes = [
    ["letters only, upper case", "Here is your security code:\nRXCZMK", "RXCZMK"],
    ["letters only, lower case", "Here is your security code:\nrxczmk", "rxczmk"],
    ["letters only, mixed case", "Your verification code: RxCzMk", "RxCzMk"],
    ["digits only", "Your verification code: 481902", "481902"],
    ["alphanumeric", "Your security code: 7FK2QA", "7FK2QA"],
    ["code on its own line", "Your one-time password\n\nQ4RT9B", "Q4RT9B"],
  ];

  for (const [name, body, expected] of shapes) {
    await t.test(name, () => assert.strictEqual(bg.extractOTP(body), expected));
  }
});

test("extractOTP preserves the case it found", () => {
  // Most sites compare case-insensitively, but not all. Upper-casing a
  // lowercase code would break those, so the original is filled verbatim.
  assert.strictEqual(bg.extractOTP("Your security code: abcdef"), "abcdef");
  assert.strictEqual(bg.extractOTP("Your security code: AbC123"), "AbC123");
});

test("extractOTP rejects letters-only text that is not a presented code", async (t) => {
  // The relaxation is tied to layout: a security label presenting a value after
  // a colon or on its own line. Everything else still needs a digit.
  const notCodes = [
    ["ordinary prose after a generic label", "Enter this code to continue with setup"],
    ["promotional code", "Use code SUMMER for 20% off your next order"],
    ["label with no presented value", "Your verification code below expires soon"],
    ["nothing code-like at all", "Thanks for signing up. Welcome aboard."],
  ];

  for (const [name, body] of notCodes) {
    await t.test(name, () => assert.strictEqual(bg.extractOTP(body), null));
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

test("findLatestOTP skips codes older than notBefore", async (t) => {
  // The scenario this exists for: signing in a second time, when the previous
  // code is still inside the age limit and is the newest one that exists at
  // the moment of the search. Filling it wastes the user's time.
  const minute = 60000;

  const message = (id, sentAgoMs, code) => ({
    id,
    internalDate: String(Date.now() - sentAgoMs),
    snippet: "",
    payload: {
      headers: [{ name: "Subject", value: "Your verification code" }],
      mimeType: "text/plain",
      body: { data: Buffer.from(`Your verification code: ${code}`).toString("base64url") },
    },
  });

  function withMessages(messages) {
    const instance = loadBackground();
    // Stub the Gmail layer: the list call, then one call per message id.
    instance.call(`
      fetchGmail = async (endpoint) => {
        if (endpoint.startsWith("messages?")) {
          return { messages: ${JSON.stringify(messages.map((m) => ({ id: m.id })))} };
        }
        const id = endpoint.split("/")[1];
        return ${JSON.stringify(Object.fromEntries(messages.map((m) => [m.id, m])))}[id];
      };
      getAuthToken = async () => "test-token";
    `);
    return instance;
  }

  const stale = message("old", 6 * minute, "111111");
  const fresh = message("new", 10000, "222222");

  await t.test("without notBefore the newest wins", async () => {
    const bgx = withMessages([stale, fresh]);
    const result = await bgx.call("findLatestOTP({ maxOTPAge: 10 })");
    assert.strictEqual(result.otp, "222222");
  });

  await t.test("a stale code alone is used when nothing is required", async () => {
    const bgx = withMessages([stale]);
    const result = await bgx.call("findLatestOTP({ maxOTPAge: 10 })");
    assert.strictEqual(result.otp, "111111");
  });

  await t.test("a stale code alone is refused once notBefore is set", async () => {
    const bgx = withMessages([stale]);
    const cutoff = Date.now() - 90000;
    const result = await bgx.call(`findLatestOTP({ maxOTPAge: 10, notBefore: ${cutoff} })`);
    assert.strictEqual(result.otp, null, "the previous attempt's code must not be filled");
  });

  await t.test("a fresh code passes the same cutoff", async () => {
    const bgx = withMessages([stale, fresh]);
    const cutoff = Date.now() - 90000;
    const result = await bgx.call(`findLatestOTP({ maxOTPAge: 10, notBefore: ${cutoff} })`);
    assert.strictEqual(result.otp, "222222");
  });
});

test("a code is only offered for the site that sent it", async (t) => {
  // Filling one service's code into another's form is the extension actively
  // doing the wrong thing, and auto-submit can send it before anyone reads it.
  const cases = [
    ["Steam page, Steam mail", "store.steampowered.com",
      "Steam <noreply@steampowered.com>", "Your Steam Guard code", true],
    ["Steam page, Blizzard mail", "store.steampowered.com",
      "Battle.net <noreply@battle.net>", "Battle.net Account Verification", false],
    ["Blizzard page, Blizzard mail", "battle.net",
      "Battle.net <noreply@battle.net>", "Battle.net Account Verification", true],
    ["same brand, different domain", "steamcommunity.com",
      "Steam <noreply@steampowered.com>", "Steam Guard", true],
    ["brand named only in the subject", "battle.net",
      "Blizzard <no-reply@blizzard.com>", "Your Battle.net code", true],
    ["unrelated sender entirely", "twitch.tv",
      "PayPal <service@paypal.com>", "Your security code", false],
    // notion.so once reduced to ["notion", "so"], and "so" is inside "sony",
    // so a Sony code would have been typed into Notion's form.
    ["short ccTLD is not a brand", "www.notion.so",
      "Sony <no-reply@sony.com>", "Your verification code", false],
    ["the real sender still matches", "www.notion.so",
      "Notion <no-reply@notion.so>", "Your login code", true],
  ];

  for (const [name, host, from, subject, expected] of cases) {
    await t.test(name, () => {
      const matched = bg.call(
        `messageMatchesSite(siteTokens(${JSON.stringify(host)}), ` +
        `${JSON.stringify(from)}, ${JSON.stringify(subject)})`,
      );
      assert.strictEqual(matched, expected);
    });
  }
});

test("a hostname reduces to the name of the service", () => {
  const reduce = (host) => bg.call(`siteTokens(${JSON.stringify(host)})`).join(",");

  assert.strictEqual(reduce("store.steampowered.com"), "steampowered");
  assert.strictEqual(reduce("battle.net"), "battle");
  assert.strictEqual(reduce("www.epicgames.com"), "epicgames");
  assert.strictEqual(reduce("id.twitch.tv"), "twitch");
  assert.strictEqual(reduce("accounts.google.com"), "google");
  assert.strictEqual(reduce("amazon.de"), "amazon");
  // Services that use a short ccTLD as their whole domain.
  assert.strictEqual(reduce("www.notion.so"), "notion");
  assert.strictEqual(reduce("bit.ly"), "bit");
});

test("a code that does not fit the boxes is refused", () => {
  // Split-digit widgets hold one character per box, so the count is exact.
  // A six-character code in five boxes silently loses its last character and
  // submits something that was never the code.
  const body = "Your security code:\nRXCZMK";

  assert.strictEqual(bg.extractOTP(body), "RXCZMK", "no constraint, found normally");
  assert.strictEqual(bg.extractOTP(body, undefined, 6), "RXCZMK", "six boxes fit");
  assert.strictEqual(bg.extractOTP(body, undefined, 5), null, "five boxes must refuse it");
  assert.strictEqual(bg.extractOTP(body, undefined, 8), null, "eight boxes must refuse it");
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

test("hyphenated alphanumeric codes are read, as Slack sends them", () => {
  // Slack's code is "BYF-4UI". Every capture class stopped at the hyphen, so
  // "BYF" was three characters and failed the minimum length, and the
  // hyphenated pattern accepted digits only. The mail was found and the code
  // was visible in it, and nothing could match it.
  const slack = [
    "Slack confirmation code: BYF-4UI",
    "",
    "Confirm your email address",
    "Here is your confirmation code. You can copy it into the open browser",
    "window or click the link below to confirm this email address.",
    "BYF-4UI",
    "CONFIRM AND SIGN IN",
  ].join("\n");

  assert.strictEqual(bg.extractOTP(slack), "BYF4UI");
  // Slack shows six boxes, so the hyphen has to be stripped before the length
  // is judged or the code would be refused for not fitting.
  assert.strictEqual(bg.extractOTP(slack, undefined, 6), "BYF4UI");
});

test("hyphens do not let ordinary text through", async (t) => {
  const notCodes = [
    ["hyphenated words", "Your code is well-known to everyone"],
    ["a date", "Your code expires on 2026-08-01"],
    ["no digits at all", "Please use the well-worn path"],
  ];

  for (const [name, body] of notCodes) {
    await t.test(name, () => {
      const found = bg.extractOTP(body);
      assert.ok(
        found === null || /\d/.test(found),
        `matched ${JSON.stringify(found)}, which is not code-like`,
      );
    });
  }
});

test("a message with no code in it yields no code", async (t) => {
  // Reported on namecheap.com. A password reset mail carries no one-time code
  // at all, yet the extension offered one: the catch-all pattern matched the
  // account's user name and the overlay presented it as the code to type.
  //
  // Returning nothing is the correct answer here. A wrong code is worse than
  // no code, because the user types it, the site rejects it, and the next
  // lookup is now racing a lockout counter.
  const resetMail = [
    "Account Password Reset",
    "Namecheap.com Password Reset",
    "Dear Alek,",
    "To reset the password to your account, click the link below:",
    "https://www.example.com/resetpassword.aspx?token=z2ee59f8b123d1368bef8a6d4b2864d66",
    "For your information:",
    "User Name : Zortu9K",
    "Time of Request : Friday, 16 October 2026",
    "IP Address : 45.65.121.143",
  ].join("\n");

  await t.test("the user name is not offered as a code", () => {
    assert.strictEqual(bg.extractOTP(resetMail), null);
  });

  await t.test("nor is it offered when a field length is known", () => {
    assert.strictEqual(bg.extractOTP(resetMail, 7), null);
  });
});

test("a code is found even when markup separates it from its label", async (t) => {
  // Also namecheap.com, the mail that actually carried the code. The label and
  // the code are in different table cells, so the gap between them holds a
  // newline and a pipe. The labelled patterns gave up, and the fallback then
  // matched the Gecko build date out of the User-Agent line instead.
  const verifyMail = [
    "Your confirmation code",
    "Sign-in from unauthorized device detected",
    " Namecheap",
    "| # Verification needed Please confirm your sign-in request |",
    "| - | Account: Zortu9K |",
    "| - | Device: Mozilla 5.0 (Windows NT 10.0 Win64 x64 rv 158.0) Gecko 20100101 Firefox 158.0 |",
    "",
    "To verify your account is safe, please use the following code to enable",
    "your new device - it will expire in 30 minutes:",
    "",
    "| 7b3ca2 |",
  ].join("\n");

  await t.test("the real code is returned", () => {
    assert.strictEqual(bg.extractOTP(verifyMail), "7b3ca2");
  });

  await t.test("the browser build number is never the answer", () => {
    assert.notStrictEqual(bg.extractOTP(verifyMail), "20100101");
  });

  await t.test("the account name is never the answer", () => {
    assert.notStrictEqual(bg.extractOTP(verifyMail), "Zortu9K");
  });

  await t.test("nor is the brand name sitting alone on its own line", () => {
    // These mails open with the sender name alone under the subject, one line
    // below the words "confirmation code".
    assert.notStrictEqual(bg.extractOTP(verifyMail), "Namecheap");
  });
});

test("the manual lookup receives the same page context as the automatic one", () => {
  // The popup asked for a code with nothing but maxOTPAge. With no siteHost the
  // site check inside findLatestOTP short-circuits to true for every message,
  // so the popup presented whatever was newest regardless of who sent it, while
  // the overlay on the same page was filtering properly. Reported on
  // namecheap.com.
  //
  // This reads the sources as text because the bug is an omission at a call
  // site. There is nothing to assert about a value that was never passed.
  const bgSrc = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
  const start = bgSrc.indexOf('msg.type === "MANUAL_GET_OTP"');
  assert.notStrictEqual(start, -1, "the MANUAL_GET_OTP handler has gone");
  const handler = bgSrc.slice(start, bgSrc.indexOf("return true;", start));
  assert.ok(
    handler.includes("siteHost: msg.siteHost"),
    "MANUAL_GET_OTP must forward siteHost into the lookup",
  );

  const popupSrc = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
  assert.ok(popupSrc.includes("siteHost"), "the popup must send the active tab's host");
  assert.ok(
    popupSrc.includes("matchesSite"),
    "the popup must say when a code came from a different sender",
  );
});

test("every icon the manifest declares exists at the size it claims", () => {
  // A manifest can name a 48px icon and ship a 16px one. The browser scales it
  // and nobody notices until the store listing looks soft. The icons are
  // generated by tools/make-icons.py, so a regeneration that changes a size is
  // exactly the kind of thing that slips through.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const declared = { ...(manifest.icons ?? {}), ...(manifest.action?.default_icon ?? {}) };
  assert.ok(Object.keys(declared).length > 0, "the manifest declares no icons at all");

  for (const [size, file] of Object.entries(declared)) {
    const png = fs.readFileSync(path.join(ROOT, file));
    // A PNG keeps its dimensions as big-endian 32-bit values inside the IHDR
    // chunk, which always begins at byte 8. No decoder needed to read them.
    assert.strictEqual(png.toString("ascii", 12, 16), "IHDR", `${file} is not a PNG`);
    assert.strictEqual(png.readUInt32BE(16), Number(size),
      `${file} is ${png.readUInt32BE(16)}px wide but declared as ${size}`);
    assert.strictEqual(png.readUInt32BE(20), Number(size),
      `${file} is ${png.readUInt32BE(20)}px tall but declared as ${size}`);
  }
});

test("a code the user rejected is not offered again", async (t) => {
  // "Not this one" is the only way out when two services mail inside the same
  // minute, or when one service sends a password reset and a sign-in code
  // together. Without a skip list the next lookup hands back the same code,
  // because it is still the newest thing that matches and every tiebreak still
  // lands on it.
  const minute = 60000;

  const message = (id, agoMs, from, code) => ({
    id,
    internalDate: String(Date.now() - agoMs),
    snippet: "",
    payload: {
      headers: [
        { name: "Subject", value: "Your verification code" },
        { name: "From", value: from },
      ],
      mimeType: "text/plain",
      body: { data: Buffer.from(`Your verification code: ${code}`).toString("base64url") },
    },
  });

  function withMessages(messages) {
    const instance = loadBackground();
    instance.call(`
      fetchGmail = async (endpoint) => {
        if (endpoint.startsWith("messages?")) {
          return { messages: ${JSON.stringify(messages.map((m) => ({ id: m.id })))} };
        }
        const id = endpoint.split("/")[1];
        return ${JSON.stringify(Object.fromEntries(messages.map((m) => [m.id, m])))}[id];
      };
      getAuthToken = async () => "test-token";
    `);
    return instance;
  }

  const newer = message("newer", 10000, "Example <no-reply@example.com>", "111111");
  const older = message("older", 2 * minute, "Example <no-reply@example.com>", "222222");

  await t.test("the newest wins when nothing is rejected", async () => {
    const bgx = withMessages([newer, older]);
    const result = await bgx.call('findLatestOTP({ maxOTPAge: 10, siteHost: "example.com" })');
    assert.strictEqual(result.otp, "111111");
  });

  await t.test("rejecting it moves on to the next one", async () => {
    const bgx = withMessages([newer, older]);
    const result = await bgx.call(
      'findLatestOTP({ maxOTPAge: 10, siteHost: "example.com", skip: ["111111"] })',
    );
    assert.strictEqual(result.otp, "222222");
  });

  await t.test("rejecting every candidate says so rather than going quiet", async () => {
    const bgx = withMessages([newer, older]);
    const result = await bgx.call(
      'findLatestOTP({ maxOTPAge: 10, siteHost: "example.com", skip: ["111111", "222222"] })',
    );
    assert.strictEqual(result.otp, null);
    assert.match(result.reason, /already/, "the reason should say they were already checked");
  });
});

test("the manual lookup path reaches the user", async (t) => {
  await t.test("a keyboard shortcut is declared", () => {
    // The shortcut is the answer to "it did nothing on this page": it skips the
    // score threshold and the cooldown, both of which can silently decide there
    // is nothing to do.
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    assert.ok(manifest.commands, "no commands declared in the manifest");
    assert.ok(manifest.commands["fetch-code"], "the fetch-code command is missing");
    assert.ok(
      manifest.commands["fetch-code"].description,
      "a command with no description shows up blank in the browser's shortcut list",
    );
  });

  await t.test("the background listens for it and the content script answers", () => {
    const bg = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
    const content = fs.readFileSync(path.join(ROOT, "content.js"), "utf8");
    assert.ok(bg.includes("onCommand"), "nothing listens for the command");
    assert.ok(bg.includes("FORCE_LOOKUP"), "the command sends no message");
    assert.ok(content.includes("FORCE_LOOKUP"), "the content script ignores the message");
    assert.ok(content.includes("function forceLookup"), "forceLookup is missing");
  });

  await t.test("the popup explains why it found nothing", () => {
    // findLatestOTP works out a reason every time it comes back empty. The
    // overlay has always shown it; the popup used to drop it and say "no code".
    const popup = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
    assert.ok(popup.includes("result.reason"), "the popup still discards the reason");
    assert.ok(popup.includes("popup.noCodeReason"), "no string for it");
  });
});

test("the extension interface carries no emoji", async (t) => {
  // The overlay used a padlock emoji as its icon, which is both a character in
  // the interface rather than a drawing and the exact shape the branding just
  // stopped using. The site has been checked for this since the Google
  // branding review; the extension never was.
  for (const file of ["content.js", "popup.html", "options.html", "styles.css"]) {
    await t.test(file, () => {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      const found = [...text.matchAll(/[\u{1F300}-\u{1FAFF}]/gu)].map((m) => m[0]);
      assert.deepStrictEqual(found, [], `${file} contains emoji: ${found.join(" ")}`);
    });
  }
});

test("the bug report cannot carry a code", async (t) => {
  // detectionReport() ends up in a public GitHub issue. If it ever read a
  // field's value, the one thing a user must never paste into a public issue
  // would be pasted there for them, automatically, every single time.
  const src = fs.readFileSync(path.join(ROOT, "content.js"), "utf8");
  const start = src.indexOf("function detectionReport()");
  assert.notStrictEqual(start, -1, "detectionReport has gone");
  const body = src.slice(start, src.indexOf("\n}", start));

  await t.test("it never reads a field value", () => {
    assert.ok(!body.includes(".value"), "detectionReport reads a field value");
  });

  await t.test("it never reads the page's text", () => {
    for (const reader of ["textContent", "innerText", "innerHTML"]) {
      assert.ok(!body.includes(reader), `detectionReport reads page text via ${reader}`);
    }
  });

  await t.test("it reads the attributes a detection bug is reproducible from", () => {
    for (const attr of ["placeholder", "autocomplete", "maxLength", "inputMode", "score"]) {
      assert.ok(body.includes(attr), `the report omits ${attr}, which is needed to reproduce`);
    }
  });

  await t.test("the popup warns against pasting a real code", () => {
    const popup = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
    assert.ok(
      popup.includes("never paste a real code"),
      "the prefilled issue should say not to paste a real code",
    );
  });
});

test("Italian mail yields its code", async (t) => {
  // Italian builds these as "codice di X" rather than compounding, so a word
  // boundary behaves in a way it does not in German. The trap here is a
  // different one: "codice di sicurezza" is a card's CVV on a payment form and
  // an ordinary one-time code everywhere else.
  const cases = [
    ["plain", "Il tuo codice di verifica e 482913", "482913"],
    ["after a colon", "Codice di accesso: 55213", "55213"],
    // "codice monouso" is a phrase that can only mean a one-time code, so a
    // code with no digits in it is trusted after one.
    ["letters only", "Il tuo codice monouso e 9KD2M4", "9KD2M4"],
    ["mid sentence", "Ecco il codice di conferma 730192 per accedere", "730192"],
    ["hyphenated", "Il tuo codice temporaneo: 41-7823", "417823"],
  ];

  for (const [name, text, expected] of cases) {
    await t.test(name, () => {
      assert.strictEqual(bg.extractOTP(text), expected);
    });
  }
});

test("Italian reaches the parts of the system that need a language", async (t) => {
  const terms = bg.call("AAF_TERMS");

  await t.test("the Gmail query searches Italian wording", () => {
    // Without this the search never returns an Italian message at all, and no
    // amount of good extraction downstream can help.
    assert.match(terms.gmailQuery, /codice di verifica/);
  });

  await t.test("an Italian submit button is recognised", () => {
    for (const word of ["conferma", "accedi", "invia"]) {
      assert.ok(terms.submitButtons.includes(word), `"${word}" is missing`);
    }
  });

  await t.test("codice di sicurezza is treated as ambiguous, not as a code name", () => {
    // The same collision as Sicherheitscode. If it were in cardField it would
    // refuse real one-time code fields; if it were absent it would fill a CVV.
    assert.match(terms.cardAmbiguous.source, /sicurezza/);
    assert.ok(!/sicurezza/.test(terms.cardField.source),
      "an unconditional refusal here would break real Italian code fields");
  });

  await t.test("Italian card wording is refused outright", () => {
    for (const probe of ["numero carta", "scadenza", "titolare della carta"]) {
      assert.match(probe, terms.cardField, `"${probe}" should be refused`);
    }
  });
});

test("a sign-in link is offered when no code exists, and only then", async (t) => {
  // Some services mail a link instead of a code. Opening a link out of an email
  // is the most phishing-adjacent thing this extension could do, so the guards
  // matter more than the feature: https only, the anchor's own text has to
  // invite a sign-in, and the sender has to match the site.
  const html = (href, text) =>
    `<p>Hello</p><p><a href="${href}">${text}</a></p><p>Thanks</p>`;

  const mail = (id, from, href, text, extra = "", subject = "Sign in to Example") => ({
    id,
    internalDate: String(Date.now() - 20000),
    snippet: "",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "Subject", value: subject },
        { name: "From", value: from },
      ],
      parts: [
        {
          mimeType: "text/html",
          body: { data: Buffer.from(html(href, text) + extra).toString("base64url") },
        },
      ],
    },
  });

  function withMessages(messages) {
    const instance = loadBackground();
    instance.call(`
      fetchGmail = async (endpoint) => {
        if (endpoint.startsWith("messages?")) {
          return { messages: ${JSON.stringify(messages.map((m) => ({ id: m.id })))} };
        }
        const id = endpoint.split("/")[1];
        return ${JSON.stringify(Object.fromEntries(messages.map((m) => [m.id, m])))}[id];
      };
      getAuthToken = async () => "test-token";
    `);
    return instance;
  }

  const run = (messages, host = "example.com") =>
    withMessages(messages).call(`findLatestOTP({ maxOTPAge: 10, siteHost: "${host}" })`);

  await t.test("a matching sender's sign-in link is offered", async () => {
    const result = await run([
      mail("a", "Example <no-reply@example.com>",
           "https://example.com/magic?t=abc123def456", "Sign in"),
    ]);
    assert.strictEqual(result.otp, null, "there is no code in this mail");
    assert.strictEqual(result.magicLink, "https://example.com/magic?t=abc123def456");
    assert.strictEqual(result.linkHost, "example.com");
  });

  await t.test("a link from an unrelated sender is never offered", async () => {
    // The sender check is the only thing between the user and a link out of
    // their mail, so a message that fails it cannot win on anything else.
    const result = await run([
      // The subject must not name the site either. A service naming itself
      // there is a deliberate match path, for senders like Battle.net that
      // mail from an unrelated domain.
      mail("a", "Somebody Else <no-reply@totally-different.net>",
           "https://totally-different.net/magic?t=abc123", "Sign in", "",
           "Sign in to your account"),
    ]);
    assert.strictEqual(result.magicLink, undefined);
  });

  await t.test("an insecure link is never offered", async () => {
    const result = await run([
      mail("a", "Example <no-reply@example.com>",
           "http://example.com/magic?t=abc123def456", "Sign in"),
    ]);
    assert.strictEqual(result.magicLink, undefined);
  });

  await t.test("an ordinary link is not mistaken for a sign-in link", async () => {
    const result = await run([
      mail("a", "Example <no-reply@example.com>",
           "https://example.com/unsubscribe?u=99", "Unsubscribe"),
    ]);
    assert.strictEqual(result.magicLink, undefined);
  });

  await t.test("a real code still wins over a link", async () => {
    // A link is the fallback. Returning one while a usable code sits in the
    // same inbox would be a worse answer and a bigger risk.
    const result = await run([
      mail("a", "Example <no-reply@example.com>",
           "https://example.com/magic?t=abc123def456",
           "Sign in", "<p>Your verification code is 889213</p>"),
    ]);
    assert.strictEqual(result.otp, "889213");
    assert.strictEqual(result.magicLink, undefined);
  });

  await t.test("a URL never leaks into code extraction", async () => {
    // extractLinks reads the HTML; extractOTP reads the flattened text, which
    // has had every tag removed. A tracking parameter full of alphanumerics is
    // exactly the shape the catch-all patterns match, and a Gecko build date
    // already proved what that costs.
    const result = await run([
      mail("a", "Example <no-reply@example.com>",
           "https://example.com/go?token=4829135550", "Sign in"),
    ]);
    assert.strictEqual(result.otp, null, "a tracking parameter is not a code");
  });

  await t.test("the overlay offers the link rather than following it", () => {
    const src = fs.readFileSync(path.join(ROOT, "content.js"), "utf8");
    assert.ok(src.includes("details.magicLink"), "the overlay ignores a link result");
    assert.ok(src.includes("noopener,noreferrer"), "the link opens without noopener");
    assert.ok(!src.includes("location.href = details.magicLink"),
      "the extension must never navigate to the link on its own");
  });
});
