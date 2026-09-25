import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE_ANCHOR, VOT_HOOK, insertNativeHook, verifyStartupLinks } from '../tools/native_hook.mjs';
const activity = '.method static bridge synthetic -$$Nest$minitializeJavaBridge(Ldev/cobalt/coat/CobaltActivity;)V\n.end method';
const bridge = '.method public static installReady(Ldev/cobalt/coat/CobaltActivity;)V\n.end method';
test('native hook preserves both dollars in D8 synthetic method name', () => {
    const source = 'before\n' + BRIDGE_ANCHOR + '\nafter';
    const patched = insertNativeHook(source);
    assert.equal(patched, 'before\n' + VOT_HOOK + '\n\n' + BRIDGE_ANCHOR + '\nafter');
    verifyStartupLinks(activity, patched, bridge);
});
test('startup verifier rejects the actual v7.1 replacement-string corruption', () => {
    const corrupt = BRIDGE_ANCHOR.replace(BRIDGE_ANCHOR, VOT_HOOK + '\n' + BRIDGE_ANCHOR);
    assert.ok(corrupt.includes('->-$Nest$minitializeJavaBridge'));
    assert.throws(() => verifyStartupLinks(activity, corrupt, bridge), /Unresolved startup method/);
});
test('native hook refuses duplicate patching and ambiguous anchors', () => {
    assert.throws(() => insertNativeHook(insertNativeHook(BRIDGE_ANCHOR)), /Unexpected/);
    assert.throws(() => insertNativeHook(BRIDGE_ANCHOR + '\n' + BRIDGE_ANCHOR), /Unexpected/);
});
