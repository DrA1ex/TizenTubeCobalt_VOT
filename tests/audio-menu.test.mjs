import test from 'node:test';
import { audioText } from '../third_party/TizenTube/mods/features/audioLocale.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { audioMenuPage } from '../third_party/TizenTube/mods/ui/audioMenuPaging.js';
import { unifyPlayerAudioEntry } from '../third_party/TizenTube/mods/ui/playerAudioEntry.js';
import * as tracks from '../third_party/TizenTube/mods/features/audioTracks.js';

test('every paged language/volume item is reachable with at most five rows', () => {
    for (const count of [6, 11, 17, 25]) {
        const items = Array.from({ length: count }, (_, i) => i), visited = [];
        for (let i = 0; i < Math.ceil(count / 3); i++) {
            const p = audioMenuPage(items, i * 3);
            visited.push(...p.items);
            assert.ok(p.items.length + Number(i > 0) + Number(i + 1 < p.pageCount) <= 5);
            assert.equal(p.selectedIndex, 0);
        }
        assert.deepEqual(visited, items);
    }
});
test('observed speaker-icon Audio and custom Audio entries collapse to one, idempotently', () => {
    const row = (name, icon = 'VOLUME_UP') => ({ compactLinkRenderer: { title: { simpleText: name }, icon: { iconType: icon } } });
    const replacement = row('Аудио и перевод');
    const source = [row('Субтитры', 'SUBTITLES'), row('Аудио и перевод'), row('Аудио'), row('Скорость воспроизведения')];
    const result = unifyPlayerAudioEntry(source, replacement);
    assert.deepEqual(result, [source[0], replacement, source[3]]);
    assert.deepEqual(unifyPlayerAudioEntry(result, replacement), result);
});

async function menuHarness() {
    const config = { audioPreferredProvider: 'lively', audioAutoStart: false, audioTargetLanguage: 'ru', audioVisibleLanguages: ['ru', 'en'], votTranslationVolume: '1', votOriginalVolume: '0.2' };
    let id = 'ted', last, selected;
    const state = { status: 'waiting', target: 'ru' };
    const ctx = vm.createContext({ console });
    const modules = {};
    const values = {
        '../config.js': { configRead: key => config[key], configWrite: (key, value) => { config[key] = value; } },
        '../features/audioLocale.js': { audioText },
        '../features/audioTracks.js': { ...tracks, audioInventory: () => ({ tracks: [], originalLanguage: '' }) },
        '../features/audioFlow.js': { audioFlow: {
            snapshot: () => state, select: async choice => { selected = choice; state.requested = choice; },
            cancelWaiting() {}, applyReady() {}, setTarget() {}
        }, rememberAudioLogin() {} },
        '../features/vot.js': { getCurrentVideoId: () => id, getVotState: () => ({ hasOAuthToken: false }),
            loginYandex() {}, setOAuthToken() {}, clearOAuthToken() {}, refreshVotAuthorization() {} },
        './ytUI.js': { showModal: (header, content, uniqueId, update) => { last = { header, items: content.items, uniqueId, update }; },
            buttonItem: (title, icon, commands) => ({ title, icon, commands }),
            overlayPanelItemListRenderer: items => ({ items }), showToast() {} },
        './settings.js': { optionShow: options => { last = options; } },
        './audioMenuPaging.js': { audioMenuPage }
    };
    const load = async name => {
        if (modules[name]) return modules[name];
        if (values[name]) {
            const value = values[name];
            return modules[name] = new vm.SyntheticModule(Object.keys(value), function () {
                for (const [key, item] of Object.entries(value)) this.setExport(key, item);
            }, { context: ctx });
        }
        const module = new vm.SourceTextModule(await readFile(new URL('../third_party/TizenTube/mods/ui/' + name.replace('./', ''), import.meta.url), 'utf8'), { context: ctx });
        modules[name] = module; await module.link(load); return module;
    };
    const main = await load('./audioMenu.js'); await main.evaluate();
    return { api: main.namespace, get last() { return last; }, get selected() { return selected; }, config, state,
        home: () => { id = null; }, preferences: modules['./votSettings.js'].namespace };
}
test('real audio menu sections are short; absent YouTube tracks are not offered as ready choices', async () => {
    const h = await menuHarness();
    for (const section of ['main', 'tracks', 'youtube', 'waiting', 'language', 'account']) {
        h.api.showAudioMenu(section);
        assert.ok(h.last.items.length <= 5, section);
    }
    h.api.showAudioMenu('youtube');
    assert.equal(h.last.items.length, 1);
    assert.equal(h.last.items[0].title.title, 'No other tracks');
    await h.api.audioMenuAction('AUDIO_CHOOSE', { provider: 'standard' });
    assert.equal(h.selected.provider, 'standard');
});
test('home menu contains preferences not unusable current-video choices', async () => {
    const h = await menuHarness(); h.home(); h.api.showAudioMenu();
    assert.equal(h.last.items.length, 0);
    assert.ok(h.last.items.every(item => !item.title.title.includes('this video')));
    const prefs = h.preferences.votSettings();
    assert.equal(prefs.options.length, 5);
    assert.ok(prefs.options.every(group => group.options.length <= 5));
    const automatic = prefs.options.find(group => group.menuId === 'tt-audio-automatic');
    assert.equal(automatic.options.length, 5);
    assert.ok(automatic.options.some(option => option.value === 'audioDetectUnknownLanguage'));
    assert.ok(automatic.options.some(option => option.value === 'audioAutoUnknownLanguage'));
    assert.ok(automatic.options.every(option => option.name.length <= 24));
    assert.ok(automatic.options.every(option => !option.subtitle || option.subtitle.length <= 40));
    const provider = prefs.options.find(group => group.menuId === 'tt-audio-audioPreferredProvider');
    assert.equal(provider.name, 'Translation provider');
    assert.equal(provider.options.length, 4);
    assert.equal(h.preferences.audioVolumeSettings().options.length, 2);
});

test('choosing Yandex immediately replaces the open menu and moves the check', async () => {
    const h = await menuHarness();
    await h.api.audioMenuAction('AUDIO_CHOOSE', { provider: 'standard' });
    assert.equal(h.last.uniqueId, 'tt-audio-tracks');
    assert.equal(h.last.update, 'replace');
    assert.ok(h.last.items.find(row => row.title.title.includes('standard')).title.title.startsWith('✓ '));
    await h.api.audioMenuAction('AUDIO_CHOOSE', { provider: 'lively' });
    assert.ok(!h.last.items.find(row => row.title.title.includes('standard')).title.title.startsWith('✓ '));
    assert.equal(h.last.items.filter(row => row.title.title.startsWith('✓ ')).length, 1);
});
test('quick menu offers session choice and only explicitly saving changes defaults', async () => {
    const h = await menuHarness();
    await h.api.audioMenuAction('AUDIO_CHOOSE', { provider: 'standard' });
    assert.equal(h.config.audioPreferredProvider, 'lively');
    h.api.showAudioMenu();
    assert.ok(!h.last.items.some(row => ['AUDIO_PREFERENCES', 'AUDIO_VOLUMES', 'AUDIO_LOGIN'].includes(row.commands[0].customAction.action)));
    await h.api.audioMenuAction('AUDIO_SAVE_DEFAULT');
    assert.equal(h.config.audioPreferredProvider, 'standard');
    assert.equal(h.config.audioTargetLanguage, 'ru');
    assert.equal(h.config.audioAutoStart, true);
});
test('native audio entries can be removed without inserting a second settings entry', () => {
    const original = [{ compactLinkRenderer: { icon: { iconType: 'AUDIO_TRACK' } } },
        { compactLinkRenderer: { title: { simpleText: 'Quality' } } }];
    assert.deepEqual(unifyPlayerAudioEntry(original), [original[1]]);
});
