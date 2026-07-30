# Auto Auth Filler Setup Guide

Auto Auth Filler is a browser extension that automatically detects and fills OTP/2FA codes from your Gmail inbox on any website. Once signed in with Google, it works entirely in the background, with no configuration needed per site.

---

## Supported Browsers

| Browser | Status |
|---------|--------|
| Chrome 102+ | ✅ Full support |
| Edge 102+ (Chromium) | ✅ Full support |
| Brave / Opera / Vivaldi | ✅ Full support (Chromium-based) |
| Firefox 140+ | ✅ Full support |

---

## Installation

### Chrome / Edge / Brave

1. Open **chrome://extensions** (or **edge://extensions**).
2. Enable **Developer Mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `Auto Auth Filler` folder.
5. The extension icon (🔐) appears in your toolbar.

### Firefox

1. Open **about:debugging#/runtime/this-firefox**.
2. Click **Load Temporary Add-on…**.
3. Navigate to the `Auto Auth Filler` folder and select `manifest.json`.
4. The extension icon (🔐) appears in your toolbar.

> **Note:** Firefox's "Load Temporary Add-on" is removed on every browser restart. For a permanent install, sign the extension through [addons.mozilla.org](https://addons.mozilla.org).

---

## First-Time Setup: Sign In with Google

1. Click the **🔐 Auto Auth Filler** toolbar icon.
2. Click **Sign in with Google**.
3. Approve the permission request. The extension only asks for `gmail.readonly` (it cannot send or modify emails).
4. You're done. The extension will now automatically search your Gmail inbox for OTP codes whenever it detects a verification field on a webpage.

> Your access token is stored in session storage and cleared when the browser closes. The refresh token is stored in local storage so you stay signed in across restarts; "Sign out" deletes it and revokes the grant with Google.

---

## How It Works

1. **Field detection**: The content script scans every page for OTP/2FA input fields using a score-based heuristic (attribute names, input mode, label text, surrounding context). There is no domain whitelist; it works on every site automatically.
2. **Code search**: When an OTP field is detected, the extension searches your last 10 Gmail messages from the past 10 minutes (configurable) for any message that looks like a verification email.
3. **Extraction**: A pattern-matching engine extracts the code from the email body (plain-text and HTML, supports 4 to 8 digit/alphanumeric codes, labeled patterns like "Code: 123456", Google-style "G-XXXXXX", hyphenated formats, and so on).
4. **Fill**: An overlay appears with the found code and two buttons, "Fill & Submit" (fills the field and clicks the form's submit button) and "Copy" (copies to clipboard).

---

## Settings

Open the **⚙ Settings** page from the popup footer:

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-submit after filling | ON | Automatically clicks the verify/confirm button after filling. |
| Maximum code age | 10 min | Codes older than this are ignored. |
| Blocked domains | (empty) | Enter domains (one per line) where the overlay should never appear. |

---

## Publishing Your Own Copy

To publish this extension under your own Google account, you need to register your own OAuth 2.0 Client ID:

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project → enable the **Gmail API**.
3. Create credentials: **OAuth 2.0 Client ID** → Application type: **Chrome Extension**.
4. Enter your extension's Item ID (visible on chrome://extensions after loading unpacked, or assigned by the Chrome Web Store).
5. Copy `config.template.js` to `config.js` and put your new Client ID in it. `config.js` is git-ignored; `background.js` is committed normally.
6. Run `package.bat` (Windows) to produce the ZIP files for Chrome Web Store and Firefox AMO.

> See `config.template.js` for step-by-step instructions.

---

## Privacy

- The extension only reads Gmail with the **`gmail.readonly`** scope.
- It cannot send, delete, or modify any emails.
- Your access token is stored in browser session storage and cleared when the browser closes; the refresh token is stored in local storage so sign-in survives a restart. Neither is ever transmitted anywhere except to Google.
- No data is sent to any external server. All processing happens locally.
- Email bodies are never stored. They are read in memory and immediately discarded after OTP extraction.
