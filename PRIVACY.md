# Privacy Policy

**Auto Auth Filler**, last updated 31 July 2026

Auto Auth Filler is a browser extension that finds the verification code in your
most recent Gmail message and fills it into the one-time-code field on the page
you are using. This policy explains exactly what it touches and what it does
not.

The short version: everything happens inside your browser. There is no server,
no account and no analytics. Nothing is ever sent anywhere except directly to
Google's own API in order to read your mail on your behalf.

## What the extension accesses

**Gmail messages, read-only.** The extension requests a single Google
permission, `https://www.googleapis.com/auth/gmail.readonly`. It searches your
ten most recent messages from the last day that look like verification emails,
and reads them only to locate a numeric or alphanumeric code.

It cannot send, delete, modify or label mail. That is enforced by Google, not
merely by this extension's own code. The permission granted does not allow it.

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

The refresh token is kept in local storage deliberately, because it must
survive a browser restart. Otherwise you would face a Google consent screen
roughly every hour. Pressing **Sign out** deletes both tokens and additionally
asks Google to revoke the grant, so the extension also disappears from the
permissions list on your Google account.

## What is *not* stored

Email content is never written to disk. Message bodies exist only in memory,
for as long as it takes to run the code-matching patterns over them and are
discarded immediately afterwards. Codes themselves are not saved either. There
is no history, no cache and no log of what was read.

## What is transmitted

Requests go to exactly three Google endpoints, and nowhere else:

- `accounts.google.com`, to show you Google's sign-in and consent screen
- `oauth2.googleapis.com`, to exchange, refresh and revoke tokens
- `gmail.googleapis.com`, to search and read your messages

There is no server operated by the developer of this extension. No analytics,
no telemetry, no crash reporting, no advertising and no third-party service of
any kind receives your data. Nothing about your usage is collected.

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
