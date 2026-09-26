#!/usr/bin/env node
// Mechanical patch of a fresh apktool decode; never run on an unknown APK layout.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { insertNativeHook } from './native_hook.mjs';
import { capVideoBufferBudget, GX1_MAX_VIDEO_BUFFER_MB } from './apk_performance.mjs';
import { prepareManifest } from './apk_identity.mjs';
const dir = process.argv[2];
if (!dir) throw Error('Usage: prepare_native_apk.mjs DECODED_APK');
const manifestPath = path.join(dir, 'AndroidManifest.xml');
const prepared = prepareManifest(await readFile(manifestPath, 'utf8'));
await writeFile(manifestPath, prepared.manifest);

const coatDir = path.join(dir, 'smali_classes2/dev/cobalt/coat');
const callbackNames = (await readdir(coatDir)).filter(name => /^CobaltActivity\$\d+\.smali$/.test(name));
const callbackMatches = [];
for (const name of callbackNames) {
    const source = await readFile(path.join(coatDir, name), 'utf8');
    if (source.includes('->-$$Nest$minitializeJavaBridge(Ldev/cobalt/coat/CobaltActivity;)V')) {
        callbackMatches.push(name);
    }
}
if (callbackMatches.length !== 1) throw Error(`Unexpected WebContents callback count: ${callbackMatches.length}`);
const hookPath = path.join(coatDir, callbackMatches[0]);
let hook = await readFile(hookPath, 'utf8');
hook = insertNativeHook(hook);
await writeFile(hookPath, hook);
const activityPath = path.join(dir, 'smali_classes2/dev/cobalt/app/MainActivity.smali');
let activity = await readFile(activityPath, 'utf8');
if (/\.method .*on(?:Start|Stop)\(/.test(activity)) throw Error('Unexpected existing lifecycle hooks');
activity += `
.method protected onStart()V
    .locals 1
    invoke-super {p0}, Ldev/cobalt/coat/CobaltActivity;->onStart()V
    const/4 v0, 0x1
    invoke-static {v0}, Lio/gh/reisxd/tizentube/vot/VotBridge;->setForeground(Z)V
    return-void
.end method

.method protected onStop()V
    .locals 1
    const/4 v0, 0x0
    invoke-static {v0}, Lio/gh/reisxd/tizentube/vot/VotBridge;->setForeground(Z)V
    invoke-super {p0}, Ldev/cobalt/coat/CobaltActivity;->onStop()V
    return-void
.end method
`;
await writeFile(activityPath, activity);
const integersPath = path.join(dir, 'res/values/integers.xml');
const integers = await readFile(integersPath, 'utf8');
await writeFile(integersPath, capVideoBufferBudget(integers));
const nativeAbis = (await readdir(path.join(dir, 'lib')))
    .filter(abi => ['armeabi-v7a', 'arm64-v8a', 'x86'].includes(abi));
if (nativeAbis.length !== 1) throw Error('Expected exactly one supported Cobalt ABI');
const libPath = path.join(dir, 'lib', nativeAbis[0], 'libchrobalt.so');
const lib = await readFile(libPath);
const needle = Buffer.from('/userScript.js?v=');
const suffix = lib.indexOf(needle);
if (prepared.baseline === 'tizentube-cobalt') {
    if (suffix < 0 || lib.indexOf(needle, suffix + 1) !== -1) throw Error('Unexpected userscript URL slots');
    const start = lib.lastIndexOf(0, suffix) + 1;
    const end = suffix + needle.length;
    const previous = lib.subarray(start, end).toString();
    if (!/^https?:\/\/(?:cdn\.jsdelivr\.net\/npm\/@foxreis\/tizentube\/dist|192\.168\.\d+\.\d+:\d+)\/userScript\.js\?v=$/.test(previous)) {
        throw Error('Unknown base userscript URL');
    }
    const target = Buffer.from('http://127.0.0.1:8013/embedded?v=');
    if (target.length > end - start) throw Error('URL replacement too long');
    lib.fill(0, start, end);
    target.copy(lib, start);
    await writeFile(libPath, lib);
} else if (suffix >= 0) {
    throw Error('Unexpected userscript loader in official Cobalt');
}
console.log(`Patched ${prepared.baseline} (${path.basename(path.dirname(libPath))}, ${callbackMatches[0]}), native lifecycle, embedded injection, and ${GX1_MAX_VIDEO_BUFFER_MB} MB video buffer cap.`);
