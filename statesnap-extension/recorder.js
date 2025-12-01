(function () {
    if (window._isRecording) return;
    window._isRecording = true;
    window._networkLogs = [];

    console.log("%c 🔴 RECORDER STARTED ", "background: red; color: white; padding: 4px;");

    // Helper: attempt to detect XHR creation via constructor proxy (best-effort)
    try {
        const NativeXHR = window.XMLHttpRequest;
        if (NativeXHR) {
            const XProxy = function () {
                // eslint-disable-next-line no-console
                console.log('[REC][xhr new] constructor called');
                return new NativeXHR();
            };
            XProxy.prototype = NativeXHR.prototype;
            window.XMLHttpRequest = XProxy;
        }
    } catch (e) {
        console.warn('Could not proxy XHR constructor', e);
    }

    // Instrument navigator.sendBeacon
    try {
        if (navigator && typeof navigator.sendBeacon === 'function') {
            const origBeacon = navigator.sendBeacon.bind(navigator);
            navigator.sendBeacon = function (url, data) {
                try {
                    window._networkLogs.push({
                        method: 'BEACON',
                        url: String(url),
                        requestBody: typeof data === 'string' ? data : null,
                        status: null,
                        responseBody: null,
                        ts: Date.now()
                    });
                } catch (e) { /* ignore */ }
                return origBeacon(url, data);
            };
        }
    } catch (e) { /* ignore */ }

    // Instrument WebSocket send
    try {
        const NativeWS = window.WebSocket;
        if (NativeWS) {
            const WSProxy = function (url, protocols) {
                const ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
                try {
                    const _url = url;
                    const origSend = ws.send;
                    ws.send = function (data) {
                        try {
                            window._networkLogs.push({
                                method: 'WS-SEND',
                                url: String(_url),
                                requestBody: typeof data === 'string' ? data : (typeof data === 'object' ? JSON.stringify(data) : String(data)),
                                status: null,
                                responseBody: null,
                                ts: Date.now()
                            });
                        } catch (e) { /* ignore */ }
                        return origSend.call(this, data);
                    };
                } catch (e) { /* ignore */ }
                return ws;
            };
            WSProxy.prototype = NativeWS.prototype;
            window.WebSocket = WSProxy;
        }
    } catch (e) { /* ignore */ }

    // --- FETCH ---
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const input = args[0];
        const init = args[1] || {};
        const url = input instanceof Request ? input.url : input;
        const method = (input instanceof Request ? input.method : init.method || "GET").toUpperCase();
        let reqBodyStr = null;

        try {
            if (input instanceof Request) {
                // Try to read request body from cloned Request
                await input.clone().text().then(t => { reqBodyStr = t; }).catch(() => { /* ignore */ });
            } else if (init && init.body != null) {
                reqBodyStr = String(init.body);
            }
        } catch (_) { /* ignore */ }

        console.log(`[REC][fetch] ${method} ${url}`);

        const response = await originalFetch(...args);
        const clone = response.clone();

        const pushLog = (text) => {
            try {
                window._networkLogs.push({
                    method: method,
                    url: url,
                    requestBody: reqBodyStr,
                    status: response.status,
                    responseBody: text,
                    ts: Date.now()
                });
            } catch (e) {
                console.error("Error pushing fetch log", e);
            }
        };

        // Opaque/binary responses can throw on text(); fall back to empty string
        try {
            const text = await clone.text();
            pushLog(text);
        } catch (_) {
            pushLog("");
        }

        return response;
    };

    // --- XHR (prototype patch, more reliable) ---
    try {
        const OriginalXHR = window.XMLHttpRequest;
        if (OriginalXHR && OriginalXHR.prototype) {
            const origOpenProto = OriginalXHR.prototype.open;
            const origSendProto = OriginalXHR.prototype.send;

            OriginalXHR.prototype.open = function (method, url, ...rest) {
                try {
                    this.__statesnap_xhr_method = (method || 'GET').toUpperCase();
                    this.__statesnap_xhr_url = url;
                } catch (e) { /* ignore */ }
                return origOpenProto.apply(this, [method, url, ...rest]);
            };

            OriginalXHR.prototype.send = function (body) {
                try {
                    this.__statesnap_xhr_body = body != null ? String(body) : null;
                    console.log(`[REC][xhr send] ${this.__statesnap_xhr_method || 'GET'} ${this.__statesnap_xhr_url || ''}`);

                    this.addEventListener('load', () => {
                        try {
                            const responseText = this.responseText;
                            window._networkLogs.push({
                                method: this.__statesnap_xhr_method || 'GET',
                                url: this.__statesnap_xhr_url || '',
                                requestBody: this.__statesnap_xhr_body,
                                status: this.status,
                                responseBody: responseText,
                                ts: Date.now()
                            });
                        } catch (e) {
                            console.error('Error logging XHR (proto)', e);
                        }
                    });
                } catch (e) {
                    console.error('Error in patched XHR.send', e);
                }
                return origSendProto.apply(this, [body]);
            };
        }
    } catch (e) {
        console.warn('XHR prototype patch failed:', e);
    }
})();