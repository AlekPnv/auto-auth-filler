// Auto Auth Filler - OAuth configuration template
//
// Copy this file to `config.js` and replace the placeholder below with your
// own Client ID. `config.js` is git-ignored, so your ID stays out of the
// repository while this template remains the shared reference.
//
//   Windows:      copy config.template.js config.js
//   macOS/Linux:  cp config.template.js config.js
//
// Getting a Client ID:
//
//  1. Go to https://console.cloud.google.com/ and create (or select) a project.
//  2. Enable the Gmail API:
//     APIs & Services -> Library -> search "Gmail API" -> Enable
//  3. Configure the OAuth consent screen. While it is in "Testing", add your
//     own Google account under "Test users" or sign-in will be refused.
//  4. APIs & Services -> Credentials -> Create Credentials -> OAuth client ID
//     - Chrome/Edge/Brave: application type "Chrome Extension", then enter the
//       extension ID shown at chrome://extensions after loading it unpacked.
//     - Firefox: application type "Web application", then add the redirect URI
//       that chrome.identity.getRedirectURL() returns. It is logged to the
//       console the first time authentication runs.
//  5. Paste the generated Client ID below. It looks like:
//     1234567890-abcdefg....apps.googleusercontent.com
//
// A client ID for an installed app is not a secret: it ships inside every
// published extension and anyone can read it by unpacking the XPI or CRX. It
// is kept out of the repo because it identifies a specific Google Cloud
// project, not because leaking it would compromise an account. The OAuth
// *client secret* is what must never be committed, and this extension has none.

// About CLIENT_SECRET: Google's "Web application" client type requires it at
// the token endpoint even when PKCE is used - verified by request, the token
// endpoint answers "client_secret is missing" without it. Firefox forces this
// client type, because chrome.identity.getRedirectURL() returns an https URI
// and only a Web application client accepts one.
//
// This means the secret ships inside the packaged extension and is readable by
// anyone who unpacks it. That is unavoidable for this client type and is why
// the flow also uses PKCE, which stops an intercepted authorization code from
// being redeemed by someone else. Keep the blast radius small: use a client
// dedicated to this extension, never one shared with a server-side app.

globalThis.AAF_CONFIG = {
  CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE",
  CLIENT_SECRET: "YOUR_GOOGLE_OAUTH_CLIENT_SECRET_HERE",
};
