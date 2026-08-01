// Tests for the re-search guard in content.js.
//
// The full field-detection logic needs a real DOM, so it is not covered here.
// This exercises the rule that decides whether a new lookup may start, which is
// what stops the overlay closing and reopening in a loop after a fill.

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
    // Enough of a DOM for the script to evaluate. Detection is not exercised.
    document: {
      querySelectorAll: () => emptyList,
      getElementById: () => null,
      documentElement: {},
      createElement: () => ({ setAttribute: noop, addEventListener: noop, appendChild: noop }),
    },
    window: { location: { hostname: "example.com" } },
    MutationObserver: class { observe() {} disconnect() {} },
    HTMLInputElement: { prototype: {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    chrome: {
      storage: { local: { get: (keys, cb) => cb && cb({}) } },
      runtime: { onMessage: { addListener: noop }, sendMessage: noop, lastError: null },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8"), sandbox);

  // Top-level `let` creates a lexical binding rather than a property of the
  // sandbox, so module state has to be reached by evaluating in the context.
  sandbox.call = (expr) => vm.runInContext(expr, sandbox);
  return sandbox;
}

// A stand-in for an <input>; only the value is consulted.
const field = (value = "") => ({ value });

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
