# Auto Auth Filler

Auto Auth Filler is a browser extension that finds the verification code in your latest Gmail message and fills it into the OTP or two-factor authentication field on whatever page you are using. You sign in with your Google account once, and after that the extension works quietly in the background on every site, with no per-site setup required.

## Why it exists

Switching between your inbox and a login form to copy a six-digit code is a small but constant annoyance, and it adds up if you use two-factor authentication often. This extension removes that step. It detects the input field, retrieves the code from your inbox, and offers to fill it in, all without leaving the page you are on.

## Features

- Detects OTP and 2FA fields on virtually any website using a scoring system based on field attributes, input mode, label text, and surrounding page context. There is no list of supported sites to maintain; it simply works where it is needed.
- Reads recent Gmail messages (read-only) and extracts the verification code using pattern matching that covers plain numeric codes, alphanumeric codes, hyphenated formats, Google-style "G-XXXXXX" codes, and split-digit input boxes.
- Shows a small overlay with the code it found, plus "Fill and Submit" and "Copy" actions, so you stay in control of when the code is used.
- Optional auto-submit after filling, a configurable maximum code age, and a per-domain blocklist for sites where you never want the overlay to appear.
- Works on Chrome, Edge, Brave, Opera, Vivaldi, and Firefox.

## How it works

1. You sign in with Google once, granting the `gmail.readonly` scope. The extension cannot send, delete, or modify your email; it can only read it.
2. When you land on a page with a verification field, the content script recognizes it and asks the background service worker for a code.
3. The background worker searches your most recent Gmail messages for something that looks like a verification email and extracts the code from it.
4. The code appears in an overlay on the page. You choose whether to fill it, fill and submit, or just copy it.

No email content is ever stored or sent anywhere outside your browser. Codes are read into memory long enough to extract and display them, then discarded.

## Installation (development / unpacked)

### Chrome, Edge, Brave, Opera, Vivaldi

1. Open the browser's extensions page (`chrome://extensions`, `edge://extensions`, etc.).
2. Turn on Developer Mode.
3. Click "Load unpacked" and select this project's folder.
4. The Auto Auth Filler icon appears in the toolbar.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on" and select `manifest.json` inside this folder.
3. The Auto Auth Filler icon appears in the toolbar.

Firefox removes temporary add-ons on every restart. For a permanent install, the extension needs to be signed through addons.mozilla.org.

## Setting up your own Google OAuth credentials

This extension needs its own Google Cloud project and OAuth 2.0 Client ID to talk to the Gmail API. The repository ships `config.template.js` but no working Client ID, so the extension will not authenticate until you supply one.

1. Go to the Google Cloud Console and create (or select) a project.
2. Enable the Gmail API for that project.
3. Create OAuth 2.0 credentials of type "Chrome Extension" (or "Web application" for Firefox, using the redirect URI that `chrome.identity.getRedirectURL()` returns).
4. Copy `config.template.js` to `config.js` and put your Client ID in it:

   ```
   copy config.template.js config.js      # Windows
   cp config.template.js config.js        # macOS / Linux
   ```

5. `config.js` is git-ignored, so your ID stays out of the repository. Everything else, including `background.js`, is committed normally.

See `config.template.js` for the full step-by-step instructions, including where to find your extension's ID for the credential setup.

A note on what is and isn't secret: a client ID for an installed application is **not** a credential. It ships inside every published extension and anyone can read it by unpacking the XPI or CRX — Google documents it as public. It is kept out of the repository because it identifies a specific Google Cloud project, not because leaking it would compromise an account. The OAuth *client secret* is the thing that must never be committed, and this extension does not use one.

## Usage

1. Click the Auto Auth Filler icon in the toolbar.
2. Click "Sign in with Google" and approve the read-only Gmail permission.
3. Visit any site that emails you a verification code. When the extension detects a code field, the overlay appears with the code already found.

## Settings

Open the settings page from the popup footer.

| Setting                   | Default    | Description                                                                |
| ------------------------- | ---------- | -------------------------------------------------------------------------- |
| Auto-submit after filling | On         | Automatically activates the form's submit button once the field is filled. |
| Maximum code age          | 10 minutes | Codes found in older emails are ignored.                                   |
| Blocked domains           | Empty      | Domains, one per line, where the overlay should never appear.              |

## Privacy and permissions

- The only Gmail scope requested is `gmail.readonly`. The extension cannot send, delete, or modify any email.
- The OAuth access token is kept in the browser's session storage (or local storage as a fallback on older Firefox versions) and is cleared automatically when the browser closes.
- No data leaves your browser. There is no external server, analytics, or telemetry of any kind.
- Email bodies are processed in memory only, for as long as it takes to look for a code, and are never written to disk or logged.

A full breakdown of why each permission is requested is available in `STORE_LISTING.md`.

## Building a release package

Run `package.bat` (Windows) or `package.sh` (macOS/Linux) from the project root. Both scripts assemble a clean copy of the extension's files into a `dist` folder and produce ZIP archives ready for submission to the Chrome Web Store and Firefox AMO. `config.js` is included in the package — the extension cannot authenticate without it — so make sure it holds *your* Client ID before you upload anything.

## Project structure

```
.
├── background.js        Service worker: OAuth flow, Gmail search, code extraction
├── config.js            Your Client ID. Git-ignored; create it from the template
├── content.js           Detects fields on the page and renders the overlay
├── popup.html / .js     Toolbar popup UI
├── options.html / .js   Settings page
├── styles.css           Overlay styling
├── manifest.json        Extension manifest (Manifest V3)
├── config.template.js   Template and instructions for your own OAuth Client ID
├── icons/               Toolbar and store icons
├── package.bat / .sh    Packaging scripts for store submission
├── SETUP.md             Setup and usage guide
└── STORE_LISTING.md     Draft listing copy and permissions justification for store review
```

## Screenshots

Add screenshots to a `docs/screenshots` folder and reference them here once they exist, for example:

```
docs/screenshots/overlay-on-login-page.png
docs/screenshots/popup-with-code-found.png
docs/screenshots/settings-page.png
docs/screenshots/sign-in-flow.png
```

These same images double as the assets requested during Chrome Web Store and Firefox AMO submission, so capturing them once covers both the README and the store listing.

## Contributing

Issues and pull requests are welcome. If you are changing how OTP detection or extraction works, please describe the kind of page or email format you tested against, since that logic is heuristic by nature and small adjustments can have wide effects.

## License

MIT — see [LICENSE](LICENSE) for details.
