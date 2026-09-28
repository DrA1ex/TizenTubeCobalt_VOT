import test from 'node:test';
import assert from 'node:assert/strict';
import { installBufferedWaitingFilter } from '../third_party/TizenTube/mods/features/bufferedWaitingFilter.js';

function fixture() {
    let clock = 1000;
    let timer = null;
    const listeners = new Map();
    const video = {
        currentTime: 20, paused: false, seeking: false, ended: false,
        buffered: { length: 1, start: () => 0, end: () => 70 },
        frames: 100,
        getVideoPlaybackQuality() { return { totalVideoFrames: this.frames, droppedVideoFrames: 0 }; },
        ownerDocument: { defaultView: { Event } },
        dispatchEvent(event) { emit(event.type, video, event); }
    };
    const documentRef = {
        querySelector: () => video,
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(listener);
        },
        removeEventListener(type, listener) {
            listeners.set(type, listeners.get(type).filter(item => item !== listener));
        }
    };
    const received = [];
    function emit(type, target = video, original = null) {
        const event = original || { type, target, stopped: false,
            stopImmediatePropagation() { this.stopped = true; } };
        if (!event.target) Object.defineProperty(event, 'target', { value: target });
        for (const listener of listeners.get(type) || []) {
            if (event.stopped) break;
            listener(event);
        }
        return event;
    }
    const dispose = installBufferedWaitingFilter(documentRef, () => 1.5, {
        now: () => clock, setTimer: fn => { timer = fn; return 1; }, clearTimer: () => { timer = null; }
    });
    documentRef.addEventListener('waiting', event => received.push(event), true);
    return { video, received, emit, dispose, advance(ms) { clock += ms; }, fireTimer() {
        const fn = timer; timer = null; assert.ok(fn); fn();
    } };
}

test('brief waiting with 50 seconds buffered and advancing frames does not reach the player', () => {
    const h = fixture();
    h.emit('timeupdate');
    assert.equal(h.emit('waiting').stopped, true);
    h.advance(700);
    h.video.currentTime += 1;
    h.video.frames += 30;
    h.fireTimer();
    assert.equal(h.received.length, 0);
    h.dispose();
});

test('a real buffered decoder stall reaches the player after a short check', () => {
    const h = fixture();
    h.emit('timeupdate');
    h.emit('waiting');
    h.advance(700);
    h.fireTimer();
    assert.equal(h.received.length, 1);
    h.dispose();
});

test('empty buffer waiting is delivered immediately', () => {
    const h = fixture();
    h.video.buffered.end = () => 21;
    h.emit('timeupdate');
    assert.equal(h.emit('waiting').stopped, false);
    assert.equal(h.received.length, 1);
    h.dispose();
});
