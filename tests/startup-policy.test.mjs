import test from 'node:test';
import assert from 'node:assert/strict';
import { startupCommand } from '../third_party/TizenTube/mods/features/startupPolicy.js';

const home = { enabled: true, embedded: true, href: 'https://www.youtube.com/tv#/' };
test('embedded home does not reload when the first preview video appears', () => {
    assert.equal(startupCommand(home), null);
    assert.equal(startupCommand({ ...home, enabled: false, destination: '{}' }), null);
});

test('an explicit startup destination is preserved on home', () => {
    const destination = { browseEndpoint: { browseId: 'FEsubscriptions' } };
    assert.deepEqual(startupCommand({ ...home, destination: JSON.stringify(destination) }), destination);
});

test('deep-linked playback is not interrupted by a late startup action', () => {
    for (const href of ['https://www.youtube.com/tv#/watch?v=one', 'https://www.youtube.com/watch?v=one']) {
        assert.equal(startupCommand({ ...home, href, destination: '{}' }), null);
    }
});

test('legacy non-embedded home keeps the configured reload behavior', () => {
    assert.deepEqual(startupCommand({ ...home, embedded: false }),
        { signalAction: { signal: 'SOFT_RELOAD_PAGE' } });
});
