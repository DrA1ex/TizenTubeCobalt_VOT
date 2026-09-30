import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { capVideoBufferBudget, GX1_MAX_VIDEO_BUFFER_MB } from '../tools/apk_performance.mjs';
import { AUDIO_TRANSLATIONS } from '../third_party/TizenTube/mods/features/audioTranslations.js';
import { isRussianAudioLocale } from '../third_party/TizenTube/mods/features/audioLocale.js';
import { languageName } from '../third_party/TizenTube/mods/features/audioTracks.js';
import { waitingIndicatorMessage } from '../third_party/TizenTube/mods/features/audioWaitingIndicator.js';

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
        requested: { provider: 'detect' } }), /detecting the original language/);
    assert.match(waitingIndicatorMessage({ videoId: 'v', status: 'preparing', sourceLanguage: '',
        requested: { provider: 'lively' } }), /will be detected automatically/);
    assert.match(waitingIndicatorMessage({ videoId: 'v', status: 'waiting',
        requested: { provider: 'youtube' } }), /YouTube: waiting for a track/);
    assert.match(waitingIndicatorMessage({ videoId: 'v', status: 'retrying',
        requested: { provider: 'standard' } }), /retrying the network request/);
    assert.equal(waitingIndicatorMessage({ videoId: 'v', status: 'playing',
        requested: { provider: 'standard' } }), null);
    const source = await readFile(new URL('../third_party/TizenTube/mods/features/audioWaitingIndicator.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\.animate\s*\(/);
});

test('audio strings use Russian only for Russian UI locales', () => {
    const previous = globalThis.window;
    try {
        for (const [locale, russian] of [['ru', true], ['ru-RU', true], ['ru_RU', true], ['en', false], ['fr-FR', false]]) {
            globalThis.window = { yt: { config_: { HL: locale } } };
            assert.equal(isRussianAudioLocale(), russian);
            assert.equal(languageName('ru'), russian ? 'Русский' : 'Russian');
            assert.equal(languageName('en'), russian ? 'Английский' : 'English');
            const message = waitingIndicatorMessage({ videoId: 'v', status: 'detecting', requested: { provider: 'detect' } });
            assert.match(message, russian ? /определяем язык оригинала/ : /detecting the original language/);
        }
    } finally { globalThis.window = previous; }
});

test('every GX1 audio translation key has English and Russian resources', async () => {
    const sources = ['resolveCommand.js'];
    for (const directory of ['features', 'ui']) {
        for (const file of await readdir(new URL('../third_party/TizenTube/mods/' + directory + '/', import.meta.url))) {
            if (file.endsWith('.js')) sources.push(directory + '/' + file);
        }
    }
    for (const source of sources) {
        const code = await readFile(new URL('../third_party/TizenTube/mods/' + source, import.meta.url), 'utf8');
        for (const [, key] of code.matchAll(/audioText\('([^']+)'\)/g)) {
            assert.ok(AUDIO_TRANSLATIONS[key]?.en, source + ': missing English ' + key);
            assert.ok(AUDIO_TRANSLATIONS[key]?.ru, source + ': missing Russian ' + key);
        }
    }
});
