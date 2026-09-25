import test from 'node:test';
import assert from 'node:assert/strict';
import {
    prepareManifest,
    prepareStartupManifest,
    TIZENTUBE_PACKAGE,
    TIZENTUBE_VERSION_CODE,
    TIZENTUBE_VERSION_NAME,
} from '../tools/apk_identity.mjs';

const official = `<?xml version="1.0"?><manifest n0:versionCode="1" n0:versionName="Developer Build" package="dev.cobalt.coat" xmlns:n0="http://schemas.android.com/apk/res/android">
    <application n0:label="Cobalt Shell">
        <activity n0:name="dev.cobalt.app.MainActivity">
            <meta-data n0:name="cobalt.ENABLE_SPLASH_SCREEN" n0:value="true" />
            <meta-data n0:name="cobalt.ENABLE_FEATURES" n0:value="EnablePerfettoSystemTracing" />
        </activity>
    </application>
</manifest>`;

test('official Cobalt APK keeps the TizenTube update identity', () => {
    const { manifest, baseline } = prepareManifest(official);
    assert.equal(baseline, 'official-cobalt-27');
    assert.match(manifest, new RegExp(`package="${TIZENTUBE_PACKAGE}"`));
    assert.match(manifest, new RegExp(`n0:versionCode="${TIZENTUBE_VERSION_CODE}"`));
    assert.ok(manifest.includes(`n0:versionName="${TIZENTUBE_VERSION_NAME}"`));
    assert.match(manifest, /n0:label="TizenTube"/);
    assert.match(manifest, /YandexAuthActivity/);
    assert.match(manifest, /REQUEST_INSTALL_PACKAGES/);
});

test('unknown APK identities are rejected', () => {
    assert.throws(() => prepareManifest(official.replace('dev.cobalt.coat', 'example.unknown')),
        /Unsupported APK package/);
});

test('startup disables the separate splash in both Cobalt command-line sources', () => {
    const { manifest } = prepareManifest(official);
    assert.match(manifest, /name="cobalt.ENABLE_SPLASH_SCREEN" n0:value="false"/);
    assert.match(manifest, /name="cobalt.ENABLE_FEATURES" n0:value="DisableSplashScreen"/);
    assert.doesNotMatch(manifest, /EnablePerfettoSystemTracing/);
});

test('startup preserves unrelated features and rejects an unknown metadata layout', () => {
    const input = official.replace('EnablePerfettoSystemTracing', 'OtherFeature,EnablePerfettoSystemTracing');
    assert.match(prepareStartupManifest(input, 'n0'), /value="OtherFeature,DisableSplashScreen"/);
    assert.throws(() => prepareStartupManifest('<manifest/>', 'n0'), /startup metadata/);
});
