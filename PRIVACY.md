# Privacy Policy

**Auto Auth Filler**, last updated 2 August 2026

Auto Auth Filler is a browser extension that finds the verification code in your
most recent Gmail message and fills it into the one-time-code field on the page
you are using. This policy explains exactly what it touches and what it does
not.

The short version: everything happens inside your browser. There is no server,
no account and no analytics. Nothing is ever sent anywhere except directly to
Google's own API in order to read your mail on your behalf.

## What Google user data the extension accesses

Auto Auth Filler requests one Google OAuth scope and no others:

| | |
| --- | --- |
| Scope | `https://www.googleapis.com/auth/gmail.readonly` |
| Google user data accessed | The sender, subject, date and body text of your ten most recent Gmail messages from the last day |
| Why | To locate a verification code and check that it was sent by the site you are signing in to |
| Retention | None. Message content is held in memory only while the patterns run over it |

**Google user data the extension does not access:** attachments, contacts,
drafts, labels, mail older than one day, any other Google service, and your
Google profile or account details. No scope granting any of those is requested,
so access is refused by Google rather than merely declined by this extension.

The scope is read-only, so the extension cannot send, delete, modify or label
mail. That restriction is enforced by Google rather than by this extension's own
code: the permission it holds does not allow those actions at all.

**Page content on sites you visit.** To recognise a one-time-code field, the
extension inspects form fields on the page: their names, labels, input types,
maximum lengths and the surrounding wording. This inspection happens locally
and its results are never recorded or transmitted. It runs on all sites because
a verification field can appear on any site; there is no list of supported
websites to maintain.

## What is stored, and where

Everything is stored by your browser, on your device.

| Data | Where | Removed when |
| --- | --- | --- |
| Access token (short-lived) | Browser session storage | The browser closes |
| Refresh token | Browser local storage | You press **Sign out** |
| Your settings (auto-submit, maximum code age, blocked domains) | Browser local storage | You uninstall the extension |
| A fingerprint of codes already tried on a site | Browser local storage | Ten minutes after the attempt |

The refresh token is kept in local storage deliberately, because it must
survive a browser restart. Otherwise you would face a Google consent screen
roughly every hour. Pressing **Sign out** deletes both tokens and additionally
asks Google to revoke the grant, so the extension also disappears from the
permissions list on your Google account.

## What is *not* stored

Email content is never written to disk. Message bodies exist only in memory,
for as long as it takes to run the code-matching patterns over them and are
discarded immediately afterwards. There is no history, no cache and no log of
what was read.

One small exception is worth stating plainly. When a code is entered into a
page, a short fingerprint of it is written to local storage against that site's
hostname, and removed ten minutes later. This exists so a code the site rejects
is never entered a second time, which matters because many sites submit by
reloading the page and would otherwise leave you stuck with a code that cannot
work. The code itself is not stored, though the fingerprint is a checksum and
not a security measure: a six-character code has too little variation for that
to hide it. It is never transmitted anywhere.

## What is transmitted

Requests go to exactly three Google endpoints, and nowhere else:

- `accounts.google.com`, to show you Google's sign-in and consent screen
- `oauth2.googleapis.com`, to exchange, refresh and revoke tokens
- `gmail.googleapis.com`, to search and read your messages

There is no server operated by the developer of this extension. No analytics,
no telemetry, no crash reporting, no advertising and no third-party service of
any kind receives your data. Nothing about your usage is collected.

## How Google user data is shared, transferred or disclosed

**It is not.** Auto Auth Filler does not share, transfer, sell, rent, trade or
otherwise disclose Google user data to any party, under any circumstance.

There is no recipient to name, because there is nobody to name it to:

- No third parties. No analytics provider, advertising network, data broker,
  crash reporter, error tracker or content delivery network receives any of it.
- No developer. The author of this extension cannot read your mail. There is no
  server, no database and no logging endpoint, so there is nowhere for the data
  to arrive even in principle.
- No AI or machine learning. Google user data is never used to train, fine-tune,
  evaluate or prompt any model, whether the developer's or anyone else's.
- No human review. Nobody reads your messages. The only thing that touches them
  is a set of regular expressions running locally in your browser.

The only network destination that ever receives anything is Google itself, and
only to fetch your own mail on your behalf, as listed under **What is
transmitted** above.

Google user data is never transferred out of your browser. It is not sent to
another device, another account or another application.

## How Google user data is protected

**In transit.** Every request to Google is made over HTTPS with TLS. The
extension declares only the three Google hosts listed above and cannot reach any
other origin, so there is no path by which data could be sent somewhere else.

**At rest.** Message content is never written to disk at all, so there is no file
to protect. What is stored is limited to the table under **What is stored, and
where**: two OAuth tokens, your settings and short code fingerprints.

**Where the tokens live.** Browser extension storage is isolated by the browser:
websites you visit cannot read it, and neither can other extensions. The
short-lived access token is kept in session storage and is destroyed when the
browser closes. The refresh token is in local storage and is deleted, and
revoked with Google, the moment you press **Sign out**.

**The sign-in flow.** Authorization uses OAuth 2.0 with PKCE and SHA-256
(RFC 7636). An intercepted authorization code cannot be exchanged for a token
without the verifier, which never leaves the extension.

**Attack surface.** Because there is no developer-operated server, there is no
database to breach, no backup to leak and no employee with access. The data
never exists outside your own browser, which is the strongest protection
available and the reason the extension is built this way.

**Revocation.** You can withdraw access at any moment, either through **Sign
out** or at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions),
without needing to contact anyone.

## Limited Use disclosure

Auto Auth Filler's use and transfer of information received from Google APIs
adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

Specifically, Google user data is used only to provide the extension's single
user-facing feature, which is locating a verification code and entering it.
It is not transferred to anyone, not used for advertising, not used to train
any model and not read by any human.

## Your control

- Automatic filling can be switched off in Settings, in which case the code is
  shown and the extension waits for you. On password fields it always waits.
- Individual sites can be silenced through the blocked-domains list in
  Settings.
- Signing out revokes access immediately.
- You can also revoke access at any time, independently of this extension, at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- Uninstalling the extension removes all stored settings and tokens.

## Children

This extension is not directed at children and collects no personal
information from anyone.

## Changes

Any change to this policy will be published in this file, with the date at the
top updated. The revision history is public in the project's Git repository.

## Contact

Questions or concerns can be raised as an issue in the project's repository at
<https://github.com/AlekPnv/auto-auth-filler>.
