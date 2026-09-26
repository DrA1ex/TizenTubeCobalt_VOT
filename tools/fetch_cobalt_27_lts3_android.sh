#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$ROOT/build/cobalt-27.lts.3/official"
RUN_ID="34979978242"

fetch_arch() {
    local abi="$1" artifact="$2" zip_sha="$3" apk_sha="$4" relative_apk="$5"
    local apk="$BASE/$relative_apk" zip="$BASE/$abi.zip" temporary_zip="$BASE/$abi.zip.part"

    if [[ -f "$apk" ]]; then
        local actual_apk
        actual_apk="$(shasum -a 256 "$apk" | awk '{print $1}')"
        if [[ "$actual_apk" == "$apk_sha" ]]; then
            echo "Verified cached Cobalt $abi APK: $apk"
            return
        fi
        echo "error: cached Cobalt $abi APK has an unexpected SHA-256: $actual_apk" >&2
        return 1
    fi

    mkdir -p "$(dirname "$apk")"
    if [[ ! -f "$zip" ]]; then
        rm -f "$temporary_zip"
        curl -fL --retry 2 \
            "https://nightly.link/youtube/cobalt/actions/runs/$RUN_ID/$artifact.zip" \
            -o "$temporary_zip"
        local actual_zip
        actual_zip="$(shasum -a 256 "$temporary_zip" | awk '{print $1}')"
        if [[ "$actual_zip" != "$zip_sha" ]]; then
            rm -f "$temporary_zip"
            echo "error: unexpected Cobalt $abi artifact SHA-256: $actual_zip" >&2
            return 1
        fi
        mv "$temporary_zip" "$zip"
    fi

    local actual_zip
    actual_zip="$(shasum -a 256 "$zip" | awk '{print $1}')"
    if [[ "$actual_zip" != "$zip_sha" ]]; then
        echo "error: cached Cobalt $abi ZIP SHA-256 mismatch: $actual_zip" >&2
        return 1
    fi
    unzip -o "$zip" -d "$BASE/$abi" >/dev/null
    local extracted="$BASE/$abi/apks/Cobalt.apk"
    local actual_apk
    actual_apk="$(shasum -a 256 "$extracted" | awk '{print $1}')"
    if [[ "$actual_apk" != "$apk_sha" ]]; then
        echo "error: unexpected Cobalt $abi APK SHA-256: $actual_apk" >&2
        return 1
    fi
    if [[ "$extracted" != "$apk" ]]; then
        mv "$extracted" "$apk"
    fi
    echo "Verified Cobalt 27.lts.3 Android $abi QA artifact: $apk"
}

mkdir -p "$BASE"
fetch_arch "armeabi-v7a" "android-arm%20APKs" \
    "4649b2ed7a0cbce4dc7c46bcf0ae18c314d466ea297e74bbf41345ba16b9a849" \
    "037ec5fb1d5ab12be76e95bac5ca7ec94ce3e4f138c51ac61f71a6cef4c6b7cf" \
    "apks/Cobalt.apk"
fetch_arch "arm64-v8a" "android-arm64%20APKs" \
    "7760da30762034bc981d76e2f24dbeaf46417b9e680a3d23e4e2d25d2533dc5a" \
    "04516ca14b3adae5c34d0e4201eccfe75809254bfdb4fd8c382936d76ae98f3b" \
    "arm64-v8a/apks/Cobalt.apk"
fetch_arch "x86" "android-x86%20APKs" \
    "b6b8e4935b7dcc2a022d553c6afe17bb3a518a687bc50a5e5de48172537fe95e" \
    "a382c518090b49b82d30599159d7f5a1c4e50955a724b49315c07db87f1aa26a" \
    "x86/apks/Cobalt.apk"
