// Tests for the website.
//
// The site is four hand-written pages sharing one stylesheet rather than being
// generated from a template. That keeps the source directly editable, but it
// means a page can be forgotten: privacy.html spent weeks without a canonical
// link, without any Open Graph tags and with the old emoji favicon that the home
// page had already replaced to satisfy Google's branding check.
//
// These tests are the thing that makes the shared-stylesheet approach safe. They
// take the place of a build step: drift becomes a failing test instead of
// something nobody notices until a reviewer does.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SITE = path.join(__dirname, "..", "site");

const PAGES = [
  { file: "index.html", url: "https://autoauthfiller.com/", nav: "/" },
  { file: "docs.html", url: "https://autoauthfiller.com/docs", nav: "/docs" },
  { file: "faq.html", url: "https://autoauthfiller.com/faq", nav: "/faq" },
  { file: "privacy.html", url: "https://autoauthfiller.com/privacy", nav: "/privacy" },
];

const read = (file) => fs.readFileSync(path.join(SITE, file), "utf8");

test("every page carries the metadata a search result needs", async (t) => {
  for (const page of PAGES) {
    await t.test(page.file, () => {
      const html = read(page.file);
      const required = [
        ['<meta charset', "charset"],
        ['name="viewport"', "viewport"],
        ["<title>", "title"],
        ['name="description"', "meta description"],
        ['rel="canonical"', "canonical link"],
        ['property="og:title"', "og:title"],
        ['property="og:description"', "og:description"],
        ['property="og:image"', "og:image"],
        ['property="og:url"', "og:url"],
        ['name="twitter:card"', "twitter:card"],
        ['name="theme-color"', "theme-color"],
        ['rel="stylesheet" href="/style.css"', "shared stylesheet"],
      ];
      for (const [needle, label] of required) {
        assert.ok(html.includes(needle), `${page.file} is missing its ${label}`);
      }
    });
  }
});

test("each page declares its own canonical URL", async (t) => {
  for (const page of PAGES) {
    await t.test(page.file, () => {
      const html = read(page.file);
      assert.ok(
        html.includes(`rel="canonical" href="${page.url}"`),
        `${page.file} should be canonical to ${page.url}`,
      );
      assert.ok(
        html.includes(`content="${page.url}"`),
        `${page.file} og:url should be ${page.url}`,
      );
    });
  }
});

test("no page still carries the padlock emoji", async (t) => {
  // The emoji favicon and heading were what failed Google's branding check: the
  // page text read "[padlock] Auto Auth Filler" and the consent screen did not.
  // index.html was fixed and privacy.html was not, which is the exact drift
  // these tests exist to catch.
  for (const page of PAGES) {
    await t.test(page.file, () => {
      const html = read(page.file);
      assert.ok(!html.includes("128274"), `${page.file} still has the emoji favicon entity`);
      assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(html), `${page.file} contains an emoji`);
    });
  }
});

test("every page has the same navigation, and marks itself as current", async (t) => {
  for (const page of PAGES) {
    await t.test(page.file, () => {
      const html = read(page.file);
      for (const target of ["/", "/docs", "/faq", "/privacy"]) {
        assert.ok(
          html.includes(`href="${target}"`),
          `${page.file} navigation is missing a link to ${target}`,
        );
      }
      assert.ok(
        html.includes(`href="${page.nav}" aria-current="page"`),
        `${page.file} should mark ${page.nav} as the current page`,
      );
    });
  }
});

test("every page is reachable by keyboard and screen reader", async (t) => {
  for (const page of PAGES) {
    await t.test(page.file, () => {
      const html = read(page.file);
      assert.ok(html.includes('class="skip"'), `${page.file} has no skip link`);
      assert.ok(html.includes('id="main"'), `${page.file} skip link has no target`);
      assert.ok(/<html[^>]+lang="/.test(html), `${page.file} has no lang attribute`);
      assert.ok(html.includes('aria-label="Main"'), `${page.file} nav is unlabelled`);
    });
  }
});

test("no page inlines its own stylesheet any more", async (t) => {
  // A <style> block is how the drift started. One stylesheet cannot drift from
  // itself, so a page growing its own again should fail here.
  for (const page of PAGES) {
    await t.test(page.file, () => {
      const html = read(page.file);
      assert.ok(!html.includes("<style>"), `${page.file} has an inline <style> block`);
    });
  }
});

test("every image has alt text and explicit dimensions", async (t) => {
  // Dimensions stop the page reflowing as images load, which is both a layout
  // shift and, on a slow connection, a genuine annoyance.
  for (const page of PAGES) {
    await t.test(page.file, () => {
      const html = read(page.file);
      for (const tag of html.match(/<img[^>]*>/g) ?? []) {
        assert.ok(/\salt="/.test(tag), `image without alt in ${page.file}: ${tag.slice(0, 70)}`);
        assert.ok(/\swidth="/.test(tag) && /\sheight="/.test(tag),
          `image without dimensions in ${page.file}: ${tag.slice(0, 70)}`);
      }
    });
  }
});

test("every internal link points at a page that exists", () => {
  const known = new Set(["/", "/docs", "/faq", "/privacy", "/style.css", "/theme.js"]);
  const missing = [];

  for (const page of PAGES) {
    const html = read(page.file);
    for (const m of html.matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)) {
      const target = m[1];
      if (known.has(target)) continue;
      // Anything else has to exist as a file under site/.
      const asFile = path.join(SITE, target.replace(/^\//, ""));
      if (!fs.existsSync(asFile)) missing.push(`${page.file} -> ${target}`);
    }
  }

  assert.deepStrictEqual(missing, [], `internal links with no target:\n${missing.join("\n")}`);
});

test("every image referenced by a page is present", () => {
  const missing = [];
  for (const page of PAGES) {
    for (const m of read(page.file).matchAll(/src="(\/[^"]+\.(?:png|jpg|svg|webp))"/g)) {
      const asFile = path.join(SITE, m[1].replace(/^\//, ""));
      if (!fs.existsSync(asFile)) missing.push(`${page.file} -> ${m[1]}`);
    }
  }
  assert.deepStrictEqual(missing, [], `images that do not exist:\n${missing.join("\n")}`);
});

test("the sitemap lists every page and nothing that does not exist", () => {
  const xml = fs.readFileSync(path.join(SITE, "sitemap.xml"), "utf8");
  const listed = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  const expected = PAGES.map((p) => p.url).sort();
  assert.deepStrictEqual(listed, expected, "sitemap does not match the set of pages");
});

test("any page mentioning Safari says plainly that it is unsupported", () => {
  // The extension has never been built or run on Safari, and cannot be from a
  // Windows machine, so no page may imply otherwise. A blanket ban on the word
  // is wrong though: the FAQ has to discuss Safari in order to explain why it is
  // absent. The rule is that mentioning it obliges the page to deny support.
  for (const page of PAGES) {
    const text = read(page.file).toLowerCase();
    if (!text.includes("safari")) continue;

    const denies =
      text.includes("safari is not supported") ||
      text.includes("not supported") ||
      text.includes("safari, ios, ipados</td><td>not supported");

    assert.ok(denies, `${page.file} mentions Safari without stating it is unsupported`);

    // Affirmative phrasings that would be untrue however they were framed.
    for (const claim of ["available on safari", "works on safari", "download for safari"]) {
      assert.ok(!text.includes(claim), `${page.file} claims Safari works: "${claim}"`);
    }
  }
});

test("the dark palette defines every variable the light one themes", () => {
  // The palette lives in three blocks: light on :root, dark under the system
  // preference, and dark again under an explicit choice. A variable added to
  // one and forgotten in another does not throw; it just renders one colour
  // from the wrong theme, which is easy to miss and unpleasant to look at.
  const css = fs.readFileSync(path.join(SITE, "style.css"), "utf8");

  const varsIn = (re) => {
    const m = css.match(re);
    assert.ok(m, `could not find the block matching ${re}`);
    return [...m[1].matchAll(/(--[a-z0-9]+)\s*:/g)].map((x) => x[1]).sort();
  };

  const light = varsIn(/:root\s*\{([\s\S]*?)\}/);
  const mediaDark = varsIn(/:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\}/);
  const attrDark = varsIn(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/);

  // Fonts and sizes are the same in both themes and are deliberately not repeated.
  const NOT_THEMED = ["--mono", "--sans", "--measure", "--wide", "--radius"];
  const themed = light.filter((v) => !NOT_THEMED.includes(v));

  assert.deepStrictEqual(
    mediaDark, attrDark,
    "the system-preference and explicit-choice dark blocks have drifted apart",
  );
  assert.deepStrictEqual(
    themed, attrDark,
    "a themed variable is missing from the dark palette, or a dark variable has no light default",
  );
});

test("a class that caps the page width also centres what it caps", () => {
  // The home page puts .narrow on sections inside .wrap, while docs, faq and
  // privacy put it on the same element as .wrap. In the first form .narrow had a
  // max width and no auto margin, so those sections sat flush left in a 64rem
  // column while the hero and the feature grid stayed centred. The page looked
  // lopsided on any screen wider than the narrow measure, and only there, which
  // is why it survived a review of the markup.
  const css = fs.readFileSync(path.join(SITE, "style.css"), "utf8");

  const ruleBody = (selector) => {
    const at = css.indexOf(`\n${selector} {`);
    assert.notStrictEqual(at, -1, `no rule found for ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };

  for (const selector of [".wrap", ".narrow"]) {
    assert.ok(
      ruleBody(selector).includes("margin-inline: auto"),
      `${selector} caps the page width but never centres what it caps`,
    );
  }
});
