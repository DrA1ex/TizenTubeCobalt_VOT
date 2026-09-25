#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/build/cobalt-27.lts.3/official"
ZIP="$DEST/android-arm-apks.zip"
EXPECTED_ZIP_SHA256="4649b2ed7a0cbce4dc7c46bcf0ae18c314d466ea297e74bbf41345ba16b9a849"
EXPECTED_APK_SHA256="037ec5fb1d5ab12be76e95bac5ca7ec94ce3e4f138c51ac61f71a6cef4c6b7cf"
URL="https://nightly.link/youtube/cobalt/actions/runs/34979978242/android-arm%20APKs.zip"

mkdir -p "$DEST"
curl -fL "$URL" -o "$ZIP"

actual_zip="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
if [[ "$actual_zip" != "$EXPECTED_ZIP_SHA256" ]]; then
    echo "error: unexpected Cobalt artifact SHA-256: $actual_zip" >&2
    exit 1
fi

unzip -o "$ZIP" -d "$DEST"
APK="$DEST/apks/Cobalt.apk"
actual_apk="$(shasum -a 256 "$APK" | awk '{print $1}')"
if [[ "$actual_apk" != "$EXPECTED_APK_SHA256" ]]; then
    echo "error: unexpected official Cobalt APK SHA-256: $actual_apk" >&2
    exit 1
fi

echo "Verified Cobalt 27.lts.3 Android ARM QA artifact: $APK"
