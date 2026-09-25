#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/build/tools/apktool_3.0.3.jar"
EXPECTED_SHA256="dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423"
URL="https://github.com/iBotPeaches/Apktool/releases/download/v3.0.3/apktool_3.0.3.jar"
mkdir -p "$(dirname "$DEST")"
if [[ -f "$DEST" ]]; then
    actual="$(shasum -a 256 "$DEST" | awk '{print $1}')"
    if [[ "$actual" == "$EXPECTED_SHA256" ]]; then exit 0; fi
    echo "error: existing apktool JAR has an unexpected SHA-256: $DEST" >&2
    exit 1
fi
curl -fL "$URL" -o "$DEST"
actual="$(shasum -a 256 "$DEST" | awk '{print $1}')"
if [[ "$actual" != "$EXPECTED_SHA256" ]]; then
    rm -f "$DEST"
    echo "error: unexpected apktool SHA-256: $actual" >&2
    exit 1
fi
echo "Verified apktool 3.0.3: $DEST"
