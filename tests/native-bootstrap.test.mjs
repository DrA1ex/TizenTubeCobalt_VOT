import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../native_bridge/bootstrap.js', import.meta.url), 'utf8');
function harness() {
    const requests = [];
    const timers = [];
    const context = vm.createContext({ window: {}, document: { body: {} },
        setTimeout: callback => { timers.push(callback); },
        location: { origin: 'https://www.youtube.com' },
        XMLHttpRequest: class {
            constructor() { requests.push(this); this.headers = {}; }
            open(method, url, async) { Object.assign(this, { method, url, async }); }
            setRequestHeader(name, value) { this.headers[name] = value; }
            send(body) { this.body = JSON.parse(body); }
        } });
    return { context, requests, timers, run: () => vm.runInContext(source, context) };
}

test('bootstrap requests one asynchronous injection and becomes idle once loaded', () => {
    const h = harness(); h.run(); h.run();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].async, true);
    assert.equal(h.requests[0].body.action, 'inject');
    assert.equal(h.requests[0].headers['X-VOT-Key'], '__VOT_BRIDGE_KEY__');
    h.requests[0].onloadend();
    h.context.window.__tizenTubeVotEmbeddedLoaded = true;
    for (let i = 0; i < 20; i++) h.run();
    assert.equal(h.requests.length, 1);
});

test('bootstrap retries a failed request and handles a new document', () => {
    const h = harness(); h.run(); h.requests[0].onloadend(); h.run();
    assert.equal(h.requests.length, 2);
    h.context.window = {};
    h.run(); assert.equal(h.requests.length, 3);
});

test('bootstrap waits for the document and does not inject outside YouTube', () => {
    const h = harness(); h.context.document.body = null; h.run();
    h.context.document.body = {}; h.context.location.origin = 'https://example.org'; h.run();
    assert.equal(h.requests.length, 0);
});

test('available native injection command avoids loopback startup round trips', () => {
    const h = harness();
    const commands = [];
    h.context.window.votNative = { command: body => { commands.push(JSON.parse(body)); return '{"ok":true}'; } };
    h.run(); h.run();
    assert.equal(h.requests.length, 0);
    assert.deepEqual(commands, [{ action: 'inject' }]);
    h.timers[0](); h.run();
    assert.equal(commands.length, 2, 'failed injection can retry');
    h.context.window.__tizenTubeVotEmbeddedLoaded = true;
    h.run(); assert.equal(commands.length, 2);
});

test('native injection failure falls back to the HTTP bridge', () => {
    const h = harness();
    h.context.window.votNative = { command() { throw Error('bridge unavailable'); } };
    h.run(); assert.equal(h.requests.length, 1);
});
