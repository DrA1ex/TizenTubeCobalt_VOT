import test from 'node:test';
import assert from 'node:assert/strict';
import { PreferredQualitySession } from '../third_party/TizenTube/mods/features/preferredQualitySession.js';

function fixture() {
    const state = { videoId: 'first', playing: true, available: [2160, 1440, 1080, 240],
        responseId: 'first', responseHeights: [2160, 1440, 1080, 240], calls: [] };
    const player = {
        getVideoData: () => ({ video_id: state.videoId }),
        getPlayerStateObject: () => ({ isPlaying: state.playing }),
        getVideoStats: () => ({}),
        getAvailableQualityData: () => state.available.map(height =>
            ({ quality: `hd${height}`, qualityLabel: `${height}p60` })),
        getPlayerResponse: () => ({ videoDetails: { videoId: state.responseId },
            streamingData: { adaptiveFormats: state.responseHeights.map(height =>
                ({ height, mimeType: 'video/webm; codecs="vp9"' })) } }),
        setPlaybackQualityRange: (min, max) => state.calls.push([min, max])
    };
    return { state, player, session: new PreferredQualitySession() };
}

test('a configured 2160p choice is written once despite transient IDs and incomplete lists', () => {
    const { state, player, session } = fixture();
    assert.equal(session.apply(player, '2160p'), true);
    state.videoId = undefined;
    state.available = [240];
    assert.equal(session.apply(player, '2160p'), false);
    state.videoId = 'first';
    assert.equal(session.apply(player, '2160p'), true);
    assert.deepEqual(state.calls, [['hd2160', 'hd2160']]);
});

test('an incomplete list cannot pin a new 4K video to 240p', () => {
    const { state, player, session } = fixture();
    state.available = [240];
    assert.equal(session.apply(player, '2160p'), false);
    state.available = [2160, 1440, 1080, 240];
    assert.equal(session.apply(player, '2160p'), true);
    assert.deepEqual(state.calls, [['hd2160', 'hd2160']]);
});

test('a lower resolution is selected only when the player response confirms the video limit', () => {
    const { state, player, session } = fixture();
    state.available = [1080, 720, 240];
    state.responseHeights = [1080, 720, 240];
    assert.equal(session.apply(player, '2160p'), true);
    assert.deepEqual(state.calls, [['hd1080', 'hd1080']]);
});

test('stale response metadata cannot cause a lower fallback', () => {
    const { state, player, session } = fixture();
    state.available = [240];
    state.responseId = 'previous';
    assert.equal(session.apply(player, '2160p'), false);
    assert.deepEqual(state.calls, []);
});

test('changing the setting to Auto releases the fixed range once', () => {
    const { state, player, session } = fixture();
    session.apply(player, '2160p');
    session.apply(player, 'auto', { configChanged: true });
    session.apply(player, 'auto', { configChanged: true });
    assert.deepEqual(state.calls, [['hd2160', 'hd2160'], ['auto', 'auto']]);
});

test('complete startup metadata applies quality before first playback without a later decoder restart', () => {
    const { state, player, session } = fixture();
    state.playing = false;
    assert.equal(session.apply(player, '2160p'), false);
    assert.equal(session.apply(player, '2160p', { starting: true }), true);
    state.playing = true;
    assert.equal(session.apply(player, '2160p'), true);
    assert.deepEqual(state.calls, [['hd2160', 'hd2160']]);
});
