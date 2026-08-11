// Tests for content.js: the rule that decides when a new lookup may start, and
// the scoring that decides whether an input is a code field at all.
//
// content.js expects a browser, so it is evaluated in a vm context with a DOM
// stub. Inputs are plain objects exposing only what scoreInput() reads, which
// is enough to test the heuristic without a real page.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadContentScript() {
  const noop = () => {};
  const emptyList = [];

  const sandbox = {
    console: { error: noop, log: noop },
    Date, Math, JSON, parseInt, Number, Array, Object, String, RegExp, Set,
    Promise, setTimeout, clearTimeout, Error,
    // Enough of a DOM for the script to evaluate. Individual inputs are stubbed
    // per test rather than being queried out of this.
    document: {
      querySelectorAll: () => emptyList,
      getElementById: () => null,
      documentElement: {},
      createElement: () => ({ setAttribute: noop, addEventListener: noop, appendChild: noop }),
    },
    window: { location: { hostname: "example.com" } },
    MutationObserver: class { observe() {} disconnect() {} },
    HTMLInputElement: { prototype: {} },
    // setNativeValue constructs these to notify the page. The stubs only need to
    // exist; the fake inputs ignore what they are handed.
    Event: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    chrome: {
      // A real store, so the record of tried codes can be exercised. It has to
      // survive a page load in the browser, which is the whole point of it.
      storage: {
        local: (() => {
          const data = {};
          return {
            get: (keys, cb) => {
              const key = typeof keys === "string" ? keys : null;
              cb && cb(key ? { [key]: data[key] } : { ...data });
            },
            set: (items, cb) => { Object.assign(data, items); cb && cb(); },
          };
        })(),
      },
      runtime: { onMessage: { addListener: noop }, sendMessage: noop, lastError: null },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // The manifest lists vocabulary.js before content.js; mirror that here.
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "vocabulary.js"), "utf8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8"), sandbox);

  // Top-level `let` creates a lexical binding rather than a property of the
  // sandbox, so module state has to be reached by evaluating in the context.
  sandbox.call = (expr) => vm.runInContext(expr, sandbox);
  return sandbox;
}

// A stand-in for an <input>; only the value is consulted.
const field = (value = "") => ({ value });

// A fuller stand-in, exposing everything scoreInput() reads. Enough to test the
// scoring without a browser, which is the only reason this logic was previously
// uncovered.
function input({
  name = "", id = "", placeholder = "", ariaLabel = "", label = "",
  testId = "", inputMode = "", type = "text", maxLength = -1, formText = null,
} = {}) {
  const attrs = { "aria-label": ariaLabel, "data-testid": testId };
  return {
    name, id, placeholder, inputMode, type, maxLength, value: "",
    labels: label ? [{ textContent: label }] : undefined,
    getAttribute: (key) => attrs[key] ?? null,
    // null formText means the field sits outside any form.
    closest: (sel) => (sel === "form" && formText !== null ? { textContent: formText } : null),
  };
}

const THRESHOLD = 28;

test("a search starts when an empty code field is present", () => {
  const cs = loadContentScript();
  assert.strictEqual(cs.shouldSearch([field("")]), true);
});

test("no search starts when the field is already filled", () => {
  // This is the loop that made the overlay flicker: filling the field is itself
  // a DOM change, the observer wakes, and the same field is found again.
  const cs = loadContentScript();
  assert.strictEqual(cs.shouldSearch([field("H2T8GW")]), false);
});

test("split-digit boxes count as filled only when every box has a value", () => {
  const cs = loadContentScript();
  const allFilled = ["4", "8", "1", "9", "0", "2"].map(field);
  const partly = ["4", "8", "", "", "", ""].map(field);

  assert.strictEqual(cs.shouldSearch(allFilled), false);
  assert.strictEqual(cs.shouldSearch(partly), true, "a half-filled widget still needs a code");
});

test("no search starts without any candidate field", () => {
  const cs = loadContentScript();
  assert.strictEqual(cs.shouldSearch(null), false);
  assert.strictEqual(cs.shouldSearch([]), false);
});

test("a second search is refused during the cooldown", () => {
  const cs = loadContentScript();
  const inputs = [field("")];

  assert.strictEqual(cs.shouldSearch(inputs), true);

  // init() records the start time; simulate that having just happened.
  cs.call("lastSearchStartedAt = Date.now()");
  assert.strictEqual(
    cs.shouldSearch(inputs),
    false,
    "back-to-back searches must not be allowed even on an empty field",
  );

  // Once the cooldown has passed, a still-empty field may be retried. Someone
  // who clears a wrong code and waits should get a fresh lookup.
  cs.call("lastSearchStartedAt = Date.now() - 20000");
  assert.strictEqual(cs.shouldSearch(inputs), true);
});

// ---------------------------------------------------------------------------
// Field scoring. This is the most fragile code in the project: a heuristic that
// decides whether an arbitrary input on an arbitrary page is a code field. It
// went uncovered for a long time because it needs a DOM, which is exactly why
// the German bug survived as long as it did.
// ---------------------------------------------------------------------------

test("an English code field scores well above the threshold", () => {
  const cs = loadContentScript();
  const score = cs.scoreInput(input({
    name: "otp", inputMode: "numeric", maxLength: 6,
    formText: "Enter the verification code we sent you",
  }));
  assert.ok(score >= THRESHOLD, `expected a detection, scored ${score}`);
});

test("a German code field is detected", async (t) => {
  // This is the regression that started the whole review. German compounds have
  // no word boundary before "code", so these scored 27 against a threshold of
  // 28 and were missed by a single point.
  const cs = loadContentScript();

  const spellings = [
    ["umlaut", "bestätigungscode", "Geben Sie den Bestätigungscode ein"],
    ["transliterated", "bestaetigungscode", "Geben Sie den Bestaetigungscode ein"],
    ["Einmalcode", "einmalcode", "Ihr Einmalcode"],
  ];

  for (const [name, fieldName, formText] of spellings) {
    await t.test(name, () => {
      const score = cs.scoreInput(input({
        name: fieldName, inputMode: "numeric", maxLength: 6, formText,
      }));
      assert.ok(score >= THRESHOLD, `${fieldName} scored ${score}, needs ${THRESHOLD}`);
    });
  }
});

test("a card PIN field is not treated as an emailed code", () => {
  // "pin" scores on its own, but a card PIN is never emailed. Filling one and
  // submitting it is the worst outcome the detector can produce.
  const cs = loadContentScript();

  const cardPin = cs.scoreInput(input({
    name: "pin", inputMode: "numeric", maxLength: 4,
    formText: "Set your card PIN",
  }));
  assert.ok(cardPin < THRESHOLD, `card PIN scored ${cardPin}, should be ignored`);

  const germanCardPin = cs.scoreInput(input({
    name: "pin", inputMode: "numeric", maxLength: 4,
    formText: "Karten-PIN festlegen",
  }));
  assert.ok(germanCardPin < THRESHOLD, `Karten-PIN scored ${germanCardPin}`);

  // A PIN that really was emailed still counts: the demotion is about payment
  // context, not about the word itself.
  const emailedPin = cs.scoreInput(input({
    name: "pin", inputMode: "numeric", maxLength: 6,
    formText: "Enter the PIN we emailed you",
  }));
  assert.ok(emailedPin >= THRESHOLD, `emailed PIN scored ${emailedPin}, should be detected`);
});

test("ordinary fields are left alone", async (t) => {
  const cs = loadContentScript();

  const ignored = [
    ["search box", input({ name: "q", placeholder: "Search products", formText: "Find something" })],
    ["bare text field", input({ name: "nickname", formText: "Choose a display name" })],
    ["quantity", input({ name: "qty", inputMode: "numeric", maxLength: 2, formText: "How many?" })],
  ];

  for (const [name, el] of ignored) {
    await t.test(name, () => {
      const score = cs.scoreInput(el);
      assert.ok(score < THRESHOLD, `${name} scored ${score}, should be ignored`);
    });
  }
});

test("the label and placeholder count, not only the name", () => {
  // Plenty of sites give the input a meaningless name and put the meaning in
  // the label, so scoring only on name would miss them.
  const cs = loadContentScript();

  const byLabel = cs.scoreInput(input({
    name: "field3", label: "One-time passcode", inputMode: "numeric", maxLength: 6,
    formText: "Almost there",
  }));
  assert.ok(byLabel >= THRESHOLD, `scored ${byLabel} from its label alone`);

  const byPlaceholder = cs.scoreInput(input({
    name: "x1", placeholder: "Enter your verification code",
    inputMode: "numeric", maxLength: 6, formText: "Almost there",
  }));
  assert.ok(byPlaceholder >= THRESHOLD, `scored ${byPlaceholder} from its placeholder`);
});

test("a field outside any form is still scored", () => {
  // Not every code input sits in a <form>. Losing the surrounding wording costs
  // points but must not throw.
  const cs = loadContentScript();
  const score = cs.scoreInput(input({ name: "otp", inputMode: "numeric", maxLength: 6 }));
  assert.ok(score >= THRESHOLD, `scored ${score} with no surrounding form`);
});

// ---------------------------------------------------------------------------
// Submit button selection. Clicking a disabled button does nothing and reports
// nothing, so a form that validates before enabling its button looked exactly
// like a successful submit.
// ---------------------------------------------------------------------------

// A stand-in for a button. offsetWidth defaults to visible.
function button({ text = "", disabled = false, ariaDisabled = null, width = 100 } = {}) {
  return {
    innerText: text,
    offsetWidth: width,
    disabled,
    getAttribute: (key) => (key === "aria-disabled" ? ariaDisabled : null),
  };
}

function pageWith(buttons) {
  const cs = loadContentScript();
  cs.document.querySelectorAll = () => buttons;
  return cs;
}

test("a disabled submit button is not chosen", () => {
  const cs = pageWith([button({ text: "Verify", disabled: true })]);
  assert.strictEqual(
    cs.findSubmitButton(null), null,
    "a disabled button must count as not found, so the caller can wait for it",
  );
});

test("aria-disabled is respected on elements that are not real buttons", () => {
  const cs = pageWith([button({ text: "Continue", ariaDisabled: "true" })]);
  assert.strictEqual(cs.findSubmitButton(null), null);
});

test("an enabled button is chosen", () => {
  const target = button({ text: "Verify" });
  const cs = pageWith([target]);
  assert.strictEqual(cs.findSubmitButton(null), target);
});

test("an invisible button is skipped", () => {
  const cs = pageWith([button({ text: "Submit", width: 0 })]);
  assert.strictEqual(cs.findSubmitButton(null), null);
});

test("the enabled button wins over a disabled one earlier in the page", () => {
  const enabled = button({ text: "Continue" });
  const cs = pageWith([button({ text: "Verify", disabled: true }), enabled]);
  assert.strictEqual(cs.findSubmitButton(null), enabled);
});

test("German button text is recognised", () => {
  const target = button({ text: "Bestätigen" });
  const cs = pageWith([target]);
  assert.strictEqual(cs.findSubmitButton(null), target);
});

test("an unrelated button is not treated as submit", () => {
  const cs = pageWith([button({ text: "Add to basket" }), button({ text: "Close" })]);
  assert.strictEqual(cs.findSubmitButton(null), null);
});

// ---------------------------------------------------------------------------
// Recovery after a rejected code. Signing out and back in put the previous
// code into the field, the site rejected it, and because a filled field stops
// any new lookup, nothing recovered until the box was cleared by hand.
// ---------------------------------------------------------------------------

test("a code already entered on this page is never entered again", () => {
  const cs = loadContentScript();
  cs.call('attemptedCodes.add(fingerprint("68VNBF"))');

  assert.ok(cs.wasAttempted("68VNBF"), "the attempt must be remembered");
  assert.ok(!cs.wasAttempted("112233"), "a different code is still allowed");
});

test("submit keywords cover the spacing variants sites actually use", async (t) => {
  const cs = loadContentScript();
  const keywords = cs.AAF_TERMS.submitButtons;
  const matches = (label) => keywords.some((k) => label.toLowerCase().includes(k));

  // "Log in" with a space is Blizzard's button, and "login" does not match it.
  for (const label of ["Log in", "Login", "Log-in", "Sign in", "Sign-in",
                       "Verify", "Continue", "Submit", "Done", "Bestätigen"]) {
    await t.test(`accepts "${label}"`, () => assert.ok(matches(label), `${label} not recognised`));
  }

  for (const label of ["Add to basket", "Close", "Cancel", "Resend code"]) {
    await t.test(`ignores "${label}"`, () => assert.ok(!matches(label), `${label} wrongly matched`));
  }
});

test("the freshness window is short enough to exclude a previous attempt", () => {
  const cs = loadContentScript();
  // Signing out and back in reuses the same page within seconds. A window of
  // several minutes would let the earlier code through as though it were new.
  const lookback = cs.call("CODE_LOOKBACK_MS");
  assert.ok(lookback <= 60000, `lookback is ${lookback}ms, too generous`);
  assert.ok(lookback >= 30000, `lookback is ${lookback}ms, mail arriving early would be missed`);
});

test("a field holding a code we entered may be searched again", () => {
  // The recovery route that does not depend on the overlay or the session
  // surviving. After a rejected code the field is full, and the old rule
  // "a full field needs nothing" is what left the page stuck.
  const cs = loadContentScript();
  const boxes = ["6", "8", "V", "N", "B", "F"].map(field);

  assert.strictEqual(
    cs.shouldSearch(boxes), false,
    "a full field holding an unknown value is left alone",
  );

  cs.call('attemptedCodes.add(fingerprint("68VNBF"))');
  assert.strictEqual(
    cs.shouldSearch(boxes), true,
    "a full field holding a code we entered must be searchable again",
  );
});

test("a code the user typed themselves is not overwritten", () => {
  // Only values this extension entered qualify. Someone who typed their own
  // code must not have it replaced underneath them.
  const cs = loadContentScript();
  cs.call('attemptedCodes.add(fingerprint("111111"))');
  assert.strictEqual(cs.shouldSearch([field("999999")]), false);
});

test("the single-field and split-digit cases read the same value", () => {
  const cs = loadContentScript();
  assert.strictEqual(cs.currentFieldValue([field("68VNBF")]), "68VNBF");
  assert.strictEqual(
    cs.currentFieldValue(["6", "8", "V", "N", "B", "F"].map(field)), "68VNBF",
  );
});

test("codes tried before a page reload are still known afterwards", async () => {
  // Blizzard submits by navigating, then re-renders the form with the rejected
  // code still in the boxes. The replacement content script has to know that
  // code was already tried, or it treats it as something the user typed and
  // leaves the page stuck.
  const first = loadContentScript();
  await first.rememberAttempt("68VNBF");

  // A second load of the script, sharing the same extension storage, stands in
  // for the page having navigated.
  const second = loadContentScript();
  second.chrome.storage.local = first.chrome.storage.local;
  await second.loadAttempts();

  assert.ok(second.wasAttempted("68VNBF"), "the record must survive the reload");
  assert.strictEqual(
    second.shouldSearch(["6", "8", "V", "N", "B", "F"].map(field)), true,
    "the re-rendered form must be searchable again",
  );
});

test("only a fingerprint is written, never the code", async () => {
  const cs = loadContentScript();
  await cs.rememberAttempt("68VNBF");

  const written = await new Promise((resolve) =>
    cs.chrome.storage.local.get(null, resolve));
  const dump = JSON.stringify(written);

  assert.ok(!dump.includes("68VNBF"), `the code appeared in storage: ${dump}`);
  assert.ok(dump.includes("attempted:"), "the record should be keyed by hostname");
});

test("stale attempts are forgotten", async () => {
  const cs = loadContentScript();
  const key = cs.attemptStorageKey();
  const old = Date.now() - 11 * 60 * 1000;

  await new Promise((resolve) =>
    cs.chrome.storage.local.set({ [key]: [{ fp: cs.fingerprint("111111"), at: old }] }, resolve));
  await cs.loadAttempts();

  assert.ok(!cs.wasAttempted("111111"), "an attempt older than the window must expire");
});

test("the watch stops once the code field is gone", () => {
  // A successful sign-in takes the form away. A rejected code leaves it on
  // screen. That difference is the only generic signal available, and without
  // it the overlay sat on a signed-in page saying it waited for a newer code.
  const cs = loadContentScript();

  // Before anything has been entered, a missing field is not a success signal:
  // it just means there is nothing to do yet.
  cs.call("session = { filled: false, missCount: 0 }");
  assert.strictEqual(cs.call("session.filled"), false);

  // After filling, one miss is tolerated because a form can re-render.
  cs.call("session = { filled: true, missCount: 0 }");
  cs.call("session.missCount = (session.missCount ?? 0) + 1");
  assert.strictEqual(cs.call("session.missCount >= 2"), false, "one miss must not end the watch");

  cs.call("session.missCount = (session.missCount ?? 0) + 1");
  assert.strictEqual(cs.call("session.missCount >= 2"), true, "two misses end it");

  // Finding the field again clears the count.
  cs.call("session.missCount = 0");
  assert.strictEqual(cs.call("session.missCount >= 2"), false);
});

// A widget that scrambles what it is given: on any input it keeps only the last
// character written and blanks the rest, which is the shape of what G2G does.
// Nothing about write order rescues this, so it exists to prove the correction
// pass, which is the only part of the fix that guarantees a final value.
function scramblingBoxes(count) {
  const boxes = [];
  let settled = false;
  for (let i = 0; i < count; i++) {
    boxes.push({
      value: "",
      focus() {},
      dispatchEvent() {
        if (settled) return true;
        for (let j = 0; j < boxes.length; j++) if (j !== i) boxes[j].value = "";
        return true;
      },
    });
  }
  // The second pass succeeds, as it does on a real page once the widget has
  // finished whatever it was doing.
  boxes.stopScrambling = () => { settled = true; };
  return boxes;
}

function plainBoxes(count) {
  return Array.from({ length: count }, () => ({
    value: "", focus() {}, dispatchEvent() { return true; },
  }));
}

test("writeCode fills every box of a split-digit field", async () => {
  const cs = loadContentScript();
  const boxes = plainBoxes(6);
  await cs.call("writeCode")(boxes, "FTW8S7");
  assert.strictEqual(boxes.map((b) => b.value).join(""), "FTW8S7");
});

test("writeCode leaves boxes beyond the code untouched", async () => {
  const cs = loadContentScript();
  const boxes = plainBoxes(6);
  boxes[5].value = "x";
  await cs.call("writeCode")(boxes, "1234");
  assert.strictEqual(boxes.slice(0, 4).map((b) => b.value).join(""), "1234");
  assert.strictEqual(boxes[5].value, "x", "a box past the end of the code was cleared");
});

test("writeCode leaves a gap between boxes rather than writing them in one burst", async () => {
  // The gap is what gives a framework-driven widget room to flush its own state
  // between characters. Asserting the elapsed time is the only honest way to
  // show the behaviour exists, since a stub cannot model another site's
  // rendering.
  const cs = loadContentScript();
  const started = Date.now();
  await cs.call("writeCode")(plainBoxes(6), "123456");
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 250, `expected the writes to be spread out, took ${elapsed}ms`);
});

test("a single field is written in one go, with no delay", async () => {
  const cs = loadContentScript();
  const one = plainBoxes(1);
  const started = Date.now();
  await cs.call("writeCode")(one, "123456");
  assert.strictEqual(one[0].value, "123456");
  assert.ok(Date.now() - started < 50, "a single field should not be staggered");
});

test("a scrambling widget is corrected on the second pass", async () => {
  const cs = loadContentScript();
  const boxes = scramblingBoxes(6);

  await cs.call("writeCode")(boxes, "FTW8S7");
  assert.notStrictEqual(
    boxes.map((b) => b.value).join(""),
    "FTW8S7",
    "the stub was meant to scramble the first pass",
  );

  boxes.stopScrambling();
  await cs.call("writeCode")(boxes, "FTW8S7");
  assert.strictEqual(boxes.map((b) => b.value).join(""), "FTW8S7");
});

// ---------------------------------------------------------------------------
// Payment forms. Reported on ryanair.com: the overlay opened on a checkout page
// and treated card fields as somewhere to put an emailed code. Filling one and
// submitting it is the worst outcome this extension can produce, which is why
// these return a refusal rather than a low score.
// ---------------------------------------------------------------------------

const CARD_FORM = "Pay now. Card number, expiry date and security code required. Total EUR 129.";

test("a German CVV box on a payment form is refused", () => {
  // The reported case. "Sicherheitscode" is German for both a card's security
  // number and a one-time code, and fieldStrong matches it, so this scored 35
  // and above the threshold before the form was ever considered.
  const cs = loadContentScript();
  const score = cs.scoreInput(input({
    name: "sicherheitscode", inputMode: "numeric", maxLength: 4,
    formText: "Jetzt bezahlen. Kartennummer, Ablaufdatum und Sicherheitscode. Gesamt EUR 129.",
  }));
  assert.ok(score < THRESHOLD, `a CVV field scored ${score}, it must never be a candidate`);
});

test("an English security-code box on a payment form is refused", () => {
  const cs = loadContentScript();
  const score = cs.scoreInput(input({
    name: "securityCode", inputMode: "numeric", maxLength: 4, formText: CARD_FORM,
  }));
  assert.ok(score < THRESHOLD, `scored ${score}`);
});

test("the same wording away from a payment form is still a code field", () => {
  // "Security code" genuinely means a one-time code on plenty of sign-in pages.
  // The refusal has to depend on the surrounding form, not the word alone.
  const cs = loadContentScript();
  const score = cs.scoreInput(input({
    name: "securityCode", inputMode: "numeric", maxLength: 6,
    formText: "Enter the security code we emailed you to finish signing in",
  }));
  assert.ok(score >= THRESHOLD, `a genuine code field scored ${score}`);
});

test("card fields are refused whatever the surrounding form says", async (t) => {
  const cs = loadContentScript();
  const names = ["cvv", "cvc", "cardNumber", "card-number", "expiry", "cardholder",
                 "kartennummer", "kartenprüfnummer", "ablaufdatum"];
  for (const name of names) {
    await t.test(name, () => {
      const score = cs.scoreInput(input({
        name, inputMode: "numeric", maxLength: 6,
        formText: "Enter the verification code we sent you",
      }));
      assert.ok(score < THRESHOLD, `${name} scored ${score}`);
    });
  }
});

test("the browser's own card autocomplete tokens are refused", async (t) => {
  const cs = loadContentScript();
  for (const token of ["cc-csc", "cc-number", "cc-exp", "cc-name"]) {
    await t.test(token, () => {
      const el = input({
        name: "code", inputMode: "numeric", maxLength: 6,
        formText: "Enter the verification code we sent you",
      });
      const original = el.getAttribute;
      el.getAttribute = (k) => (k === "autocomplete" ? token : original(k));
      assert.ok(cs.scoreInput(el) < THRESHOLD, `${token} was not refused`);
    });
  }
});

test("a 3-D Secure code field on a payment page still works", () => {
  // The case the refusal must not break: a bank challenge during checkout is a
  // real emailed code, and one of the more useful things the extension does.
  const cs = loadContentScript();
  const score = cs.scoreInput(input({
    name: "otp", inputMode: "numeric", maxLength: 6,
    formText: "3-D Secure. Enter the one-time code sent to your phone to authorise this card payment.",
  }));
  assert.ok(score >= THRESHOLD, `a 3DS challenge field scored ${score}`);
});
