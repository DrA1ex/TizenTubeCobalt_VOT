import test from 'node:test';
import assert from 'node:assert/strict';
import { requestTranslationCycle, votTransportAttempts } from '../third_party/TizenTube/mods/features/votRequestPolicy.js';

test('native requests ask Yandex directly before the worker and lively has a safe worker fallback', () => {
    assert.deepEqual(votTransportAttempts(false, true, 'auto'), ['direct', 'worker']);
    assert.deepEqual(votTransportAttempts(true, true, 'auto'), ['direct', 'worker']);
    assert.deepEqual(votTransportAttempts(false, false, 'auto'), ['worker', 'direct']);
    assert.deepEqual(votTransportAttempts(false, true, 'worker'), ['worker']);
});

test('a waiting route cannot hide a ready cached translation on another route', async () => {
    const called = [];
    const entries = [
        { transport: 'direct', client: { translateVideo: async () => {
            called.push('direct'); return { translated: false, status: 2, remainingTime: 30 };
        } } },
        { transport: 'worker', client: { translateVideo: async () => {
            called.push('worker'); return { translated: true, status: 1, url: 'ready.mp3' };
        } } }
    ];
    const cycle = await requestTranslationCycle(entries, {}, () => true, () => 30);
    assert.deepEqual(called, ['direct', 'worker']);
    assert.equal(cycle.ready.transport, 'worker');
    assert.equal(cycle.ready.result.url, 'ready.mp3');
});

test('network failures are distinct from a real server waiting response', async () => {
    const failed = await requestTranslationCycle([
        { transport: 'direct', client: { translateVideo: async () => { throw new Error('timeout'); } } },
        { transport: 'worker', client: { translateVideo: async () => { throw new Error('offline'); } } }
    ], {}, () => true, () => 15);
    assert.equal(failed.received, false);
    assert.equal(failed.failures.length, 2);

    const partial = await requestTranslationCycle([
        { transport: 'direct', client: { translateVideo: async () =>
            ({ translated: true, status: 5, url: 'partial.mp3', remainingTime: 12 }) } }
    ], {}, () => true, result => result.remainingTime);
    assert.equal(partial.received, true);
    assert.equal(partial.partial, true);
    assert.equal(partial.delay, 12);
});
