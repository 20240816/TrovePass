# TrovePass

A password generator for Android that works offline: one master password plus a site name
produces that site's password, identically every time, on every device — and the generated
passwords are byte-identical to the [LessPass](https://lesspass.com) format, so another
LessPass client will agree with this one.

* **Offline by construction.** The app contains no network code at all — not a request, not a
  socket, not an analytics call — and the Android manifest requests **no permission of any kind**.
  Everything it needs is compiled into the APK.
* **The master password is never stored**, in any form.
* **A generated password is written down only when you press Save on it**, and the saved
  entries are then sealed with a key this device holds (AES-GCM, a non-extractable key in
  IndexedDB). Nothing asks you to unlock anything; the entries are protected at rest, not
  behind a second password.

## Licence

GPL-3.0-or-later: the full text is `LICENSE`, and `NOTICE` carries the one third-party credit.

## Layout

```
src/        the algorithm: WebCrypto + BigInt, zero dependencies (this is the whole core)
web/        the UI: plain HTML/CSS/JS, no framework, no bundler, no runtime dependencies
android/    the Android shell: one activity, one WebView, no dependencies
fastlane/   the store listing text and changelogs F-Droid reads straight out of this repo
fdroid/     the F-Droid build recipe
tools/      the build steps, listed below
build.mjs   concatenates src/ into the bundle the UI imports
```

`src/version.js` is the version the app's About tab shows; the build writes it, and the two commands below
then carry it into the Android assets. The launcher icons and the store images are rendered from the mark
in `android/app/src/main/res/drawable/ic_launcher.xml` — that vector is the source the PNGs come from.

## Building

**The APK** needs a JDK 17 and the Android SDK:

```
cd android && gradle assembleRelease
```

`android/app/src/main/assets/www/` is a committed copy of `web/` plus the built bundle, so
the APK builds with no Node.js at all — that is what F-Droid's build server needs.

**The web bundle** (only needed if you change `src/` or `web/`) needs Node.js ≥ 20:

```
npm run build          # concatenates src/ -> dist/trovepass.js  (bumps the patch version)
npm run sync           # copies web/ + dist/ into android/app/src/main/assets/www/
```

There is nothing to install: the build scripts use only Node's own standard library.

## The password format

For a site, a login, a counter and a set of character classes:

```
salt   = site + login + counter.toString(16)      (hex, unpadded)
key    = PBKDF2-HMAC-SHA256(master, salt, 100000, dkLen = 32 bytes)
chars  = one character per selected class, then the rest, chosen by repeatedly taking
         the running BigInt modulo the pool length and dividing it down
```

Two details are upstream's quirks rather than choices, and are reproduced deliberately
because a "fix" would change every existing password:

* the counter is hex and unpadded, so the site and the login run into it without a delimiter;
* the characters for the selected classes are inserted at positions taken modulo the
  **current** length, which leaves the final slot unreachable.
