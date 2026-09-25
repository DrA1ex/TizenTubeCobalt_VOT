(function () {
    if (location.origin !== 'https://www.youtube.com' || !document.body
        || window.__tizenTubeVotEmbeddedLoaded || window.__tizenTubeVotInjectionPending) return;

    // Ask Android to inject the bundle only when this document needs it.
    // XHR is available before the userscript installs its fetch polyfill.
    window.__tizenTubeVotInjectionPending = true;
    var finished = function () { window.__tizenTubeVotInjectionPending = false; };
    // This command only queues local injection; it performs no network request.
    // Prefer it at startup to avoid an HTTP round trip and CORS preflight.
    try {
        if (window.votNative && typeof window.votNative.command === 'function') {
            var result = JSON.parse(String(window.votNative.command('{"action":"inject"}')));
            if (result && result.ok) {
                setTimeout(finished, 3000);
                return;
            }
        }
    } catch (_) {}

    var request = new XMLHttpRequest();
    try {
        request.open('POST', 'http://127.0.0.1:8013/command', true);
        request.setRequestHeader('Content-Type', 'application/json');
        request.setRequestHeader('X-VOT-Key', "__VOT_BRIDGE_KEY__");
        request.timeout = 3000;
        request.onloadend = finished;
        request.send('{"action":"inject"}');
    } catch (_) {
        finished();
    }
})();
