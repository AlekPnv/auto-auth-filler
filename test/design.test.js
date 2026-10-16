// Tests for the design system that spans the site and the extension.
//
// The palette is defined in four places and cannot be defined in one. The site
// is served from Vercel, the extension is zipped and installed, and the overlay
// stylesheet is injected into other people's pages. There is no honest way to
// make those three import a single file without introducing a build step, and
// the project does not have one on purpose: what ships is what you can read.
//
// So the values are repeated and these tests are what stop them drifting. That
// is the same bargain test/site.test.js already makes for light against dark,
// widened to every surface.
//
// See docs/superpowers/specs/2026-10-16-design-system-design.md

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

// Each surface and where its stylesheet lives inside the file.
const SURFACES = [
  { file: "site/style.css", inline: false },
  { file: "styles.css", inline: false },
  { file: "popup.html", inline: true },
  { file: "options.html", inline: true },
];

const LIGHT_GROUND = "#fbfaf9";
const DARK_GROUND = "#141317";

function stylesheet({ file, inline }) {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  if (!inline) return text;
  const open = text.indexOf("<style>");
  const close = text.indexOf("</style>", open);
  assert.notStrictEqual(open, -1, `${file} has no <style> block`);
  return text.slice(open, close);
}

// Every brace block that declares --bg, whatever selector carries it. Matching
// on the content rather than on the selector keeps this working across four
// different shapes: :root, :root:not([data-theme="light"]), #aaf-overlay, and
// the same selectors again nested inside a prefers-color-scheme query.
function paletteBlocks(css) {
  const found = [];
  for (const block of css.matchAll(/\{([^{}]*--bg\s*:[^{}]*)\}/g)) {
    const tokens = {};
    for (const decl of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      tokens[decl[1]] = decl[2].trim().toLowerCase();
    }
    found.push(tokens);
  }
  return found;
}

test("every surface defines both a light and a dark palette", async (t) => {
  for (const surface of SURFACES) {
    await t.test(surface.file, () => {
      const blocks = paletteBlocks(stylesheet(surface));
      const grounds = blocks.map((b) => b["--bg"]);
      assert.ok(grounds.includes(LIGHT_GROUND),
        `${surface.file} has no light palette (no block with --bg: ${LIGHT_GROUND})`);
      assert.ok(grounds.includes(DARK_GROUND),
        `${surface.file} has no dark palette (no block with --bg: ${DARK_GROUND})`);
    });
  }
});

test("a token means the same colour on every surface", async (t) => {
  // The failure this catches: changing --accent in site/style.css and leaving
  // the popup indigo-that-was. Nothing throws, nothing looks broken in
  // isolation, and the two halves of the product quietly stop matching.
  for (const [theme, ground] of [["light", LIGHT_GROUND], ["dark", DARK_GROUND]]) {
    await t.test(theme, () => {
      const seen = new Map(); // token -> { value, file }
      const clashes = [];

      for (const surface of SURFACES) {
        for (const block of paletteBlocks(stylesheet(surface))) {
          if (block["--bg"] !== ground) continue;
          for (const [token, value] of Object.entries(block)) {
            const prior = seen.get(token);
            if (!prior) {
              seen.set(token, { value, file: surface.file });
            } else if (prior.value !== value) {
              clashes.push(
                `${token} is ${prior.value} in ${prior.file} but ${value} in ${surface.file}`,
              );
            }
          }
        }
      }

      assert.deepStrictEqual(clashes, [],
        `the ${theme} palette has drifted:\n${clashes.join("\n")}`);
      assert.ok(seen.size >= 12, `only ${seen.size} tokens found, the palette is larger than that`);
    });
  }
});

test("no surface hardcodes a colour outside its own palette", async (t) => {
  // Hardcoding is how the drift starts. A literal hex is invisible until the
  // palette moves and one element stays behind, which is exactly what happened
  // to privacy.html before the site was rebuilt.
  //
  // The allowed set is derived from the file's own token blocks rather than
  // written down here, so adding a token does not mean editing this test.
  for (const surface of SURFACES) {
    await t.test(surface.file, () => {
      const css = stylesheet(surface);
      const declared = new Set();
      for (const block of paletteBlocks(css)) {
        for (const value of Object.values(block)) declared.add(value);
      }

      const used = new Set(
        [...css.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()),
      );
      const stray = [...used].filter((hex) => !declared.has(hex)).sort();

      assert.deepStrictEqual(stray, [],
        `${surface.file} uses colours that are not in its palette: ${stray.join(", ")}`);
    });
  }
});

test("the overlay keeps its tokens off :root", () => {
  // styles.css is injected into pages nobody here controls. Declaring --text on
  // :root would let a host page's own --text win or lose depending on specificity
  // and order, so the overlay would either inherit a stranger's colours or leak
  // into theirs. Every declaration stays on the overlay's own element.
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  for (const block of css.matchAll(/([^{}]*)\{([^{}]*--bg\s*:[^{}]*)\}/g)) {
    const selector = block[1].trim().split("\n").pop().trim();
    assert.ok(
      selector.startsWith("#aaf-overlay"),
      `the overlay declares tokens on "${selector}", which can collide with the host page`,
    );
  }
});

test("the interface face is not the monospace one", async (t) => {
  // Headings, the wordmark and table headers in mono read as a developer tool.
  // Mono earns its place on codes and field names, where the reader may have to
  // compare character by character, and nowhere else.
  const css = fs.readFileSync(path.join(ROOT, "site", "style.css"), "utf8");

  await t.test("headings use the interface face", () => {
    const rule = css.match(/h1,\s*h2,\s*h3\s*\{([^}]*)\}/);
    assert.ok(rule, "no heading rule found");
    assert.ok(rule[1].includes("var(--sans)"),
      "headings should be set in the interface face, not the monospace one");
  });

  await t.test("the monospace face is still used for codes", () => {
    const rule = css.match(/(?:^|\n)code\s*\{([^}]*)\}/);
    assert.ok(rule, "no code rule found");
    assert.ok(rule[1].includes("var(--mono)"), "code should stay monospace");
  });
});
