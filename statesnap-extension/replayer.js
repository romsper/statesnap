// Universal replayer: fully mocks fetch + XHR based on recorded NetworkLog entries
(function () {
    const SNAPSHOT = window.__STATESNAP;
    if (!SNAPSHOT) {
        console.error("No snapshot data found for replay!");
        return;
    }

    console.log("%c ▶️ REPLAY MODE ", "background: green; color: white; padding: 4px;");

    if (SNAPSHOT.html) {
        console.log("[StateSnap][replayer] Snapshot contains DOM HTML (length):", SNAPSHOT.html.length);
        // Optional helper to manually apply DOM from the console if needed.
        window.__STATESNAP_applyDomSnapshot = function () {
            try {
                document.open();
                document.write(SNAPSHOT.html);
                document.close();
            } catch (e) {
                console.error("[StateSnap][replayer] Error applying DOM snapshot via helper", e);
            }
        };
    }

    // 1. Restore Storage
    try {
        localStorage.clear();
        sessionStorage.clear();
    } catch (e) {
        console.warn("Unable to clear storage during replay", e);
    }

    if (SNAPSHOT.localStorage) {
        try {
            Object.entries(SNAPSHOT.localStorage).forEach(([k, v]) => localStorage.setItem(k, v));
        } catch (e) {
            console.warn("Error restoring localStorage from snapshot", e);
        }
    }
    if (SNAPSHOT.sessionStorage) {
        try {
            Object.entries(SNAPSHOT.sessionStorage).forEach(([k, v]) => sessionStorage.setItem(k, v));
        } catch (e) {
            console.warn("Error restoring sessionStorage from snapshot", e);
        }
    }

    const logs = Array.isArray(SNAPSHOT.networkLogs) ? SNAPSHOT.networkLogs : [];

    const normalizeUrl = (u) => {
        try {
            const url = new URL(u, window.location.origin);
            // Strip hash for matching
            url.hash = "";
            return url.toString();
        } catch {
            return String(u);
        }
    };

    const findMatch = (method, url, body) => {
        const normUrl = normalizeUrl(url);
        const bodyStr = body != null ? String(body) : null;

        return logs.find((log) => {
            if (!log || !log.url) return false;
            const logUrl = normalizeUrl(log.url);
            if ((log.method || "").toUpperCase() !== method) return false;

            if (log.requestBody != null) {
                const logBody = String(log.requestBody);
                const reqBody = bodyStr != null ? bodyStr : "";
                if (logBody !== reqBody) return false;
            }

            // 1) Strict equality
            if (logUrl === normUrl) return true;

            // 2) fallback: prefixes (helps with slight differences in query/CDN tails)
            if (logUrl.length > 0 && (normUrl.startsWith(logUrl) || logUrl.startsWith(normUrl))) {
                return true;
            }

            return false;
        });
    };

    // 2. Mock fetch
    window.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : input;
        const method = (input instanceof Request ? input.method : (init?.method || "GET")).toUpperCase();
        const body = input instanceof Request ? input.body : init?.body;

        const match = findMatch(method, url, body);

        if (match) {
            console.log(`[MOCK][fetch] ${method} ${url}`);
            return new Response(match.responseBody ?? "", {
                status: match.status ?? 200,
                statusText: "OK (Mocked)",
                headers: { "Content-Type": "application/json" }
            });
        }

        console.warn(`[MISS][fetch] ${method} ${url} — blocking (no recorded entry)`);
        return new Response(JSON.stringify({ error: "No recorded state for this request" }), { status: 404 });
    };

    // 3. Mock XHR
    const OriginalXHR = window.XMLHttpRequest;
    function MockedXHR() {
        const xhr = new OriginalXHR();
        let method = "GET";
        let url = "";
        let requestBody = null;

        const origOpen = xhr.open;
        xhr.open = function (m, u, ...rest) {
            method = (m || "GET").toUpperCase();
            url = u;
            return origOpen.call(xhr, m, u, ...rest);
        };

        const origSend = xhr.send;
        xhr.send = function (body) {
            requestBody = body != null ? String(body) : null;

            const match = findMatch(method, url, requestBody);

            if (match) {
                console.log(`[MOCK][xhr] ${method} ${url}`);
                setTimeout(() => {
                    try {
                        Object.defineProperty(xhr, "status", { value: match.status ?? 200, configurable: true });
                        Object.defineProperty(xhr, "responseText", { value: match.responseBody ?? "", configurable: true });
                        xhr.readyState = 4;
                        xhr.dispatchEvent(new Event("readystatechange"));
                        xhr.dispatchEvent(new Event("load"));
                    } catch (e) {
                        console.error("Error simulating XHR response", e);
                    }
                }, 0);
                return;
            }

            console.warn(`[MISS][xhr] ${method} ${url} — blocking (no recorded entry)`);
            setTimeout(() => {
                try {
                    Object.defineProperty(xhr, "status", { value: 404, configurable: true });
                    Object.defineProperty(xhr, "responseText", { value: '{"error":"No recorded state for this request"}', configurable: true });
                    xhr.readyState = 4;
                    xhr.dispatchEvent(new Event("readystatechange"));
                    xhr.dispatchEvent(new Event("load"));
                } catch (e) {
                    console.error("Error simulating XHR miss", e);
                }
            }, 0);
        };

        return xhr;
    }

    window.XMLHttpRequest = MockedXHR;

    console.log("State restored. All network traffic is now fully mocked.");
})();