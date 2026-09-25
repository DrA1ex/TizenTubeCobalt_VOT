import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioFlowController } from '../third_party/TizenTube/mods/features/audioFlowController.js';
import { audioInventory, filteredYouTubeTracks, selectYouTubeTrack, ensureOriginal, normalizeTrack } from '../third_party/TizenTube/mods/features/audioTracks.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
test('false-valued TV flag methods do not mark und as dubbed', async () => {
    const selected = { id: 'und', isDubbed() { return false; }, isAutoDubbed() { return false; } };
    assert.equal(normalizeTrack(selected).dubbed, false);
    const player = { ...tvTedSnapshotPlayer(), getAudioTrack: () => selected };
    globalThis.document = { querySelector: () => player };
    try { assert.equal(audioInventory().keepCurrentAudio, true); await ensureOriginal(); }
    finally { delete globalThis.document; }
});
test('dub flags are evaluated by value, preserving true and rejecting false strings', () => {
    assert.equal(normalizeTrack({ id: 'und', isDubbed: 'false' }).dubbed, false);
    assert.equal(normalizeTrack({ id: 'ru.1', isDubbed: 'true' }).dubbed, true);
    assert.equal(normalizeTrack({ id: 'ru.1', isDubbed() { return this.id === 'ru.1'; } }).dubbed, true);
    assert.equal(normalizeTrack({ id: 'en.1', isOriginal() { return false; } }).original, false);
});
test('true or failing dub query still blocks implicit original fallback', async () => {
    for (const isDubbed of [() => true, () => { throw Error('unavailable'); }, () => ({ unknown: true })]) {
        const player = { ...tvTedSnapshotPlayer(), getAudioTrack: () => ({ id: 'und', isDubbed }) };
        globalThis.document = { querySelector: () => player };
        try { await assert.rejects(ensureOriginal(), /original track/); }
        finally { delete globalThis.document; }
    }
});
const tvTedSnapshotPlayer = () => ({
    getAvailableAudioTracks: () => [],
    getAudioTrack: () => ({ id: 'und' }),
    getPlayerResponse: () => ({ streamingData: { adaptiveFormats: [] }, videoDetails: {} }),
    setAudioTrack: () => { throw new Error('TED snapshot must not require switching'); }
});
test('exact TV v7.3 TED snapshot: selected und, no advertised tracks or language', async () => {
    globalThis.document = { querySelector: () => tvTedSnapshotPlayer() };
    try {
        const inventory = audioInventory();
        assert.equal(inventory.tracks.length, 1);
        assert.equal(inventory.originalLanguage, '');
        assert.equal(inventory.keepCurrentAudio, true);
        await ensureOriginal();
    } finally { delete globalThis.document; }
});
test('single unnamed legacy track does not require a language or track setter', async () => {
    for (const available of [[], [{ id: 'default', displayName: 'Original' }]]) {
        globalThis.document = { querySelector: () => ({ getAvailableAudioTracks: () => available }) };
        try {
            assert.equal(audioInventory().originalLanguage, '');
            await ensureOriginal();
            await assert.rejects(ensureOriginal({ isCurrent: () => false }), /cancelled/);
        } finally { delete globalThis.document; }
    }
});
test('unknown multitrack and single explicit dub still cannot masquerade as original', async () => {
    for (const available of [[{ id: 'a.1' }, { id: 'b.1' }], [{ id: 'ru.1', isAutoDubbed: true }]]) {
        globalThis.document = { querySelector: () => ({ getAvailableAudioTracks: () => available }) };
        try { await assert.rejects(ensureOriginal(), /original track/); }
        finally { delete globalThis.document; }
    }
    assert.equal(normalizeTrack({ id: 'default' }).language, '');
});
function harness(options = {}) {
    const h = { id: 'one', hidden: false, media: { isConnected: true, readyState: 4, paused: false },
        prefs: { auto: false, provider: 'lively', target: 'ru', translateDifferent: true,
            detectUnknown: true, translateUnknown: false, waitingTrack: 'current', readyBehavior: 'switch', ...options },
        requests: [], detections: [], events: [], token: true, playback: 'playing',
        inventory: { originalLanguage: 'en', original: { id: 'en.1' }, selected: { id: 'ru.2' }, tracks: [{ id: 'ru.2', language: 'ru' }] } };
    h.flow = new AudioFlowController({ preferences: () => h.prefs, videoId: () => h.id, media: () => h.media,
        hidden: () => h.hidden, inventory: () => h.inventory, hasToken: () => h.token, playbackState: () => h.playback,
        stop: () => h.events.push('stop'), notify: message => h.events.push('notice:' + message),
        prepare: params => new Promise((resolve, reject) => h.requests.push({ params, resolve, reject })),
        detectLanguage: params => new Promise((resolve, reject) => h.detections.push({ params, resolve, reject })),
        selectOriginal: async () => { h.events.push('original'); h.inventory.selected = h.inventory.original; },
        selectTrack: async id => { h.events.push('youtube:' + id); h.inventory.selected = { id }; },
        activate: result => h.events.push('activate:' + result.name) });
    return h;
}
test('TV TED snapshot through real inventory and ensureOriginal reaches activation after preparation', async () => {
    const h = harness();
    globalThis.document = { querySelector: () => tvTedSnapshotPlayer() };
    h.flow.d.inventory = () => audioInventory();
    h.flow.d.selectOriginal = ensureOriginal;
    try {
        await h.flow.select({ provider: 'standard' });
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].params.sourceLang, '');
        h.requests[0].resolve({ name: 'ted-und' }); await flush();
        assert.equal(h.flow.status, 'playing');
        assert.ok(h.events.includes('activate:ted-und'));
    } finally { delete globalThis.document; }
});
test('manual Yandex request is allowed without source-language metadata', async () => {
    const h = harness(); h.inventory.originalLanguage = '';
    await h.flow.select({ provider: 'standard' });
    assert.equal(h.requests.length, 1);
    h.requests[0].resolve({ name: 'manual-unknown' }); await flush();
    assert.equal(h.flow.status, 'playing');
});
test('automatic unknown language is detected before translation', async () => {
    const h = harness({ auto: true }); h.inventory.originalLanguage = '';
    const tick = h.flow.tick();
    assert.equal(h.flow.status, 'detecting');
    assert.equal(h.requests.length, 0);
    h.detections[0].resolve('en'); await tick;
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].params.sourceLang, 'en');
    assert.equal(h.flow.status, 'preparing');
    assert.equal(h.flow.snapshot().sourceLanguage, 'en');
});
test('detected target language keeps a Russian video in original audio', async () => {
    const h = harness({ auto: true }); h.inventory.originalLanguage = '';
    const tick = h.flow.tick(); h.detections[0].resolve('ru'); await tick;
    assert.equal(h.requests.length, 0);
    assert.equal(h.flow.audible.provider, 'current');
    assert.ok(!h.events.includes('original'));
});
test('unknown language is translated only when the explicit fallback is enabled', async () => {
    const h = harness({ auto: true, detectUnknown: false, translateUnknown: false });
    h.inventory.originalLanguage = ''; await h.flow.tick();
    assert.equal(h.requests.length, 0);
    h.prefs.translateUnknown = true; await h.flow.tick();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].params.sourceLang, '');
});
test('failed language detection falls back only when requested', async () => {
    for (const translateUnknown of [false, true]) {
        const h = harness({ auto: true, translateUnknown }); h.inventory.originalLanguage = '';
        const tick = h.flow.tick(); h.detections[0].reject(new Error('no language')); await tick;
        assert.equal(h.requests.length, translateUnknown ? 1 : 0);
        assert.equal(h.flow.snapshot().detectionAttempted, true);
    }
});
test('known foreign language respects the automatic mismatch checkbox', async () => {
    const h = harness({ auto: true, translateDifferent: false });
    await h.flow.tick(); assert.equal(h.requests.length, 0);
});
test('auto uses original English despite selected Russian YouTube dub', async () => {
    const h = harness({ auto: true }); await h.flow.tick();
    assert.equal(h.requests[0].params.sourceLang, 'en'); assert.equal(h.requests[0].params.lively, true);
    assert.equal(h.flow.automatic, true);
});
test('manual provider choice does not modify global preference and wins over auto', async () => {
    const h = harness({ auto: true }); await h.flow.select({ provider: 'youtube', trackId: 'ru.2' });
    await h.flow.tick(); assert.equal(h.prefs.provider, 'lively'); assert.equal(h.requests.length, 0);
});
test('no media during initial load does not permanently disable auto', async () => {
    const h = harness({ auto: true }); const media = h.media; h.media = null; await h.flow.tick();
    h.media = media; await h.flow.tick(); assert.equal(h.requests.length, 1);
});
test('pending translation leaves current audio untouched then restores original before activation', async () => {
    const h = harness(); await h.flow.select({ provider: 'lively' }); const before = h.events.length;
    h.requests[0].params.onStatus({ remaining: 30 }); await flush(); assert.equal(h.events.length, before);
    h.requests[0].resolve({ name: 'live' }); await flush();
    assert.deepEqual(h.events.slice(-3), ['stop', 'original', 'activate:live']);
});
test('notify readiness keeps watching until explicit confirmation', async () => {
    const h = harness({ readyBehavior: 'notify' }); await h.flow.select({ provider: 'standard' });
    h.requests[0].params.onStatus({}); h.requests[0].resolve({ name: 'standard' }); await flush();
    assert.equal(h.flow.status, 'ready'); assert.ok(!h.events.includes('activate:standard'));
    await h.flow.applyReady(); assert.equal(h.flow.status, 'playing');
});
test('late result cannot activate after close or video change', async () => {
    for (const next of [null, 'two']) {
        const h = harness(); await h.flow.select({ provider: 'standard' }); h.id = next; await h.flow.tick();
        h.requests[0].resolve({ name: 'late' }); await flush(); assert.ok(!h.events.includes('activate:late'));
    }
});
test('late live result cannot override a newer manual YouTube selection', async () => {
    const h = harness(); await h.flow.select({ provider: 'lively' });
    await h.flow.select({ provider: 'youtube', trackId: 'ru.2' }); h.requests[0].resolve({ name: 'late' }); await flush();
    assert.equal(h.flow.audible.provider, 'youtube'); assert.ok(!h.events.includes('activate:late'));
});
test('optional ordinary fallback plays while lively is pending', async () => {
    const h = harness({ waitingTrack: 'standard' }); await h.flow.select({ provider: 'lively' });
    h.requests[0].params.onStatus({}); h.requests[1].resolve({ name: 'standard' }); await flush();
    assert.equal(h.flow.audible.provider, 'standard'); assert.equal(h.flow.requested.provider, 'lively');
    h.requests[0].resolve({ name: 'live' }); await flush(); assert.equal(h.flow.audible.provider, 'lively');
});
test('slow fallback never replaces already ready lively voice', async () => {
    const h = harness({ waitingTrack: 'standard' }); await h.flow.select({ provider: 'lively' });
    h.requests[0].params.onStatus({}); h.requests[0].resolve({ name: 'live' }); await flush();
    h.requests[1].resolve({ name: 'standard' }); await flush(); assert.equal(h.flow.audible.provider, 'lively');
});
test('cancelling pending work keeps audible track and blocks late completion', async () => {
    const h = harness(); await h.flow.select({ provider: 'youtube', trackId: 'ru.2' });
    await h.flow.select({ provider: 'lively' }); h.flow.cancelWaiting();
    assert.equal(h.requests[0].params.signal.aborted, true); h.requests[0].resolve({ name: 'late' }); await flush();
    assert.equal(h.flow.audible.provider, 'youtube');
});
test('missing YouTube target can become available without stopping video', async () => {
    const h = harness(); h.inventory.tracks = []; await h.flow.select({ provider: 'youtube' });
    assert.equal(h.flow.status, 'waiting'); h.inventory.tracks = [{ id: 'ru.3', language: 'ru' }];
    await h.flow.tick(); await flush(); assert.equal(h.flow.audible.trackId, 'ru.3');
});
test('rejected existing token does not start a 500ms authorization retry loop', async () => {
    const h = harness(); await h.flow.select({ provider: 'lively' });
    h.requests[0].reject(Object.assign(new Error('auth'), { code: 'AUTH_REQUIRED' })); await flush();
    await h.flow.tick(); await h.flow.tick(); assert.equal(h.requests.length, 1);
});
test('per-video target does not change preferred language', async () => {
    const h = harness(); await h.flow.tick(); await h.flow.setTarget('kk');
    assert.equal(h.prefs.target, 'ru'); assert.equal(h.requests[0].params.targetLang, 'kk');
});
test('ended video cancels pending work', async () => {
    const h = harness(); await h.flow.select({ provider: 'standard' }); h.media.ended = true; await h.flow.tick();
    h.requests[0].resolve({ name: 'late' }); await flush(); assert.ok(!h.events.includes('activate:late'));
});
test('replaying the same video after ended runs automatic selection again', async () => {
    const h = harness({ auto: true });
    h.media.ended = true; await h.flow.tick();
    h.media.ended = false; h.media.paused = false; await h.flow.tick();
    assert.equal(h.requests.length, 1, 'automatic selection must recover when the same video is replayed');
});
test('replay renews cancelled pending auto request and ignores the old result', async () => {
    const h = harness({ auto: true }); await h.flow.tick();
    h.media.ended = true; await h.flow.tick();
    assert.equal(h.requests[0].params.signal.aborted, true);
    h.media.ended = false; await h.flow.tick();
    assert.equal(h.requests.length, 2);
    h.requests[0].resolve({ name: 'stale' }); await flush();
    assert.ok(!h.events.includes('activate:stale'));
    h.requests[1].resolve({ name: 'replay' }); await flush();
    assert.equal(h.flow.status, 'playing'); assert.ok(h.events.includes('activate:replay'));
});
test('replay retains manual voice and per-video target using the ready cache', async () => {
    const h = harness({ auto: true }); await h.flow.tick();
    h.flow.target = 'kk'; await h.flow.select({ provider: 'standard' });
    h.requests[1].resolve({ name: 'manual' }); await flush();
    h.media.ended = true; await h.flow.tick(); assert.equal(h.flow.audible, null);
    h.media.ended = false; await h.flow.tick();
    assert.equal(h.flow.audible.provider, 'standard'); assert.equal(h.flow.target, 'kk');
    assert.equal(h.flow.override, true); assert.equal(h.requests.length, 2);
    assert.equal(h.events.filter(x => x === 'activate:manual').length, 2);
});
test('paused seek after ended does not reactivate until playback actually resumes', async () => {
    const h = harness({ auto: true }); await h.flow.tick();
    h.media.ended = true; await h.flow.tick();
    h.media.ended = false; h.media.paused = true; await h.flow.tick();
    assert.equal(h.requests.length, 1); assert.equal(h.flow.ended, true);
    h.media.paused = false; h.media.seeking = true; await h.flow.tick();
    assert.equal(h.requests.length, 1);
    h.media.seeking = false; await h.flow.tick(); assert.equal(h.requests.length, 2);
});
test('auto disabled at end does not resume the old automatic request', async () => {
    const h = harness({ auto: true }); await h.flow.tick();
    h.media.ended = true; await h.flow.tick(); h.prefs.auto = false;
    h.media.ended = false; await h.flow.tick(); await h.flow.tick();
    assert.equal(h.requests.length, 1); assert.equal(h.flow.requested, null);
});
test('cancelled waiting remains cancelled after replay despite global auto', async () => {
    const h = harness({ auto: true }); await h.flow.tick(); h.flow.cancelWaiting();
    h.media.ended = true; await h.flow.tick();
    h.media.ended = false; await h.flow.tick(); await h.flow.tick();
    assert.equal(h.requests.length, 1); assert.equal(h.flow.requested.provider, 'current');
});
test('track inventory identifies original independently of selected dub and filters languages', () => {
    const player = { getAvailableAudioTracks: () => [
        { id: 'en.1', displayName: 'English (original)' }, { id: 'ru.2', displayName: 'Russian auto-dubbed' }, { id: 'de.3' }],
        getAudioTrack: () => ({ id: 'ru.2', isAutoDubbed: true }) };
    const inventory = audioInventory(player);
    assert.equal(inventory.originalLanguage, 'en');
    assert.deepEqual(filteredYouTubeTracks(inventory, ['ru', 'en']).map(x => x.id), ['ru.2']);
});
test('track setter requires readback confirmation and does not run cancelled work', async () => {
    let selected = { id: 'ru.2' }, calls = 0;
    globalThis.document = { querySelector: () => ({ getAvailableAudioTracks: () => [{ id: 'en.1' }, { id: 'ru.2' }],
        getAudioTrack: () => selected, setAudioTrack: track => { calls++; selected = track; } }) };
    try {
        await assert.rejects(selectYouTubeTrack('en.1', { isCurrent: () => false }), /cancelled/);
        assert.equal(calls, 0); await selectYouTubeTrack('en.1'); assert.equal(selected.id, 'en.1');
    } finally { delete globalThis.document; }
});
test('rejected asynchronous YouTube setter is reported without readback retries', async () => {
    let reads = 0;
    globalThis.document = { querySelector: () => ({
        getAvailableAudioTracks: () => [{ id: 'en.1' }, { id: 'ru.2' }],
        getAudioTrack: () => { reads++; return { id: 'ru.2' }; },
        setAudioTrack: async () => { throw new Error('setter rejected'); }
    }) };
    try {
        await assert.rejects(selectYouTubeTrack('en.1', { delay: async () => {} }), /setter rejected/);
        assert.equal(reads, 1);
    } finally { delete globalThis.document; }
});

test('playback failure clears the audible translation and does not loop reactivation', async () => {
    const h = harness();
    await h.flow.select({ provider: 'standard' });
    h.requests[0].resolve({ name: 'failed' }); await flush();
    h.playback = 'error';
    await h.flow.tick(); await h.flow.tick();
    assert.equal(h.flow.audible, null);
    assert.equal(h.flow.status, 'error');
    assert.equal(h.events.filter(x => x === 'activate:failed').length, 1);
});

test('failed interim audio does not cancel the requested lively voice', async () => {
    const h = harness({ waitingTrack: 'standard' });
    await h.flow.select({ provider: 'lively' });
    h.requests[0].params.onStatus({ state: 'waiting' });
    h.requests[1].resolve({ name: 'interim' }); await flush();
    h.playback = 'error'; await h.flow.tick();
    assert.equal(h.flow.audible, null);
    assert.equal(h.flow.status, 'waiting');
    h.requests[0].resolve({ name: 'lively' }); await flush();
    assert.equal(h.flow.audible.provider, 'lively');
});
