// ============================================================================
// StateSnap popup
// ============================================================================

let API_URL = "http://localhost:8080";
const API_URL_KEY = "statesnap:apiUrl";

const $ = (id) => document.getElementById(id);

// --- Status helper ---
const statusEl = $('status');
function setStatus(msg, type = '') {
    statusEl.textContent = msg;
    statusEl.className = 'status-bar' + (type ? ' ' + type : '');
}

// --- Element refs ---
const btnStart = $('btnStart');
const includeDomCheckbox = $('includeDom');
const applyDomCheckbox = $('applyDom');
const snapshotNameInput = $('snapshotName');
const saveCookiesCheckbox = $('saveCookies');
const saveLocalStorageCheckbox = $('saveLocalStorage');
const saveSessionStorageCheckbox = $('saveSessionStorage');
const saveNetworkCheckbox = $('saveNetwork');
const applyCookiesCheckbox = $('applyCookies');
const applyLocalStorageCheckbox = $('applyLocalStorage');
const applySessionStorageCheckbox = $('applySessionStorage');
const applyNetworkCheckbox = $('applyNetwork');

// --- Generic helpers ---
async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}
const isChromeUrl = (u) => /^chrome:\/\//i.test(u || '');
const isHttpUrl = (u) => /^https?:\/\//i.test(u || '');

function fmtTime(ts) {
    if (!ts) return '';
    try { return new Date(Number(ts)).toLocaleString(); } catch (e) { return String(ts); }
}

// ============================================================================
// Settings (backend URL)
// ============================================================================
async function loadConfig() {
    try {
        const r = await chrome.storage.local.get(API_URL_KEY);
        if (r[API_URL_KEY]) API_URL = r[API_URL_KEY];
    } catch (e) { /* ignore */ }
    $('settingsApiUrl').value = API_URL;
}

$('btnSaveSettings').addEventListener('click', async () => {
    const val = $('settingsApiUrl').value.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(val)) {
        setStatus('Backend URL must start with http:// or https://', 'err');
        return;
    }
    API_URL = val;
    try { await chrome.storage.local.set({ [API_URL_KEY]: val }); } catch (e) {}
    setStatus('Settings saved', 'ok');
    $('settingsPanel').hidden = true;
});

$('btnGear').addEventListener('click', () => {
    $('settingsPanel').hidden = !$('settingsPanel').hidden;
});

// ============================================================================
// Form persistence — the popup closes whenever you click the page, so keep the
// snapshot name and option toggles across reopens (per browser session).
// ============================================================================
const FORM_KEY = 'statesnap:form';
const saveBoxes = { cookies: saveCookiesCheckbox, ls: saveLocalStorageCheckbox, ss: saveSessionStorageCheckbox, net: saveNetworkCheckbox, dom: includeDomCheckbox };
const applyBoxes = { cookies: applyCookiesCheckbox, ls: applyLocalStorageCheckbox, ss: applySessionStorageCheckbox, net: applyNetworkCheckbox, dom: applyDomCheckbox };

async function persistForm() {
    const data = { name: snapshotNameInput.value, save: {}, apply: {} };
    for (const k in saveBoxes) data.save[k] = saveBoxes[k].checked;
    for (const k in applyBoxes) data.apply[k] = applyBoxes[k].checked;
    try { await chrome.storage.session.set({ [FORM_KEY]: data }); } catch (e) { /* ignore */ }
}

async function restoreForm() {
    try {
        const r = await chrome.storage.session.get(FORM_KEY);
        const data = r[FORM_KEY];
        if (!data) return;
        if (typeof data.name === 'string') snapshotNameInput.value = data.name;
        if (data.save) for (const k in saveBoxes) if (k in data.save) saveBoxes[k].checked = data.save[k];
        if (data.apply) for (const k in applyBoxes) if (k in data.apply) applyBoxes[k].checked = data.apply[k];
    } catch (e) { /* ignore */ }
}

// Persist on any change to the name or toggles.
[snapshotNameInput, ...Object.values(saveBoxes), ...Object.values(applyBoxes)].forEach((el) => {
    el.addEventListener('input', persistForm);
    el.addEventListener('change', persistForm);
});

// ============================================================================
// Tabs
// ============================================================================
document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
        const name = btn.dataset.tab;
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
        document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
        if (name === 'library') refreshLibrary();
    });
});

function switchTab(name) {
    const btn = document.querySelector(`.tab[data-tab="${name}"]`);
    if (btn) btn.click();
}

// ============================================================================
// Master "toggle all" switches
// ============================================================================
function wireToggleAll(linkId, checkboxes) {
    $(linkId).addEventListener('click', () => {
        const target = !checkboxes.every(c => c.checked); // if all on -> turn off, else on
        checkboxes.forEach(c => { c.checked = target; });
        persistForm();
    });
}
wireToggleAll('saveAll', [saveCookiesCheckbox, saveLocalStorageCheckbox, saveSessionStorageCheckbox, saveNetworkCheckbox, includeDomCheckbox]);
wireToggleAll('applyAll', [applyCookiesCheckbox, applyLocalStorageCheckbox, applySessionStorageCheckbox, applyNetworkCheckbox, applyDomCheckbox]);

// ============================================================================
// Recording status badge
// ============================================================================
async function updateRecordingBadge() {
    const badge = $('recBadge');
    const text = $('recBadgeText');
    const setBadge = (cls, label, btnLabel) => {
        badge.classList.remove('recording', 'replaying');
        if (cls) badge.classList.add(cls);
        text.textContent = label;
        btnStart.textContent = btnLabel;
    };
    try {
        const tab = await getActiveTab();
        if (!tab || isChromeUrl(tab.url) || !isHttpUrl(tab.url)) { setBadge('', 'N/A', 'Initialize recording'); return; }
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => ({
                recording: sessionStorage.getItem('__STATESNAP_RECORDING') === 'true',
                replaying: !!sessionStorage.getItem('__STATESNAP_REPLAY'),
                applied: !!sessionStorage.getItem('__STATESNAP_APPLIED')
            })
        });
        if (result && result.recording) setBadge('recording', 'Recording', 'Recording active ✓');
        else if (result && result.replaying) setBadge('replaying', 'Replaying', 'Initialize recording');
        else if (result && result.applied) setBadge('replaying', 'Applied', 'Initialize recording');
        else setBadge('', 'Idle', 'Initialize recording');
    } catch (e) {
        setBadge('', 'Idle', 'Initialize recording');
    }
}

// ============================================================================
// RECORD: initialize
// ============================================================================
btnStart.addEventListener('click', async () => {
    const tab = await getActiveTab();
    const url = tab && tab.url ? String(tab.url) : '';
    if (isChromeUrl(url) || !isHttpUrl(url)) {
        setStatus('Cannot record on this page (not a normal web page)', 'err');
        return;
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => {
                try { sessionStorage.removeItem('__STATESNAP_LOGS'); } catch (e) {}
                try { sessionStorage.removeItem('__STATESNAP_REPLAY'); } catch (e) {}
                try { sessionStorage.removeItem('__STATESNAP_APPLIED'); } catch (e) {}
                sessionStorage.setItem('__STATESNAP_RECORDING', 'true');
                window.location.reload();
            }
        });

        try {
            await chrome.runtime.sendMessage({ type: 'statesnap:startRecording', tabId: tab.id });
        } catch (e) { /* same-origin recording still works without background */ }

        setStatus('Recording… reproduce your scenario, then Save.', 'ok');
        setTimeout(updateRecordingBadge, 400);
    } catch (e) {
        setStatus('Error initializing recording: ' + (e?.message || e), 'err');
    }
});

// ============================================================================
// RECORD: save
// ============================================================================
$('btnSave').addEventListener('click', async () => {
    const tab = await getActiveTab();
    const tabUrl = tab && tab.url ? String(tab.url) : '';
    if (isChromeUrl(tabUrl)) { setStatus('Cannot save from chrome:// pages', 'err'); return; }
    if (!isHttpUrl(tabUrl)) { setStatus('Unsupported tab URL', 'err'); return; }

    const wantDom = includeDomCheckbox?.checked ?? false;
    const wantLS = saveLocalStorageCheckbox?.checked ?? false;
    const wantSS = saveSessionStorageCheckbox?.checked ?? false;
    const wantNetwork = saveNetworkCheckbox?.checked ?? false;

    setStatus('Collecting page state…');

    const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: 'MAIN',
        args: [wantDom, wantLS, wantSS, wantNetwork],
        func: (withDom, wantLSArg, wantSSArg, wantNetworkArg) => {
            try {
                let logs = [];
                if (wantNetworkArg) {
                    if (Array.isArray(window._networkLogs)) logs = logs.concat(window._networkLogs);
                    try {
                        const buffered = JSON.parse(sessionStorage.getItem('__STATESNAP_LOGS') || '[]');
                        if (Array.isArray(buffered)) logs = logs.concat(buffered);
                    } catch (e) { /* ignore */ }
                }
                const cleanStorage = (store) => {
                    const out = JSON.parse(JSON.stringify(store));
                    delete out.__STATESNAP_LOGS;
                    delete out.__STATESNAP_RECORDING;
                    delete out.__STATESNAP_REPLAY;
                    return out;
                };
                return {
                    ls: wantLSArg ? cleanStorage(localStorage) : {},
                    ss: wantSSArg ? cleanStorage(sessionStorage) : {},
                    logs: logs,
                    html: withDom ? document.documentElement.outerHTML : null
                };
            } catch (e) {
                return { ls: {}, ss: {}, logs: [], html: null, error: String(e) };
            }
        }
    });

    const frameResults = (injectionResults || []).map(r => r && r.result).filter(Boolean);
    const firstFrame = frameResults.find(f => f) || { ls: {}, ss: {}, logs: [], html: null };
    const mergedLogs = ([]).concat(...frameResults.map(f => Array.isArray(f.logs) ? f.logs : [])).filter(Boolean);

    // Deduplicate (method+url+body+status), preferring the latest timestamp.
    const dedupeMap = new Map();
    for (const l of mergedLogs) {
        try {
            const key = `${l && l.method || ''}|${l && l.url || ''}|${l && l.requestBody || ''}|${String(l && l.status || '')}`;
            const existing = dedupeMap.get(key);
            if (!existing || (l && l.ts && existing.ts && l.ts > existing.ts)) dedupeMap.set(key, l);
        } catch (_) { /* ignore */ }
    }

    const sanitizedLogs = Array.from(dedupeMap.values())
        .map((l) => {
            const url = l && l.url ? String(l.url) : '';
            if (!url) return null;
            return {
                method: l && l.method ? String(l.method) : 'GET',
                url,
                requestBody: l && l.requestBody != null ? String(l.requestBody) : null,
                status: (l && typeof l.status === 'number') ? l.status : null,
                responseBody: (l && l.responseBody != null) ? String(l.responseBody).slice(0, 200 * 1024) : null
            };
        })
        .filter(Boolean);

    // Cookies via the extension API (covers HttpOnly).
    let cookies = [];
    if (saveCookiesCheckbox?.checked && isHttpUrl(tabUrl)) {
        try { cookies = await chrome.cookies.getAll({ url: tabUrl }); }
        catch (e) { console.warn('[StateSnap] cookie read failed', e); cookies = []; }
    }
    const cookieModels = (cookies || []).map(c => ({
        name: String(c.name || ''),
        value: String(c.value || ''),
        domain: String(c.domain || ''),
        path: String(c.path || '/'),
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        expirationDate: typeof c.expirationDate === 'number' ? c.expirationDate : null
    }));

    const snapshot = {
        timestamp: Date.now(),
        url: tabUrl,
        description: snapshotNameInput?.value?.trim() || undefined,
        cookies: cookieModels,
        localStorage: firstFrame.ls || {},
        sessionStorage: firstFrame.ss || {},
        networkLogs: sanitizedLogs,
        html: firstFrame.html || null
    };

    setStatus('Saving to backend…');
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
        const resData = await response.json().catch(() => { throw new Error("Invalid JSON from server"); });
        const id = (resData && (resData._id || resData.id)) || "<no-id>";
        const savedName = snapshot.description ? `"${snapshot.description}" · ` : '';
        setStatus(`Saved ✓  ${savedName}${sanitizedLogs.length} requests · ID copied`, 'ok');
        if (navigator.clipboard && id && id !== "<no-id>") navigator.clipboard.writeText(id).catch(() => {});
        // Clear the name for the next snapshot and refresh the library.
        snapshotNameInput.value = '';
        persistForm();
        refreshLibrary();
    } catch (e) {
        setStatus('Server error: ' + e.message, 'err');
    }
});

// ============================================================================
// APPLY / REPLAY
// ============================================================================
async function applySnapshot(idOrName) {
    if (!idOrName) { setStatus('Enter a snapshot ID or name', 'err'); return; }
    setStatus('Loading snapshot…');

    try {
        const response = await fetch(`${API_URL}/snapshot/${encodeURIComponent(idOrName)}`);
        if (!response.ok) throw new Error('Snapshot not found');
        const snapshot = await response.json();

        let tab = await getActiveTab();

        try { await chrome.runtime.sendMessage({ type: 'statesnap:stopRecording', tabId: tab.id }); } catch (e) {}

        if (snapshot.url && tab.url !== snapshot.url) {
            setStatus(`Navigating to ${snapshot.url}…`);
            await chrome.tabs.update(tab.id, { url: snapshot.url });
            await new Promise((resolve) => {
                const listener = (updatedTabId, changeInfo, updatedTab) => {
                    if (updatedTabId === tab.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        tab = updatedTab;
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
            });
        }

        // Track exactly what we apply so "Clear applied" can undo it precisely.
        const appliedCookies = [];
        if (applyCookiesCheckbox?.checked) {
            setStatus('Restoring cookies…');
            for (const c of (snapshot.cookies || [])) {
                const domain = String(c.domain || '').replace(/^\./, '');
                const path = c.path || '/';
                const cookieUrl = 'http' + (c.secure ? 's' : '') + '://' + domain + path;
                try {
                    const details = {
                        url: cookieUrl, name: c.name, value: c.value, domain: c.domain,
                        path: c.path, secure: !!c.secure, httpOnly: !!c.httpOnly
                    };
                    if (typeof c.expirationDate === 'number') details.expirationDate = c.expirationDate;
                    await chrome.cookies.set(details);
                    appliedCookies.push({ url: cookieUrl, name: c.name });
                } catch (e) { console.warn('Cookie error:', c && c.name, e); }
            }
        }

        const replayPayload = {};
        if (applyNetworkCheckbox?.checked) replayPayload.networkLogs = snapshot.networkLogs || [];
        if (applyDomCheckbox?.checked && snapshot.html) replayPayload.html = snapshot.html;
        const wantReplay = applyNetworkCheckbox?.checked || (applyDomCheckbox?.checked && snapshot.html);

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            args: [
                snapshot,
                !!applyLocalStorageCheckbox?.checked,
                !!applySessionStorageCheckbox?.checked,
                wantReplay ? JSON.stringify(replayPayload) : null
            ],
            func: (data, applyLS, applySS, replayJson) => {
                try {
                    if (applyLS && data.localStorage) {
                        try { Object.keys(data.localStorage).forEach(k => localStorage.setItem(k, data.localStorage[k])); }
                        catch (e) { console.warn('Error applying localStorage', e); }
                    }
                    if (applySS && data.sessionStorage) {
                        try { Object.keys(data.sessionStorage).forEach(k => sessionStorage.setItem(k, data.sessionStorage[k])); }
                        catch (e) { console.warn('Error applying sessionStorage', e); }
                    }
                    try { sessionStorage.removeItem('__STATESNAP_RECORDING'); } catch (e) {}
                    try { sessionStorage.removeItem('__STATESNAP_LOGS'); } catch (e) {}
                    if (replayJson) {
                        try { sessionStorage.setItem('__STATESNAP_REPLAY', replayJson); } catch (e) { console.warn('Could not stage replay payload', e); }
                    } else {
                        try { sessionStorage.removeItem('__STATESNAP_REPLAY'); } catch (e) {}
                    }
                    // Mark this tab as having a snapshot applied (for the badge),
                    // even for cookie/storage-only applies with no replayer.
                    try { sessionStorage.setItem('__STATESNAP_APPLIED', String(Date.now())); } catch (e) {}
                } catch (e) { console.error('Error staging replay', e); }
                window.location.reload();
            }
        });

        // Remember what was applied (for "Clear applied"), keyed per tab.
        try {
            const manifest = {
                cookies: appliedCookies,
                ls: applyLocalStorageCheckbox?.checked && snapshot.localStorage ? Object.keys(snapshot.localStorage) : [],
                ss: applySessionStorageCheckbox?.checked && snapshot.sessionStorage ? Object.keys(snapshot.sessionStorage) : []
            };
            await chrome.storage.session.set({ [`statesnap:applied:${tab.id}`]: manifest });
        } catch (e) { /* ignore */ }

        setStatus('Applied ✓  Page reloaded with the restored state.', 'ok');
        setTimeout(updateRecordingBadge, 400);
    } catch (e) {
        setStatus('Error: ' + e.message, 'err');
    }
}

$('btnLoad').addEventListener('click', () => applySnapshot($('snapshotId').value.trim()));

// Stop replaying: clear replay/applied markers and reload so the page returns
// to the live network (the replayer only re-installs while the flag is set).
async function stopReplaying() {
    const tab = await getActiveTab();
    const url = tab && tab.url ? String(tab.url) : '';
    if (isChromeUrl(url) || !isHttpUrl(url)) { setStatus('Not applicable on this page', 'err'); return; }

    try {
        try { await chrome.runtime.sendMessage({ type: 'statesnap:stopRecording', tabId: tab.id }); } catch (e) {}
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => {
                const wasActive = !!(sessionStorage.getItem('__STATESNAP_REPLAY') || sessionStorage.getItem('__STATESNAP_APPLIED'));
                try { sessionStorage.removeItem('__STATESNAP_REPLAY'); } catch (e) {}
                try { sessionStorage.removeItem('__STATESNAP_APPLIED'); } catch (e) {}
                try { sessionStorage.removeItem('__STATESNAP_RECORDING'); } catch (e) {}
                try { sessionStorage.removeItem('__STATESNAP_LOGS'); } catch (e) {}
                window.location.reload();
                return wasActive;
            }
        });
        setStatus(result ? 'Replay stopped — reloaded with live network.' : 'Nothing was replaying — page reloaded.', 'ok');
        setTimeout(updateRecordingBadge, 400);
    } catch (e) {
        setStatus('Error stopping replay: ' + e.message, 'err');
    }
}
$('btnStop').addEventListener('click', stopReplaying);

// Clear applied: remove the cookies and storage keys this snapshot set (tracked
// in the per-tab manifest at apply time), clear markers, then reload.
async function clearAppliedState() {
    const tab = await getActiveTab();
    const url = tab && tab.url ? String(tab.url) : '';
    if (isChromeUrl(url) || !isHttpUrl(url)) { setStatus('Not applicable on this page', 'err'); return; }

    setStatus('Clearing applied state…');
    const manifestKey = `statesnap:applied:${tab.id}`;
    let manifest = { cookies: [], ls: [], ss: [] };
    try {
        const r = await chrome.storage.session.get(manifestKey);
        if (r[manifestKey]) manifest = r[manifestKey];
    } catch (e) { /* ignore */ }

    try { await chrome.runtime.sendMessage({ type: 'statesnap:stopRecording', tabId: tab.id }); } catch (e) {}

    // Remove cookies (these are managed via the extension API, not the page).
    let removedCookies = 0;
    for (const c of (manifest.cookies || [])) {
        try { await chrome.cookies.remove({ url: c.url, name: c.name }); removedCookies++; } catch (e) {}
    }

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            args: [manifest],
            func: (m) => {
                try { (m.ls || []).forEach(k => localStorage.removeItem(k)); } catch (e) {}
                try { (m.ss || []).forEach(k => sessionStorage.removeItem(k)); } catch (e) {}
                ['__STATESNAP_REPLAY', '__STATESNAP_APPLIED', '__STATESNAP_RECORDING', '__STATESNAP_LOGS']
                    .forEach(k => { try { sessionStorage.removeItem(k); } catch (e) {} });
                window.location.reload();
            }
        });
        try { await chrome.storage.session.remove(manifestKey); } catch (e) {}
        const lsN = (manifest.ls || []).length, ssN = (manifest.ss || []).length;
        setStatus(`Cleared ✓  ${removedCookies} cookies, ${lsN} LS, ${ssN} SS removed — page reloaded.`, 'ok');
        setTimeout(updateRecordingBadge, 400);
    } catch (e) {
        setStatus('Error clearing applied state: ' + e.message, 'err');
    }
}
$('btnClear').addEventListener('click', clearAppliedState);

// ============================================================================
// LIBRARY
// ============================================================================
async function refreshLibrary() {
    const list = $('libraryList');
    list.innerHTML = '<div class="lib-empty">Loading…</div>';
    try {
        const res = await fetch(`${API_URL}/snapshots`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const snaps = await res.json();
        if (!Array.isArray(snaps) || snaps.length === 0) {
            list.innerHTML = '<div class="lib-empty">No snapshots yet. Record one to get started.</div>';
            return;
        }
        list.innerHTML = '';
        for (const s of snaps) {
            list.appendChild(renderSnapItem(s));
        }
    } catch (e) {
        list.innerHTML = `<div class="lib-empty">Could not reach backend.<br>${API_URL}<br><small>${e.message}</small></div>`;
    }
}

function chip(count, label) {
    if (!count) return '';
    return `<span class="chip">${count} ${label}</span>`;
}

// Escape untrusted snapshot text before inserting via innerHTML.
function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderSnapItem(s) {
    const id = s._id || s.id || '';
    const name = (s.description && s.description.trim()) || '(unnamed)';
    const cookies = Array.isArray(s.cookies) ? s.cookies.length : 0;
    const ls = s.localStorage ? Object.keys(s.localStorage).length : 0;
    const ss = s.sessionStorage ? Object.keys(s.sessionStorage).length : 0;
    const net = Array.isArray(s.networkLogs) ? s.networkLogs.length : 0;
    const dom = s.html ? 1 : 0;

    const el = document.createElement('div');
    el.className = 'snap';
    el.innerHTML = `
        <div class="snap-main">
            <div class="snap-title" title="${esc(name)}">${esc(name)}</div>
            <div class="snap-url" title="${esc(s.url || '')}">${esc(s.url || '')}</div>
            <div class="snap-meta">
                <span>${esc(fmtTime(s.timestamp))}</span>
                ${chip(cookies, '🍪')}${chip(ls, '💾')}${chip(ss, '🗂️')}${chip(net, '🌐')}${dom ? '<span class="chip">📄</span>' : ''}
            </div>
        </div>
        <div class="snap-actions">
            <button class="icon-btn load" title="Load &amp; apply">▶</button>
            <button class="icon-btn del" title="Delete">✕</button>
        </div>`;

    el.querySelector('.load').addEventListener('click', () => {
        $('snapshotId').value = id;
        switchTab('apply');
        applySnapshot(id);
    });
    const delBtn = el.querySelector('.del');
    let armed = false, armTimer = null;
    delBtn.addEventListener('click', async () => {
        // Two-step confirm (window.confirm is unreliable inside MV3 popups).
        if (!armed) {
            armed = true;
            delBtn.textContent = '✓?';
            delBtn.title = 'Click again to confirm delete';
            setStatus(`Click ✓? again to delete "${name}"`);
            armTimer = setTimeout(() => { armed = false; delBtn.textContent = '✕'; delBtn.title = 'Delete'; }, 3000);
            return;
        }
        clearTimeout(armTimer);
        try {
            const res = await fetch(`${API_URL}/snapshot/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setStatus('Snapshot deleted', 'ok');
            refreshLibrary();
        } catch (e) {
            setStatus('Delete failed: ' + e.message, 'err');
        }
    });
    return el;
}

$('btnRefresh').addEventListener('click', refreshLibrary);

// ============================================================================
// Capture test (advanced)
// ============================================================================
$('btnTest').addEventListener('click', async () => {
    const tab = await getActiveTab();
    const tabUrl = tab && tab.url ? String(tab.url) : '';
    if (isChromeUrl(tabUrl) || !isHttpUrl(tabUrl)) { setStatus('Cannot run test on this page', 'err'); return; }
    setStatus('Running capture test…');
    try {
        const res = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            world: 'MAIN',
            func: async () => {
                try {
                    const testUrl = (location && location.origin) ? (location.origin + '/?statesnap=1') : 'about:blank';
                    await fetch(testUrl, { cache: 'no-store' }).catch(() => {});
                    await new Promise(r => setTimeout(r, 300));
                    return { logsLength: window._networkLogs ? window._networkLogs.length : null };
                } catch (e) { return { error: String(e) }; }
            }
        });
        const results = (res || []).map(r => r && r.result).filter(Boolean);
        const total = results.reduce((s, r) => s + (r.logsLength || 0), 0);
        setStatus(`Test done — recorder holds ${total} request(s)`, total > 0 ? 'ok' : '');
    } catch (e) {
        setStatus('Test error: ' + e.message, 'err');
    }
});

// ============================================================================
// Init
// ============================================================================
(async function init() {
    await loadConfig();
    await restoreForm();
    updateRecordingBadge();
})();
