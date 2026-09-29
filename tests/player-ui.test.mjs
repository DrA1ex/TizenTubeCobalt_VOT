import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { extractAssignedFunctions } from '../third_party/TizenTube/mods/utils/ASTParser.js';
import { audioText } from '../third_party/TizenTube/mods/features/audioLocale.js';
import { unifyPlayerAudioEntry } from '../third_party/TizenTube/mods/ui/playerAudioEntry.js';

async function moduleHarness(file, values, globals = {}) {
    const context = vm.createContext({ console, ...globals });
    const module = new vm.SourceTextModule(await readFile(
        new URL('../third_party/TizenTube/mods/' + file, import.meta.url), 'utf8'), { context });
    await module.link(name => {
        const exports = values[name];
        assert.ok(exports, 'Missing mock: ' + name);
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
        }, { context });
    });
    await module.evaluate();
    return module.namespace;
}
const buttonItem = (title, icon, commands) => ({ compactLinkRenderer: {
    title: { simpleText: title.title }, subtitle: { simpleText: title.subtitle },
    icon: { iconType: icon?.icon }, secondaryIcon: { iconType: icon?.secondaryIcon },
    serviceEndpoint: { commandExecutorCommand: { commands } }
} });

test('player patches install before the first video, parse once, and render adjacent speed/audio controls', async () => {
    const config = { enablePatchingVideoPlayer: true, enableSpeedControlsButton: true,
        audioUnifiedFlow: true, enableSuperThanksButton: true, enableAIAskButton: true, videoSpeed: 1 };
    let parses = 0;
    function Actions(props) {
        // TRANSPORT_CONTROLS_BUTTON_TYPE_FEATURED_ACTION
        this.props = props;
        this.settings = function () { return [{ type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS' }]; };
        this.engagement = function () { return this.props.data.engagementActions; };
    }
    const window = { _yttv: { Actions } };
    await moduleHarness('ui/customUI.js', {
        '../utils/ASTParser.js': { extractAssignedFunctions: code => { parses++; return extractAssignedFunctions(code); } },
        '../config.js': { configRead: key => config[key] },
        './ytUI.js': { ButtonRenderer: (disabled, label, icon, command) => ({ label, icon, command }) },
        '../features/audioLocale.js': { audioText }, 'i18next': { t: key => key }
    }, { window, document: { readyState: 'interactive', querySelector: () => null },
        setTimeout() { throw Error('must not wait for a video'); } });
    assert.equal(parses, 1);
    for (const speed of [1, 1.5, 1.75, 2]) {
        config.videoSpeed = speed;
        const inst = new window._yttv.Actions({ data: { engagementActions: [
            { type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_AUDIO_TRACK' }
        ] } });
        const buttons = inst.engagement();
        assert.deepEqual(Array.from(buttons, item => item.type), [
            'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED', 'TRANSPORT_CONTROLS_BUTTON_TYPE_AUDIO'
        ]);
        assert.ok(buttons[0].button.buttonRenderer.label.endsWith(speed + 'x'));
        assert.equal(buttons[1].button.buttonRenderer.command.customAction.action, 'TT_VOT_SETTINGS_SHOW');
    }
    assert.equal(parses, 1, 'opening more videos must not repeat the AST walk');
});

test('audio settings repaint their radio check immediately and preserve the selected row', async () => {
    const config = { audioPreferredProvider: 'standard' };
    const shown = [];
    const api = await moduleHarness('ui/settings.js', {
        '../features/audioLocale.js': { audioText }, '../config.js': { configRead: key => config[key] },
        './votSettings.js': { votSettings() {} },
        './audioMenuPaging.js': { audioMenuPage() { throw Error('short menu'); } },
        './ytUI.js': { showModal: (...args) => shown.push(args), buttonItem,
            overlayPanelItemListRenderer: (items, selectedIndex) => ({ items, selectedIndex }),
            scrollPaneRenderer() {}, overlayMessageRenderer() {}, QrCodeRenderer() {} },
        'qrcode-npm': { default: {} }, 'i18next': { t: key => key }, '../resolveCommand.js': { default() {} }
    });
    const parameters = { menuId: 'tt-audio-provider', options: [
        { name: 'Standard', key: 'audioPreferredProvider', value: 'standard' },
        { name: 'Expressive', key: 'audioPreferredProvider', value: 'lively' }
    ] };
    api.optionShow(parameters);
    const commands = shown.at(-1)[1].items[1].compactLinkRenderer.serviceEndpoint.commandExecutorCommand.commands;
    config.audioPreferredProvider = commands[0].setClientSettingEndpoint.settingDatas[0].stringValue;
    api.optionShow(commands[1].customAction.parameters, commands[1].customAction.parameters.update);
    const [header, content, id, update] = shown.at(-1);
    assert.equal(id, parameters.menuId);
    assert.equal(update, 'replace');
    assert.equal(content.selectedIndex, 1);
    assert.deepEqual(Array.from(content.items, item => item.compactLinkRenderer.secondaryIcon.iconType),
        ['RADIO_BUTTON_UNCHECKED', 'RADIO_BUTTON_CHECKED']);
});

async function commandsHarness() {
    const config = { videoSpeed: 1.75, audioUnifiedFlow: true, array: [] };
    const forwarded = [], written = [], actions = [];
    const window = { _yttv: { client: { instance: { resolveCommand: cmd => { forwarded.push(cmd); return true; } } } } };
    const api = await moduleHarness('resolveCommand.js', {
        './features/audioLocale.js': { audioText },
        './config.js': { configRead: key => config[key], configWrite: (key, value) => { config[key] = value; written.push(key); } },
        './features/pictureInPicture.js': { enablePip() {} },
        './ui/settings.js': { default() {}, optionShow: (...args) => actions.push(args) },
        './ui/speedUI.js': { speedSettings() {} },
        './ui/ytUI.js': { showToast() {}, buttonItem, showModal() {}, QrCodeRenderer() {}, overlayPanelItemListRenderer() {}, overlayMessageRenderer() {} },
        './features/updater.js': { default() {} }, 'i18next': { t: key => key },
        './utils/innerTubeCalls.js': { requestNextAndNavigateChannel() {} }, 'qrcode-npm': { default: {} },
        './ui/sidebarModification.js': { default() {} },
        './features/vot.js': { toggleVot() {}, setOAuthToken() {}, clearOAuthToken() {}, setWorkerHost() {}, showVotStatus() {} },
        './ui/audioMenu.js': { showAudioMenu() {}, audioMenuAction() {} },
        './ui/playerAudioEntry.js': { unifyPlayerAudioEntry },
        './features/playbackSpeed.js': { applyPlaybackSpeed() {} }
    }, { window });
    api.patchResolveCommand();
    return { config, forwarded, written, resolve: window._yttv.client.instance.resolveCommand };
}
test('a batch of custom settings is applied once and never sent to YouTube as native settings', async () => {
    const h = await commandsHarness();
    h.resolve({ setClientSettingEndpoint: { settingDatas: [
        { clientSettingEnum: { item: 'audioPreferredProvider' }, stringValue: 'lively' },
        { clientSettingEnum: { item: 'array' }, arrayValue: 'ru' }
    ] } });
    assert.deepEqual(h.written, ['audioPreferredProvider', 'array']);
    assert.equal(h.config.audioPreferredProvider, 'lively');
    assert.deepEqual(Array.from(h.config.array), ['ru']);
    assert.equal(h.forwarded.length, 0);
});
test('playback settings show the configured speed and remove the stock audio menu', async () => {
    const h = await commandsHarness();
    const list = { items: [
        { compactLinkRenderer: { icon: { iconType: 'SLOW_MOTION_VIDEO' }, subtitle: { simpleText: '1x' } } },
        { compactLinkRenderer: { icon: { iconType: 'AUDIO_TRACK' } } },
        { compactLinkRenderer: { title: { simpleText: 'Аудио' }, icon: { iconType: 'VOLUME_UP' } } }
    ] };
    h.resolve({ openPopupAction: { uniqueId: 'playback-settings', popup: {
        overlaySectionRenderer: { overlay: { overlayTwoPanelRenderer: {
            actionPanel: { overlayPanelRenderer: { content: { overlayPanelItemListRenderer: list } } }
        } } }
    } } });
    assert.equal(list.items[0].compactLinkRenderer.subtitle.simpleText, '1.75x');
    assert.equal(list.items.filter(item => ['AUDIO_TRACK', 'VOLUME_UP'].includes(item.compactLinkRenderer.icon?.iconType)).length, 0);
});

test('guide JSON hook preserves null, empty lists and new renderer types without adding an audio shortcut', async () => {
    const config = { sidebarContentsOrder: ['home'], disabledSidebarContents: [] };
    const context = vm.createContext({ console });
    const module = new vm.SourceTextModule(await readFile(new URL(
        '../third_party/TizenTube/mods/ui/customGuideAction.js', import.meta.url), 'utf8'), { context });
    const exports = {
        '../config.js': { configRead: key => config[key], configWrite: (key, value) => { config[key] = value; },
            configChangeEmitter: { addEventListener() {} } },
        './customCommandExecution.js': { default() {} }, './ytUI.js': { GuideEntryRenderer() {} }
    };
    await module.link(name => new vm.SyntheticModule(Object.keys(exports[name]), function () {
        for (const [key, value] of Object.entries(exports[name])) this.setExport(key, value);
    }, { context }));
    await module.evaluate();
    for (const input of ['null', 'false', '0', '[]', '{"items":[]}']) {
        assert.equal(vm.runInContext(`JSON.stringify(JSON.parse(${JSON.stringify(input)}))`, context), input);
    }
    const input = { items: [{ guideSectionRenderer: { items: [
        { guideEntryRenderer: { navigationEndpoint: { browseEndpoint: { browseId: 'home' } } } },
        { separatorRenderer: {} }
    ] } }, { otherRenderer: {} }] };
    context.input = JSON.stringify(input);
    const output = JSON.parse(vm.runInContext('JSON.stringify(JSON.parse(input))', context));
    assert.equal(output.items[0].guideSectionRenderer.items.length, 2);
    assert.ok(output.items[0].guideSectionRenderer.items[1].separatorRenderer);
});
