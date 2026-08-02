// Tests for the interface translations.
//
// The point of these is that a half-translated release cannot ship quietly. A
// missing German key does not throw, it falls back to English, so nothing but a
// test will notice that half the settings page switched language and half did
// not.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function loadI18n(uiLanguage, browserLang = "en-GB") {
  const sandbox = {
    console,
    navigator: { language: browserLang },
    Object, String, Promise, Error,
    chrome: {
      storage: { local: { get: (keys, cb) => cb({ uiLanguage }) } },
      i18n: { getUILanguage: () => browserLang },
    },
    document: null,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "i18n.js"), "utf8"), sandbox);
  return sandbox.AAF_I18N;
}

const i18n = loadI18n(null);
const LANGS = i18n.languages;
const KEYS = Object.keys(i18n.strings.en);

test("every language carries every English key", async (t) => {
  for (const lang of LANGS) {
    await t.test(lang, () => {
      const missing = KEYS.filter((k) => !(k in i18n.strings[lang]));
      assert.deepStrictEqual(missing, [], `${lang} is missing: ${missing.join(", ")}`);
    });
  }
});

test("no language carries a key English does not have", async (t) => {
  // A stale key is a translation nobody will ever see, and usually means a
  // string was renamed on one side only.
  for (const lang of LANGS) {
    await t.test(lang, () => {
      const extra = Object.keys(i18n.strings[lang]).filter((k) => !KEYS.includes(k));
      assert.deepStrictEqual(extra, [], `${lang} has orphans: ${extra.join(", ")}`);
    });
  }
});

test("no translation is left as the English string by accident", () => {
  // Some strings are legitimately identical across languages, so this checks
  // that translation happened at all rather than every string individually.
  const identical = KEYS.filter((k) => i18n.strings.de[k] === i18n.strings.en[k]);
  const ratio = identical.length / KEYS.length;
  assert.ok(
    ratio < 0.2,
    `${identical.length} of ${KEYS.length} German strings equal the English one: ${identical.join(", ")}`,
  );
});

test("placeholders survive translation", async (t) => {
  // A German string that dropped {n} would render a sentence with a hole in it.
  for (const lang of LANGS) {
    await t.test(lang, () => {
      for (const key of KEYS) {
        const wanted = [...i18n.strings.en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        const got = [...i18n.strings[lang][key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        assert.deepStrictEqual(got, wanted, `${lang} "${key}" placeholder mismatch`);
      }
    });
  }
});

test("a stored language beats the browser", () => {
  assert.strictEqual(loadI18n("de", "en-GB").resolve("de"), "de");
  assert.strictEqual(loadI18n("en", "de-DE").resolve("en"), "en");
});

test("auto follows the browser, including a regional variant", () => {
  assert.strictEqual(loadI18n("auto", "de-AT").resolve("auto"), "de");
  assert.strictEqual(loadI18n("auto", "de").resolve("auto"), "de");
  assert.strictEqual(loadI18n("auto", "en-US").resolve("auto"), "en");
});

test("an unsupported language falls back to English rather than breaking", () => {
  assert.strictEqual(loadI18n("auto", "fr-FR").resolve("auto"), "en");
  assert.strictEqual(loadI18n("pt", "en-GB").resolve("pt"), "en");
});

test("init reads the stored setting", async () => {
  const de = loadI18n("de");
  assert.strictEqual(await de.init(), "de");
  assert.strictEqual(de.t("popup.signOut"), "Abmelden");

  const auto = loadI18n("auto", "de-DE");
  assert.strictEqual(await auto.init(), "de");
});

test("placeholders are substituted", () => {
  const en = loadI18n("en");
  en.lang = "en";
  assert.strictEqual(en.t("popup.minutesAgo", { n: 3 }), "3 minute(s) ago");
  assert.strictEqual(en.t("popup.error", { message: "boom" }), "Error: boom");

  const de = loadI18n("de");
  de.lang = "de";
  assert.strictEqual(de.t("popup.minutesAgo", { n: 3 }), "vor 3 Minute(n)");
});

test("an unknown key returns itself instead of empty text", () => {
  // Visible in review, which is the point. Silent empty text is not.
  const en = loadI18n("en");
  assert.strictEqual(en.t("nope.not.a.key"), "nope.not.a.key");
});

test("every key referenced in the source exists in the table", () => {
  // Catches a typo in a T("...") call, which would otherwise render the key
  // itself on screen and only be noticed by someone using the extension.
  const referenced = new Set();
  for (const file of ["popup.js", "options.js", "content.js"]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of src.matchAll(/\bT\(\s*"([^"]+)"/g)) referenced.add(m[1]);
  }
  for (const file of ["popup.html", "options.html"]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of src.matchAll(/data-i18n(?:-title|-label)?="([^"]+)"/g)) referenced.add(m[1]);
  }

  assert.ok(referenced.size > 20, `only found ${referenced.size} referenced keys, the scan is wrong`);
  const unknown = [...referenced].filter((k) => !KEYS.includes(k));
  assert.deepStrictEqual(unknown, [], `referenced but not defined: ${unknown.join(", ")}`);
});

test("apply() translates a document, including titles and aria labels", () => {
  // A DOM stub rather than a real browser: apply() only needs querySelectorAll,
  // dataset, textContent, title and setAttribute, and this pins the behaviour
  // that the settings page and the overlay both depend on.
  const make = (dataset) => ({
    dataset,
    textContent: "",
    title: "",
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
  });

  const heading = make({ i18n: "opt.behaviour" });
  const button = make({ i18nTitle: "overlay.copyTitle" });
  const close = make({ i18nLabel: "overlay.close" });

  const root = {
    querySelectorAll(sel) {
      if (sel === "[data-i18n]") return [heading];
      if (sel === "[data-i18n-title]") return [button];
      if (sel === "[data-i18n-label]") return [close];
      return [];
    },
  };

  const de = loadI18n("de");
  de.lang = "de";
  de.apply(root);

  assert.strictEqual(heading.textContent, "Verhalten");
  assert.strictEqual(button.title, "In die Zwischenablage kopieren");
  assert.strictEqual(close.attrs["aria-label"], "Schließen");
});

test("switching language re-renders the same element differently", () => {
  const el = { dataset: { i18n: "opt.save" }, textContent: "" };
  const root = { querySelectorAll: (s) => (s === "[data-i18n]" ? [el] : []) };

  const i = loadI18n("auto");
  i.lang = "en";
  i.apply(root);
  assert.strictEqual(el.textContent, "Save");

  i.lang = "de";
  i.apply(root);
  assert.strictEqual(el.textContent, "Speichern");
});
