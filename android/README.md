# Android shell

The app's Android container: one WebView, serving the assets in this directory. It declares **no permission
of any kind** and contains no network code; the hardening it applies is listed below.

## What is here

```
settings.gradle, build.gradle, app/build.gradle   plain Gradle app, no dependencies at all
gradle/wrapper/gradle-wrapper.properties          the Gradle version a store's builder runs (pinned)
app/src/main/AndroidManifest.xml                  no permission at all, backup off, cleartext off
app/src/main/java/dev/trovepass/MainActivity.java the whole shell: asset-loader origin, WebView
                                                  hardening, FLAG_SECURE, one narrow JS bridge
app/src/main/res/                                 strings, theme/colours matching the web UI, icon
app/src/main/assets/www/                          committed copy of web/ and the built bundle
```

`app/src/main/assets/www/` holds the app's own files and the built bundle, so the APK builds with a JDK
and no Node. `node tools/android-sync.mjs --write` refreshes that copy from `web/`, and
`node tools/android-sync.mjs --check` fails on any drift — between the copy and `web/`, and between the
Gradle `applicationId` and the app id in `src/brand.js`.

## What is checked here, and what is not

`node tools/android-sync.mjs --check` audits this directory with no Android toolchain at all:

- the assets are byte-identical to `web/` and to the built bundle;
- the Gradle `applicationId` equals the app id in `src/brand.js`;
- the manifest declares **no `<uses-permission>` at all**, and neither a request element nor an
  `android.permission.*` name anywhere in the file passes the audit — it sets `allowBackup="false"` and
  `usesCleartextTraffic="false"`, and the activity handles every `configChanges` the platform can dispatch;
- no Android source uses a network API, and `FLAG_SECURE` is set;
- every XML file here is well-formed.

**Not checked here**: nothing here compiles anything — the build is Gradle's job,
`cd android && gradle assembleRelease`.

## Before any release

1. The `applicationId` is `io.github.u_20240816.trovepass`, and it is permanent once the app is published:
   F-Droid identifies an app by it. The file to submit to fdroiddata is `fdroid/metadata.example.yml`, which
   belongs there under `metadata/`, named after that id.
2. Stamp the version — `node tools/fastlane.mjs --stamp X.Y.Z` writes `versionName`/`versionCode`
   (`versionCode = major*10000 + minor*100 + patch`), then tag the commit `vX.Y.Z`: F-Droid builds from
   the tag and reads the version out of this file by regex.
