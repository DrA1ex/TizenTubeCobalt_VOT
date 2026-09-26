#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/tools/fetch_cobalt_27_lts3_android.sh"

BASE="$ROOT/build/cobalt-27.lts.3/official"
for abi in armeabi-v7a arm64-v8a x86; do
    case "$abi" in
        armeabi-v7a) apk="$BASE/apks/Cobalt.apk" ;;
        *) apk="$BASE/$abi/apks/Cobalt.apk" ;;
    esac
    VOT_BASE_APK="$apk" bash "$ROOT/tools/build_native_vot_apk_macos.sh"
done
