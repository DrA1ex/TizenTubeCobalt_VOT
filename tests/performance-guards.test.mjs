import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { determineQuality } from '../third_party/TizenTube/mods/features/preferredQualityPolicy.js';
import { capVideoBufferBudget, GX1_MAX_VIDEO_BUFFER_MB } from '../tools/apk_performance.mjs';
import { waitingIndicatorMessage } from '../third_party/TizenTube/mods/features/audioWaitingIndicator.js';

const qualities = [
    { qualityLabel: '2160p60 HDR', quality: 'hd2160' },
    { qualityLabel: '1440p60', quality: 'hd1440' },
    { qualityLabel: '1080p60', quality: 'hd1080' },
    { qualityLabel: '720p', quality: 'hd720' },
];

test('preferred quality selects an exact resolution regardless of FPS suffix', () => {
    assert.equal(determineQuality('2160p', qualities), 'hd2160');
});

test('missing preferred quality falls down instead of forcing highres', () => {
    assert.equal(determineQuality('1800p', qualities), 'hd1440');
    assert.equal(determineQuality('480p', qualities), 'hd720');
    assert.equal(determineQuality('2160p', []), null);
});

test('GX1 APK caps Cobalt encoded-video memory budget', () => {
    const input = '<resources><integer name="max_video_buffer_budget">0</integer></resources>';
    assert.equal(capVideoBufferBudget(input),
        `<resources><integer name="max_video_buffer_budget">${GX1_MAX_VIDEO_BUFFER_MB}</integer></resources>`);
    assert.throws(() => capVideoBufferBudget(input, 16), /between 32 and 200/);
    assert.throws(() => capVideoBufferBudget('<resources/>'), /resource layout/);
});

test('GX1 defaults to the hardware VP9 path with the key used by the filter', async () => {
    const source = await readFile(new URL('../third_party/TizenTube/mods/config.js', import.meta.url), 'utf8');
    assert.match(source, /preferredVideoCodec:\s*'vp9'/);
    assert.doesNotMatch(source, /videoPreferredCodec:/);
});

test('waiting badge covers automatic Yandex and YouTube waits without animation', async () => {
    assert.match(waitingIndicatorMessage({ videoId: 'v', status: 'detecting',
        requested: { provider: 'detect' } }), /определяем язык оригинала/);
    assert.match(waitingIndicatorMessage({ videoId: 'v', status: 'preparing', sourceLanguage: '',
        requested: { provider: 'lively' } }), /определится автоматически/);
    assert.match(waitingIndicatorMessage({ videoId: 'v', status: 'waiting',
        requested: { provider: 'youtube' } }), /YouTube: ждём дорожку/);
    assert.match(waitingIndicatorMessage({ videoId: 'v', status: 'retrying',
        requested: { provider: 'standard' } }), /повторяем сетевой запрос/);
    assert.equal(waitingIndicatorMessage({ videoId: 'v', status: 'playing',
        requested: { provider: 'standard' } }), null);
    const source = await readFile(new URL('../third_party/TizenTube/mods/features/audioWaitingIndicator.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\.animate\s*\(/);
});
