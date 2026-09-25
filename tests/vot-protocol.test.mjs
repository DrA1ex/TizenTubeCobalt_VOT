import test from 'node:test';
import assert from 'node:assert/strict';
import VOTClient from '../third_party/TizenTube/mods/node_modules/@vot.js/ext/dist/client.js';
import { VOTWorkerProvider } from '../third_party/TizenTube/mods/node_modules/@vot.js/core/dist/providers/votworker.js';
import { VideoTranslationRequest, VideoTranslationResponse, YandexSessionResponse } from '../third_party/TizenTube/mods/node_modules/@vot.js/shared/dist/protos/yandex.js';
import { probeVotLanguage } from '../third_party/TizenTube/mods/features/votLanguageProbe.js';

for (const lively of [true, false]) {
    test('real vot.js protobuf and headers: ' + (lively ? 'lively direct' : 'standard worker'), async () => {
        const seen = [];
        const client = new VOTClient({
            provider: lively ? undefined : VOTWorkerProvider,
            host: lively ? 'api.browser.yandex.ru' : 'vot-worker.eu.cc',
            apiToken: lively ? 'native-stored-token' : undefined,
            fetchFn: async (url, options) => {
                const payload = lively ? new Uint8Array(await options.body.arrayBuffer())
                    : Uint8Array.from(JSON.parse(options.body).body);
                const headers = lively ? options.headers : JSON.parse(options.body).headers;
                seen.push({ url, headers, payload });
                const bytes = url.endsWith('/session/create')
                    ? YandexSessionResponse.encode({ secretKey: 'fake-session-key', expires: 600 }).finish()
                    : VideoTranslationResponse.encode(VideoTranslationResponse.fromPartial({ status: 1,
                        url: 'https://vtrans.s3-private.mds.yandex.net/tts/prod/mock.mp3' })).finish();
                return { status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
            }
        });
        const result = await client.translateVideo({ videoData: { url: 'https://youtu.be/example', duration: 843, videoId: 'example' },
            requestLang: 'en', responseLang: 'ru', extraOpts: { useLivelyVoice: lively } });
        assert.equal(result.translated, true);
        assert.equal(seen.length, 2);
        assert.equal(VideoTranslationRequest.decode(seen[1].payload).useLivelyVoice, lively);
        assert.equal(VideoTranslationRequest.decode(seen[1].payload).responseLanguage, 'ru');
        assert.equal(seen[0].headers.Authorization, undefined);
        assert.equal(seen[1].headers.Authorization, lively ? 'OAuth native-stored-token' : undefined);
        assert.match(seen[1].headers['Vtrans-Signature'], /^[a-f0-9]{64}$/);
    });
}

test('language probe accepts a corrected language from the real protobuf response', async () => {
    const requests = [];
    const client = new VOTClient({ provider: VOTWorkerProvider, host: 'vot-worker.eu.cc',
        fetchFn: async (url, options) => {
            const envelope = JSON.parse(options.body);
            requests.push(Uint8Array.from(envelope.body));
            const bytes = url.endsWith('/session/create')
                ? YandexSessionResponse.encode({ secretKey: 'fake-session-key', expires: 600 }).finish()
                : VideoTranslationResponse.encode(VideoTranslationResponse.fromPartial({ status: 0, language: 'ru' })).finish();
            return { status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
        } });
    const language = await probeVotLanguage(client,
        { url: 'https://youtu.be/russian', duration: 600, videoId: 'russian' }, 'ru');
    assert.equal(language, 'ru');
    const probe = VideoTranslationRequest.decode(requests[1]);
    assert.equal(probe.language, 'en');
    assert.equal(probe.responseLanguage, 'ru');
    assert.equal(probe.forceSourceLang, false);
    assert.equal(probe.useLivelyVoice, false);
});

test('language probe treats an uncorrected hint as the detected language', async () => {
    const client = new VOTClient({ provider: VOTWorkerProvider, host: 'vot-worker.eu.cc',
        fetchFn: async (url, options) => {
            const bytes = url.endsWith('/session/create')
                ? YandexSessionResponse.encode({ secretKey: 'fake-session-key', expires: 600 }).finish()
                : VideoTranslationResponse.encode(VideoTranslationResponse.fromPartial({ status: 2 })).finish();
            return { status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
        } });
    assert.equal(await probeVotLanguage(client,
        { url: 'https://youtu.be/english', duration: 600, videoId: 'english' }, 'ru'), 'en');
});
