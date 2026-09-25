import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { VOT_HOOK, verifyStartupLinks } from './native_hook.mjs';
const dir = process.argv[2];
if (!dir) throw Error('Usage: verify_native_startup.mjs DECODED_APK');
const read = relative => readFile(path.join(dir, relative), 'utf8');
const coatDir = path.join(dir, 'smali_classes2/dev/cobalt/coat');
const callbacks = [];
for (const name of await readdir(coatDir)) {
    if (!/^CobaltActivity\$\d+\.smali$/.test(name)) continue;
    const source = await readFile(path.join(coatDir, name), 'utf8');
    if (source.includes(VOT_HOOK.trim())) callbacks.push({ name, source });
}
if (callbacks.length !== 1) throw Error(`Expected one native startup hook, found ${callbacks.length}`);
verifyStartupLinks(
    await read('smali_classes2/dev/cobalt/coat/CobaltActivity.smali'),
    callbacks[0].source,
    await read('smali_classes4/io/gh/reisxd/tizentube/vot/VotBridge.smali')
);
console.log(`Native startup links: PASS (${callbacks[0].name}, exact descriptors and hook order)`);
