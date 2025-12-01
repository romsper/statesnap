# StateSnap
[![](https://img.shields.io/badge/-LinkedIn-blue?style=flat&logo=Linkedin&logoColor=white)](https://www.linkedin.com/in/romsper/) [![](https://img.shields.io/static/v1?label=Telegram&message=%23&logo=Telegram&color=%23fe8e86)](http://t.me/romsper_qa_buddy) ![](https://komarev.com/ghpvc/?username=romsper) 

StateSnap captures a browser tab's runtime state (cookies, local/session storage, network activity and DOM snapshot) and saves it to a small Ktor backend which persists snapshots into MongoDB. It includes two main components:

- `statesnap-backend`: Kotlin + Ktor HTTP server that stores and serves snapshots.
- `statesnap-extension`: Chrome extension that records and replays snapshots from the browser.

Quickstart
----------

1. Start MongoDB (docker):

```bash
docker run --name mongodb -d -p 27017:27017 mongo
```

2. Run the backend (from repo root):

```bash
./gradlew :statesnap-backend:run
```

The backend listens on `0.0.0.0:8080` by default.

3. Load the extension for development (Chromium-based browser):

- Open `chrome://extensions` → enable *Developer mode* → *Load unpacked* and select the `statesnap-extension/` folder.
- Open the extension popup and use `Initialize recording` then `Save` to send snapshots to the backend.

Troubleshooting
---------------

- No network logs in saved snapshot:
	- Ensure the extension injected `recorder.js` into the page. In the page console check `window._isRecording === true` and `Array.isArray(window._networkLogs)`.
	- Recording requires the page to be a normal web page (not `chrome://` or certain extension pages) and the recorder runs in the page's MAIN world.
- Backend errors when saving:
	- Confirm Mongo is running on `localhost:27017`. If not, start via Docker or update `Databases.kt` connection string.
- CORS / CSP issues when testing extension repro:
	- Extension uses `chrome.scripting.executeScript` in the MAIN world to avoid many CSP restrictions. Some pages with strict CSP may still block replayer injection.

Questions?
----------
If you'd like a short developer checklist (how to iterate on the extension, reproduce missing network logs, or add new endpoints), tell me which area and I will expand this README with step-by-step guidance.


