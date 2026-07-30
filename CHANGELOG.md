# Changelog

All notable changes to Auto Auth Filler are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.1] - 2026-07-30

### Fixed

- The popup showed "Sign in with Google" while already signed in, and the on-page overlay never hid its action row. Both elements were toggled correctly in JavaScript via the `hidden` attribute, but `hidden` is enforced by a user-agent rule that any author `display` declaration outranks — `.btn-row` and `.aaf-actions` are both `display: flex`, so the elements stayed on screen regardless. An explicit `[hidden] { display: none !important }` now backs the attribute in all three stylesheets.
- The popup's status dot stayed yellow after fetching a code. `setLoading(false)` assigned `authDot.className` to itself, which changed nothing; it now restores green or red from the actual sign-in state.

## [3.1.0] - 2026-07-30

### Fixed

- Alphanumeric codes were lost whenever an ordinary word sat in front of them. Each pattern only ever examined its first match, so a word without digits — "continue" in `Enter this code to continue: 7FK2QA` — consumed the pattern and the real code was never reached. Every occurrence is now checked before falling through to the next pattern.
- The label pattern could not span a word between the label and the code. Its separator excluded letters, so `Ihr Einmalcode lautet 934812` never matched as a labelled code and only worked by accident, because the bare-digit fallback happened to find the same number. Up to three words are now allowed in the gap.
- German code fields were not detected. `\b` cannot break a compound noun, so `Bestätigungscode` and `Einmalcode` scored nothing on the field name and such fields landed on 27 points against a threshold of 28 — one point short. The name, form-wording and submit-button vocabulary now recognise German compounds.
- The overlay could sit on "Searching Gmail for code…" indefinitely. When the background worker replied that it was busy, the content script never inspected the response and neither retried nor gave up. Busy replies are now retried with a backoff, and any search that goes unanswered times out.

### Changed

- Card PIN fields are no longer offered a Gmail code. `pin` still scores, but a field that scored on `pin` alone is demoted when the surrounding form mentions a card, payment or IBAN.
- Code fields rendered as `type="password"`, as some banks do, are now detected. They are only considered when the field names itself unambiguously — `otp`, `one-time`, `Einmalcode`, `Bestätigungscode` or `verification code` — so ordinary password boxes are never touched. `passcode` is deliberately excluded, because sites use it for real passwords.
- The OAuth client ID moved out of `background.js` into a git-ignored `config.js`, created from `config.template.js`. `background.js` is now committed like any other file — previously the whole file was excluded from version control, which left a clone with no background script at all.
- The overlay's action row is built with DOM calls instead of `innerHTML`. The code was already escaped, but add-on review flags every dynamic `innerHTML` assignment, and `escapeHtml()` is no longer needed.
- Declared `data_collection_permissions: { required: ["none"] }`, which addons.mozilla.org requires for new submissions. The extension transmits nothing: email bodies are matched in memory and discarded.
- Minimum Firefox raised from 128 to 140, the first version that supports that key. Firefox for Android needs 142.

### Known issues

- Authentication still uses the OAuth implicit flow (`response_type=token`), which Google has deprecated for new clients and which cannot refresh silently. Migrating to authorization code + PKCE is the next significant piece of work.

## [3.0.0] - 2026-06-07

### Added

- Score-based OTP and 2FA field detection that works on any site without a domain whitelist or per-site setup. Fields are recognized by attribute names, input mode, label text, and surrounding page context.
- Google sign-in using the `gmail.readonly` scope, with the OAuth token stored in session storage so it clears automatically when the browser closes.
- An on-page overlay that shows the detected code with "Fill & Submit" and "Copy" actions.
- Support for a wide range of code formats: standard 6 to 8 digit codes, alphanumeric codes, hyphenated formats, Google-style "G-XXXXXX" codes, and split-digit input boxes.
- Configurable auto-submit after fill, a maximum code age filter (default 10 minutes), and a per-domain blocklist.
- Cross-browser support for Chrome, Edge, Brave, Opera, Vivaldi, and Firefox 128 and newer.

### Notes

- This release uses the OAuth implicit grant flow (`response_type=token`). The extension now reads the actual `expires_in` value returned by Google for each token instead of assuming a fixed lifetime, so token refresh timing matches what Google actually grants.

[3.1.1]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.1.1
[3.1.0]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.1.0
[3.0.0]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.0.0
