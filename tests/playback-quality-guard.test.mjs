import test from 'node:test';
import assert from 'node:assert/strict';
import {
    playbackQualityCandidates, accelerationQualityLimit, guardPlaybackQuality, applyPreferredQuality,
    prepareNewVideoQuality
} from '../third_party/TizenTube/mods/features/playbackQualityGuard.js';
import { applyPlaybackSpeed, installPlaybackSpeed } from '../third_party/TizenTube/mods/features/playbackSpeed.js';
import { playbackFormats, lighterPlaybackFormats, currentPlaybackFormat } from '../third_party/TizenTube/mods/features/playbackFormats.js';

function fixture(fps = 60, preferred = 'auto') {
    const h = { calls: [], preferred, id: 'first', current: 'hd2160', buffer: 100, total: 100, dropped: 0 };
    h.available = [2160, 1440, 1080, 720].map(height => ({
        quality: `hd${height}`, qualityLabel: `${height}p${fps}`, isPlayable: true
    }));
    h.formats = h.available.map(item => {
        const height = Number.parseInt(item.qualityLabel, 10);
        return { itag: height, quality: item.quality, width: height * 16 / 9, height, fps, bitrate: height * 10000,
            mimeType: 'video/webm; codecs="vp9"' };
    });
    h.video = { playbackRate: 1, currentTime: 0, readyState: 4, paused: false, ended: false, seeking: false,
        buffered: { length: 1, start: () => 0, end: () => h.video.currentTime + h.buffer },
        getVideoPlaybackQuality: () => ({ totalVideoFrames: h.total, droppedVideoFrames: h.dropped }),
        ownerDocument: { defaultView: { MediaSource: { isTypeSupported: () => true } } } };
    h.player = {
        getVideoData: () => ({ video_id: h.id }),
        getPlayerResponse: () => ({ streamingData: { adaptiveFormats: h.formats } }),
        getAvailableQualityData: () => h.available,
        getPreferredQuality: () => h.preferred,
        getPlaybackQuality: () => h.current,
        getVideoStats: () => ({ fmt: h.formatId || h.formats.find(format => format.quality === h.current)?.itag }),
        getPlaybackRate: () => 1,
        setPlaybackRate: () => assert.fail('YouTube blanket HFR restriction must stay disabled'),
        setPlaybackQualityRange: (min, max, id) => {
            h.calls.push(id === undefined ? [min, max] : [min, max, id]); h.preferred = max;
        }
    };
    h.guard = (speed = 2, now = 0) => guardPlaybackQuality(h.player, h.video, speed, now);
    return h;
}

test('4K60 workload at 1.5, 1.75 and 2x selects 1440p; 5x needs 720p', () => {
    const h = fixture();
    const candidates = playbackQualityCandidates(h.available, h.formats);
    for (const speed of [1.5, 1.75, 2]) {
        assert.equal(accelerationQualityLimit(candidates, speed).quality, 'hd1440');
    }

    assert.equal(accelerationQualityLimit(candidates, 5).quality, 'hd720');
    for (const speed of [0.75, 1, 1.0001]) assert.equal(accelerationQualityLimit(candidates, speed), null);
});

function addLighter4K(h, fps = 30, bitrate = 10000000, itag = 313) {
    h.formats.push({ ...h.formats[0], fps, bitrate, itag });
}

test('4K30 is selected by exact format ID before a 4K60 acceleration can lower resolution', () => {
    const h = fixture();
    addLighter4K(h);
    h.guard();
    assert.deepEqual(h.calls, [['hd2160', 'hd2160', '313']]);
    h.formatId = '313';
    for (const now of [1000, 8000, 11000, 14000, 17000]) {
        h.video.currentTime = now / 1000 * 2;
        h.total += 180;
        h.guard(2, now);
    }

    assert.equal(h.calls.length, 1, 'confirmed healthy 4K30 must not fall back to the range-only 1440p budget');
    h.guard(1, 18000);
    assert.deepEqual(h.calls.at(-1), ['auto', 'auto']);
});

test('lower bitrate at the same FPS gets a playback trial, not a false claim of lower decoder pixel rate', () => {
    const h = fixture();
    addLighter4K(h, 60);
    h.guard(1.5);
    assert.deepEqual(h.calls, [['hd2160', 'hd2160', '313']]);
    h.formatId = '313';
    h.video.currentTime = 0.75;
    h.total += 30;
    h.guard(1.5, 500);
    for (const now of [1000, 1500, 2000]) h.guard(1.5, now);
    assert.deepEqual(h.calls.at(-1), ['hd1440', 'hd1440'], 'a confirmed but stalled lighter stream must fall back');
});

test('ignored format requests time out, try the next same-resolution alternative, then lower resolution', () => {
    const h = fixture();
    addLighter4K(h, 30, 10000000, 313);
    addLighter4K(h, 60, 15000000, 314);
    h.guard();
    h.guard(2, 12000);
    h.guard(2, 24000);
    assert.deepEqual(h.calls, [
        ['hd2160', 'hd2160', '313'], ['hd2160', 'hd2160', '314'], ['hd1440', 'hd1440']
    ]);
    h.current = 'hd1440';
    h.guard(2, 25000);
    assert.equal(h.calls.length, 3, 'failed variants cannot oscillate back on each tick');
});

test('unsupported codec and absent telemetry cannot be treated as successful same-resolution selection', () => {
    for (const cause of ['codec', 'telemetry']) {
        const h = fixture();
        addLighter4K(h);
        if (cause === 'codec') h.video.ownerDocument.defaultView.MediaSource.isTypeSupported = () => false;
        else delete h.player.getVideoStats;
        h.guard();
        assert.deepEqual(h.calls, [['tiny', 'hd1440']]);
    }
});

test('a format-selection exception tries the next variant before reducing resolution', () => {
    const h = fixture();
    addLighter4K(h, 30, 10000000, 313);
    addLighter4K(h, 60, 15000000, 314);
    const setQuality = h.player.setPlaybackQualityRange;
    h.player.setPlaybackQualityRange = (min, max, id) => {
        if (id === '313') throw Error('not selectable');
        setQuality(min, max, id);
    };
    h.guard();
    assert.deepEqual(h.calls, [['hd2160', 'hd2160', '314']]);
});

test('pinning a format cannot indefinitely disable ABR during network starvation', () => {
    const h = fixture();
    addLighter4K(h);
    h.guard();
    h.formatId = '313';
    h.video.currentTime = 1;
    h.guard(2, 500);
    h.video.currentTime = 2;
    h.guard(2, 1000);
    h.video.readyState = 2;
    h.buffer = 0;
    h.guard(2, 1500);
    h.guard(2, 3500);
    assert.deepEqual(h.calls.at(-1), ['hd1440', 'hd1440']);
});

test('pause does not expire a pending format trial', () => {
    const h = fixture();
    addLighter4K(h);
    h.guard();
    h.video.paused = true;
    h.guard(2, 30000);
    h.video.paused = false;
    h.guard(2, 31000);
    assert.equal(h.calls.length, 1);
});

test('return to 1x releases the exact-format preference and restores manual 4K', () => {
    const h = fixture(60, 'hd2160');
    addLighter4K(h);
    h.guard();
    h.guard(1, 1000);
    assert.deepEqual(h.calls, [['hd2160', 'hd2160', '313'], ['hd2160', 'hd2160']]);
});

test('configured quality applied after canplay preserves the pending same-resolution format', () => {
    const h = fixture();
    addLighter4K(h);
    h.guard();
    applyPreferredQuality(h.player, 'hd2160');
    assert.deepEqual(h.calls.at(-1), ['hd2160', 'hd2160', '313']);
    h.guard(1, 1000);
    assert.deepEqual(h.calls.at(-1), ['hd2160', 'hd2160']);
});

test('configured manual quality does not overwrite an active acceleration cap', () => {
    const h = fixture(60, 'hd2160');
    h.guard(2, 0);
    applyPreferredQuality(h.player, 'hd2160');
    assert.deepEqual(h.calls, [['tiny', 'hd1440']]);
    for (const now of [500, 1000, 1500, 2000]) h.guard(2, now);
    assert.deepEqual(h.calls.at(-1), ['hd1080', 'hd1080']);
});

test('new videos do not inherit the previous exact format ID', () => {
    const h = fixture();
    addLighter4K(h);
    h.guard();
    h.id = 'second';
    h.formats.pop();
    h.guard(2, 1000);
    assert.equal(h.calls.length, 1, 'the new video must not receive the old format ID');
});

test('navigation releases the previous quality cap before the next video starts', () => {
    const h = fixture(60, 'hd2160');
    h.guard(2, 0);
    assert.deepEqual(h.calls, [['tiny', 'hd1440']]);
    prepareNewVideoQuality(h.player, h.video, '#/watch?v=first');
    assert.equal(h.calls.length, 1, 'the current video must keep its cap');
    prepareNewVideoQuality(h.player, h.video, '#/watch?v=second');
    assert.deepEqual(h.calls.at(-1), ['hd2160', 'hd2160']);
    h.id = 'second';
    h.current = 'hd2160';
    h.guard(2, 1000);
    assert.equal(h.calls.length, 2, 'starting the next stream must not apply another range');
});

test('a lighter 4K stream already playing after restart is not downgraded by the old range budget', () => {
    const h = fixture(60, 'hd2160');
    addLighter4K(h);
    h.formatId = '313';
    h.video.ownerDocument.defaultView.localStorage = {
        getItem: () => JSON.stringify({ preferred: 'auto', cap: 'hd2160' }), removeItem() {}
    };
    h.guard();
    assert.deepEqual(h.calls, [['auto', 'auto']]);
});

test('format metadata retains xtags, ignores audio, and never substitutes a smaller frame as the same resolution', () => {
    const h = fixture();
    addLighter4K(h);
    h.formats.at(-1).xtags = 'variant=1';
    const formats = playbackFormats([...h.formats, { itag: 251, mimeType: 'audio/webm' }]);
    assert.equal(formats.length, h.formats.length);
    assert.deepEqual(lighterPlaybackFormats(formats, formats[0], new Set(), () => true).map(format => format.id),
        ['313;variant=1']);
    h.formatId = '313;variant=1';
    assert.equal(currentPlaybackFormat(h.player, formats).id, h.formatId);
});

test('a lower bitrate in another codec is not assumed to be easier to decode', () => {
    const h = fixture();
    addLighter4K(h);
    h.formats.at(-1).mimeType = 'video/mp4; codecs="av01.0.13M.08"';
    assert.deepEqual(lighterPlaybackFormats(playbackFormats(h.formats), playbackFormats(h.formats)[0],
        new Set(), () => true), []);
    h.guard(1.75);
    assert.deepEqual(h.calls, [['tiny', 'hd1440']]);
});

test('stats-for-nerds fallback verifies actual size and FPS, not optimal size or an ambiguous itag', () => {
    const h = fixture();
    delete h.player.getVideoStats;
    addLighter4K(h);
    h.player.getStatsForNerds = () => ({ codecs: 'vp09.00 (313) / opus (251)',
        resolution: '3840x2160@30 / 3840x2160@60' });
    assert.equal(currentPlaybackFormat(h.player, playbackFormats(h.formats)).id, '313');
    h.formats.push({ ...h.formats.at(-1), xtags: 'other' });
    assert.equal(currentPlaybackFormat(h.player, playbackFormats(h.formats)), null);
});

test('4K30 at 2x and 1080p60 at 2x retain their full resolution', () => {
    const h = fixture(30);
    assert.equal(accelerationQualityLimit(playbackQualityCandidates(h.available, h.formats), 2), null);
    const hfr = fixture();
    assert.equal(accelerationQualityLimit(playbackQualityCandidates(hfr.available.slice(2), hfr.formats), 2), null);
});

test('mixed FPS variants use the heaviest selectable format, regardless of label', () => {
    const h = fixture(30);
    h.formats.push({ ...h.formats[0], fps: 60 });
    assert.equal(accelerationQualityLimit(playbackQualityCandidates(h.available, h.formats), 2).quality, 'hd1440');
});

test('labels without format metadata are conservative; unavailable and paygated levels are excluded', () => {
    const h = fixture();
    h.available[0].isPlayable = false;
    h.available[1].paygatedQualityDetails = {};
    h.available[2].qualityLabel = '1080p';
    h.available.push({ quality: 'auto', qualityLabel: 'Auto' });
    const candidates = playbackQualityCandidates(h.available);
    assert.deepEqual(candidates.map(item => item.quality), ['hd720', 'hd1080']);
    assert.equal(candidates[1].pixelRate, 1920 * 1080 * 60);
});

test('Cobalt sets a temporary upper bound before accelerating, without locking out network ABR', () => {
    const h = fixture();
    const result = applyPlaybackSpeed(1.75, { ...h, cobalt: true });
    assert.equal(result.applied, true);
    assert.equal(h.video.playbackRate, 1.75);
    assert.deepEqual(h.calls, [['tiny', 'hd1440']]);
    for (let i = 0; i < 5; i++) applyPlaybackSpeed(1.75, { ...h, cobalt: true });
    assert.equal(h.calls.length, 1, 'canplay/ratechange must not repeatedly reset quality');
});

test('auto and manual 4K preferences are restored when acceleration ends', () => {
    for (const preferred of ['auto', 'hd2160']) {
        const h = fixture(60, preferred);
        h.guard(2);
        h.guard(1);
        h.guard(1);
        assert.deepEqual(h.calls, [['tiny', 'hd1440'], [preferred, preferred]]);
    }
});

test('YouTube sticky quality changes cannot turn a temporary cap into the preference after restart', () => {
    const data = new Map();
    const ownerDocument = { defaultView: { localStorage: {
        getItem: key => data.get(key), setItem: (key, value) => data.set(key, value),
        removeItem: key => data.delete(key)
    } } };
    const h = fixture(60, 'hd2160');
    h.video.ownerDocument = ownerDocument;
    h.guard();
    assert.equal(data.size, 1);
    const restarted = fixture(60, h.preferred);
    restarted.video.ownerDocument = ownerDocument;
    restarted.guard(1);
    assert.deepEqual(restarted.calls, [['hd2160', 'hd2160']]);
    assert.equal(data.size, 0);
});

test('a newer manual preference overrides a saved cap after restart', () => {
    const h = fixture(60, 'hd720');
    h.video.ownerDocument = { defaultView: { localStorage: {
        getItem: () => JSON.stringify({ preferred: 'hd2160', cap: 'hd1440' })
    } } };
    h.guard(1);
    h.guard(2);
    assert.deepEqual(h.calls, []);
});

test('manual low quality is preserved and is never upgraded by the guard', () => {
    const h = fixture(60, 'hd720');
    h.guard(2);
    h.guard(1);
    assert.deepEqual(h.calls, []);
});

test('manual changes during acceleration become the preference restored at 1x', () => {
    const h = fixture();
    h.guard();
    h.preferred = 'hd2160';
    h.guard(2, 1000);
    h.guard(1, 2000);
    assert.deepEqual(h.calls.at(-1), ['hd2160', 'hd2160']);
    const lower = fixture();
    lower.guard();
    lower.preferred = 'hd720';
    lower.guard(2, 1000);
    lower.guard(1, 2000);
    assert.deepEqual(lower.calls, [['tiny', 'hd1440'], ['hd720', 'hd720']]);
});

test('a new 30fps video on a reused element removes the previous HFR cap', () => {
    const h = fixture();
    h.guard();
    h.id = 'second';
    h.formats.forEach(format => { format.fps = 30; });
    h.guard(2, 1000);
    assert.deepEqual(h.calls, [['tiny', 'hd1440']], 'do not restart a new stream just to clear the old cap');
});

test('lowering acceleration recalculates the cap and replacement elements are handled', () => {
    const h = fixture();
    h.guard(5);
    h.video = { ...h.video };
    h.guard(1.5, 1000);
    assert.deepEqual(h.calls, [['tiny', 'hd720'], ['tiny', 'hd1440']]);
});

test('unavailable metadata is retried; failed quality writes do not count as applied', () => {
    const h = fixture();
    const available = h.available;
    h.available = [];
    h.guard();
    assert.equal(h.calls.length, 0);
    h.available = available;
    const setQuality = h.player.setPlaybackQualityRange;
    h.player.setPlaybackQualityRange = () => { throw Error('transition'); };
    h.guard();
    h.player.setPlaybackQualityRange = setQuality;
    h.guard();
    assert.deepEqual(h.calls, [['tiny', 'hd1440']]);
});

test('optional frame counters and storage may throw without disabling the workload limit', () => {
    const h = fixture();
    h.video.getVideoPlaybackQuality = () => { throw Error('unsupported'); };
    h.video.ownerDocument = { defaultView: { get localStorage() { throw Error('disabled'); } } };
    h.guard();
    assert.deepEqual(h.calls, [['tiny', 'hd1440']]);
});

test('sustained buffered stalls step down once, then allow time for the switch', () => {
    const h = fixture();
    h.guard();
    h.current = 'hd1440';
    h.video.currentTime = 1;
    h.total += 30;
    h.guard(2, 500);
    for (const now of [1000, 1500, 2000]) h.guard(2, now);
    assert.deepEqual(h.calls.at(-1), ['hd1080', 'hd1080']);
    for (const now of [2500, 3000]) h.guard(2, now);
    assert.equal(h.calls.length, 2);
    h.guard(1, 3500);
    assert.deepEqual(h.calls.at(-1), ['auto', 'auto']);
});

test('a stalled 4K stream steps below an ignored 1440p cap', () => {
    const h = fixture();
    h.guard(2, 0);
    for (const now of [500, 1000, 1500, 2000]) h.guard(2, now);
    assert.deepEqual(h.calls, [['tiny', 'hd1440'], ['hd1080', 'hd1080']]);
    h.guard(2, 2500);
    assert.equal(h.calls.length, 2, 'the switch still gets time to settle');
});

test('a new video retries maximum quality before limiting a sustained heavy stream', () => {
    const h = fixture();
    h.guard(2, 0);
    h.current = 'hd1440';
    h.video.currentTime = 1;
    h.total += 30;
    h.guard(2, 500);
    for (const now of [1000, 1500, 2000]) h.guard(2, now);
    assert.deepEqual(h.calls.at(-1), ['hd1080', 'hd1080']);

    h.id = 'second';
    h.current = 'hd2160';
    h.video.currentTime = 0;
    h.guard(2, 3000);
    applyPreferredQuality(h.player, 'hd2160');
    assert.equal(h.calls.length, 2, 'no quality write may restart the new 4K stream');
    for (const now of [3500, 4000]) {
        h.video.currentTime = (now - 3000) / 500;
        h.total += 30;
        h.guard(2, now);
    }
    assert.equal(h.calls.length, 2, 'the new video must get a short 4K trial');
    h.video.currentTime = 3;
    h.total += 30;
    h.guard(2, 4500);
    assert.deepEqual(h.calls.at(-1), ['tiny', 'hd1440']);
});

test('a 1440p start does not time out the trial before the actual 4K60 upgrade', () => {
    const h = fixture();
    h.guard(1.75, 0);
    h.id = 'second';
    h.current = 'hd2160'; // Requested quality can precede the decoder switch.
    h.formatId = '1440';
    h.player.getVideoStats = () => ({ fmt: h.formatId, optimal_format: '2160p60' });
    for (const now of [1000, 1500, 2000, 2500, 3000]) {
        h.video.currentTime = now / 1000 * 1.75;
        h.total += 30;
        h.guard(1.75, now);
    }
    assert.deepEqual(h.calls, [['tiny', 'hd1440']],
        'the recommended 4K quality must not be mistaken for the active format');
    h.formatId = '2160';
    for (const now of [3500, 4000, 4500, 5000]) {
        h.video.currentTime = now / 1000 * 1.75;
        h.total += 30;
        h.guard(1.75, now);
    }
    assert.deepEqual(h.calls.at(-1), ['tiny', 'hd1440'],
        'the active 4K60 stream must be capped even while its clock and frames advance');
    assert.equal(h.calls.length, 2);
});

test('a heavy current quality also ends the trial when exact format stats are unavailable', () => {
    const h = fixture();
    h.guard(1.75, 0);
    h.id = 'second';
    h.current = 'hd2160';
    delete h.player.getVideoStats;
    for (const now of [1000, 1500, 2000, 2500]) {
        h.video.currentTime = now / 1000 * 1.75;
        h.total += 30;
        h.guard(1.75, now);
    }
    assert.deepEqual(h.calls.at(-1), ['tiny', 'hd1440']);
    assert.equal(h.calls.length, 2);
});

test('raising speed after a new video starts ends its maximum-quality trial', () => {
    const h = fixture();
    h.guard(1, 0);
    h.id = 'second';
    h.guard(1, 500);
    assert.deepEqual(h.calls, []);
    h.guard(1.75, 1000);
    assert.deepEqual(h.calls, [['tiny', 'hd1440']]);
});

test('auto leaves empty-buffer recovery to ABR after reaching the cap', () => {
    const h = fixture();
    h.guard(2, 0);
    h.current = 'hd1440';
    h.video.currentTime = 1;
    h.total += 30;
    h.guard(2, 500);
    h.video.readyState = 2;
    h.buffer = 0;
    for (const now of [1000, 1500, 2500, 3500, 5000]) h.guard(2, now);
    assert.deepEqual(h.calls, [['tiny', 'hd1440']]);
});

test('a healthy accelerated clock at 30 presented fps does not count as a freeze', () => {
    const h = fixture();
    h.guard(2, 0);
    h.current = 'hd1440';
    for (const now of [500, 1000, 1500, 2000, 2500, 3000]) {
        h.video.currentTime = now / 500;
        h.total += 30;
        h.dropped += 15;
        h.guard(2, now);
    }
    assert.deepEqual(h.calls, [['tiny', 'hd1440']]);
});

test('an ignored cap with an empty buffer recovers before any progress sample', () => {
    const h = fixture();
    h.guard(2, 0);
    h.current = 'hd1440'; // The quality label can update before the video format does.
    h.formatId = '2160';
    h.video.readyState = 2;
    h.buffer = 0;
    for (const now of [500, 1000, 1500, 2000, 2500]) h.guard(2, now);
    assert.deepEqual(h.calls, [['tiny', 'hd1440'], ['hd1080', 'hd1080']]);

    const startup = fixture();
    startup.current = 'hd1440';
    startup.guard(2, 0);
    startup.video.readyState = 2;
    startup.buffer = 0;
    startup.guard(2, 500);
    startup.guard(2, 3000);
    assert.deepEqual(startup.calls, [],
        'a safe stream without progress may just be loading');
});

test('an ignored upper bound is pinned at the same resolution before stepping lower', () => {
    const h = fixture(60, 'hd2160');
    h.player.setPlaybackQualityRange = (min, max) => h.calls.push([min, max]);
    for (const now of [0, 500, 1000, 1500, 2000, 2500, 3000]) {
        h.video.currentTime = now / 500;
        h.total += 30;
        h.guard(2, now);
    }
    assert.deepEqual(h.calls, [['tiny', 'hd1440'], ['hd1440', 'hd1440']]);
});

test('frozen video with advancing audio clock also triggers buffered stall recovery', () => {
    const h = fixture();
    h.guard();
    h.current = 'hd1440';
    for (const now of [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500]) {
        h.video.currentTime = now / 1000 * 2;
        h.guard(2, now);
    }

    assert.deepEqual(h.calls.at(-1), ['hd1080', 'hd1080']);
});

test('delayed timer callbacks retain evidence of frozen frames while audio advances', () => {
    const h = fixture();
    h.guard(1, 0);
    h.video.currentTime = 3;
    h.guard(1, 3000);
    h.video.currentTime = 6;
    h.guard(1, 6000);
    assert.deepEqual(h.calls, [['hd1440', 'hd1440']]);
});

test('batched Cobalt frame counters do not lower quality while media time advances', () => {
    const h = fixture();
    for (const now of [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000]) {
        h.video.currentTime = now / 1000;
        if (now % 2500 === 0) h.total += 150;
        h.guard(1, now);
    }
    assert.deepEqual(h.calls, []);
});

test('a normal-speed stream also steps down after a 1.5 second buffered freeze', () => {
    const h = fixture();
    h.guard(1, 0);
    h.video.currentTime = 0.5;
    h.total += 30;
    h.guard(1, 500);
    for (const now of [1000, 1500, 2000]) h.guard(1, now);
    assert.deepEqual(h.calls, [['hd1440', 'hd1440']]);
    h.guard(1, 2500);
    assert.equal(h.calls.length, 1, 'the recovery cap must persist at 1x');
});

test('normal-speed recovery verifies a lighter same-resolution format before stepping down', () => {
    const h = fixture();
    addLighter4K(h);
    h.guard(1, 0);
    for (const now of [500, 1000, 1500, 2000]) h.guard(1, now);
    assert.deepEqual(h.calls, [['hd2160', 'hd2160', '313']]);
    h.guard(1, 2500);
    assert.equal(h.calls.length, 1, 'a pending format trial must not be undone at normal speed');
    h.guard(1, 6000);
    assert.deepEqual(h.calls.at(-1), ['hd1440', 'hd1440']);
});

test('a brief playback hiccup and a suspended timer do not lower quality', () => {
    const h = fixture();
    h.guard(1, 0);
    h.video.currentTime = 0.5;
    h.total += 30;
    h.guard(1, 500);
    h.guard(1, 1000);
    h.video.currentTime = 1;
    h.total += 30;
    h.guard(1, 1500);
    h.guard(1, 10000);
    assert.deepEqual(h.calls, []);
});

test('a failed stall recovery write is retried on the next check', () => {
    const h = fixture();
    h.guard(1, 0);
    const setQuality = h.player.setPlaybackQualityRange;
    h.player.setPlaybackQualityRange = () => { throw Error('player transition'); };
    for (const now of [500, 1000, 1500]) h.guard(1, now);
    h.player.setPlaybackQualityRange = setQuality;
    h.guard(1, 2000);
    assert.deepEqual(h.calls, [['hd1440', 'hd1440']]);
});

test('expected frame dropping at 120 source fps on a 60Hz screen is healthy', () => {
    const h = fixture();
    h.guard();
    h.current = 'hd1440';
    for (const now of [8000, 11000, 14000, 17000, 20000]) {
        h.video.currentTime = now / 1000 * 2;
        h.total = now / 1000 * 120;
        h.dropped = now / 1000 * 60;
        h.guard(2, now);
    }

    assert.equal(h.calls.length, 1);
});

test('pauses, seeks, empty buffers and suspended timers do not cause recovery downgrades', () => {
    for (const condition of ['paused', 'ended', 'seeking', 'network', 'suspended']) {
        const h = fixture();
        h.guard();
        h.current = 'hd1440';
        if (condition === 'network') h.buffer = 0;
        else if (condition !== 'suspended') h.video[condition] = true;
        for (const now of [8000, 18000, 28000]) h.guard(2, now);
        assert.equal(h.calls.length, 1, condition);
    }
});

test('non-Cobalt playback uses the player API and does not impose a GX1 budget', () => {
    const h = fixture();
    h.player.setPlaybackRate = rate => { h.video.playbackRate = rate; };
    applyPlaybackSpeed(2, { ...h, cobalt: false });
    assert.equal(h.video.playbackRate, 2);
    assert.deepEqual(h.calls, []);
});

test('timer recovers without media events, retries restoration, and can be disposed', () => {
    const h = fixture();
    const listeners = new Map();
    let tick, speed = 2, cleared = false;
    const doc = {
        defaultView: { __votBridgeKey: 'test', setInterval: fn => { tick = fn; return 7; },
            clearInterval: id => { assert.equal(id, 7); cleared = true; } },
        querySelector: selector => selector === 'video' ? h.video : h.player,
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: type => listeners.delete(type)
    };
    const dispose = installPlaybackSpeed(doc, () => speed);
    assert.deepEqual(h.calls, [['tiny', 'hd1440']]);
    speed = 1;
    const setQuality = h.player.setPlaybackQualityRange;
    h.player.setPlaybackQualityRange = () => { throw Error('transition'); };
    tick();
    h.player.setPlaybackQualityRange = setQuality;
    tick();
    assert.deepEqual(h.calls.at(-1), ['auto', 'auto']);
    dispose();
    assert.equal(listeners.size, 0);
    assert.equal(cleared, true);
});
