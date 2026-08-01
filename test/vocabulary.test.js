// Tests for vocabulary.js, the single table of language-dependent words.
//
// The point of these is that adding a language is a one-file change. Each test
// checks that a term entered in the table actually reaches the place that uses
// it, so a new language cannot be half-wired without something failing here.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadVocabulary() {
  const sandbox = { console, RegExp, Object, Array, String };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "vocabulary.js"), "utf8"),
    sandbox,
  );
  return sandbox;
}

test("the table exposes every category the two scripts consume", () => {
  const { AAF_TERMS } = loadVocabulary();

  // content.js destructures exactly these. A missing one becomes undefined and
  // throws only when a page is visited, which no test would catch.
  for (const key of [
    "nameStrong", "nameMedium", "nameWeak",
    "formStrong", "formWeak", "paymentContext", "passwordFieldOk",
  ]) {
    assert.ok(AAF_TERMS[key] instanceof RegExp, `${key} must be a RegExp`);
  }

  assert.ok(Array.isArray(AAF_TERMS.submitButtons), "submitButtons must be an array");
  assert.ok(AAF_TERMS.submitButtons.length > 0);
  assert.strictEqual(typeof AAF_TERMS.securityLabel, "string");
  assert.strictEqual(typeof AAF_TERMS.genericLabel, "string");
  assert.strictEqual(typeof AAF_TERMS.gmailQuery, "string");
});

test("every configured language reaches the Gmail query", () => {
  const { AAF_VOCAB, AAF_TERMS } = loadVocabulary();

  // The query is a gate: a message it does not match is never fetched, so a
  // language whose terms are missing here cannot work at all.
  for (const [code, lang] of Object.entries(AAF_VOCAB)) {
    for (const term of lang.mailSubjectTerms ?? []) {
      assert.ok(
        AAF_TERMS.gmailQuery.includes(`subject:${term}`),
        `${code}: subject term "${term}" missing from the Gmail query`,
      );
    }
    for (const term of lang.mailBodyTerms ?? []) {
      assert.ok(
        AAF_TERMS.gmailQuery.includes(`"${term}"`),
        `${code}: body term "${term}" missing from the Gmail query`,
      );
    }
  }
});

test("every configured language reaches the submit button list", () => {
  const { AAF_VOCAB, AAF_TERMS } = loadVocabulary();

  for (const [code, lang] of Object.entries(AAF_VOCAB)) {
    for (const word of lang.submitButtons ?? []) {
      assert.ok(
        AAF_TERMS.submitButtons.includes(word),
        `${code}: submit word "${word}" did not reach content.js`,
      );
    }
  }
});

test("German terms survive composition", () => {
  const { AAF_TERMS } = loadVocabulary();

  // German is the second language, so it is the canary for the merge working
  // at all rather than English simply being passed through.
  assert.ok(AAF_TERMS.securityLabel.includes("einmalcode"));
  assert.ok(AAF_TERMS.nameStrong.test("bestaetigungscode"));
  assert.ok(AAF_TERMS.nameStrong.test("bestätigungscode"));
  assert.ok(AAF_TERMS.submitButtons.includes("bestätigen"));
  assert.ok(AAF_TERMS.paymentContext.test("kreditkarte"));
});

test("English and German are both present in the merged patterns", () => {
  const { AAF_TERMS } = loadVocabulary();

  assert.ok(AAF_TERMS.nameStrong.test("otp"), "English must still match");
  assert.ok(AAF_TERMS.nameStrong.test("einmalcode"), "German must also match");
  assert.ok(AAF_TERMS.paymentContext.test("credit card"), "English payment terms");
  assert.ok(AAF_TERMS.paymentContext.test("zahlung"), "German payment terms");
});
