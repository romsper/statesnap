const API_URL = "http://localhost:8080";

function setStatus(msg) {
    document.getElementById('status').innerText = msg;
}

// === RECORDING LOGIC ===

const btnStart = document.getElementById('btnStart');
const includeDomCheckbox = document.getElementById('includeDom');
const applyDomCheckbox = document.getElementById('applyDom');
const snapshotNameInput = document.getElementById('snapshotName');
// Save options
const saveCookiesCheckbox = document.getElementById('saveCookies');
const saveLocalStorageCheckbox = document.getElementById('saveLocalStorage');
const saveSessionStorageCheckbox = document.getElementById('saveSessionStorage');
const saveNetworkCheckbox = document.getElementById('saveNetwork');
// Apply (load) options
const applyCookiesCheckbox = document.getElementById('applyCookies');
const applyLocalStorageCheckbox = document.getElementById('applyLocalStorage');
const applySessionStorageCheckbox = document.getElementById('applySessionStorage');
const applyNetworkCheckbox = document.getElementById('applyNetwork');

async function updateInitializeButtonLabel() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
        const url = tab && tab.url ? String(tab.url) : '';
        if (/^chrome:\/\//i.test(url)) {
            // Cannot execute scripts in chrome:// pages
            btnStart.innerText = 'Initialize recording';
            return;
        }
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => sessionStorage.getItem('__STATESNAP_RECORDING') === 'true'
        });
        btnStart.innerText = result ? 'Already initialized' : 'Initialize recording';
    } catch (e) {
        console.warn('[StateSnap] updateInitializeButtonLabel: cannot access tab for scripting', e);
        btnStart.innerText = 'Initialize recording';
    }
}

updateInitializeButtonLabel().catch(() => {});

btnStart.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    try {
        const url = tab && tab.url ? String(tab.url) : '';
        if (/^chrome:\/\//i.test(url)) {
            setStatus('Cannot initialize recording on chrome:// pages');
            return;
        }

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => {
                sessionStorage.setItem('__STATESNAP_RECORDING', 'true');
                window.location.reload();
            }
        });

        setStatus("Reloading and initializing recording...");
    } catch (e) {
        console.warn('[StateSnap] btnStart: scripting error', e);
        setStatus('Error initializing recording: ' + (e && e.message ? e.message : String(e)));
    }
});

document.getElementById('btnSave').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabUrl = tab && tab.url ? String(tab.url) : '';
    if (/^chrome:\/\//i.test(tabUrl)) {
        setStatus('Cannot save from chrome:// pages');
        return;
    }

    // 1. Collect data from the page context (LocalStorage, Logs)
    const wantDom = includeDomCheckbox?.checked ?? false;
    const wantLS = saveLocalStorageCheckbox?.checked ?? false;
    const wantSS = saveSessionStorageCheckbox?.checked ?? false;
    const wantNetwork = saveNetworkCheckbox?.checked ?? false;

    const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: 'MAIN', // Important! Access to the page's window(s)
        args: [wantDom, wantLS, wantSS, wantNetwork],
        func: (withDom, wantLSArg, wantSSArg, wantNetworkArg) => {
            try {
                return {
                    ls: wantLSArg ? JSON.parse(JSON.stringify(localStorage)) : {},
                    ss: wantSSArg ? JSON.parse(JSON.stringify(sessionStorage)) : {},
                    logs: wantNetworkArg ? (window._networkLogs || []) : [],
                    html: withDom ? document.documentElement.outerHTML : null
                };
            } catch (e) {
                return { ls: {}, ss: {}, logs: [], html: null, error: String(e) };
            }
        }
    });

    // injectionResults contains one entry per frame; merge logs from all frames
    const frameResults = (injectionResults || []).map(r => r && r.result).filter(Boolean);
    const firstFrame = frameResults.find(f => f) || { ls: {}, ss: {}, logs: [], html: null };
    const mergedLogs = ([]).concat(...frameResults.map(f => Array.isArray(f.logs) ? f.logs : [])).filter(Boolean);

    // Deduplicate mergedLogs (simple key based on method+url+body+status)
    const dedupeMap = new Map();
    for (const l of mergedLogs) {
        try {
            const key = `${l && l.method||''}|${l && l.url||''}|${l && l.requestBody||''}|${String(l && l.status||'')}`;
            const existing = dedupeMap.get(key);
            // prefer the entry with later timestamp (if available)
            if (!existing || (l && l.ts && existing.ts && l.ts > existing.ts)) {
                dedupeMap.set(key, l);
            }
        } catch (_) { /* ignore */ }
    }
    const dedupedLogs = Array.from(dedupeMap.values());

    const pageData = {
        ls: firstFrame.ls || {},
        ss: firstFrame.ss || {},
        logs: dedupedLogs,
        html: firstFrame.html || null
    };

    // 2. Collect cookies (via Extension API, since JS can't see HttpOnly)
    let cookies = [];
    if (saveCookiesCheckbox?.checked) {
        try {
            const tabUrl = tab && tab.url ? String(tab.url) : '';
            if (/^https?:\/\//i.test(tabUrl)) {
                cookies = await chrome.cookies.getAll({ url: tabUrl });
            } else {
                console.warn('[StateSnap] Skipping cookies: tab URL not http(s):', tabUrl);
                cookies = [];
            }
        } catch (e) {
            console.warn('[StateSnap] Error getting cookies for tab:', e);
            cookies = [];
        }
    } else {
        cookies = [];
    }

    const snapshot = {
        timestamp: Date.now(),
        url: tab.url,
        description: snapshotNameInput?.value?.trim() || undefined,
        cookies: cookies,
        localStorage: pageData.ls,
        sessionStorage: pageData.ss,
        networkLogs: (pageData.logs || []).map((l) => {
            try {
                return {
                    method: l && l.method ? String(l.method) : null,
                    url: l && l.url ? String(l.url) : null,
                    requestBody: l && l.requestBody != null ? String(l.requestBody) : null,
                    status: (l && typeof l.status === 'number') ? l.status : null,
                    // cap response body to 200k chars to avoid huge payloads
                    responseBody: (l && l.responseBody != null) ? String(l.responseBody).slice(0, 200 * 1024) : null
                };
            } catch (e) {
                return { method: null, url: null, requestBody: null, status: null, responseBody: null };
            }
        }),
        html: pageData.html
    };

    setStatus("Sending data to server...");

    try {
        const response = await fetch(`${API_URL}/snapshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot)
        });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`HTTP ${response.status} ${response.statusText || ""} ${text}`.trim());
        }

        const resData = await response.json().catch(() => {
            throw new Error("Invalid JSON from server");
        });

        const id = resData.id || resData._id || "<no-id>";
        setStatus(`Saved! ID: ${id}`);
        if (navigator.clipboard && id && id !== "<no-id>") {
            navigator.clipboard.writeText(id).catch(() => {});
        }
    } catch (e) {
        setStatus("Server error: " + e.message);
    }
});

// Quick test: trigger a fetch in the page and check whether recorder captured it
const btnTest = document.getElementById('btnTest');
if (btnTest) {
    btnTest.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabUrl = tab && tab.url ? String(tab.url) : '';
        if (/^chrome:\/\//i.test(tabUrl)) {
            setStatus('Cannot run test capture on chrome:// pages');
            return;
        }
        setStatus('Running capture test...');
        try {
            const res = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                world: 'MAIN',
                func: async () => {
                    try {
                        // Use page origin to avoid CSP "connect-src" blocks.
                        const testUrl = (location && location.origin) ? (location.origin + '/?statesnap=1') : 'about:blank';
                        // perform a fetch from the page context
                        await fetch(testUrl, { cache: 'no-store' }).catch(() => {});
                        // give recorder a short time to push the log
                        await new Promise(r => setTimeout(r, 300));
                        // When run with allFrames, the results will be an array per frame; collect and merge
                        const frames = (typeof __TAURI__ === 'undefined') ? (window._frame_results ? window._frame_results : null) : null;
                        // But since this function runs in each frame separately, just return local logs info; popup will aggregate
                        return {
                            logsLength: window._networkLogs ? window._networkLogs.length : null,
                            lastLog: (window._networkLogs && window._networkLogs.length) ? window._networkLogs[window._networkLogs.length - 1] : null
                        };
                    } catch (e) {
                        return { error: String(e) };
                    }
                }
            });
            // res is an array of frame results; merge
            const results = (res || []).map(r => r && r.result).filter(Boolean);
            const totalLength = results.reduce((s, r) => s + (r.logsLength || 0), 0);
            const lastLog = results.map(r => r.lastLog).filter(Boolean).pop() || null;
            const result = { logsLength: totalLength, lastLog };
            if (!result) {
                setStatus('Test failed: no result');
                return;
            }
            if (result.error) {
                setStatus('Test error: ' + result.error);
                return;
            }

            setStatus(`Test completed: logsLength=${result.logsLength}`);
            console.log('[StateSnap][test] lastLog:', result.lastLog);
        } catch (e) {
            setStatus('Test error: ' + e.message);
        }
    });
}

// === REPLAY LOGIC ===
document.getElementById('btnLoad').addEventListener('click', async () => {
    const idOrName = document.getElementById('snapshotId').value.trim();
    if (!idOrName) {
        setStatus('Please enter snapshot ID or name');
        return;
    }

    setStatus("Loading data...");

    try {
        // Allow backend to interpret this as either ID or name.
        const response = await fetch(`http://localhost:8080/snapshot/${encodeURIComponent(idOrName)}`);
        if (!response.ok) throw new Error("Snapshot not found");
        const snapshot = await response.json();

        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (snapshot.url && tab.url !== snapshot.url) {
            setStatus(`Navigating to snapshot URL: ${snapshot.url}`);
            await chrome.tabs.update(tab.id, { url: snapshot.url });

            await new Promise((resolve) => {
                const listener = (updatedTabId, changeInfo, updatedTab) => {
                    if (updatedTabId === tab.id && changeInfo.status === "complete") {
                        chrome.tabs.onUpdated.removeListener(listener);
                        tab = updatedTab;
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
            });
        }

        setStatus("Setting cookies...");
        if (applyCookiesCheckbox?.checked) {
            for (const c of (snapshot.cookies || [])) {
                const cookieUrl = "http" + (c.secure ? "s" : "") + "://" + c.domain.replace(/^\./, '') + c.path;
                try {
                    await chrome.cookies.set({
                        url: cookieUrl,
                        name: c.name,
                        value: c.value,
                        domain: c.domain,
                        path: c.path,
                        secure: c.secure,
                        httpOnly: c.httpOnly,
                        expirationDate: c.expirationDate
                    });
                } catch (e) { console.warn("Cookie error: ", c.name, e); }
            }
        } else {
            console.log('[StateSnap] Skipping cookie restore (applyCookies unchecked)');
        }

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            args: [snapshot],
            func: (data) => {
                window.__STATESNAP = data;
            }
        });

        // Apply storages if requested
        if (applyLocalStorageCheckbox?.checked || applySessionStorageCheckbox?.checked) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: 'MAIN',
                args: [snapshot, !!applyLocalStorageCheckbox?.checked, !!applySessionStorageCheckbox?.checked],
                func: (data, applyLS, applySS) => {
                    try {
                        if (applyLS && data.localStorage) {
                            try {
                                Object.keys(data.localStorage).forEach(k => localStorage.setItem(k, data.localStorage[k]));
                            } catch (e) { console.warn('Error applying localStorage', e); }
                        }
                        if (applySS && data.sessionStorage) {
                            try {
                                Object.keys(data.sessionStorage).forEach(k => sessionStorage.setItem(k, data.sessionStorage[k]));
                            } catch (e) { console.warn('Error applying sessionStorage', e); }
                        }
                    } catch (e) {
                        console.error('Error in apply storages', e);
                    }
                }
            });
        } else {
            console.log('[StateSnap] Skipping storage restore (applyLocalStorage/applySessionStorage unchecked)');
        }

        if (applyDomCheckbox?.checked && snapshot.html) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: 'MAIN',
                args: [snapshot.html],
                func: (html) => {
                    try {
                        console.log('[StateSnap][popup] Applying DOM snapshot automatically. You can reapply later via __STATESNAP_applyDomSnapshot().');
                        document.open();
                        document.write(html);
                        document.close();
                    } catch (e) {
                        console.error('Error applying DOM snapshot', e);
                    }
                }
            });
        }

        if (applyNetworkCheckbox?.checked) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: 'MAIN',
                files: ['replayer.js']
            });
        } else {
            console.log('[StateSnap] Skipping replayer injection (applyNetwork unchecked)');
        }

        setStatus("Done! Refresh the page (F5) if needed, but data is already in memory.");

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => {
                window.location.reload();
            }
        });

    } catch (e) {
        setStatus("Error: " + e.message);
    }
});
