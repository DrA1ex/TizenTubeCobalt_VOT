import test from 'node:test';
import { audioText } from '../third_party/TizenTube/mods/features/audioLocale.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { playbackSnapshot, sourceLanguage } from '../third_party/TizenTube/mods/features/votPlayback.js';

const source = await readFile(new URL('../third_party/TizenTube/mods/features/vot.js', import.meta.url), 'utf8');
const policy = await readFile(new URL('../third_party/TizenTube/mods/features/votPlayback.js', import.meta.url), 'utf8');
const requestPolicy = await readFile(new URL('../third_party/TizenTube/mods/features/votRequestPolicy.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

async function harness({ lang = 'en', auto = false, token = false, deferred = false, mode = 'standard',
    native = true, bridge = null, translate = null } = {}) {
    const events = new Map();
    const windowEvents = new Map();
    const documentEvents = new Map();
    const intervals = [];
    const commands = [];
    const requests = [];
    const clients = [];
    const audios = [];
    const configEvents = [];
    let resolveTranslation;
    const translation = deferred ? new Promise(resolve => { resolveTranslation = resolve; }) : null;
    const config = { enableVOT: true, votAutoEnglish: auto, votOAuthToken: '', votVoiceMode: mode,
        votTransport: 'worker', votWorkerHost: 'vot-worker.eu.cc', votOriginalVolume: '0.2', votTranslationVolume: '1' };
    const media = { currentTime: 12, duration: 840, paused: false, seeking: false, ended: false,
        readyState: 4, volume: 0.8, playbackRate: 1, isConnected: true,
        addEventListener: (type, fn) => events.set(type, fn),
        removeEventListener: type => events.delete(type), getClientRects: () => [1] };
    let currentMedia = media;
    const player = { getVideoData: () => ({ video_id: 'english-video' }), getAudioTrack: () => lang ? { id: lang + '.4' } : null,
        getPlayerResponse: () => ({ videoDetails: {} }) };
    const window = { __votBridgeKey: 'test-key', location: { href: 'https://www.youtube.com/tv#/watch?v=english-video' },
        votNative: bridge, addEventListener: (type, fn) => windowEvents.set(type, fn) };
    const document = { hidden: false,
        querySelector: selector => selector === 'video' ? currentMedia : player,
        addEventListener: (type, fn) => documentEvents.set(type, fn),
        body: { appendChild() {} },
        createElement: () => {
            const audioEvents = new Map();
            const created = { paused: true, currentTime: 0, playbackRate: 1,
                addEventListener: (type, fn) => audioEvents.set(type, fn),
                play: () => { created.paused = false; return Promise.resolve(); },
                pause: () => { created.paused = true; }, removeAttribute() {}, load() {}, remove() {},
                event: type => audioEvents.get(type)?.() };
            audios.push(created);
            return created;
        } };
    class Client {
        constructor(options) { clients.push(options); this.options = options; }
        async translateVideo(options) {
            requests.push(options);
            if (translate) return translate(options, this.options);
            return translation || { translated: true, status: 1, url: 'https://vtrans.s3-private.mds.yandex.net/tts/prod/test.mp3' };
        }
    }
    const context = vm.createContext({ window, document, URL, Blob, TextEncoder, TextDecoder, Uint8Array,
        ArrayBuffer, AbortController, AbortSignal, Date, console: { info() {}, warn() {}, error() {} }, btoa, atob,
        setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {},
        setTimeout, clearTimeout,
        fetch: async (url, options) => {
            assert.equal(options.headers['X-VOT-Key'], 'test-key');
            if (url.endsWith('/health')) return { ok: native, json: async () => ({ hasToken: token, foreground: true }) };
            if (url.endsWith('/request')) return { ok: true,
                json: async () => ({ status: 200, bodyBase64: btoa('response') }) };
            if (url.endsWith('/command')) {
                const command = JSON.parse(options.body);
                commands.push(command);
                return { ok: true, json: async () => ({ ok: true, state: 'playing' }) };
            }
            throw Error('Unexpected real network request: ' + url);
        } });
    const values = {
        '@vot.js/ext': { default: Client },
        '@vot.js/core/providers/votworker': { VOTWorkerProvider: class Worker {} },
        './votLanguageProbe.js': { probeVotLanguage: async () => 'en' },
        '../config.js': { configRead: key => config[key], configWrite: (key, value) => { config[key] = value; },
            configChangeEmitter: { addEventListener: (_, fn) => configEvents.push(fn) } },
        '../ui/ytUI.js': { showToast() {} },
        '../features/audioLocale.js': { audioText }
    };
    const module = new vm.SourceTextModule(source, { context });
    await module.link(async specifier => {
        if (specifier === './votPlayback.js') return new vm.SourceTextModule(policy, { context });
        if (specifier === './votRequestPolicy.js') return new vm.SourceTextModule(requestPolicy, { context });
        const exports = values[specifier];
        assert.ok(exports, specifier);
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
        }, { context });
    });
    await module.evaluate();
    await flush();
    return { api: module.namespace, media, commands, requests, clients, config, window, document, audios,
        resolveTranslation,
        replaceVideo: () => { currentMedia = { ...media }; },
        event: async type => { events.get(type)?.({ type }); await flush(); },
        tick: async () => { intervals.forEach(fn => fn()); await flush(); },
        route: async () => { window.location.href = 'https://www.youtube.com/tv#/'; windowEvents.get('hashchange')(); await flush(); },
        hidden: async () => { document.hidden = true; documentEvents.get('visibilitychange')(); await flush(); },
        setting: async (key, value) => { config[key] = value; configEvents.forEach(fn => fn({ detail: { key, value } })); await flush(); } };
}

test('pause, buffering, seeking and stalled progress produce paused snapshots', () => {
    const media = { currentTime: 20, readyState: 4, playbackRate: 1 };
    for (const property of ['paused', 'seeking', 'ended']) assert.equal(playbackSnapshot({ ...media, [property]: true }).paused, true);
    for (const options of [{ buffering: true }, { hidden: true }, { now: 2000, progressAt: 0 }])
        assert.equal(playbackSnapshot(media, options).paused, true);
});
test('language evidence: translated captions do not imply English speech', () => {
    assert.equal(sourceLanguage({ getPlayerResponse: () => ({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en' }] } } }) }), '');
    assert.equal(sourceLanguage({ getAudioTrack: () => ({ languageCode: 'ru' }), getPlayerResponse: () => ({ videoDetails: { language: 'en' } }) }), 'ru');
});
test('pause stays paused after periodic sync; seek while paused cannot resume', async () => {
    const h = await harness(); await h.api.toggleVot(); await flush();
    h.media.paused = true; await h.event('pause');
    h.media.currentTime = 200; h.media.seeking = true; await h.event('seeking');
    h.media.seeking = false; await h.event('seeked'); await h.tick();
    const syncs = h.commands.filter(c => c.action === 'sync');
    assert.equal(syncs.at(-1).paused, true); assert.equal(syncs.at(-1).positionMs, 200000);
    assert.ok(syncs.every((c, i) => i === 0 || c.seq > syncs[i - 1].seq));
});
test('resume and playback speed follow video state', async () => {
    const h = await harness(); await h.api.toggleVot();
    h.media.paused = true; await h.event('pause');
    h.media.paused = false; h.media.playbackRate = 1.5; await h.event('playing');
    assert.equal(h.commands.at(-1).paused, false); assert.equal(h.commands.at(-1).rate, 1.5);
});
test('dense periodic checks coalesce native audio heartbeats', async () => {
    const h = await harness(); await h.api.toggleVot();
    const initial = h.commands.filter(command => command.action === 'sync').length;
    for (let i = 0; i < 8; i++) await h.tick();
    assert.equal(h.commands.filter(command => command.action === 'sync').length, initial);
    h.media.paused = true; await h.event('pause');
    assert.equal(h.commands.filter(command => command.action === 'sync').length, initial + 1);
});
for (const scenario of ['route', 'hidden', 'replace', 'ended', 'emptied', 'error']) {
    test('translation stops on ' + scenario + ' and restores original volume', async () => {
        const h = await harness(); await h.api.toggleVot(); await flush();
        if (scenario === 'route') await h.route();
        else if (scenario === 'hidden') await h.hidden();
        else if (scenario === 'replace') { h.replaceVideo(); await h.tick(); }
        else await h.event(scenario);
        assert.equal(h.commands.at(-1).action, 'stop');
        assert.equal(h.media.volume, 0.8); assert.equal(h.api.getVotState().state, 'idle');
    });
}
test('late translation response after video close never starts audio', async () => {
    const h = await harness({ deferred: true }); const pending = h.api.toggleVot(); await flush();
    await h.route();
    h.resolveTranslation({ translated: true, status: 1, url: 'https://vtrans.s3-private.mds.yandex.net/tts/prod/test.mp3' });
    await pending; await flush();
    assert.equal(h.commands.some(c => c.action === 'sync'), false);
});
for (const [lang, auto, expected] of [['en', true, 1], ['ru', true, 0], ['', true, 0], ['en', false, 0]]) {
    test('auto English: ' + JSON.stringify({ lang, auto }), async () => {
        const h = await harness({ lang, auto }); await h.tick(); await flush();
        assert.equal(h.requests.length, expected);
        if (expected) { h.api.stopVot(true); await h.tick(); assert.equal(h.requests.length, 1); }
    });
}
test('changing both volumes immediately updates active playback', async () => {
    const h = await harness(); await h.api.toggleVot();
    await h.setting('votTranslationVolume', '0.4'); await h.setting('votOriginalVolume', '0');
    assert.equal(h.media.volume, 0); assert.equal(h.commands.at(-1).volume, 0.4);
    h.api.stopVot(); assert.equal(h.media.volume, 0.8);
});
test('YouTube mute also mutes the translation', async () => {
    const h = await harness(); await h.api.toggleVot();
    h.media.muted = true; await h.tick(); assert.equal(h.commands.at(-1).volume, 0);
    h.media.muted = false; await h.tick(); assert.equal(h.commands.at(-1).volume, 1);
});
test('strict lively uses direct provider with stored-token placeholder despite old worker setting', async () => {
    const h = await harness({ token: true, mode: 'lively' }); await h.api.toggleVot();
    assert.equal(h.requests[0].extraOpts.useLivelyVoice, true);
    assert.equal(h.clients[0].provider, undefined);
    assert.equal(h.clients[0].apiToken, 'native-stored-token');
});
test('strict lively without token never silently requests standard', async () => {
    const h = await harness({ mode: 'lively' }); await h.api.toggleVot();
    assert.equal(h.requests.length, 0); assert.equal(h.api.getVotState().state, 'error');
});
test('opening OAuth input stops audio and uses native dialog', async () => {
    const h = await harness(); await h.api.toggleVot(); await h.api.setOAuthToken();
    assert.equal(h.commands.at(-1).action, 'authDialog');
    assert.ok(h.commands.some(c => c.action === 'stop'));
});

test('translation follows speeds above 4x without falling behind the video', async () => {
    const h = await harness(); await h.api.toggleVot();
    h.media.playbackRate = 5; await h.event('ratechange');
    assert.equal(h.commands.at(-1).rate, 5);
});

test('mute reaches native audio immediately without waiting for the periodic check', async () => {
    const h = await harness(); await h.api.toggleVot();
    h.media.muted = true; await h.event('volumechange');
    assert.equal(h.commands.at(-1).volume, 0);
});

test('unified browser audio errors restore original volume', async () => {
    const h = await harness({ native: false });
    h.api.activateVotTrack({ url: 'track.mp3', videoId: 'english-video' });
    assert.ok(h.media.volume < 0.8);
    h.audios[0].event('error');
    assert.equal(h.api.getVotState().state, 'error');
    assert.equal(h.media.volume, 0.8);
});

test('rejected play from an old audio element cannot stop a newer translation', async () => {
    const h = await harness({ native: false });
    const result = { url: 'track.mp3', videoId: 'english-video' };
    h.api.activateVotTrack(result);
    const first = h.audios[0];
    let rejectPlay;
    first.paused = true;
    first.play = () => new Promise((_, reject) => { rejectPlay = reject; });
    await h.event('playing');
    h.api.activateVotTrack(result);
    rejectPlay(new Error('old play interrupted by load'));
    await flush();
    assert.equal(h.api.getVotState().state, 'playing');
    assert.equal(h.audios[1].paused, false);
});

test('a pause interrupting browser play is not a translation failure', async () => {
    const h = await harness({ native: false });
    h.api.activateVotTrack({ url: 'track.mp3', videoId: 'english-video' });
    let rejectPlay;
    h.audios[0].paused = true;
    h.audios[0].play = () => new Promise((_, reject) => { rejectPlay = reject; });
    await h.event('playing');
    h.media.paused = true; await h.event('pause');
    rejectPlay(new Error('play interrupted by pause'));
    await flush();
    assert.equal(h.api.getVotState().state, 'playing');
});

test('native network requests use async loopback even when synchronous Java bridge exists', async () => {
    const h = await harness({ bridge: {
        request() { throw Error('must not block the video thread'); }, command() { return '{}'; }
    } });
    await h.api.toggleVot();
    const response = await h.clients[0].fetchFn('https://api.browser.yandex.ru/video-translation/translate');
    assert.equal(await response.text(), 'response');
});

test('standard worker preparation survives a direct-route 403 without asking for OAuth', async () => {
    const h = await harness({ translate: async (_, options) => {
        if (!options.provider) throw Error('HTTP 403');
        return { translated: false, status: 2, remainingTime: 5 };
    } });
    h.config.votTransport = 'auto';
    const controller = new AbortController();
    let waiting = false;
    await assert.rejects(h.api.prepareVotTrack({ lively: false, targetLang: 'ru', videoId: 'english-video',
        media: h.media, signal: controller.signal, onStatus: status => {
            waiting = status.state === 'waiting'; controller.abort();
        } }), /cancelled/);
    assert.equal(waiting, true);
});
