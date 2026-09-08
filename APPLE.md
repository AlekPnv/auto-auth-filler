# Apple platforms

**Status: not supported. Nothing here has been built, run or tested.**

This document exists so that a future attempt starts from facts rather than
from scratch. It deliberately claims nothing about whether the extension works
on Safari, because nobody has been able to try.

## Why not, in one paragraph

Safari web extensions can only be built, signed and notarised with Xcode, which
runs on macOS only. This project is developed on Windows. There is no converter,
no CI runner and no cross-compiler that removes that requirement: Apple's
toolchain is the only way in. Shipping also requires an Apple Developer
membership at 99 USD per year, and an extension for iOS or iPadOS has to be
delivered inside an App Store application rather than installed directly.

## The unresolved technical question

Even with a Mac, one thing has to be tested before any of this is worth
starting: **whether Safari supports the `identity` API this extension uses to
sign in to Google.**

Sources disagree. Some report `identity.launchWebAuthFlow` working from Safari
16.4 with a redirect base derived from the containing app; others state that
`browser.identity` is absent in Safari and that `safari-web-extension://` URLs
are blocked. That contradiction cannot be settled by reading. It needs one
afternoon on real hardware.

It matters because sign-in is not a feature of this extension, it is the whole
of it. An extension that cannot reach Gmail does nothing at all.

## What a port would actually touch

The codebase is already shaped for this, which is the one piece of good news.
Authentication is split per browser rather than being one tangled function:

| Location | What it does |
| --- | --- |
| `background.js`, `authenticateChrome()` | `launchWebAuthFlow` against the `chromiumapp.org` redirect |
| `background.js`, `authenticateFirefox()` | Opens a tab and watches `tabs.onUpdated`, because Firefox was unreliable with `launchWebAuthFlow` |
| `background.js`, `buildAuthUrl()` | Shared. Builds the authorisation URL with PKCE and `state` |

A Safari port adds a third function beside the other two. It does not require
restructuring anything, and no adapter layer has been added in advance, because
inventing an abstraction for a platform nobody can test is how speculative
generality gets into a codebase.

Beyond that:

- A **third OAuth redirect URI** must be registered in Google Cloud Console,
  derived from the app bundle identifier rather than the extension ID.
- `manifest.json` needs a Safari-compatible background declaration. The project
  already generates a different manifest per browser in `make-manifest.js`, so
  this is an addition to an existing mechanism rather than a new one.
- `<all_urls>` behaves differently. Safari asks the user per site and offers
  "allow for one day" rather than granting broadly at install, so the detection
  overlay would simply not appear until permission is granted for that site.
  That is a real change in how the product feels, not just a permission dialog.

## Options

### Option A: document it and stop. Current choice.

**What:** Say plainly that Safari is unsupported, explain why, and record what a
port would involve. No code changes.

**Complexity:** none. **New technology:** none. **Apple requirements:** none.
**Maintenance:** none.

**Limitation:** Safari users have no extension. On a Mac they can use Chrome,
Edge, Brave, Opera or Vivaldi, all of which are supported. On iPhone and iPad
there is no option at all.

**When:** now, and this is what has been done.

### Option B: a real Safari web extension. Recommended if circumstances change.

**What:** Convert with `xcrun safari-web-extension-converter`, resolve the
identity question, register the third redirect URI, test on real hardware, and
submit to the Mac App Store and the App Store.

**Complexity:** moderate, with one large unknown. The conversion itself is close
to mechanical; the OAuth flow is where the work is. **New technology:** Xcode,
a small amount of Swift for the app shell, Apple's signing and notarisation.
**Apple requirements:** a Mac, 99 USD per year, App Store review for two
targets, and a privacy manifest declaring data use.

**Maintenance:** this is the part people underestimate. Every release becomes
four submissions instead of two, each with its own review. The membership and
its certificates renew annually, and a lapsed membership removes shipped apps
from sale.

**Limitation:** the per-site permission model means the extension is quieter and
more manual on Safari than elsewhere, even when it works.

**When:** only once a Mac is available and the identity question has been tested.
Not before.

### Option C: a full Apple ecosystem. Not recommended, now or later.

**What:** Safari extension, a macOS companion app, an iOS app, and iCloud sync
between them.

**Complexity:** high. **New technology:** Swift and SwiftUI properly, three App
Store review processes, and a synchronisation service.

**Why it is the wrong direction, on its own terms:** sync means verification
codes leaving the device. The single strongest claim this project can make is
that nothing does. Adding a backend to store one-time codes in order to have a
tidier ecosystem story would trade away the thing that makes the extension
defensible, in exchange for a feature nobody has asked for. It would also have
to be disclosed in the privacy policy and re-reviewed by Google, whose Limited
Use terms currently permit this design precisely because there is no server.

**When:** no.

## What would change the decision

In rough order of how much each one matters:

1. Access to a Mac, even occasionally. Without it nothing else is relevant.
2. A test showing `identity.launchWebAuthFlow` completing against Google in
   Safari. If it cannot, Option B is dead regardless of budget.
3. Enough users on Apple platforms to justify 99 USD a year and a permanently
   doubled release process.

Item three is worth being honest about. The Google consent screen is capped at
100 users while the app is unverified, and that cap is not close to being
reached. Adding two more stores before the first hundred users exist would be
building distribution for demand that has not appeared.
