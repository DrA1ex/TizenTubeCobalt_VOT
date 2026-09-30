#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
BASE_APK="${1:-${VOT_BASE_APK:-$PROJECT_DIR/build/cobalt-27.lts.3/official/apks/Cobalt.apk}}"
OUTPUT_APK="${2:-}"
MODS_DIR="$PROJECT_DIR/third_party/TizenTube/mods"
USERSCRIPT="$PROJECT_DIR/third_party/TizenTube/dist/userScript.js"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}"
SDK_BUILD="${VOT_BUILD_TOOLS:-$SDK_ROOT/build-tools/36.0.0}"
ANDROID_JAR="${VOT_ANDROID_JAR:-$SDK_ROOT/platforms/android-35/android.jar}"
APKTOOL="${VOT_APKTOOL_JAR:-$PROJECT_DIR/build/tools/apktool_3.0.3.jar}"
BASE_SHA256="$(shasum -a 256 "$BASE_APK" | awk '{print $1}')"
ABI_COUNT="$(unzip -Z1 "$BASE_APK" | sed -nE 's#^lib/(armeabi-v7a|arm64-v8a|x86)/libchrobalt\.so$#\1#p' | wc -l | tr -d ' ')"
if [[ "$ABI_COUNT" != "1" ]]; then
    echo "error: expected exactly one supported libchrobalt.so ABI in $BASE_APK" >&2
    exit 1
fi
ABI="$(unzip -Z1 "$BASE_APK" | sed -nE 's#^lib/(armeabi-v7a|arm64-v8a|x86)/libchrobalt\.so$#\1#p')"
case "$ABI:$BASE_SHA256" in
    "armeabi-v7a:037ec5fb1d5ab12be76e95bac5ca7ec94ce3e4f138c51ac61f71a6cef4c6b7cf" | \
    "arm64-v8a:04516ca14b3adae5c34d0e4201eccfe75809254bfdb4fd8c382936d76ae98f3b" | \
    "x86:a382c518090b49b82d30599159d7f5a1c4e50955a724b49315c07db87f1aa26a") ;;
    *) echo "error: unsupported Cobalt base APK ABI or SHA-256: $ABI $BASE_SHA256" >&2; exit 1 ;;
esac
if [[ -z "$OUTPUT_APK" ]]; then
    OUTPUT_APK="$PROJECT_DIR/TizenTube-Cobalt-VOT-v9.0-Cobalt27.3-$ABI.apk"
fi

if [[ ! -f "$MODS_DIR/package.json" ]]; then
    echo "error: initialize the TizenTube submodule: git submodule update --init" >&2
    exit 1
fi
if [[ ! -f "$BASE_APK" || ! -f "$ANDROID_JAR" || ! -x "$SDK_BUILD/d8" ]]; then
    echo "error: missing Cobalt APK or Android SDK; see BUILDING.md" >&2
    exit 1
fi
if [[ "$APKTOOL" == "$PROJECT_DIR/build/tools/apktool_3.0.3.jar" && ! -f "$APKTOOL" ]]; then
    bash tools/fetch_apktool_3_0_3.sh
fi
if [[ ! -f "$APKTOOL" ]]; then
    echo "error: apktool JAR not found: $APKTOOL" >&2
    exit 1
fi
npm --prefix "$MODS_DIR" ci --legacy-peer-deps

mkdir -p "$PROJECT_DIR/build"
# Each build decodes a Cobalt APK (about 800 MB). Remove directories that
# interrupted builds left behind; the age limit protects a concurrent build.
find "$PROJECT_DIR/build" -maxdepth 1 -type d -name 'vot-release.*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true
BUILD_DIR="$(mktemp -d "$PROJECT_DIR/build/vot-release.XXXXXX")"
echo "Build directory: $BUILD_DIR"
cleanup_build() {
    if [[ "${VOT_KEEP_BUILD:-0}" == "1" ]]; then
        echo "Keeping build directory: $BUILD_DIR"
    else
        rm -rf "$BUILD_DIR"
    fi
}
trap cleanup_build EXIT
if [[ "${VOT_SKIP_TESTS:-0}" != "1" ]]; then
    node --experimental-vm-modules --test tests/*.test.mjs
fi
mkdir -p "$BUILD_DIR/classes" "$BUILD_DIR/dex"
"$JAVA_HOME/bin/javac" --release 8 -classpath "$ANDROID_JAR" -d "$BUILD_DIR/classes" \
    native_bridge/stubs/dev/cobalt/coat/*.java \
    native_bridge/stubs/dev/cobalt/coat/javabridge/*.java \
    native_bridge/stubs/org/chromium/content_public/browser/*.java \
    native_bridge/stubs/org/chromium/content/browser/*.java \
    native_bridge/src/io/gh/reisxd/tizentube/vot/*.java
if [[ "${VOT_SKIP_TESTS:-0}" != "1" ]]; then
    "$JAVA_HOME/bin/javac" --release 8 -classpath "$BUILD_DIR/classes" -d "$BUILD_DIR/classes" tests/PlaybackOrderTest.java tests/AudioDriftTest.java tests/OAuthCallbackTest.java tests/NativeStringsTest.java
    "$JAVA_HOME/bin/java" -cp "$BUILD_DIR/classes" PlaybackOrderTest
    "$JAVA_HOME/bin/java" -cp "$BUILD_DIR/classes" AudioDriftTest
    "$JAVA_HOME/bin/java" -cp "$BUILD_DIR/classes" OAuthCallbackTest
    "$JAVA_HOME/bin/java" -cp "$BUILD_DIR/classes" NativeStringsTest
fi
npm --prefix "$MODS_DIR" run build
"$SDK_BUILD/d8" --min-api 24 --lib "$ANDROID_JAR" --classpath "$BUILD_DIR/classes" \
    --output "$BUILD_DIR/dex" "$BUILD_DIR/classes/io/gh/reisxd/tizentube/vot/"*.class
zip -j "$BUILD_DIR/native.zip" "$BUILD_DIR/dex/classes.dex"
"$JAVA_HOME/bin/java" -jar "$APKTOOL" d "$BUILD_DIR/native.zip" -o "$BUILD_DIR/native-smali"
"$JAVA_HOME/bin/java" -jar "$APKTOOL" d -p "$PROJECT_DIR/build/apktool-framework" "$BASE_APK" -o "$BUILD_DIR/apk"
node tools/prepare_native_apk.mjs "$BUILD_DIR/apk"
# Cobalt's classes2 is close to the method-reference limit; keep the port in its own DEX.
test ! -e "$BUILD_DIR/apk/smali_classes4"
mkdir -p "$BUILD_DIR/apk/smali_classes4/io/gh/reisxd/tizentube/vot"
cp "$BUILD_DIR/native-smali/smali/io/gh/reisxd/tizentube/vot/"*.smali "$BUILD_DIR/apk/smali_classes4/io/gh/reisxd/tizentube/vot/"
cp "$USERSCRIPT" "$BUILD_DIR/apk/assets/tizentube_vot.js"
cp native_bridge/bootstrap.js "$BUILD_DIR/apk/assets/tizentube_vot_bootstrap.js"
node tools/verify_native_startup.mjs "$BUILD_DIR/apk"
"$JAVA_HOME/bin/java" -jar "$APKTOOL" b -p "$PROJECT_DIR/build/apktool-framework" "$BUILD_DIR/apk" -o "$BUILD_DIR/unsigned.apk"
"$SDK_BUILD/zipalign" -p -f 4 "$BUILD_DIR/unsigned.apk" "$BUILD_DIR/aligned.apk"
bash tools/sign_apk_macos.sh "$BUILD_DIR/aligned.apk" "$OUTPUT_APK"
"$SDK_BUILD/zipalign" -c -p 4 "$OUTPUT_APK"
unzip -t "$OUTPUT_APK" | tail -n 1
unzip -p "$OUTPUT_APK" assets/tizentube_vot.js | cmp - "$USERSCRIPT"
unzip -p "$OUTPUT_APK" assets/tizentube_vot_bootstrap.js | cmp - native_bridge/bootstrap.js
mkdir -p "$BUILD_DIR/verify-dex"
unzip -j "$OUTPUT_APK" 'classes*.dex' -d "$BUILD_DIR/verify-dex"
zip -j "$BUILD_DIR/verify-dex.zip" "$BUILD_DIR/verify-dex/"*.dex
"$JAVA_HOME/bin/java" -jar "$APKTOOL" d "$BUILD_DIR/verify-dex.zip" -o "$BUILD_DIR/verify-smali"
node tools/verify_native_startup.mjs "$BUILD_DIR/verify-smali"
shasum -a 256 "$OUTPUT_APK"
echo "Local build complete. No ADB or device commands were run."
