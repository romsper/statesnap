// StateSnap replayer.
// Runs in the page's MAIN world at document_start (registered as a content
// script in manifest.json). It activates only when a replay payload is present
// in sessionStorage, which the popup writes right before reloading the tab.
// Installing here — instead of via executeScript before a reload — means the
// fetch/XHR mocks survive the reload and are in place before the page's own
// scripts run. Unmatched requests fall through to the real network instead of
// being hard-failed, so replayed pages don't break on un-recorded calls.
(function () {
    if (window.__STATESNAP_REPLAY_INSTALLED) return;

    var payload = null;
    try {
        var raw = sessionStorage.getItem('__STATESNAP_REPLAY');
        if (!raw) return;
        payload = JSON.parse(raw);
    } catch (e) {
        return;
    }
    if (!payload) return;

    window.__STATESNAP_REPLAY_INSTALLED = true;
    console.log("%c ▶️ REPLAY MODE ", "background: green; color: white; padding: 4px;");

    var logs = Array.isArray(payload.networkLogs) ? payload.networkLogs : [];

    // Capture native implementations before patching (used for pass-through).
    var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    var NativeXHROpen = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
    var NativeXHRSend = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;

    function normalizeUrl(u) {
        try {
            var url = new URL(u, window.location.origin);
            url.hash = "";
            return url.toString();
        } catch (e) {
            return String(u);
        }
    }

    function findMatch(method, url, body) {
        var normUrl = normalizeUrl(url);
        var bodyStr = body != null ? String(body) : null;
        return logs.find(function (log) {
            if (!log || !log.url) return false;
            if ((log.method || "").toUpperCase() !== method) return false;
            var logUrl = normalizeUrl(log.url);

            if (log.requestBody != null) {
                var logBody = String(log.requestBody);
                var reqBody = bodyStr != null ? bodyStr : "";
                if (logBody !== reqBody) return false;
            }

            if (logUrl === normUrl) return true;
            if (logUrl.length > 0 && (normUrl.startsWith(logUrl) || logUrl.startsWith(normUrl))) return true;
            return false;
        });
    }

    // --- Mock fetch (pass-through on miss) ---
    if (logs.length && nativeFetch) {
        window.fetch = function (input, init) {
            var url = input instanceof Request ? input.url : input;
            var method = (input instanceof Request ? input.method : ((init && init.method) || "GET")).toUpperCase();
            var body = input instanceof Request ? input.body : (init && init.body);
            var match = findMatch(method, url, body);

            if (match) {
                console.log("[MOCK][fetch] " + method + " " + url);
                return Promise.resolve(new Response(match.responseBody != null ? match.responseBody : "", {
                    status: match.status != null ? match.status : 200,
                    statusText: "OK (Mocked)",
                    headers: { "Content-Type": "application/json" }
                }));
            }

            console.warn("[MISS][fetch] " + method + " " + url + " — passing through to network");
            return nativeFetch(input, init);
        };
    }

    // --- Mock XHR (pass-through on miss) ---
    if (logs.length && NativeXHROpen && NativeXHRSend) {
        window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this.__statesnap_method = (method || "GET").toUpperCase();
            this.__statesnap_url = url;
            return NativeXHROpen.apply(this, [method, url, ...rest]);
        };

        window.XMLHttpRequest.prototype.send = function (body) {
            var requestBody = body != null ? String(body) : null;
            var match = findMatch(this.__statesnap_method || "GET", this.__statesnap_url || "", requestBody);

            if (!match) {
                console.warn("[MISS][xhr] " + (this.__statesnap_method || "GET") + " " + (this.__statesnap_url || "") + " — passing through to network");
                return NativeXHRSend.apply(this, [body]);
            }

            console.log("[MOCK][xhr] " + this.__statesnap_method + " " + this.__statesnap_url);
            var self = this;
            setTimeout(function () {
                try {
                    Object.defineProperty(self, "status", { value: match.status != null ? match.status : 200, configurable: true });
                    Object.defineProperty(self, "responseText", { value: match.responseBody != null ? match.responseBody : "", configurable: true });
                    Object.defineProperty(self, "readyState", { value: 4, configurable: true });
                    self.dispatchEvent(new Event("readystatechange"));
                    self.dispatchEvent(new Event("load"));
                } catch (e) {
                    console.error("StateSnap: error simulating XHR response", e);
                }
            }, 0);
        };
    }

    // --- Optional: apply the recorded DOM as a frozen view (no script re-exec) ---
    if (payload.html) {
        var applyDom = function () {
            try {
                var parsed = new DOMParser().parseFromString(payload.html, "text/html");
                document.replaceChild(
                    document.importNode(parsed.documentElement, true),
                    document.documentElement
                );
                console.log("[StateSnap][replayer] Applied DOM snapshot (frozen view).");
            } catch (e) {
                console.error("StateSnap: error applying DOM snapshot", e);
            }
        };
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", applyDom, { once: true });
        } else {
            applyDom();
        }
    }

    console.log("StateSnap: replay active. Network is mocked; unmatched requests hit the real network.");
})();
