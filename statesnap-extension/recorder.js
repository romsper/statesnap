// StateSnap recorder.
// Runs in the page's MAIN world at document_start (registered as a content
// script in manifest.json) so that fetch/XHR are patched *before* the page's
// own scripts fire their first requests. Recording is gated on a per-origin
// sessionStorage flag and the captured logs are persisted to sessionStorage so
// they survive same-origin reloads/navigations during a recording session.
(function () {
    // Guard against double-install (content script + any manual injection).
    if (window.__STATESNAP_REC_INSTALLED) return;

    // Only activate when recording was initialized for this origin.
    var recording = false;
    try {
        recording = sessionStorage.getItem('__STATESNAP_RECORDING') === 'true';
    } catch (e) { /* storage may be unavailable (sandboxed frame) */ }
    if (!recording) return;

    window.__STATESNAP_REC_INSTALLED = true;
    window._isRecording = true;

    var LOGS_KEY = '__STATESNAP_LOGS';
    var MAX_BUFFER_CHARS = 4 * 1024 * 1024; // keep under the ~5MB sessionStorage quota

    // Restore any logs captured on previous (same-origin) page loads.
    function loadBuffer() {
        try {
            var raw = sessionStorage.getItem(LOGS_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    window._networkLogs = loadBuffer();

    // Throttled persistence so we don't serialize on every single request.
    var persistTimer = null;
    function persistSoon() {
        if (persistTimer) return;
        persistTimer = setTimeout(function () {
            persistTimer = null;
            try {
                var serialized = JSON.stringify(window._networkLogs);
                if (serialized.length <= MAX_BUFFER_CHARS) {
                    sessionStorage.setItem(LOGS_KEY, serialized);
                }
            } catch (e) { /* quota or serialization issues are non-fatal */ }
        }, 250);
    }

    function record(entry) {
        try {
            window._networkLogs.push(entry);
            persistSoon();
        } catch (e) { /* ignore */ }
    }

    console.log("%c 🔴 RECORDER STARTED ", "background: red; color: white; padding: 4px;");

    // --- navigator.sendBeacon ---
    try {
        if (navigator && typeof navigator.sendBeacon === 'function') {
            var origBeacon = navigator.sendBeacon.bind(navigator);
            navigator.sendBeacon = function (url, data) {
                record({
                    method: 'BEACON',
                    url: String(url),
                    requestBody: typeof data === 'string' ? data : null,
                    status: null,
                    responseBody: null,
                    ts: Date.now()
                });
                return origBeacon(url, data);
            };
        }
    } catch (e) { /* ignore */ }

    // --- WebSocket send ---
    try {
        var NativeWS = window.WebSocket;
        if (NativeWS) {
            var WSProxy = function (url, protocols) {
                var ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
                try {
                    var _url = url;
                    var origSend = ws.send;
                    ws.send = function (data) {
                        record({
                            method: 'WS-SEND',
                            url: String(_url),
                            requestBody: typeof data === 'string'
                                ? data
                                : (typeof data === 'object' ? (function () { try { return JSON.stringify(data); } catch (e) { return String(data); } })() : String(data)),
                            status: null,
                            responseBody: null,
                            ts: Date.now()
                        });
                        return origSend.call(this, data);
                    };
                } catch (e) { /* ignore */ }
                return ws;
            };
            WSProxy.prototype = NativeWS.prototype;
            window.WebSocket = WSProxy;
        }
    } catch (e) { /* ignore */ }

    // --- fetch ---
    var originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
        window.fetch = async function (...args) {
            var input = args[0];
            var init = args[1] || {};
            var url = input instanceof Request ? input.url : input;
            var method = (input instanceof Request ? input.method : (init.method || "GET")).toUpperCase();
            var reqBodyStr = null;

            try {
                if (input instanceof Request) {
                    await input.clone().text().then(function (t) { reqBodyStr = t; }).catch(function () {});
                } else if (init && init.body != null) {
                    reqBodyStr = String(init.body);
                }
            } catch (_) { /* ignore */ }

            var response = await originalFetch.apply(this, args);

            try {
                var clone = response.clone();
                var text = await clone.text().catch(function () { return ""; });
                record({
                    method: method,
                    url: String(url),
                    requestBody: reqBodyStr,
                    status: response.status,
                    responseBody: text,
                    ts: Date.now()
                });
            } catch (e) {
                record({ method: method, url: String(url), requestBody: reqBodyStr, status: response.status, responseBody: "", ts: Date.now() });
            }

            return response;
        };
    }

    // --- XMLHttpRequest (prototype patch) ---
    try {
        var XHR = window.XMLHttpRequest;
        if (XHR && XHR.prototype) {
            var origOpen = XHR.prototype.open;
            var origSend = XHR.prototype.send;

            XHR.prototype.open = function (method, url, ...rest) {
                try {
                    this.__statesnap_method = (method || 'GET').toUpperCase();
                    this.__statesnap_url = url;
                } catch (e) { /* ignore */ }
                return origOpen.apply(this, [method, url, ...rest]);
            };

            XHR.prototype.send = function (body) {
                try {
                    this.__statesnap_body = body != null ? String(body) : null;
                    var self = this;
                    this.addEventListener('load', function () {
                        try {
                            record({
                                method: self.__statesnap_method || 'GET',
                                url: self.__statesnap_url || '',
                                requestBody: self.__statesnap_body,
                                status: self.status,
                                responseBody: (function () { try { return self.responseText; } catch (e) { return ""; } })(),
                                ts: Date.now()
                            });
                        } catch (e) { /* ignore */ }
                    });
                } catch (e) { /* ignore */ }
                return origSend.apply(this, [body]);
            };
        }
    } catch (e) {
        console.warn('StateSnap: XHR patch failed', e);
    }
})();
