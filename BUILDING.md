# Build the Android APK

Each build takes one prebuilt Cobalt APK and compiles our TizenTube fork's JavaScript source and this repository's Android bridge. The pinned Cobalt 27.lts.3 QA run provides `armeabi-v7a`, `arm64-v8a`, and `x86` APKs; it does not provide `x86_64`. The build does not compile Cobalt or use the Tizen WGT service. The fork is pinned by the `third_party/TizenTube` Git submodule; use `git submodule update --init` after checkout.

## Inputs

- Official Cobalt `27.lts.3.1040907-qa` Android APKs from [upstream Actions run 34979978242](https://github.com/youtube/cobalt/actions/runs/34979978242). `tools/fetch_cobalt_27_lts3_android.sh` downloads all three artifacts or reuses verified cached copies. It checks each ZIP and APK SHA-256. The Cobalt Actions artifacts expire on 2026-12-14; keep verified local copies for future builds. A local APK with the matching ABI and exact hash can be supplied with `VOT_BASE_APK` or as the first build argument.
  - `armeabi-v7a`: `037ec5fb1d5ab12be76e95bac5ca7ec94ce3e4f138c51ac61f71a6cef4c6b7cf` at `build/cobalt-27.lts.3/official/apks/Cobalt.apk`.
  - `arm64-v8a`: `04516ca14b3adae5c34d0e4201eccfe75809254bfdb4fd8c382936d76ae98f3b` at `build/cobalt-27.lts.3/official/arm64-v8a/apks/Cobalt.apk`.
  - `x86`: `a382c518090b49b82d30599159d7f5a1c4e50955a724b49315c07db87f1aa26a` at `build/cobalt-27.lts.3/official/x86/apks/Cobalt.apk`.
- TizenTube source from the pinned submodule. Its `mods/package-lock.json` pins npm dependencies; the script runs `npm ci --legacy-peer-deps` on every APK build.
- A JDK, Node.js/npm, Android SDK Build Tools 36, Android platform 35 (`android.jar`), and apktool 3.0.3. On the configured macOS environment the defaults are Homebrew JDK and Android Command-line Tools. Apktool is downloaded on demand from its release and verified against SHA-256 `dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423`.
- A signing keystore. By default `tools/sign_apk_macos.sh` uses `~/.tizentube-vot.keystore` and creates a development key if absent. Set `TT_VOT_KEYSTORE_PASS` for the password. Keep the key safe: Android updates need the same signing identity.

## Commands

```bash
git submodule update --init
bash tools/build_all_native_vot_apks_macos.sh
```

The all-ABI command fetches or verifies the three official base APKs, then builds one installable package for each ABI. The individual build command detects the ABI from the base APK and names its output accordingly. To build only one ABI, pass its base APK as the first argument:

```bash
bash tools/build_native_vot_apk_macos.sh \
  build/cobalt-27.lts.3/official/arm64-v8a/apks/Cobalt.apk
```

Set an optional second argument to choose a custom output path. Each output filename includes the Android ABI of its Cobalt base APK; select the ABI supported by the target device.

Optional overrides are `VOT_ANDROID_JAR`, `VOT_BUILD_TOOLS`, `VOT_APKTOOL_JAR`, `JAVA_HOME`, and `ANDROID_SDK_ROOT`. If the Android platform JAR or apktool is stored outside the default paths, point the build at those verified files:

```bash
export VOT_ANDROID_JAR=/path/to/android-35/android.jar
export VOT_APKTOOL_JAR=/path/to/apktool_3.0.3.jar
bash tools/build_all_native_vot_apks_macos.sh
```

All referenced local files must exist before the build. The builder verifies the base APK SHA-256, identity, and structure before modifying it.

Each build runs JavaScript and Java tests, builds the userscript with Rollup, compiles the native bridge into a separate DEX, decodes the Cobalt APK, adjusts its manifest, startup hook, and video buffer cap, embeds the JavaScript and bridge, rebuilds and signs the APK, and verifies alignment, ZIP integrity, embedded assets, and startup links in the signed DEX. It prints the resulting SHA-256. It does not install the APK on a device. The decoded working directory under `build/vot-release.*` is deleted when the script exits, whether it succeeds or fails; set `VOT_KEEP_BUILD=1` to keep it for debugging. Directories left by interrupted builds are removed at the next start once they are an hour old. The downloaded Cobalt inputs and apktool in `build/` are kept, because the upstream artifacts expire.

For a faster JavaScript-only check after dependency installation:

```bash
node --experimental-vm-modules --test tests/*.test.mjs
```

The full build is currently a macOS workflow. Document any other platform after verifying it. Keep output APKs outside Git and attach tested packages to a GitHub release together with the corresponding source commit and submodule commit.
