import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlaybackSpeed, installPlaybackSpeed } from '../third_party/TizenTube/mods/features/playbackSpeed.js';
import {
    applyPreferredQuality, restoreLegacyQualityPreference
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

test('media events and periodic speed checks never lower quality', () => {
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
