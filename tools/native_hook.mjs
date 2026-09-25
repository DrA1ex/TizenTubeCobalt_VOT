export const BRIDGE_ANCHOR = '    invoke-static {v0}, Ldev/cobalt/coat/CobaltActivity;->-$$Nest$minitializeJavaBridge(Ldev/cobalt/coat/CobaltActivity;)V';
export const VOT_HOOK = '    invoke-static {v0}, Lio/gh/reisxd/tizentube/vot/VotBridge;->installReady(Ldev/cobalt/coat/CobaltActivity;)V';

export function insertNativeHook(source) {
    if (source.split(BRIDGE_ANCHOR).length !== 2 || source.includes('VotBridge;'))
        throw Error('Unexpected WebContents hook layout');
    // A replacement STRING interprets $$ as $. A callback preserves D8 synthetic method names.
    return source.replace(BRIDGE_ANCHOR, () => VOT_HOOK + '\n\n' + BRIDGE_ANCHOR);
}

export function verifyStartupLinks(activity, callback, bridge) {
    const definitions = source => new Set([...source.matchAll(/^\.method\s+.*?([^\s]+\([^\s]+)$/gm)].map(match => match[1]));
    const known = new Map([
        ['Ldev/cobalt/coat/CobaltActivity;', definitions(activity)],
        ['Lio/gh/reisxd/tizentube/vot/VotBridge;', definitions(bridge)]
    ]);
    for (const match of callback.matchAll(/invoke-static(?:\/range)?\s+\{[^}]*\},\s*(L[^\s]+;)->([^\s]+)/g)) {
        if (known.has(match[1]) && !known.get(match[1]).has(match[2]))
            throw Error('Unresolved startup method: ' + match[1] + '->' + match[2]);
    }
    const init = BRIDGE_ANCHOR.trim();
    if (!callback.includes(init) || !callback.includes(VOT_HOOK.trim())
        || callback.indexOf(VOT_HOOK.trim()) > callback.indexOf(init))
        throw Error('Missing or misordered startup hooks');
}
