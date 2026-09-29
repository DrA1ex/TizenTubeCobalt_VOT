import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlaybackSpeed, installPlaybackSpeed } from '../third_party/TizenTube/mods/features/playbackSpeed.js';
import {
    applyPreferredQuality, restoreLegacyQualityPreference, guardPlaybackQuality, observeQualitySelections, prepareNewVideoQuality
} from '../third_party/TizenTube/mods/features/playbackQualityGuard.js';

function fixture() {
    const calls = [];
    const values = new Map();
    let preferred = 'auto';
    const video = {
        playbackRate: 1, seeking: false,
        ownerDocument: { defaultView: { localStorage: {
            getItem: key => values.get(key),
            setItem: (key, value) => values.set(key, value),
            removeItem: key => values.delete(key)
        } } }
    };
    const player = {
        getPlaybackRate: () => 1,
        getPreferredQuality: () => preferred,
        setPlaybackQualityRange: (min, max) => { calls.push([min, max]); preferred = max; }
    };
    return { calls, values, video, player };
}

test('seeks, buffering and speed changes leave stream adaptation to YouTube', () => {
    const h = fixture();
    for (const speed of [1.75, 2, 1, 2]) {
        h.video.seeking = true;
        applyPlaybackSpeed(speed, { ...h, cobalt: true });
        h.video.seeking = false;
        applyPlaybackSpeed(speed, { ...h, cobalt: true });
    }
    assert.deepEqual(h.calls, []);
    assert.equal(h.video.playbackRate, 2);
});

test('media events and periodic speed checks preserve quality without failure telemetry', () => {
    const h = fixture();
    const listeners = new Map();
    let tick;
    const documentRef = {
        defaultView: { __votBridgeKey: 'test', setInterval: fn => { tick = fn; return 1; }, clearInterval() {} },
        querySelector: selector => selector === 'video' ? h.video : h.player,
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: type => listeners.delete(type)
    };
    const dispose = installPlaybackSpeed(documentRef, () => 2);
    for (const type of ['seeking', 'seeked', 'waiting', 'stalled', 'playing']) {
        h.video.seeking = type === 'seeking';
        listeners.get(type)({ type, target: h.video });
        tick();
    }
    assert.deepEqual(h.calls, []);
    dispose();
});

test('an old temporary cap is restored once and does not override a newer manual choice', () => {
    const h = fixture();
    h.player.setPlaybackQualityRange('tiny', 'hd1440');
    h.calls.length = 0;
    h.values.set('tt-acceleration-quality-restore', JSON.stringify({ preferred: 'auto', cap: 'hd1440' }));
    h.video.seeking = true;
    restoreLegacyQualityPreference(h.player, h.video);
    assert.deepEqual(h.calls, []);
    h.video.seeking = false;
    restoreLegacyQualityPreference(h.player, h.video);
    restoreLegacyQualityPreference(h.player, h.video);
    assert.deepEqual(h.calls, [['auto', 'auto']]);
    assert.equal(h.values.size, 0);

    const manual = fixture();
    manual.player.setPlaybackQualityRange('hd2160', 'hd2160');
    manual.calls.length = 0;
    manual.values.set('tt-acceleration-quality-restore', JSON.stringify({ preferred: 'auto', cap: 'hd1440' }));
    restoreLegacyQualityPreference(manual.player, manual.video);
    assert.deepEqual(manual.calls, []);
    assert.equal(manual.values.size, 0);
});

test('explicit user quality selection still reaches the player', () => {
    const h = fixture();
    applyPreferredQuality(h.player, 'hd2160');
    assert.deepEqual(h.calls, [['hd2160', 'hd2160']]);
});

// These fixtures model media telemetry independently of the recovery policy.
// Healthy and failing streams can have any resolution and playback speed.
function telemetry({ preference = 'auto', speed = 2, switches = true } = {}) {
    let id = 'video-one', clock = 1000, current = 'hd2160', preferred = preference;
    const calls = [], rates = [];
    const video = { currentTime: 10, playbackRate: speed, readyState: 4,
        paused: false, seeking: false, ended: false,
        buffered: { length: 1, start: () => 0, end: () => video.currentTime + 30 },
        total: 100, dropped: 0,
        getVideoPlaybackQuality() { return { totalVideoFrames: this.total, droppedVideoFrames: this.dropped }; },
        ownerDocument: { defaultView: { localStorage: { setItem() {}, removeItem() {} } } }
    };
    const player = {
        getVideoData: () => ({ video_id: id }), getPlaybackQuality: () => current,
        getPreferredQuality: () => preferred, getPlaybackRate: () => 1,
        getAvailableQualityData: () => [
            ['hd2160', '2160p60'], ['hd1440', '1440p60'], ['hd1080', '1080p'], ['hd720', '720p']
        ].map(([quality, qualityLabel]) => ({ quality, qualityLabel })),
        setPlaybackQualityRange(min, max) {
            calls.push({ min, max, at: clock }); preferred = max;
            if (switches && max !== 'auto') current = max;
        }
    };
    observeQualitySelections(player, rate => { rates.push(rate); speed = rate; });
    const tick = () => guardPlaybackQuality(player, video, speed, clock);
    tick();
    return { player, video, calls, rates, tick,
        advance(ms = 500, { media = true, frames = true, drop = 0 } = {}) {
            clock += ms;
            if (media) video.currentTime += ms / 1000 * speed * (typeof media === 'number' ? media : 1);
            if (frames) { const count = ms / 1000 * 30 * speed; video.total += count; video.dropped += count * drop; }
            tick();
        }, next(idValue) { id = idValue; }, quality(value) { current = value; },
        rawSelect(value) { preferred = value; current = value; },
        now: () => clock, speed: value => { speed = value; video.playbackRate = value; }
    };
}
for (const preference of ['auto', 'hd2160']) {
    test(`${preference}: buffered picture freeze recovers within five seconds even while audio advances`, () => {
        const h = telemetry({ preference });
        for (let i = 0; i < 10; i++) h.advance(500, { frames: false });
        assert.ok(h.calls.length >= 1);
        assert.equal(h.calls[0].max, 'hd1440');
        assert.equal(h.calls[0].min, preference === 'auto' ? 'tiny' : 'hd1440');
        assert.ok(h.calls[0].at - 1000 <= 5000);
        assert.ok(h.calls[0].at - 1000 >= (preference === 'auto' ? 2000 : 4000));
    });
    test(`${preference}: sustained dropped frames lower one level, then healthy playback keeps it`, () => {
        const h = telemetry({ preference });
        for (let i = 0; i < (preference === 'auto' ? 4 : 8); i++) h.advance(500, { drop: 0.5 });
        assert.equal(h.calls.length, 1);
        for (let i = 0; i < 20; i++) h.advance();
        assert.equal(h.calls.length, 1);
    });
    test(`${preference}: stopped media clock recovers even without frame counters`, () => {
        const h = telemetry({ preference }); delete h.video.getVideoPlaybackQuality;
        for (let i = 0; i < 10; i++) h.advance(500, { media: false, frames: false });
        assert.ok(h.calls.length >= 1);
    });
}
test('healthy high-resolution streams at arbitrary speeds never receive a speculative cap', () => {
    for (const speed of [1, 1.5, 1.75, 2, 3, 5]) {
        const h = telemetry({ speed });
        for (let i = 0; i < 30; i++) h.advance();
        assert.deepEqual(h.calls, []);
    }
});
test('brief drops, pauses, seeks and counter resets do not look like decoder overload', () => {
    const h = telemetry();
    h.advance(500, { drop: 0.8 });
    for (let i = 0; i < 4; i++) h.advance();
    for (const key of ['paused', 'seeking', 'ended']) {
        h.video[key] = true;
        for (let i = 0; i < 12; i++) h.advance(500, { media: false, frames: false });
        h.video[key] = false; h.advance();
    }
    h.video.total = 0; h.video.dropped = 0; h.advance();
    assert.deepEqual(h.calls, []);
});
test('empty network buffers are left to Auto but fixed quality has a bounded recovery', () => {
    for (const preference of ['auto', 'hd2160']) {
        const h = telemetry({ preference });
        h.video.readyState = 1; h.video.buffered.end = () => h.video.currentTime;
        for (let i = 0; i < 11; i++) h.advance(500, { media: false, frames: false });
        assert.equal(h.calls.length, preference === 'auto' ? 0 : 1);
    }
});
test('an ignored upper bound is pinned once, verified, then stepped below the failed cap', () => {
    const h = telemetry({ switches: false });
    for (let i = 0; i < 15; i++) h.advance(500, { frames: false });
    assert.deepEqual(h.calls.slice(0, 3).map(({ min, max }) => [min, max]),
        [['tiny', 'hd1440'], ['hd1440', 'hd1440'], ['tiny', 'hd1080']]);
});
test('reselecting a failing resolution resets speed through the stock player API', () => {
    const h = telemetry();
    for (let i = 0; i < 4; i++) h.advance(500, { frames: false });
    h.player.setPlaybackQualityRange('hd2160', 'hd2160');
    assert.deepEqual(h.rates, [1]);
    assert.equal(h.video.playbackRate, 1);
    assert.equal(h.calls.at(-1).max, 'hd2160');
});
test('configured quality callbacks do not undo a temporary recovery cap', () => {
    const h = telemetry({ preference: 'hd2160' });
    for (let i = 0; i < 9; i++) h.advance(500, { frames: false });
    const count = h.calls.length;
    applyPreferredQuality(h.player, 'hd2160');
    assert.equal(h.calls.length, count);
    applyPreferredQuality(h.player, 'hd2160', { manual: true });
    assert.deepEqual(h.rates, [1]);
    assert.equal(h.calls.at(-1).max, 'hd2160');
});
test('reducing speed restores the saved preference, and navigation releases a previous cap', () => {
    const h = telemetry();
    for (let i = 0; i < 4; i++) h.advance(500, { frames: false });
    h.speed(1); h.advance();
    assert.equal(h.calls.at(-1).max, 'auto');
    const next = telemetry({ preference: 'hd2160' });
    for (let i = 0; i < 9; i++) next.advance(500, { frames: false });
    prepareNewVideoQuality(next.player, 'video-two');
    assert.equal(next.calls.at(-1).max, 'hd2160');
    next.next('video-two'); next.quality('hd2160');
    for (let i = 0; i < 10; i++) next.advance();
    assert.equal(next.calls.length, 2);
});
test('a delayed JS callback preserves evidence of a frozen picture', () => {
    const h = telemetry({ preference: 'hd2160' });
    h.advance(3000, { frames: false });
    for (let i = 0; i < 3; i++) h.advance(500, { frames: false });
    assert.equal(h.calls.length, 1);
});

test('a TV menu using a bound copy of the quality API still resets speed on reselecting the failed resolution', () => {
    const h = telemetry({ preference: 'hd2160' });
    for (let i = 0; i < 9; i++) h.advance(500, { frames: false });
    h.rawSelect('hd2160'); h.advance();
    assert.deepEqual(h.rates, [1]);
    assert.equal(h.video.playbackRate, 1);
});

test('reselecting the configured quality through TizenTube settings also resets speed', async () => {
    const { PreferredQualitySession } = await import('../third_party/TizenTube/mods/features/preferredQualitySession.js');
    const h = telemetry({ preference: 'hd2160' });
    h.player.getPlayerStateObject = () => ({ isPlaying: true });
    const session = new PreferredQualitySession();
    session.apply(h.player, '2160p'); h.tick();
    for (let i = 0; i < 9; i++) h.advance(500, { frames: false });
    const before = h.calls.length;
    session.apply(h.player, '2160p', { configChanged: true });
    assert.equal(h.calls.length, before + 1);
    assert.deepEqual(h.rates, [1]);
});
test('choosing Auto in settings releases a guard cap even when no configured fixed quality was applied', async () => {
    const { PreferredQualitySession } = await import('../third_party/TizenTube/mods/features/preferredQualitySession.js');
    const h = telemetry();
    h.player.getPlayerStateObject = () => ({ isPlaying: true });
    const session = new PreferredQualitySession();
    session.apply(h.player, 'auto');
    for (let i = 0; i < 4; i++) h.advance(500, { frames: false });
    session.apply(h.player, 'auto', { configChanged: true });
    assert.equal(h.calls.at(-1).max, 'auto');
    assert.deepEqual(h.rates, []);
});
test('a lower speed gets a fresh trial instead of being mistaken for a manual quality reselect', () => {
    const h = telemetry({ preference: 'hd2160' });
    for (let i = 0; i < 9; i++) h.advance(500, { frames: false });
    h.speed(1.5); h.advance(); h.advance();
    assert.deepEqual(h.rates, []);
    assert.equal(h.video.playbackRate, 1.5);
});
test('a manual quality choice on a new video is not penalized for the previous video', () => {
    const h = telemetry();
    for (let i = 0; i < 4; i++) h.advance(500, { frames: false });
    h.next('video-two');
    h.player.setPlaybackQualityRange('hd2160', 'hd2160');
    h.advance();
    assert.deepEqual(h.rates, []);
});

test('sustained slow media progress with healthy frame counters is detected separately from frame loss', () => {
    for (const preference of ['auto', 'hd2160']) {
        const h = telemetry({ preference });
        for (let i = 0; i < (preference === 'auto' ? 4 : 8); i++) h.advance(500, { media: 0.3 });
        assert.equal(h.calls.length, 1);
        assert.equal(h.calls[0].max, 'hd1440');
    }
});
test('hidden-page samples cannot trigger a quality downgrade', () => {
    const h = telemetry();
    guardPlaybackQuality(h.player, h.video, 2, h.now() + 5000, { hidden: true });
    h.advance(5000, { frames: false, media: false });
    assert.deepEqual(h.calls, []);
});
