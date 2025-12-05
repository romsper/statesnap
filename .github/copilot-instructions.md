Purpose
-------
This file gives concise, repo-specific instructions to help an AI coding agent be productive immediately in the Statesnap repository.

**Big Picture**
- **Two main components:** `statesnap-backend` (Kotlin/Ktor server) and `statesnap-extension` (Chrome extension frontend). The extension collects browser state and sends it to the backend which persists snapshots in MongoDB.
- **Data flow:** extension → HTTP POST `/snapshot` → backend `Routing.kt` → KMongo collection `snapshots` in database `testing-snapshots` (see `Databases.kt`). The backend exposes retrieval endpoints (`/snapshot/{id}`, `/snapshot/lookup/{term}`, `/snapshots`). OpenAPI is served at `/openapi`.

**How to run locally (developer flow)**
- Start MongoDB (example):
  - `docker run -p 27017:27017 --name mongo -d mongo:6.0`
- Run backend from repo root (preferred):
  - `./gradlew :statesnap-backend:run`
  - or `cd statesnap-backend && ../gradlew run`
- Backend defaults: host `0.0.0.0`, port `8080` (see `Application.kt`). The extension expects the API at `http://localhost:8080` (see `statesnap-extension/popup.js`).
- You can build with `./gradlew :statesnap-backend:build` and run the produced JAR if needed.

**Important files to inspect**
- `statesnap-backend/src/main/kotlin/Application.kt` — server entrypoint and wiring (`configureSerialization`, `configureDatabases`, `configureRouting`).
- `statesnap-backend/src/main/kotlin/Routing.kt` — all HTTP endpoints and examples of request handling; look for `post("/snapshot")` and `get("/snapshot/{id}")`.
- `statesnap-backend/src/main/kotlin/Databases.kt` — KMongo client setup and DB name `testing-snapshots`.
- `statesnap-backend/src/main/kotlin/Models.kt` — `@Serializable` data models (`Snapshot`, `CookieModel`, `NetworkLog`). Use these models for payload shapes.
- `statesnap-backend/src/main/kotlin/Serialization.kt` — ContentNegotiation + kotlinx.json settings (`ignoreUnknownKeys = true`, lenient parsing).
- `statesnap-extension/` — Chrome extension code that collects and replays snapshots; `popup.js` shows how snapshots are collected and posted to the backend.

**Patterns & conventions (project-specific)**
- Uses Ktor + Kotlinx Serialization. Model classes are annotated with `@Serializable` in `Models.kt` and expected by `call.receive<Snapshot>()` in `Routing.kt`.
- Database access uses KMongo coroutine API and `CoroutineCollection<Snapshot>`; methods like `insertOne`, `findOneById`, `findOne(Snapshot::description eq term)` are used — prefer these idioms for data access.
- ID handling: inserted ID may be `BsonObjectId` or `BsonString`. `Routing.kt` extracts a hex string if present, otherwise falls back to `snapshot._id`.
- Error handling is minimal and often returns `HttpStatusCode.InternalServerError` with `e.localizedMessage`; follow similar lightweight error shapes when adding endpoints.

**Examples**
- Save snapshot (from extension): `POST http://localhost:8080/snapshot` with JSON body matching `Snapshot` model. Backend stores to `snapshots` collection.
- Curl example to list recent snapshots:
  - `curl http://localhost:8080/snapshots`
- Curl example to fetch by id/name:
  - `curl http://localhost:8080/snapshot/<id-or-name>`

**Extension integration notes**
- `statesnap-extension/popup.js` sets `const API_URL = "http://localhost:8080"` — change this if running server elsewhere.
- The extension gathers cookies via the extension API (so HttpOnly cookies are included) and uses `chrome.scripting.executeScript` to collect DOM/storage/network logs from the page context.

**Build / CI hints**
- The backend uses Gradle with Kotlin JVM + Ktor plugin. The application `mainClass` is `io.ktor.server.netty.EngineMain` (see `build.gradle.kts`). Use Gradle wrapper `./gradlew` from repo root.
- There is a `Dockerfile` under `statesnap-backend/` if containerizing is needed.

**What to watch for when modifying this repo**
- Keep the public API shape stable — `Models.kt` drives both extension payloads and DB schema.
- The extension relies on the server being available on `http://localhost:8080` during local development; updating host/port should be mirrored in `popup.js` or config.
- Large network responses are capped client-side (extension trims responseBody to ~200KB) — backend changes should respect potential large payloads.

If anything here is unclear or you'd like more detail on a part of the codebase (endpoints, DB schema, extension messaging), tell me which section to expand and I will iterate.
