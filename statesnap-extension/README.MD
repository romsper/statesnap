# StateSnap

> Record and replay browser state (cookies, storage, network, optional DOM) to reproduce web app scenarios for QA and debugging.

StateSnap captures selected browser state (Cookies, LocalStorage, SessionStorage, Network requests and an optional DOM snapshot) and restores it later to reproduce specific test scenarios.

## Features

- Record network traffic (fetch/XHR), storage and cookies from the page MAIN world.
- Optionally capture a DOM snapshot (HTML) and re-apply it on replay.
- Granular Save / Load options (choose which of Cookies / LocalStorage / SessionStorage / Network / DOM to save or apply).
- Cross-frame aggregation: collects logs from all frames and deduplicates entries.
- Simple replayer that injects mock responses for recorded network requests.

## Quick start

1. Start the backend API (MongoDB + small HTTP API) listening at `http://localhost:8080` (see Backend API below).
2. Open `chrome://extensions` in Chrome / Chromium.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder `/extension`.
5. Click the extension action to open the popup and use the UI.

## Usage

- Initialize Recording: opens the current tab, sets a recording flag and reloads the page to ensure early capture.
- Save: choose which items to save (Cookies, LocalStorage, SessionStorage, Network, DOM) and click `Save to MongoDB`.
- Load: enter a snapshot ID or name, choose which parts to apply, and click `Load and apply`.
- Test capture: use `Test capture` in the popup to run a same-origin fetch and check whether the recorder captured it (useful for diagnostics).

Notes
- Cookie operations are only attempted on `http(s)` pages. The popup will skip cookie reads/writes for `chrome://` and other non-http(s) schemes.
- The extension uses `window.__STATESNAP` as the in-page snapshot holder and `window.__StateSpan_applyDomSnapshot()` to apply a saved DOM — these are intentionally stable names for compatibility between popup and replayer.

## How it works (architecture)

- `popup.html` / `popup.js` — UI and orchestration. Lets you initialize recording, choose what to save, save snapshots, and load/apply snapshots. It uses `chrome.scripting.executeScript` with `world: 'MAIN'` to access page globals.
- `recorder_injector.js` — content script injected at `document_start` in all frames; when the recording flag is set it injects `recorder.js` into the page MAIN world as a script tag (so it runs with page-level privileges and can patch native APIs).
- `recorder.js` — page-level script that instruments `fetch`, patches `XMLHttpRequest` (prototype), hooks `navigator.sendBeacon` and `WebSocket.send`, and stores captured entries in `window._networkLogs` (each entry includes a `ts` timestamp).
- `replayer.js` — page-level script that restores storages and mocks network using the recorded `networkLogs`. It also exposes `window.__StateSnap_applyDomSnapshot()` to apply a saved DOM snapshot from the console.
- `background.js` — service worker used to coordinate injection during reload when recording is active.

## Backend API

The extension expects a small HTTP API backed by MongoDB running at `http://localhost:8080` with the following endpoints:

- `POST /snapshot` — Accepts snapshot JSON and returns `{ id: string }`.
- `GET /snapshot/:id` — Retrieves snapshot by ID (or name if backend supports lookup by name).

Snapshot shape (example)

```
{
	"timestamp": 1234567890,
	"url": "https://example.com/page",
	"description": "optional name",
	"cookies": [ /* cookie objects from chrome.cookies */ ],
	"localStorage": { /* key: value */ },
	"sessionStorage": { /* key: value */ },
	"networkLogs": [
		{ "method": "GET", "url": "https://...", "requestBody": null, "status": 200, "responseBody": "...", "ts": 159... }
	],
	"html": "<html>...optional DOM snapshot..." 
}
```

Important: `networkLogs.status` may be `null` for recorded entries where the status is not available; the backend should accept nullable status fields.

## Development & testing

- Reload the extension at `chrome://extensions` after code changes.
- Use the popup `Test capture` to compare `performance.getEntries()` with `window._networkLogs` to diagnose missed captures.
- When testing heavy sites, some requests may be initiated by Service Workers or dedicated Workers and will not be visible to the page-level recorder. Temporarily unregistering the Service Worker can help determine whether it is the cause:

```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister().then(() => console.log('unregistered', r.scope))));
```

## Limitations

- Service Worker / Worker coverage: Requests from Service Workers or dedicated Workers are not captured by page-level instrumentation.
- Binary/Blob responses: Recorder currently stores response bodies as text and truncates large responses before saving. Consider adding Blob/ArrayBuffer handling for full fidelity.
- Replay policy: Unmatched requests are mocked with 404 to avoid producing inconsistent state; this can break some third-party calls.
- SPA timing: Some single-page apps may require a reload after injection to correctly initialize with restored storage.

---

Enjoy — StateSnap helps reproduce browser state for QA and debugging.
