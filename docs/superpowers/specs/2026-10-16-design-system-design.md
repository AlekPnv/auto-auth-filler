# Design system: one vocabulary across the site and the extension

Status: approved direction, not yet implemented.
Direction: warm and mainstream, indigo accent, a new mark built on the code.

## What exists today

The site was rebuilt in September and is tokenised: `site/style.css` defines a
palette on `:root`, redefines it under the system preference and again under an
explicit choice, and `test/site.test.js` fails if those blocks drift apart.

The extension never got any of that.

| File | Hardcoded colours | Tokens | Light theme |
| --- | --- | --- | --- |
| `popup.html` | 30 uses, 12 distinct | none | no |
| `options.html` | 29 uses, 10 distinct | none | no |
| `styles.css` (overlay) | 29 uses, 9 distinct | none | partial |
| `site/style.css` | 27 uses, 18 distinct | yes | yes |

The extension is dark only, in a palette typed out by hand in three places.
Someone on a light desktop gets a dark popup whatever their system says. That is
the real gap, and it matters more than the accent being Catppuccin rather than
indigo.

## Decisions

### D1. One token vocabulary, four definition sites, held together by a test

The project has no build step and that is deliberate. The site is served from
Vercel, the extension is zipped, and the overlay stylesheet is injected into
other people's pages. There is no honest way to make those import one file.

So the token **names** are identical everywhere and the **values** are repeated,
with a test that reads every definition site and fails when they disagree. This
is the mechanism `site.test.js` already uses for light against dark, widened to
cover the extension. A build step is the textbook answer; a test is the one that
fits a project whose whole claim is that what ships is what you can read.

### D2. The overlay declares its tokens on itself, never on `:root`

The overlay is injected into arbitrary pages. If it declared `--text` on
`:root`, a host page declaring the same name would win or lose unpredictably,
and the extension would either inherit a stranger's colours or leak into theirs.

Tokens for the overlay are declared on the overlay's own root element and every
rule stays scoped to it. `styles.css` is already written this way; recording it
so the rewrite does not quietly drop it.

### D3. Indigo, verified rather than asserted

Every pair below was computed. Body text and interactive colour clear WCAG AA.

| Token | Light | Dark | Contrast, light / dark |
| --- | --- | --- | --- |
| `--bg` | `#fbfaf9` | `#141317` | page ground |
| `--surface` | `#ffffff` | `#1c1a21` | cards, the popup body |
| `--raised` | `#f4f2ef` | `#26232d` | the code box, table headers |
| `--border` | `#e4e0db` | `#35313d` | decorative hairlines only |
| `--field-border` | `#8d867e` | `#6b6577` | 3.45 / 3.31 on bg |
| `--text` | `#1c1a17` | `#ece9f0` | 16.65 / 15.40 on bg |
| `--muted` | `#6b6560` | `#a39eae` | 5.51 / 7.10 on bg |
| `--accent` | `#4f46e5` | `#8b86ff` | 6.03 / 6.12 on bg |
| `--on-accent` | `#ffffff` | `#15131c` | 6.29 / 6.09 on accent |
| `--ok` | `#15803d` | `#56d98a` | 5.02 / 9.59 on surface |
| `--warn` | `#b4232a` | `#ff8d9b` | 6.53 / 7.82 on surface |

`--border` and `--field-border` are two tokens on purpose. A hairline between a
card and the page is decoration and no contrast rule governs it. The edge of an
input is a control boundary under WCAG 1.4.11 and has to reach 3:1, or you
cannot see where to type. One token at the decorative value fails the second
job; one token at the control value makes every card edge heavy.

### D4. The mark is three cells, the last one filled

A padlock is what every security product uses, and it says "security" rather
than saying what this does. This fills a one-time code into a field, so the mark
is a one-time-code field: three rounded cells in a row, the first two at reduced
opacity and the third solid in the accent.

Opacity and solid fills, never strokes. A 2px stroke on a 24 grid becomes 1.3px
at 16px and turns to mush. A filled shape stays a filled shape.

The 16px icon is drawn on its own 16 grid with whole-pixel cells rather than
scaled from 24, because sub-pixel gaps blur into one grey block at exactly the
size where the icon most needs to be recognisable.

### D5. The extension follows the system preference, with no toggle of its own

The site has a toggle because a visitor may want to read it against their
system. The popup is open for a few seconds at a time. A toggle there means a
stored setting, a migration and a row on the options page, for very little.

Out of scope, stated so it is a decision rather than an oversight.

### D6. Type and spacing

One family for the interface, `system-ui` with the existing fallback stack. The
mono face stays for codes, field names and anything the user may have to compare
character by character, which is the one place where letterform ambiguity costs
something real.

Scale: 12, 13, 14, 16, 20, 24, 32. In rem on the site, px in the extension,
where the popup is a fixed 280px and relative units buy nothing.
Spacing on a 4px grid. Radii: 6px controls, 10px cards, 999px pills.

## Per-surface work

| Surface | Change |
| --- | --- |
| `site/style.css` | Repoint the existing tokens at the new palette. Structure stays. |
| `popup.html` | Extract the inline style onto tokens, add the light theme |
| `options.html` | Same |
| `styles.css` | Same, scoped to the overlay root per D2 |
| `icons/*.png` | Regenerate at 16, 32, 48, 128 from the new mark |
| site favicon, OG image | Regenerate from the new mark |

## Testing

- The light and dark parity test widens to every definition site.
- A test that no extension stylesheet carries a literal hex colour outside its
  token block. That is what stopped the site drifting and is the only reason
  this will not rot.
- A test that the four icon files exist at the sizes the manifest claims.

## Risks

**The icon changes under returning users.** People find an extension by its
toolbar icon. Both store listings, the favicon, the OG image and the README
screenshots carry the padlock today. Worth doing, and worth doing in one release
rather than drifting across several.

**The OAuth consent screen.** Google's branding check compares the consent
screen against the site. That logo lives in Cloud Console and is not covered
here. If the mark changes, the consent screen should change with it or the next
review will have something to say. Flagged, not scheduled.

## Sequence

1. Palette and tokens into `site/style.css`, parity test widened.
2. The mark: SVG, then the four PNG sizes, then the favicon and OG image.
3. `popup.html` and `options.html` onto tokens, light theme added.
4. `styles.css` onto tokens, scoped.
5. Site pages restyled to the warm layout conventions.

Each step stands alone and leaves the tree releasable.
