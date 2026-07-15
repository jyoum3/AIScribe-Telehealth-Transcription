# AIScribe — Changelog

A summary of the major features and engineering milestones built across the project lifecycle.

---

## v1.0.0 — Full Platform Release

### Core Infrastructure
- Monorepo structure: `apps/api` (Express), `apps/web` (React/Vite), `packages/shared`
- Two-database PostgreSQL architecture: `aiscribe_app` (app data) and `simulated_emr` (hospital data) with strict isolation at the connection pool level
- Docker Compose for reproducible PostgreSQL 15 environment
- `database/init/` SQL scripts auto-run in alphabetical order on first container boot

### Authentication & Security
- JWT authentication (HS256, 24-hour TTL) with enumeration-safe login (identical error for wrong email vs wrong password)
- `requireAuth` middleware validates Bearer token and attaches `req.user.provider_id` to every protected request
- Session restore from `localStorage` JWT on page refresh — validates structure, expiry, and payload before restoring
- `bcrypt` password comparison (cost factor 10)

### FHIR Schedule Integration
- Internal FHIR R4 mock gateway (`GET /fhir/R4/Encounter`) reads from `simulated_emr` and returns a standards-compliant FHIR Bundle (searchset)
- `fhirSync` service consumes the FHIR gateway via HTTP (mirrors real-world consumption pattern) and upserts encounters into `aiscribe_app.app_appointments`
- Three sync trigger points: auto-sync on login (fire-and-forget), manual "Refresh Schedule" button, zero-row fallback on first dashboard load
- UPSERT preserves `audio_status` on conflict — sync never resets an in-flight or completed appointment

### Audio Transcription Pipeline
- Multer `memoryStorage` — audio never written to disk; buffer garbage-collected after handler completes
- OpenAI Whisper API (`whisper-1`) via Node 18 native `fetch`/`FormData`/`Blob` — no extra npm packages
- 30-second `AbortController` timeout with `TRANSCRIPTION_TIMEOUT` error code
- File validation: `.mp3`/`.wav` only (MIME type check), 25 MB max (multer limit + belt-and-suspenders guard)

### SOAP Note Generation (Claude)
- Anthropic Claude (`claude-sonnet-4-6`) formats raw transcript into structured SOAP JSON
- System prompt enforces strict JSON output: four required keys (`subjective`, `objective`, `assessment`, `plan`), no markdown, no fabrication
- Three-step parse pipeline: (1) extract and strip `[CONTROL_BLOCK]` before SOAP parsing, (2) strip optional markdown fences, (3) validate all four keys are present and non-empty
- Error code: `SOAP_FORMATTING_FAILED` on any Claude parse or validation failure

### Custom AI Prompts
- Per-provider `custom_prompt_template` stored in `aiscribe_app.providers`
- Custom templates receive a `JSON_FORMAT_ENFORCEMENT` clause appended automatically (default prompt already contains explicit JSON instructions)
- Provider can reset to system default by saving `null`
- `GET /api/providers/me` + `POST /api/providers/me/prompt` endpoints with full CRUD

### Historical Context (Longitudinal Notes)
- For follow-up and routine visit types, the most recent signed note for the patient is fetched and injected into Claude's system prompt
- Fallback chain: `clinical_note_versions` (amended, `is_current=TRUE`) → `clinical_notes` (v1)
- Historical context fetch is non-fatal — failures fall back to null (no context injected)

### Automated Follow-Up Scheduling
- Claude returns a `[CONTROL_BLOCK]` JSON at the end of every response with `schedule_follow_up` (bool) and `timeline_weeks` (int)
- If `schedule_follow_up === true`, Express generates a deterministic `newCsn` (`CSN-AUTO-{timestamp}`) and sends a `SCHEDULE_FOLLOWUP` payload to Mirth
- Mirth's source transformer detects `type === 'SCHEDULE_FOLLOWUP'` and routes to the JavaScript Writer destination, which INSERTs a new encounter row
- Follow-up scheduling is non-fatal — failure never blocks the SOAP note response

### HL7 v2 / Mirth Connect Integration
- Mirth Connect HTTP Listener receives a 9-field JSON payload from Express
- Source transformer builds HL7 MDM^T02 (new note) or MDM^T04 (amendment, detected by `version_num > 1`)
- JavaScript Writer destination executes parameterized INSERT into `simulated_emr.clinical_notes` or `clinical_note_versions`
- Mirth returns a JSON ACK: `{ messageId, status, hl7 }` — the HL7 string is surfaced to the clinician on success

### Note Submission & Idempotency
- `submission_idempotency` table: `(csn, idempotency_key)` unique constraint prevents double-submission
- Browser generates a UUID4 `idempotencyKey` once when transcription succeeds — never regenerated on retry
- On duplicate submission (409): returns cached Mirth ACK from the original submission
- `audio_status` lifecycle: `Pending` → `Processing` → `SOAP Ready` → `Submitted`

### Note Amendments
- Signed notes in `clinical_notes` are immutable — amendments create new rows in `clinical_note_versions`
- Version number calculated server-side as `MAX(version_num) + 1` (first amendment is always v2)
- Amendment reason required — validated non-empty before Mirth call
- `is_current` flag managed by Mirth: previous version set to `FALSE`, new version set to `TRUE`

### Patient History
- Split dashboard: pending appointments (top panel) and submitted appointments (bottom panel)
- Patient sidebar (persistent across all views — no remount on navigation): alphabetical patient list, expandable encounter history, inline note viewer
- `GET /api/patients/:mrn/history`: two-phase execution — Phase 1 confirms provider ownership in `aiscribe_app` before querying `simulated_emr`; Phase 2 uses batch `ANY($csns)` queries to avoid N+1 round trips
- Note fallback chain: `clinical_note_versions` (amended) → `clinical_notes` (v1) → no note

### HIPAA Audit Logging
- `audit_logs` table in `aiscribe_app`
- Five event types: `SCHEDULE_VIEWED`, `SOAP_GENERATED`, `NOTE_SIGNED`, `NOTE_AMENDED`, `HISTORY_VIEWED`
- All writes are fire-and-forget — `logAccess()` never throws; audit failures are console-logged only and never surface to the clinician

### Frontend (React / Vite)
- View-based state machine in `App.jsx`: `login → appointments → upload → editor → success | settings`
- `PatientSidebar` mounted at App level (not inside Dashboard) — state persists across all view transitions without remounting
- `FollowUpBanner` appears between `SoapEditor` and `SubmitPanel` when Claude recommends scheduling
- All state resets are atomic (React batches `setState` calls in the same event handler)

### Demo Data Seeder
- `seedClinicalData.js` creates 2 providers, 10 patients (5 per provider), 10 today's encounters, 20 historical encounters, and 20 pre-signed SOAP notes with realistic psychiatric clinical text
- All historical dates use relative JavaScript `Date` arithmetic — no hardcoded date strings
- All inserts use `ON CONFLICT DO NOTHING` — safe for re-runs (idempotent)
