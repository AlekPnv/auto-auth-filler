# Security

This extension holds a Gmail read-only token and can read the contents of your
inbox, so a flaw in it is worth reporting carefully.

## Reporting

Use [private vulnerability reporting](https://github.com/AlekPnv/auto-auth-filler/security/advisories/new)
rather than a public issue. I will confirm within a few days.

Please do not include a real verification code, a real email or an access token
in the report. A description of the flaw is enough.

## What is in scope

- Reading mail the extension has no reason to read
- A code being entered into a site it was not sent for
- The access or refresh token leaking out of the browser
- A page being able to read the code, the token or anything else the extension holds
- Detection being tricked into treating a normal field as a code field

## What is not

**The client secret ships inside the package.** This is known and unavoidable.
Google's Web application client type requires the secret at the token endpoint
even when PKCE is used, and Firefox forces that client type because
`chrome.identity.getRedirectURL()` returns an HTTPS redirect URI. The
authorization flow therefore uses PKCE with SHA-256, so an intercepted
authorization code cannot be redeemed without the verifier, which never leaves
the extension. The README explains this at greater length.

**The unverified app warning during sign-in.** The `gmail.readonly` scope is
restricted, and clearing that warning requires an annual paid third-party
assessment. The consent screen is published but unverified, which Google permits
up to 100 users.

**`<all_urls>` in the content script.** A verification field can appear on any
domain. The content script reads form-field metadata only, and does nothing at
all on a page where no field scores above the detection threshold.

## Supported versions

Only the latest release. This is a single-developer project with no backport
branch.
