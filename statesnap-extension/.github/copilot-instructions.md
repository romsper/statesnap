# StateSnap - Chrome Extension

## Architecture Overview

This is a Manifest V3 Chrome extension called **StateSnap** that records and replays web application state for QA testing. It captures browser state (cookies, storage, network requests, and an optional DOM snapshot) and restores selected parts later to reproduce specific test scenarios.

**Core Components:**
- `popup.html` / `popup.js` - Extension UI that orchestrates recording, saving, loading, and diagnostics; provides granular save/load checkboxes (Cookies, LocalStorage, SessionStorage, Network, DOM) and a Test capture button.
- `background.js` - Service worker that monitors tab updates and coordinates injection when a recording flag is set
- `recorder_injector.js` - small content-script injected at `document_start` (all frames) that conditionally injects `recorder.js` into the page's MAIN world early
- `recorder.js` - Page-level script (injected as a <script> tag into the page) that instruments `fetch`, patches `XMLHttpRequest` (prototype), hooks `navigator.sendBeacon` and `WebSocket.send`, and collects `window._networkLogs` with timestamps
- `replayer.js` - Page-level script (injected into MAIN world) that restores storages, provides a `__STATESNAP_applyDomSnapshot()` helper to apply saved HTML, and mocks network requests using recorded `networkLogs`
- MongoDB backend (external) at `http://localhost:8080` for snapshot storage

**Data Flow:**
1. Recording: User clicks "Initialize recording" → popup sets `sessionStorage.__STATESNAP_RECORDING` and reloads the page → `recorder_injector.js` (running at `document_start` in each frame) injects `recorder.js` into the page MAIN world early → `recorder.js` instruments `fetch`/XHR/etc. and pushes entries into `window._networkLogs` (each log includes a `ts` timestamp)
2. Saving: User clicks "Save" → `popup.js` runs a `world: 'MAIN'` script in all frames to collect the selected pieces (LocalStorage, SessionStorage, Network logs, DOM) → merges and deduplicates frame logs (by method+url+body+status, using `ts` to prefer later entries), sanitizes/caps response bodies, optionally collects cookies via `chrome.cookies.getAll`, and posts the snapshot JSON to the backend → response contains `{ id }` which the popup offers to copy
3. Replaying: User provides snapshot ID or name → `popup.js` fetches snapshot → navigates to the snapshot URL if needed → optionally restores Cookies (via `chrome.cookies.set`), LocalStorage and/or SessionStorage (via a `world: 'MAIN'` script), injects `window.__STATESNAP`, and optionally injects `replayer.js` to mock network requests; `replayer.js` also exposes `window.__STATESNAP_applyDomSnapshot()` to manually apply an HTML snapshot if present

## Critical Patterns

### Script Injection Context (`world` parameter)
- **Always use `world: 'MAIN'`** for scripts that need access to the page's `window`, `localStorage`, or to override native APIs like `fetch()`
- The default isolated content-script world cannot access page globals or override native browser APIs, which is why `recorder.js` is injected into the page MAIN world via a script tag by `recorder_injector.js`.

### Page Reload Workflow
Recording often requires a page reload to capture network traffic from initial load. The extension uses `sessionStorage.__STATESNAP_RECORDING` as a persistence flag across the reload; `background.js` and `recorder_injector.js` cooperate to ensure `recorder.js` is injected early (document_start) in each frame.

### Cookie Restoration
Cookies require special URL construction: `chrome.cookies.set()` needs a `url` parameter formatted as `http(s)://{domain}{path}` with the leading dot removed from the domain. `popup.js` guards cookie operations on non-http(s) pages (for example `chrome://` pages) and catches errors from `chrome.cookies` calls.

### Network Log Storage
`recorder.js` stores network entries in `window._networkLogs`. Each entry includes: `method`, `url`, `requestBody`, `status` (nullable), `responseBody` (text, truncated before save), and `ts` timestamp. Before sending to the backend the popup sanitizes entries and caps `responseBody` (e.g. 200KB) to avoid huge payloads. For binary responses (images/files) consider adding Blob/ArrayBuffer handling in the recorder and converting to a suitable encoded form.

## Development Workflows

**Load Extension:**
1. Navigate to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select `/Users/romsper/Desktop/extension`

**Test Recording:**
1. Open extension popup, click "Initialize recording" (the popup sets the recording flag and reloads the page)
2. `recorder.js` is injected early into the page MAIN world (check the page console for recorder logs)
3. Interact with the site to generate network traffic
4. Open popup, choose which parts to save (Cookies, LocalStorage, SessionStorage, Network, DOM) and click `Save`
5. Snapshot ID is returned and can be copied to clipboard

**Test Replay:**
1. Paste snapshot ID or name into the popup input field
2. Toggle which parts to apply (Cookies, LocalStorage, SessionStorage, Network mocks, DOM) and click `Load and apply`
3. If `applyNetwork` is enabled `replayer.js` is injected and you will see a green "REPLAY MODE" banner in the page console
4. Network requests that match recorded entries will be mocked; unmatched requests return 404 to avoid state drift

**Backend Requirement:**
MongoDB API server must be running at `http://localhost:8080` with endpoints:
- `POST /snapshot` - Save snapshot, returns `{ id: string }`
- `GET /snapshot/:id` - Retrieve snapshot by ID (the backend now accepts nullable `status` fields for network logs)

## Known Limitations

- Worker / Service Worker coverage: Requests initiated from Service Workers or dedicated Workers are not visible to page-level instrumentation; those requests may be missing from `window._networkLogs`. To capture them you'd need either DevTools Protocol integration or a network proxy outside the extension scope.
- Binary/Blob responses: Recorder currently stores response bodies as text. Large binary payloads are truncated before saving. Add Blob/ArrayBuffer handling if you need accurate binary replays.
- Replay policy: Unmatched requests are blocked/mocked with 404 to avoid producing inconsistent state; this can break third-party analytics or async background calls.
- SPA timing: For some single-page apps you may need to reload the page after injecting `__STATESNAP` to ensure the app initializes with restored storage/state.
- Cookie restoration: `chrome.cookies.set()` can fail for domains/paths that don't match runtime constraints; errors are logged and the extension guards against non-http(s) contexts.

## Manifest V3 Specifics

- Uses a service worker (`background.js`) instead of a persistent background page
- Requires `scripting` permission for `executeScript()` with `world: 'MAIN'`
- Adds a content-script `recorder_injector.js` that runs at `document_start` in `all_frames` to inject `recorder.js` into the page MAIN world early
- Host permissions set to `<all_urls>` to access cookies on any domain
- `activeTab` permission allows script injection into the current tab
