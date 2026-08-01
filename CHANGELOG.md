# Changelog

All notable changes to Auto Auth Filler are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.5.0] - 2026-07-31

### Fixed

- **Signing in a second time filled the previous code first.** The extension took the newest code within the age limit, and on a second attempt at the same site the earlier code is usually still inside that limit and is the newest one in existence at the moment of the search. It was then replaced a few seconds later when the real code arrived, which looked like the extension changing its mind. A lookup now ignores anything sent more than ninety seconds before the code field appeared, so a leftover code is never offered.
- **Waiting for mail no longer tears the overlay down.** Previously a lookup that found nothing reported failure and closed, and only a later DOM change would start another. The overlay now stays open and asks again every four seconds for up to two minutes, so it is waiting rather than repeatedly giving up. This is also what made a stale code dangerous: with the field left filled, no further search would run and the real code would never be entered.
- If nothing fresh arrives within that window, the freshness requirement is dropped once and the most recent code is used, so the wait can never end with nothing when a usable code exists.

### Note

Making the subject searchable in 3.4.0 introduced a false positive found by the test suite: a subject of "Your verification code" followed by a body beginning with any word placed that word directly after a label and alone on a line, so "Your" was briefly a valid code. A presented code must now sit directly after a colon or genuinely alone on its line.

## [3.4.1] - 2026-07-31

### Fixed

- **The overlay reopened in a loop after filling a code.** Writing into the field is itself a DOM change, so the mutation observer woke, found the same field again, and started another lookup. That closed the overlay, reopened it on "Searching Gmail for code", filled again, and repeated for as long as the page stayed open. Two rules stop it: a field that already holds a value needs nothing, and no second lookup may begin within fifteen seconds of the last one. Clearing the field on purpose still triggers a fresh search once that time has passed, which is what someone retrying a rejected code expects.

## [3.4.0] - 2026-07-31

### Fixed

- **Codes without digits were found and then thrown away.** Blizzard sends codes like `RXCZMK`, and a rule requiring at least one digit discarded them, so the extension reported that no code existed while it was sitting in the inbox. That rule was there to stop the unlabelled pattern matching ordinary words, so it could not simply be removed. A code without digits is now accepted when a security-specific label presents it as a value, after a colon or on its own line. Capitalisation deliberately plays no part: a lowercase code is just as valid, and `Use code SUMMER for 20% off` is still rejected because "code" alone is not a security label.
- **The subject line was never searched.** It was already being read, for display in the overlay, but only the snippet and body were scanned. Several services put the code in the subject and some put it nowhere else.
- **HTML structure was destroyed before matching.** Every run of whitespace was collapsed to a single space, so a code presented alone in a heading or a bold table cell ran into the sentence before it and no longer looked separate. Block-level tags now become line breaks, and HTML entities are decoded so a code wrapped in `&nbsp;` is still readable.
- Codes are filled in the case they were written in. They were previously upper-cased, which would break any site that compares them exactly.
- Steam Guard codes are five characters, below the six-character floor of the unlabelled pattern, so they were missed whenever the label did not match. That pattern now starts at four characters and requires both a letter and a digit, which keeps ordinary words and bare numbers out.

### Changed

- The label list now covers the wording the large services actually use, including "Steam Guard code", "login code", "sign-in code", "access code", "confirmation code", "one-time password", "2FA code" and the German `Anmeldecode` and `Zugangscode`. Up to four words may sit between the label and the code, which is what phrasings like Steam's "the Steam Guard code you need to login:" require.
- The test suite now checks the exact phrasing used by Blizzard, Steam, Epic Games, Twitch, Discord, Amazon, Microsoft, Apple, PayPal, Netflix, GitHub and Google, so a change to the patterns cannot quietly break one of them.

## [3.3.1] - 2026-07-31

### Fixed

- **Several `chrome.*` calls were used as if they returned promises.** Firefox implements the `chrome` namespace with callbacks, so those calls return `undefined` there. Two of them mattered: `isPageRelevant()` destructured the result and threw, which would stop the content script before it ever looked at the page, and the Firefox sign-in flow read `tab.id` off the same kind of result. Every such call now goes through a small wrapper that passes a callback, which both engines accept.
- A failed token refresh discarded the refresh token whatever the cause. A dropped connection or a Google outage would therefore sign the user out and send them back through the consent screen for a problem that fixes itself. Only a rejected grant clears it now, distinguished by the OAuth `invalid_grant` code rather than by matching on the message text.
- Auto-submit searched the whole page for a button and clicked the first plausible match, which could be an unrelated "Continue" elsewhere. It now looks inside the filled field's own form first. This matters more since filling became automatic, because nothing else stands between a misdetection and a click.
- The busy lock had no expiry. A lookup that opened a consent tab the user never finished would hold it for the rest of the session, and every later request would be answered "busy". The lock now expires after two minutes.
- Errors reached the overlay as `String(err)`, which renders as "Error: Error: ...". Only the message is sent now.
- A malformed Gmail response could throw on a missing `payload` or an unparseable `internalDate`. Both are guarded.
- The clipboard button silently did nothing when a page denied clipboard access. It now shows that the copy failed.

### Added

- A test suite covering code extraction and the OAuth logic, run with `node --test` and needing nothing installed. It checks extraction against a corpus of real email shapes, including the German ones and the cases that used to fail, and verifies PKCE against the test vector in RFC 7636.

## [3.3.0] - 2026-07-31

### Added

- The code is now entered as soon as it is found, without waiting for a click. This was the original intent of the extension: if you still have to click, you have done about as much work as opening your inbox yourself. A new "Fill automatically" setting turns it off for anyone who prefers to confirm each time.
- Fields rendered as `type="password"` are the one exception and always wait for a click, whatever the setting. Those are the fields where a misdetection does real damage.

### Changed

- The store listing, README, setup guide, privacy policy and website all described the old behaviour, where nothing was entered without a click. All of them now describe what the extension actually does.
- Reviewer notes added to `STORE_LISTING.md`, covering the unverified-app warning a reviewer will hit, how to test with a supplied account, the absence of any build step, why `config.js` contains a client secret, and the justification for `<all_urls>`.

## [3.2.0] - 2026-07-30

### Changed

- **Authentication moved from the OAuth implicit flow to authorization code with PKCE.** The implicit flow returns only an access token, never a refresh token, so the consent screen reappeared roughly every hour. The extension now exchanges an authorization code for an access token *and* a refresh token, and renews silently from then on: you sign in once. The PKCE challenge is SHA-256 and verified against the RFC 7636 test vector; a random `state` value is checked on return to reject a mismatched redirect.
- Token storage split to match the new lifetimes. The access token stays in session storage and is cleared when the browser closes; the refresh token is kept in local storage, because sign-in that does not survive a restart defeats the purpose. **Sign out** now deletes both and revokes the grant with Google, so the extension also disappears from the account's permissions page.
- A 401 during a Gmail request now discards only the access token and renews it, instead of clearing everything and forcing a new consent screen.
- `CHECK_AUTH` treats a stored refresh token as signed in. Previously the popup reported "Not signed in" after every browser restart, because it only looked at the session-scoped access token.
- `config.js` gained `CLIENT_SECRET`. Google's Web application client type requires it at the token endpoint even with PKCE. Confirmed by request: the endpoint answers `client_secret is missing` without it. Firefox forces that client type, because `chrome.identity.getRedirectURL()` returns an https URI and only a Web application client accepts one. The secret therefore ships inside the package; PKCE is what stops an intercepted code from being redeemed by anyone else.

### Migration

- Copy the client secret from Google Cloud Console into `config.js` before loading this version, or sign-in will fail with a readable configuration error.
- Existing users are signed out once, because tokens from the implicit flow cannot be upgraded to refresh tokens. The next sign-in is the last one they will need.

## [3.1.1] - 2026-07-30

### Fixed

- The popup showed "Sign in with Google" while already signed in, and the on-page overlay never hid its action row. Both elements were toggled correctly in JavaScript via the `hidden` attribute, but `hidden` is enforced by a user-agent rule that any author `display` declaration outranks. `.btn-row` and `.aaf-actions` are both `display: flex`, so the elements stayed on screen regardless. An explicit `[hidden] { display: none !important }` now backs the attribute in all three stylesheets.
- The popup's status dot stayed yellow after fetching a code. `setLoading(false)` assigned `authDot.className` to itself, which changed nothing; it now restores green or red from the actual sign-in state.

## [3.1.0] - 2026-07-30

### Fixed

- Alphanumeric codes were lost whenever an ordinary word sat in front of them. Each pattern only ever examined its first match, so a word without digits, "continue" in `Enter this code to continue: 7FK2QA`, consumed the pattern and the real code was never reached. Every occurrence is now checked before falling through to the next pattern.
- The label pattern could not span a word between the label and the code. Its separator excluded letters, so `Ihr Einmalcode lautet 934812` never matched as a labelled code and only worked by accident, because the bare-digit fallback happened to find the same number. Up to three words are now allowed in the gap.
- German code fields were not detected. `\b` cannot break a compound noun, so `Bestätigungscode` and `Einmalcode` scored nothing on the field name and such fields landed on 27 points against a threshold of 28, one point short. The name, form-wording and submit-button vocabulary now recognise German compounds.
- The overlay could sit on "Searching Gmail for code…" indefinitely. When the background worker replied that it was busy, the content script never inspected the response and neither retried nor gave up. Busy replies are now retried with a backoff, and any search that goes unanswered times out.

### Changed

- Card PIN fields are no longer offered a Gmail code. `pin` still scores, but a field that scored on `pin` alone is demoted when the surrounding form mentions a card, payment or IBAN.
- Code fields rendered as `type="password"`, as some banks do, are now detected. They are only considered when the field names itself unambiguously (`otp`, `one-time`, `Einmalcode`, `Bestätigungscode` or `verification code`), so ordinary password boxes are never touched. `passcode` is deliberately excluded, because sites use it for real passwords.
- The OAuth client ID moved out of `background.js` into a git-ignored `config.js`, created from `config.template.js`. `background.js` is now committed like any other file. Previously the whole file was excluded from version control, which left a clone with no background script at all.
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

[3.5.0]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.5.0
[3.4.1]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.4.1
[3.4.0]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.4.0
[3.3.1]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.3.1
[3.3.0]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.3.0
[3.2.0]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.2.0
[3.1.1]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.1.1
[3.1.0]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.1.0
[3.0.0]: https://github.com/AlekPnv/auto-auth-filler/releases/tag/v3.0.0
