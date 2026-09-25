#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: $0 INPUT_PATCHED.apk OUTPUT_SIGNED.apk [KEYSTORE]" >&2
  exit 2
fi

INPUT="$1"
OUTPUT="$2"
KEYSTORE="${3:-$HOME/.tizentube-vot.keystore}"
ALIAS="tizentube-vot"
PASS="${TT_VOT_KEYSTORE_PASS:-android}"

if [[ -z "${JAVA_HOME:-}" && -x /opt/homebrew/opt/openjdk/bin/java ]]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk"
fi

find_apksigner() {
  local sdk
  for sdk in \
    "${ANDROID_HOME:-}" \
    "${ANDROID_SDK_ROOT:-}" \
    "$HOME/Library/Android/sdk" \
    "/opt/homebrew/share/android-commandlinetools"; do
    if [[ -n "$sdk" && -d "$sdk/build-tools" ]]; then
      find "$sdk/build-tools" -type f -name apksigner -perm +111 2>/dev/null
    fi
  done | sort -V | tail -1
}

APKSIGNER="$(find_apksigner)"
if [[ -z "$APKSIGNER" ]]; then
  echo "error: apksigner not found." >&2
  echo "Install Android SDK Build Tools (Android Studio is fine), or set ANDROID_HOME." >&2
  exit 1
fi

if [[ ! -f "$KEYSTORE" ]]; then
  KEYTOOL="${JAVA_HOME:+$JAVA_HOME/bin/}keytool"
  if ! command -v "$KEYTOOL" >/dev/null 2>&1; then
    echo "error: keytool not found. Install a JDK or set JAVA_HOME." >&2
    exit 1
  fi

  echo "Creating development signing key: $KEYSTORE"
  "$KEYTOOL" -genkeypair -v \
    -keystore "$KEYSTORE" \
    -storepass "$PASS" \
    -keypass "$PASS" \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=TizenTube VOT Development,O=Local Development,C=EE"
fi

"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$ALIAS" \
  --ks-pass "pass:$PASS" \
  --key-pass "pass:$PASS" \
  --out "$OUTPUT" \
  "$INPUT"

"$APKSIGNER" verify --verbose --print-certs "$OUTPUT"
echo "Signed: $OUTPUT"
