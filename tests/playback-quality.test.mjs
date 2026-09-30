import test from 'node:test';
import assert from 'node:assert/strict';
import { preferVideoCodec, videoFormats, speedCeiling, targetQuality, stickyQualityEntry, stickyQualityLevel, cachedSupport }
    from '../third_party/TizenTube/mods/features/preferredQualityPolicy.js';
import { installQualityController } from '../third_party/TizenTube/mods/features/qualityController.js';

// MediaSource.isTypeSupported answers measured on a RockTek GX1 (RTD1325) for
// VP9: 2160p up to 60 fps, 1440p up to 150 fps, 1080p up to 240 fps.
const GX1_VP9 = { 2160: 60, 1440: 150, 1080: 240, 720: 240, 480: 240, 360: 240, 240: 240 };
function gx1Supports(type) {
    const height = Number(type.match(/height=(\d+)/)?.[1]);
    const fps = Number(type.match(/framerate=(\d+)/)?.[1]);
    if (/vp09\.02/.test(type)) return false;
    return fps <= (GX1_VP9[height] ?? 0);
}

const LABELS = { 2160: 'hd2160', 1440: 'hd1440', 1080: 'hd1080', 720: 'hd720', 480: 'large', 360: 'medium', 240: 'small' };
function response(id, fps, heights = [2160, 1440, 1080, 720, 480, 360, 240]) {
    return { videoDetails: { videoId: id }, streamingData: { adaptiveFormats: [
        ...heights.map(height => ({ itag: height, mimeType: 'video/webm; codecs="vp9"', width: Math.round(height * 16 / 9),
            height, fps: height > 480 ? fps : Math.min(fps, 30), quality: LABELS[height],
            qualityLabel: height + 'p' + (height > 480 && fps > 30 ? fps : '') })),
        { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 1 }
    ] } };
}

test('speed ceiling follows the decoder limit, not a fixed resolution cap', () => {
    const hfr = videoFormats(response('a', 60));
    assert.equal(speedCeiling(hfr, 1, gx1Supports), Infinity);
    assert.equal(speedCeiling(hfr, 1.5, gx1Supports), 1440, '4K60 needs 90 fps at 1.5x');
    assert.equal(speedCeiling(hfr, 2, gx1Supports), 1440, '1440p60 at 2x needs 120 fps, which the decoder supports');
    assert.equal(speedCeiling(hfr, 3, gx1Supports), 1080);
    const film = videoFormats(response('b', 30));
    assert.equal(speedCeiling(film, 2, gx1Supports), Infinity, '4K30 at 2x is 60 fps');
    assert.equal(speedCeiling(film, 2.5, gx1Supports), 1440);
});

test('formats unsupported at normal speed do not limit accelerated quality', () => {
    const formats = videoFormats(response('a', 30));
    formats.push({ quality: 'hd2160', level: 2160, width: 3840, height: 2160, fps: 60,
        mimeType: 'video/webm; codecs="vp09.02.51.10"' });
    assert.equal(speedCeiling(formats, 2, gx1Supports), Infinity);
});

test('target quality combines the configured maximum with the speed ceiling', () => {
    const hfr = videoFormats(response('a', 60));
    assert.equal(targetQuality('auto', 1, hfr, gx1Supports), null);
    assert.deepEqual(targetQuality('auto', 2, hfr, gx1Supports),
        { quality: 'hd1440', level: 1440, auto: true, limited: true });
    assert.deepEqual(targetQuality('2160p', 1, hfr, gx1Supports),
        { quality: 'hd2160', level: 2160, auto: false, limited: false });
    assert.deepEqual(targetQuality('2160p', 1.5, hfr, gx1Supports),
        { quality: 'hd1440', level: 1440, auto: false, limited: true });
    assert.deepEqual(targetQuality('1080p', 2, hfr, gx1Supports),
        { quality: 'hd1080', level: 1080, auto: false, limited: false });
    const small = videoFormats(response('b', 60, [1080, 720, 360]));
    assert.equal(targetQuality('2160p', 1, small, gx1Supports).quality, 'hd1080');
    // A missing preference falls down to the next level, never up to "highres".
    assert.equal(targetQuality('1800p', 1, hfr, gx1Supports).quality, 'hd1440');
    const hd = videoFormats(response('c', 60, [2160, 1440, 1080, 720]));
    assert.equal(targetQuality('480p', 1, hd, gx1Supports).quality, 'hd720');
});

test('the preferred codec never lowers the maximum resolution', () => {
    const format = (codec, height) => ({ mimeType: `video/${codec === 'vp9' ? 'webm' : 'mp4'}; codecs="${codec}"`,
        height, qualityLabel: height + 'p' });
    const audio = { mimeType: 'audio/webm; codecs="opus"' };
    const old = [format('vp9', 240), format('vp9', 144), format('avc1.4d401e', 360),
        format('avc1.4d4015', 240), audio];
    assert.deepEqual(preferVideoCodec(old, 'vp9'), [old[0], old[1], old[2], audio]);
    const modern = [format('vp9', 2160), format('avc1.640033', 1080), audio];
    assert.deepEqual(preferVideoCodec(modern, 'vp9'), [modern[0], audio]);
    assert.equal(preferVideoCodec(modern, 'av01'), modern);
});

test('sticky entries use the player storage format', () => {
    const entry = JSON.parse(stickyQualityEntry(1440, 1000));
    assert.equal(entry.creation, 1000);
    assert.equal(entry.expiration, 1000 + 31104e6);
    assert.deepEqual(JSON.parse(entry.data), { quality: 1440, previousQuality: 1440 });
    assert.equal(stickyQualityLevel(stickyQualityEntry(2160)), 2160);
    assert.equal(stickyQualityLevel('broken'), 0);
});

test('decoder answers are cached and exceptions count as unsupported', () => {
    let calls = 0;
    const supports = cachedSupport(type => { calls++; if (type === 'bad') throw Error('x'); return true; });
    assert.equal(supports('a'), true);
    assert.equal(supports('a'), true);
    assert.equal(supports('bad'), false);
    assert.equal(calls, 2);
});

function harness({ preference = '2160p', speed = 1 } = {}) {
    const h = { preference, speed, calls: [], resets: [], listeners: {}, store: new Map(),
        id: null, response: null, playing: null, preferred: 'auto', time: 1e6,
        wait(ms = 4000) { h.time += ms; } };
    h.store.set('tt-acceleration-quality-restore', '{"preferred":"auto","cap":"large"}');
    h.store.set('yt-player-quality', stickyQualityEntry(480));
    h.video = {};
    h.player = {
        getVideoData: () => ({ video_id: h.id }),
        getPlayerResponse: () => h.response,
        getVideoStats: () => ({}),
        getAvailableQualityData: () => videoFormats(h.response).map(format =>
            ({ quality: format.quality, qualityLabel: format.level + 'p' })),
        getPlaybackQuality: () => h.playing,
        getPreferredQuality: () => h.preferred,
        setPlaybackQualityRange(min, max) {
            h.calls.push([min, max]);
            h.preferred = max;
            h.store.set('yt-player-quality', stickyQualityEntry(Number.parseInt(
                this.getAvailableQualityData().find(item => item.quality === max)?.qualityLabel, 10) || 0));
        }
    };
    h.json = { parse: JSON.parse };
    const windowRef = {
        MediaSource: { isTypeSupported: gx1Supports },
        localStorage: { setItem: (k, v) => h.store.set(k, v), removeItem: k => h.store.delete(k), getItem: k => h.store.get(k) },
        setInterval: () => 1, clearInterval() {}
    };
    const documentRef = {
        querySelector: selector => selector === 'video' ? h.video : h.player,
        addEventListener: (type, fn) => { h.listeners[type] = fn; }, removeEventListener() {}
    };
    h.controller = installQualityController({ documentRef, windowRef, jsonTarget: h.json,
        now: () => h.time, readPreference: () => h.preference, readSpeed: () => h.speed, resetSpeed: value => { h.resets.push(value); h.speed = value; } });
    h.sticky = () => stickyQualityLevel(h.store.get('yt-player-quality'));
    h.load = (id, fps, playing) => {
        h.wait();
        h.response = h.json.parse(JSON.stringify(response(id, fps)));
        h.id = id;
        h.playing = playing;
        h.listeners.loadedmetadata({ target: h.video });
    };
    return h;
}

test('startup replaces temporary caps left by older builds', () => {
    const h = harness();
    assert.equal(h.store.has('tt-acceleration-quality-restore'), false);
    assert.equal(h.sticky(), 2160);
    const auto = harness({ preference: 'auto' });
    assert.equal(auto.store.has('yt-player-quality'), false);
});

test('the player response sets the starting quality before the loader reads it', () => {
    const h = harness({ speed: 2 });
    h.json.parse(JSON.stringify(response('a', 60)));
    assert.equal(h.sticky(), 1440);
    h.json.parse(JSON.stringify(response('b', 30)));
    assert.equal(h.sticky(), 2160);
    const auto = harness({ preference: 'auto', speed: 1 });
    auto.store.set('yt-player-quality', stickyQualityEntry(480));
    auto.json.parse(JSON.stringify(response('a', 60)));
    assert.equal(auto.store.has('yt-player-quality'), false, 'Auto without a limit clears a stale maximum');
});

test('a video that already starts at the target is locked without a second load', () => {
    const h = harness({ speed: 1.5 });
    h.load('a', 60, 'hd1440');
    assert.deepEqual(h.calls, [['hd1440', 'hd1440']]);
    h.listeners.playing({ target: h.video });
    h.listeners.loadedmetadata({ target: h.video });
    assert.equal(h.calls.length, 1, 'repeated media events do not restart the stream');
});

test('speed changes switch quality once in each direction', () => {
    const h = harness({ speed: 1 });
    h.load('a', 60, 'hd2160');
    h.wait();
    h.speed = 2;
    h.controller.onSpeedChange();
    h.wait();
    h.speed = 2.25;
    h.controller.onSpeedChange();
    h.wait();
    h.speed = 1;
    h.controller.onSpeedChange();
    assert.deepEqual(h.calls, [['hd2160', 'hd2160'], ['hd1440', 'hd1440'], ['hd2160', 'hd2160']]);
});

test('Auto keeps adaptive selection and only bounds or forces an undecodable stream', () => {
    const h = harness({ preference: 'auto', speed: 1 });
    h.load('a', 60, 'hd1080');
    assert.deepEqual(h.calls, []);
    h.speed = 2;
    h.controller.onSpeedChange();
    assert.deepEqual(h.calls, [['tiny', 'hd1440']], 'a lower adaptive stream needs no restart');
    h.wait();
    h.speed = 1;
    h.controller.onSpeedChange();
    assert.deepEqual(h.calls.at(-1), ['auto', 'auto']);
    h.wait();
    h.playing = 'hd2160';
    h.speed = 1.5;
    h.controller.onSpeedChange();
    assert.deepEqual(h.calls.at(-1), ['hd1440', 'hd1440'], 'a 4K60 stream at 1.5x must be replaced');
});

test('a new video starts from its own formats, not the previous limit', () => {
    const h = harness({ speed: 2 });
    h.load('a', 60, 'hd1440');
    h.load('b', 30, 'hd2160');
    assert.deepEqual(h.calls, [['hd1440', 'hd1440'], ['hd2160', 'hd2160']]);
});

test('changing the setting applies immediately, including Auto', () => {
    const h = harness({ speed: 1 });
    h.load('a', 60, 'hd2160');
    h.wait();
    h.preference = '1080p';
    h.controller.onPreferenceChange();
    h.wait();
    h.preference = 'auto';
    h.controller.onPreferenceChange();
    assert.deepEqual(h.calls, [['hd2160', 'hd2160'], ['hd1080', 'hd1080'], ['auto', 'auto']]);
});

test('a stock menu choice is kept for the video and returns speed to 1x when undecodable', () => {
    const h = harness({ speed: 2 });
    h.load('a', 60, 'hd1440');
    h.wait();
    h.controller.checkUserChoice();
    h.preferred = 'hd2160';
    h.controller.checkUserChoice();
    assert.deepEqual(h.resets, [1]);
    const calls = h.calls.length;
    h.controller.onSpeedChange();
    assert.equal(h.calls.length, calls, 'the stock menu already applied its choice');
    h.preferred = 'hd720';
    h.controller.checkUserChoice();
    h.wait();
    h.speed = 2;
    h.controller.onSpeedChange();
    assert.equal(h.calls.length, calls, 'the 720p choice is below the speed limit and stays');
    assert.equal(h.resets.length, 1);
    h.load('b', 60, 'hd1440');
    assert.deepEqual(h.calls.at(-1), ['hd1440', 'hd1440'], 'the configured maximum returns for the next video');
});

test('incomplete quality lists and mismatched responses wait for a later event', () => {
    const h = harness();
    h.response = response('old', 60);
    h.id = 'new';
    h.listeners.loadedmetadata({ target: h.video });
    assert.deepEqual(h.calls, []);
    h.response = response('new', 60);
    const full = h.player.getAvailableQualityData;
    h.player.getAvailableQualityData = () => [{ quality: 'small', qualityLabel: '240p' }];
    h.listeners.loadedmetadata({ target: h.video });
    assert.deepEqual(h.calls, []);
    h.player.getAvailableQualityData = full;
    h.playing = 'hd2160';
    h.listeners.playing({ target: h.video });
    assert.deepEqual(h.calls, [['hd2160', 'hd2160']]);
});

test('a change requested while another is loading is applied afterwards, newest wish first', () => {
    const h = harness({ speed: 1 });
    h.load('a', 60, 'hd2160');
    h.speed = 2;
    h.controller.onSpeedChange();
    h.speed = 3;
    h.controller.onSpeedChange();
    assert.equal(h.calls.length, 1, 'no change while the first is still loading');
    h.wait(1000);
    h.controller.enforce();
    assert.equal(h.calls.length, 1);
    h.wait(3000);
    h.controller.enforce();
    assert.deepEqual(h.calls.at(-1), ['hd1080', 'hd1080'], 'only the latest speed is applied');
    assert.equal(h.calls.length, 2);
});

test('playing ends the settling period early, but not for a start event', () => {
    const h = harness({ speed: 1 });
    h.load('a', 60, 'hd2160');
    h.speed = 2;
    h.wait(500);
    h.listeners.playing({ type: 'playing', target: h.video });
    assert.equal(h.calls.length, 1, 'too early to be the end of the change');
    h.wait(1000);
    h.listeners.playing({ type: 'playing', target: h.video });
    assert.deepEqual(h.calls.at(-1), ['hd1440', 'hd1440']);
});

test('a choice made in the stock menu is forgotten when another video is opened', () => {
    const h = harness({ speed: 1 });
    h.load('a', 60, 'hd2160');
    h.wait();
    h.controller.checkUserChoice();
    h.preferred = 'hd720';
    h.controller.checkUserChoice();
    h.load('b', 60, 'hd1440');
    assert.deepEqual(h.calls.at(-1), ['hd2160', 'hd2160']);
    h.load('a', 60, 'hd720');
    assert.deepEqual(h.calls.at(-1), ['hd2160', 'hd2160'], 'the old choice must not return with the video');
});

test('the target is applied at the start of loading, before the first stream arrives', () => {
    const h = harness({ speed: 1 });
    h.wait();
    h.response = h.json.parse(JSON.stringify(response('a', 60)));
    h.id = 'a';
    h.playing = 'unknown';
    const full = h.player.getAvailableQualityData;
    h.player.getAvailableQualityData = () => [];
    h.listeners.play({ target: h.video });
    assert.deepEqual(h.calls, [], 'the format list is not ready yet');
    h.player.getAvailableQualityData = full;
    h.listeners.waiting({ target: h.video });
    assert.deepEqual(h.calls, [['hd2160', 'hd2160']]);
    h.playing = 'hd2160';
    h.listeners.loadedmetadata({ target: h.video });
    assert.equal(h.calls.length, 1);
});

test('a failed range call is retried instead of being recorded as applied', () => {
    const h = harness({ speed: 1 });
    const original = h.player.setPlaybackQualityRange;
    h.player.setPlaybackQualityRange = () => { throw Error('loader not ready'); };
    h.load('a', 60, 'hd1440');
    assert.deepEqual(h.calls, []);
    h.player.setPlaybackQualityRange = original;
    h.controller.enforce();
    assert.deepEqual(h.calls, [['hd2160', 'hd2160']]);
});
