// StateSnap background service worker.
// Recording itself is driven by the MAIN-world recorder content script, which
// activates from a per-origin sessionStorage flag. That flag does not survive
// cross-origin navigation, so the background worker tracks which tabs are in a
// recording session and re-seeds the flag (and best-effort re-injects the
// recorder) whenever such a tab navigates.

const REC_KEY = 'statesnap:recordingTabs';

async function getRecordingTabs() {
    try {
        const r = await chrome.storage.session.get(REC_KEY);
        return new Set(r[REC_KEY] || []);
    } catch (e) {
        return new Set();
    }
}

async function setRecordingTabs(set) {
    try {
        await chrome.storage.session.set({ [REC_KEY]: Array.from(set) });
    } catch (e) { /* ignore */ }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'statesnap:startRecording' && msg.tabId != null) {
        getRecordingTabs()
            .then(set => { set.add(msg.tabId); return setRecordingTabs(set); })
            .then(() => sendResponse({ ok: true }))
            .catch(() => sendResponse({ ok: false }));
        return true; // keep the message channel open for the async response
    }

    if (msg.type === 'statesnap:stopRecording' && msg.tabId != null) {
        getRecordingTabs()
            .then(set => { set.delete(msg.tabId); return setRecordingTabs(set); })
            .then(() => sendResponse({ ok: true }))
            .catch(() => sendResponse({ ok: false }));
        return true;
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    getRecordingTabs().then(set => {
        if (set.delete(tabId)) return setRecordingTabs(set);
    });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'loading') return;

    const url = tab && tab.url ? String(tab.url) : '';
    if (!/^https?:\/\//i.test(url)) return; // cannot script chrome:// etc.

    const set = await getRecordingTabs();
    if (!set.has(tabId)) return;

    try {
        // Re-seed the recording flag so same-origin reloads after this point are
        // fully covered by the document_start content script.
        await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => { try { sessionStorage.setItem('__STATESNAP_RECORDING', 'true'); } catch (e) {} }
        });

        // Best-effort fallback inject for the current (possibly cross-origin)
        // load, whose document_start run may have missed the flag. The recorder
        // guards against double-install, so this is a no-op when already active.
        await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            files: ['recorder.js']
        });
    } catch (e) {
        // Some pages (CSP, privileged URLs) forbid injection — nothing to do.
    }
});
