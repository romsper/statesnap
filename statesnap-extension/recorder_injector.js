(function () {
    try {
        // Check sessionStorage flag from the page context (content scripts can read storage)
        const shouldRecord = sessionStorage.getItem('__STATESNAP_RECORDING') === 'true';
        if (!shouldRecord) return;

        // Inject recorder.js into the page so it runs in the page (MAIN) world
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('recorder.js');
        s.onload = () => s.remove();
        (document.documentElement || document.head || document.body || document).appendChild(s);
    } catch (e) {
        // swallow errors silently
        console.warn('recorder_injector error', e);
    }
})();
