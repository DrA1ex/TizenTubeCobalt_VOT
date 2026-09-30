import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNodeHealth, probeNode } from '../third_party/TizenTube/mods/features/cdnHealth.js';
import { AUDIO_TRANSLATIONS } from '../third_party/TizenTube/mods/features/audioTranslations.js';

const DEAD = 'sn-deadnode-8v1e';
const LIVE = 'sn-livenode';
const url = (node = DEAD, extra = '') =>
    `https://rr4---${node}.googlevideo.com/videoplayback?source=youtube&mn=${DEAD},${LIVE}&fvip=5${extra}&c=TVHTML5`;

function fixture(alive = {}) {
    const h = { time: 1e6, probes: [], store: new Map() };
    h.storage = { getItem: key => h.store.get(key) ?? null, setItem: (key, value) => h.store.set(key, value) };
    h.probe = async host => { h.probes.push(host); return alive[host.split('---')[1].split('.')[0]] !== false; };
    h.create = () => createNodeHealth({ storage: h.storage, probe: h.probe, now: () => h.time });
    h.health = h.create();
    h.settle = () => new Promise(resolve => setImmediate(resolve));
    return h;
}

test('an unknown node is probed once and left in place for the current video', async () => {
    const h = fixture({ [DEAD]: false });
    assert.equal(h.health.preferLive(url()), url());
    assert.equal(h.health.preferLive(url()), url());
    await h.settle();
    assert.deepEqual(h.probes, [`rr5---${DEAD}.googlevideo.com`], 'one probe, using the fvip prefix');
    assert.equal(h.health.state(DEAD), 'dead');
});

test('a dead node is replaced by the next live node from the URL list', async () => {
    const h = fixture({ [DEAD]: false });
    h.health.preferLive(url());
    await h.settle();
    const next = new URL(h.health.preferLive(url()));
    assert.equal(next.hostname, `rr5---${LIVE}.googlevideo.com`);
    assert.equal(next.searchParams.get('mn'), `${DEAD},${LIVE}`, 'the rest of the URL is unchanged');
    assert.equal(next.searchParams.get('c'), 'TVHTML5');
});

test('a reachable node is kept and its answer is cached', async () => {
    const h = fixture();
    h.health.preferLive(url());
    await h.settle();
    assert.equal(h.health.state(DEAD), 'alive');
    assert.equal(h.health.preferLive(url()), url());
    await h.settle();
    assert.equal(h.probes.length, 1);
});

test('answers expire: dead nodes are retried after an hour, live ones after half an hour', async () => {
    const h = fixture({ [DEAD]: false });
    h.health.preferLive(url());
    await h.settle();
    h.time += 59 * 60 * 1000;
    assert.equal(h.health.state(DEAD), 'dead');
    h.time += 2 * 60 * 1000;
    assert.equal(h.health.state(DEAD), 'unknown');
    h.health.record(LIVE, true);
    h.time += 31 * 60 * 1000;
    assert.equal(h.health.state(LIVE), 'unknown');
});

test('the list survives a restart through storage', async () => {
    const h = fixture({ [DEAD]: false });
    h.health.preferLive(url());
    await h.settle();
    const restarted = h.create();
    assert.equal(new URL(restarted.preferLive(url())).hostname, `rr5---${LIVE}.googlevideo.com`);
    assert.equal(h.probes.length, 1, 'no new probe after restart');
});

test('nothing is rewritten without a live alternative or for other hosts', async () => {
    const h = fixture({ [DEAD]: false, [LIVE]: false });
    h.health.record(DEAD, false);
    h.health.record(LIVE, false);
    assert.equal(h.health.preferLive(url()), url());
    const single = `https://rr4---${DEAD}.googlevideo.com/videoplayback?mn=${DEAD}`;
    h.health.record(DEAD, false);
    assert.equal(h.health.preferLive(single), single);
    for (const other of ['https://www.youtube.com/api/stats', 'not a url', 'https://redirector.googlevideo.com/x']) {
        assert.equal(h.health.preferLive(other), other);
    }
});

test('SABR and format URLs in a streaming response are all redirected', () => {
    const h = fixture();
    h.health.record(DEAD, false);
    h.health.record(LIVE, true);
    const data = { serverAbrStreamingUrl: url(), formats: [{ url: url() }],
        adaptiveFormats: [{ url: url(DEAD, '&itag=1') }, { mimeType: 'audio/webm' }] };
    assert.equal(h.health.apply(data), true);
    for (const value of [data.serverAbrStreamingUrl, data.formats[0].url, data.adaptiveFormats[0].url]) {
        assert.equal(new URL(value).hostname, `rr5---${LIVE}.googlevideo.com`);
    }
    assert.equal(h.health.apply({}), false);
    assert.equal(h.health.apply(null), false);
});

test('the probe treats any answer as reachable and a timeout as dead', async () => {
    const signals = [];
    const ok = await probeNode('host.example', { fetchFn: async (target, options) => { signals.push([target, options.mode]); } });
    assert.equal(ok, true);
    assert.deepEqual(signals, [['https://host.example/generate_204', 'no-cors']]);
    let fire;
    const pending = probeNode('slow.example', {
        fetchFn: (target, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
        setTimer: callback => { fire = callback; return 1; }, clearTimer() {}
    });
    fire();
    assert.equal(await pending, false);
});

test('the translation button has a glyph for every label the interface uses', async () => {
    const css = await readFile(new URL('../third_party/TizenTube/mods/ui/ui.css', import.meta.url), 'utf8');
    for (const label of Object.values(AUDIO_TRANSLATIONS.audioAndTranslation)) {
        assert.ok(css.includes(`yt-button-container[aria-label="${label}"] yt-icon::before`), label);
    }
    assert.match(css, /mask: url\("data:image\/svg\+xml/);
});
