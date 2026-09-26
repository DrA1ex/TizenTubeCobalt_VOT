import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlaybackSpeed, normalizePlaybackSpeed, installPlaybackSpeed } from '../third_party/TizenTube/mods/features/playbackSpeed.js';

test('speed uses the YouTube player API without touching the media element', () => {
    const calls = [];
    const player = { setPlaybackRate: speed => calls.push(speed) };
    const video = { playbackRate: 1 };
    assert.deepEqual(applyPlaybackSpeed('1.5', { player, video }),
        { applied: true, via: 'player', speed: 1.5 });
    assert.deepEqual(calls, [1.5]);
    assert.equal(video.playbackRate, 1);
});

test('direct media speed is only a compatibility fallback', () => {
    const video = { playbackRate: 1 };
    assert.deepEqual(applyPlaybackSpeed(2, { player: {}, video }),
        { applied: true, via: 'media-fallback', speed: 2 });
    assert.equal(video.playbackRate, 2);
});

test('failed player API waits for retry instead of bypassing decoder coordination', () => {
    const video = { playbackRate: 1 };
    const player = { setPlaybackRate: () => { throw new Error('not ready'); } };
    assert.deepEqual(applyPlaybackSpeed(1.25, { player, video }),
        { applied: false, via: 'player-error', speed: 1.25 });
    assert.equal(video.playbackRate, 1);
});

test('invalid speeds are rejected', () => {
    assert.throws(() => normalizePlaybackSpeed(0), /between 0.25 and 5/);
    assert.throws(() => normalizePlaybackSpeed('fast'), /between 0.25 and 5/);
});

test('buffer recovery does not repeat an already applied speed', () => {
    let calls = 0;
    const video = { playbackRate: 1.5 };
    const player = { getPlaybackRate: () => 1.5, setPlaybackRate: () => { calls++; } };
    applyPlaybackSpeed(1.5, { player, video });
    assert.equal(calls, 0);
    video.playbackRate = 1;
    applyPlaybackSpeed(1.5, { player, video });
    assert.equal(calls, 1, 'a reset media rate must still be restored through the player');
});

test('configured speed survives video replacement and ignores translation audio events', () => {
    let video = null;
    let listener;
    const calls = [];
    const player = { setPlaybackRate: speed => calls.push(speed) };
    const documentRef = {
        querySelector: selector => selector === 'video' ? video : player,
        addEventListener: (type, fn, capture) => {
            assert.ok(['canplay', 'ratechange', 'loadedmetadata', 'waiting', 'stalled',
                'playing', 'pause', 'seeking', 'seeked'].includes(type));
            assert.equal(capture, true); listener = fn;
        }
    };
    installPlaybackSpeed(documentRef, () => 2);
    video = { playbackRate: 1 };
    listener({ target: video });
    const oldVideo = video;
    video = { playbackRate: 1 };
    listener({ target: oldVideo });
    listener({ target: {} });
    listener({ target: video });
    assert.deepEqual(calls, [2, 2]);
});

// Model the TV player's HFR restriction observed in player 4fd832e7:
// the API rate enables a hard quality cap; media ratechange updates the loader.
function cobaltPlayer() {
    let apiRate = 1;
    let mediaRate = 1;
    const h = { calls: [], loaderRate: 1, quality: 'hd2160', writes: 0 };
    h.player = {
        getPlaybackRate: () => apiRate,
        setPlaybackRate: speed => {
            h.calls.push(speed); apiRate = speed; h.video.playbackRate = speed;
            if (speed > 1) h.quality = 'large';
        },
        setPlaybackQualityRange: quality => { h.quality = apiRate > 1 ? 'large' : quality; }
    };
    h.video = {
        get playbackRate() { return mediaRate; },
        set playbackRate(speed) { h.writes++; mediaRate = speed; h.loaderRate = speed; }
    };
    return h;
}

test('Cobalt media speed does not enable the blanket HFR cap when quality metadata is unavailable', () => {
    const h = cobaltPlayer();
    for (const speed of [1.25, 1.5, 2, 1, 0.75]) {
        assert.equal(applyPlaybackSpeed(speed, { ...h, cobalt: true }).via, 'cobalt-media');
        assert.equal(h.quality, 'hd2160');
        h.player.setPlaybackQualityRange('hd1440');
        assert.equal(h.quality, 'hd1440');
        h.player.setPlaybackQualityRange('hd2160');
        assert.equal(h.quality, 'hd2160');
        assert.equal(h.loaderRate, speed);
    }
    assert.deepEqual(h.calls, []);
});

test('Cobalt clears a rate cap left by the old build and allows choosing 4K again', () => {
    const h = cobaltPlayer(); h.player.setPlaybackRate(1.5);
    assert.equal(h.quality, 'large');
    applyPlaybackSpeed(1.5, { ...h, cobalt: true });
    h.player.setPlaybackQualityRange('hd2160');
    assert.equal(h.quality, 'hd2160');
    assert.equal(h.video.playbackRate, 1.5);
    assert.deepEqual(h.calls, [1.5, 1]);
    const writes = h.writes;
    for (let i = 0; i < 10; i++) applyPlaybackSpeed(1.5, { ...h, cobalt: true });
    assert.equal(h.writes, writes, 'buffer recovery must not toggle between 1x and the desired speed');
});

test('Cobalt reapplies speed after a media reset without repeated rate writes', () => {
    const h = cobaltPlayer();
    const listeners = {};
    const documentRef = { defaultView: { __votBridgeKey: 'test' },
        querySelector: selector => selector === 'video' ? h.video : h.player,
        addEventListener: (type, fn) => { listeners[type] = fn; } };
    installPlaybackSpeed(documentRef, () => 1.5);
    h.video.playbackRate = 1;
    listeners.ratechange({ type: 'ratechange', target: h.video });
    assert.equal(h.video.playbackRate, 1.5);
    const writes = h.writes;
    listeners.ratechange({ type: 'ratechange', target: h.video });
    assert.equal(h.writes, writes);
    assert.equal(h.quality, 'hd2160');
});

test('failed Cobalt API reset does not pretend the quality cap was cleared', () => {
    const video = { playbackRate: 1 };
    const player = { getPlaybackRate: () => 2, setPlaybackRate() { throw Error('not ready'); } };
    assert.equal(applyPlaybackSpeed(2, { video, player, cobalt: true }).applied, false);
    assert.equal(video.playbackRate, 1);
});
