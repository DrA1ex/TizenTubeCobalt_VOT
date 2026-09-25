# Build the Android APK

The build takes **one prebuilt Cobalt APK** and compiles **our TizenTube fork's JavaScript source** and **this repository's Android bridge**. It does not compile Cobalt or use the Tizen WGT service. The fork is pinned by the `third_party/TizenTube` Git submodule commit; use `git submodule update --init` after checkout.

## Inputs

- Official Cobalt `27.lts.3.1040907-qa` Android ARM APK. `tools/fetch_cobalt_27_lts3_android_arm.sh` downloads the artifact from the upstream Cobalt Actions run or reuses a verified cached copy. It verifies the ZIP and APK SHA-256 values. The expected APK SHA-256 is `037ec5fb1d5ab12be76e95bac5ca7ec94ce3e4f138c51ac61f71a6cef4c6b7cf`. The upstream Actions API lists this artifact as expiring on 2026-12-14. A local copy with the exact hash can be supplied with `VOT_BASE_APK` or as the first build argument when the download is unavailable.
- TizenTube source from the pinned submodule. Its `mods/package-lock.json` pins npm dependencies; the script runs `npm ci --legacy-peer-deps` on every APK build.
- A JDK, Node.js/npm, Android SDK Build Tools 36, Android platform 35 (`android.jar`), and apktool 3.0.3. On the configured macOS environment the defaults are Homebrew JDK and Android Command-line Tools. Apktool is downloaded on demand from its release and verified against SHA-256 `dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423`.
- A signing keystore. By default `tools/sign_apk_macos.sh` uses `~/.tizentube-vot.keystore` and creates a development key if absent. Set `TT_VOT_KEYSTORE_PASS` for the password. Keep the key safe: Android updates need the same signing identity.

## Commands

```bash
git submodule update --init
bash tools/fetch_cobalt_27_lts3_android_arm.sh
bash tools/build_native_vot_apk_macos.sh
```

For an existing base APK and custom output path:

```bash
VOT_BASE_APK=/path/to/Cobalt.apk \
  bash tools/build_native_vot_apk_macos.sh \
  /path/to/Cobalt.apk \
  /path/to/TizenTube-Cobalt-VOT.apk
```

Optional overrides are `VOT_ANDROID_JAR`, `VOT_BUILD_TOOLS`, `VOT_APKTOOL_JAR`, `JAVA_HOME`, and `ANDROID_SDK_ROOT`. All referenced local files must exist before the build. The builder verifies the base APK SHA-256, identity, and structure before modifying it.

The script runs JavaScript and Java tests, builds the userscript with Rollup, compiles the native bridge into a separate DEX, decodes the Cobalt APK, adjusts its manifest, startup hook, and video buffer cap, embeds the JavaScript and bridge, rebuilds and signs the APK, and verifies alignment, ZIP integrity, embedded assets, and startup links in the signed DEX. It prints the resulting SHA-256. It does not install the APK on a device.

For a faster JavaScript-only check after dependency installation:

```bash
node --experimental-vm-modules --test tests/*.test.mjs
```

The full build is currently a macOS workflow. Document any other platform after verifying it. Keep output APKs outside Git and attach tested packages to a GitHub release together with the corresponding source commit and submodule commit.
