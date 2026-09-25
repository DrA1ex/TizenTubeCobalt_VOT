export const COBALT_27_PACKAGE = 'dev.cobalt.coat';
export const TIZENTUBE_PACKAGE = 'io.gh.reisxd.tizentube.cobalt';
export const TIZENTUBE_VERSION_CODE = '208';
export const TIZENTUBE_VERSION_NAME = '2.0.8-cobalt27.3';

const EXTRA_PERMISSIONS = [
    'android.permission.REQUEST_INSTALL_PACKAGES',
    'android.permission.QUERY_ALL_PACKAGES',
    'android.permission.GET_TASKS',
];

export function prepareStartupManifest(manifest, namespace) {
    const splash = new RegExp(`(<meta-data ${namespace}:name="cobalt\\.ENABLE_SPLASH_SCREEN" `
        + `${namespace}:value=")true("\\s*/>)`, 'g');
    const features = new RegExp(`(<meta-data ${namespace}:name="cobalt\\.ENABLE_FEATURES" `
        + `${namespace}:value=")([^"]*)("\\s*/>)`, 'g');
    if ([...manifest.matchAll(splash)].length !== 1 || [...manifest.matchAll(features)].length !== 1) {
        throw Error('Unexpected Cobalt startup metadata');
    }

    // Cobalt appends ENABLE_FEATURES after ENABLE_SPLASH_SCREEN. Include the
    // disable flag there too so the later --enable-features cannot overwrite it.
    return manifest.replace(splash, (_, prefix, suffix) => prefix + 'false' + suffix)
        .replace(features, (_, prefix, value, suffix) => {
            const enabled = value.split(',').filter(flag => flag && flag !== 'EnablePerfettoSystemTracing');
            if (!enabled.includes('DisableSplashScreen')) enabled.push('DisableSplashScreen');
            return prefix + enabled.join(',') + suffix;
        });
}

export function prepareManifest(source) {
    const namespace = source.match(/xmlns:(\w+)="http:\/\/schemas\.android\.com\/apk\/res\/android"/)?.[1];
    const packageName = source.match(/\bpackage="([^"]+)"/)?.[1];
    if (!namespace || !packageName || !source.includes('</application>') || source.includes('YandexAuthActivity')) {
        throw Error('Unexpected manifest layout');
    }

    let manifest = source;
    let baseline;
    if (packageName === COBALT_27_PACKAGE) {
        baseline = 'official-cobalt-27';
        const versionCode = new RegExp(`${namespace}:versionCode="1"`);
        const versionName = new RegExp(`${namespace}:versionName="Developer Build"`);
        if (!versionCode.test(manifest) || !versionName.test(manifest)
            || !manifest.includes(`${namespace}:label="Cobalt Shell"`)) {
            throw Error('Unexpected official Cobalt identity');
        }
        manifest = manifest
            .replace(versionCode, `${namespace}:versionCode="${TIZENTUBE_VERSION_CODE}"`)
            .replace(versionName, `${namespace}:versionName="${TIZENTUBE_VERSION_NAME}"`)
            .replace(`package="${COBALT_27_PACKAGE}"`, `package="${TIZENTUBE_PACKAGE}"`)
            .replace(`${namespace}:label="Cobalt Shell"`, `${namespace}:label="TizenTube"`);
        manifest = prepareStartupManifest(manifest, namespace);
    } else if (packageName === TIZENTUBE_PACKAGE) {
        baseline = 'tizentube-cobalt';
    } else {
        throw Error(`Unsupported APK package: ${packageName}`);
    }

    const missingPermissions = EXTRA_PERMISSIONS.filter(permission =>
        !manifest.includes(`${namespace}:name="${permission}"`));
    if (missingPermissions.length) {
        const xml = missingPermissions
            .map(permission => `    <uses-permission ${namespace}:name="${permission}" />`)
            .join('\n');
        manifest = manifest.replace('    <application ', `${xml}\n    <application `);
    }

    manifest = manifest.replace('</application>',
        `<activity ${namespace}:name="io.gh.reisxd.tizentube.vot.YandexAuthActivity" `
        + `${namespace}:exported="false" ${namespace}:theme="@android:style/Theme.Material.NoActionBar" />`
        + '</application>');
    return { manifest, baseline };
}
