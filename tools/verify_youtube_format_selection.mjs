// Execute the relevant functions from a downloaded TV player, without loading
// YouTube, contacting a device, or redistributing the upstream player source.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../third_party/TizenTube/mods/package.json', import.meta.url));
const { parse } = require('acorn');
const file = process.argv[2];
if (!file) throw Error('Usage: node tools/verify_youtube_format_selection.mjs DOWNLOADED_TV_PLAYER.js');
const source = await readFile(file, 'utf8');
const ast = parse(source, { ecmaVersion: 'latest' });
const nodes = [];
function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type) nodes.push(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
    }
}
visit(ast);

function extract(type, name, includes = '') {
    const matches = nodes.filter(node => node.type === type && (node.id?.name || node.key?.name) === name
        && source.slice(node.start, node.end).includes(includes));
    assert.equal(matches.length, 1, `Unexpected upstream layout: ${name}`);
    return source.slice(matches[0].start, matches[0].end);
}

const filter = (values, predicate, receiver) => values.filter(predicate, receiver);
const sandbox = {
    $U: filter, wD: (values, predicate) => values.find(predicate), q3v: (_, values) => values,
    po: (_, format) => format.bitrate, $rm() {}, JW: (values, index) => values.splice(index, 1),
    tB: (min, max) => ({ min, max })
};
const rangeAPI = vm.runInNewContext('({' + extract('MethodDefinition', 'setPlaybackQualityRange') + ', '
    + extract('MethodDefinition', 'l3') + '})', sandbox);
const core = vm.runInNewContext('({' + extract('MethodDefinition', 'RS', 'this.loader.o7') + '})', sandbox);
let preference;
core.U5 = () => {};
core.Z1 = () => {};
core.videoData = {};
core.loader = { o7: id => { preference = id; } };
rangeAPI.app = { Aj: () => core };
rangeAPI.l3('hd2160', 'hd2160', '313;variant=1');
assert.equal(preference, '313;variant=1');
assert.equal(core.videoData.Ui.min, 'hd2160');
assert.equal(core.videoData.Ui.max, 'hd2160');
rangeAPI.l3('auto', 'auto');
assert.equal(preference, '', 'restoring Auto must clear the format preference');

const heavy = { id: '315', itag: '315', bitrate: 30000000,
    video: { width: 3840, height: 2160, qualityOrdinal: 2160 } };
const light = { ...heavy, id: '313;variant=1', itag: '313', bitrate: 15000000 };
const lower = { id: '308', itag: '308', bitrate: 10000000,
    video: { width: 2560, height: 1440, qualityOrdinal: 1440 } };
const formats = [heavy, light, lower];
const locked = { isLocked: () => true, A: format => format.video.qualityOrdinal === 2160 };
const dash = { N: { videoInfos: formats }, Y: { Z: light.id }, policy: { Yy: false, F_: 0 },
    I1: {}, Nk: new Set(), o7: () => assert.fail('Valid format preference was discarded') };
const rn = vm.runInNewContext('(' + extract('FunctionDeclaration', 'rn') + ')', sandbox);
rn(dash, locked);
assert.equal(dash.A.length, 1);
assert.equal(dash.A[0].id, light.id, 'DASH must select the requested variant, not just the resolution');

const sabrSandbox = { ...sandbox };
vm.createContext(sabrSandbox);
vm.runInContext(extract('FunctionDeclaration', 'sM') + '\n' + extract('FunctionDeclaration', 'hQ2'), sabrSandbox);
const sabr = { Z: { Z: light.id, o7: () => {} }, L: formats, loader: { C() {} } };
sabrSandbox.hQ2(sabr, 2160);
assert.equal(sabr.videoInfos.length, 1);
assert.equal(sabr.videoInfos[0].id, light.id, 'SABR must select the same exact variant');
sabr.Z.Z = 'missing';
sabrSandbox.hQ2(sabr, 2160);
assert.equal(sabr.videoInfos.length, 2, 'unknown format IDs fall back to the resolution range');
console.log('YouTube TV API → loader preference → DASH/SABR exact-format selection: PASS');
console.log('Source SHA-256:', createHash('sha256').update(source).digest('hex'));
