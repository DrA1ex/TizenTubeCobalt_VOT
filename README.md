# TizenTube Cobalt VOT for Android TV

This project builds a RockTek GX1 Android TV APK by combining an official Cobalt Android APK with a TizenTube userscript and a native VOT audio bridge. The TizenTube source is developed in [our TizenTube fork](https://github.com/DrA1ex/TizenTube) and pinned here as a Git submodule. Cobalt is consumed as a verified prebuilt APK; its source tree is not part of this build.

The current v8.8 configuration uses the Cobalt 27.lts.3 Android ARM (`armeabi-v7a`) QA artifact. The APK has passed local checks, but playback on a GX1 device has not yet been verified. A new video gets a fresh maximum-quality trial, while sustained stalls still trigger a step down and brief interruptions, seeks, and suspended timers are ignored. See [changes](CHANGELOG.md) and [Android installation](INSTALL-ANDROID.md).

## Build

Clone with the submodule, install the required tools, and follow [BUILDING.md](BUILDING.md):

```bash
git clone --recurse-submodules https://github.com/DrA1ex/TizenTubeCobalt_VOT.git
cd TizenTubeCobalt_VOT
bash tools/fetch_cobalt_27_lts3_android_arm.sh
bash tools/build_native_vot_apk_macos.sh
```

The build script compiles the pinned fork's `mods/` source, compiles the native bridge, patches the verified Cobalt APK, signs the result, and checks the finished package. Generated APKs, downloaded binaries, dependencies, and signing keys are excluded from Git.

The upstream Cobalt Actions artifact currently has a limited retention period. [BUILDING.md](BUILDING.md) explains how to use an existing copy with the pinned SHA-256 when the download is unavailable.

## Source layout

- `third_party/TizenTube/`: pinned fork submodule; edit and commit JavaScript features there.
- `native_bridge/`: Android VOT bridge and startup code.
- `tools/`: verified input download, APK modification, signing, and checks.
- `tests/`: JavaScript and Java checks.

The original TizenTube project is by [reisxd](https://github.com/reisxd/TizenTube). This project retains its [GPL-3.0 license](LICENSE). Cobalt source and license information are available from [youtube/cobalt](https://github.com/youtube/cobalt).
