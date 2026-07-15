# AIScribe — Architecture & Design Reference

This document covers the system design, data model, API contracts, HL7 message structures, and key engineering decisions behind the AIScribe platform.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Database Architecture](#2-database-architecture)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [FHIR R4 Schedule Sync](#4-fhir-r4-schedule-sync)
5. [Transcription Pipeline](#5-transcription-pipeline)
6. [Claude SOAP Formatter](#6-claude-soap-formatter)
7. [Mirth Connect HL7 Integration](#7-mirth-connect-hl7-integration)
8. [Idempotency Design](#8-idempotency-design)
9. [Note Amendments & Versioning](#9-note-amendments--versioning)
10. [Patient History & Audit Logging](#10-patient-history--audit-logging)
11. [Frontend Architecture](#11-frontend-architecture)
12. [API Response Envelope](#12-api-response-envelope)

---

## 1. System Overview

AIScribe is structured as a monorepo containing two applications and a shared types package:

```
apps/api    — Express 4 backend (Node 18)
apps/web    — React 18 + Vite 5 frontend
packages/shared — JSDoc typedef definitions consumed by both apps
```

The system integrates three external services:
- **OpenAI Whisper** — audio-to-text transcription
- **Anthropic Claude** — transcript-to-SOAP formatting
- **Mirth Connect** — HL7 v2 message broker (runs locally, not in Docker)

And two PostgreSQL 15 databases (both served by the same Docker Compose container):
- **aiscribe_app** — application-owned data
- **simulated_emr** — hospital-side data (Mirth is the exclusive writer)

---

## 2. Database Architecture

### Two-Database Isolation

The project enforces strict isolation between the two databases using **separate `pg.Pool` instances** (`appDb.js` and `emrDb.js`). They can never share a connection.

**Access rules:**

| Database | Express | Mirth |
|---|---|---|
| `aiscribe_app` | Read / Write | ❌ Never |
| `simulated_emr` | Read Only | Write Only |

This mirrors the real-world separation between an EHR vendor's internal system and the hospital's application layer.

### aiscribe_app Schema

```sql
providers
  provider_id SERIAL PRIMARY KEY
  email TEXT UNIQUE NOT NULL
  password_hash TEXT NOT NULL
  first_name TEXT, last_name TEXT
  custom_prompt_template TEXT (nullable — null = use system default)

app_appointments           -- local FHIR cache
  csn TEXT PRIMARY KEY
  mrn TEXT, provider_id INT
  patient_first_name TEXT, patient_last_name TEXT, patient_dob DATE
  visit_date TIMESTAMPTZ, visit_type TEXT
  audio_status TEXT DEFAULT 'Pending'  -- Pending | Processing | SOAP Ready | Submitted
  last_synced TIMESTAMPTZ

audit_logs
  id SERIAL PRIMARY KEY
  operator_id INT NOT NULL     -- provider_id
  action TEXT NOT NULL         -- SCHEDULE_VIEWED | SOAP_GENERATED | NOTE_SIGNED | NOTE_AMENDED | HISTORY_VIEWED
  target_mrn TEXT, target_csn TEXT
  ip_address TEXT
  created_at TIMESTAMPTZ DEFAULT NOW()

submission_idempotency
  id SERIAL PRIMARY KEY
  csn TEXT NOT NULL
  idempotency_key UUID NOT NULL
  mirth_response JSONB NOT NULL
  created_at TIMESTAMPTZ DEFAULT NOW()
  UNIQUE (csn, idempotency_key)
```

### simulated_emr Schema

```sql
patient_demographics
  mrn TEXT PRIMARY KEY
  first_name TEXT, last_name TEXT, dob DATE, gender TEXT

encounters
  csn TEXT PRIMARY KEY
  mrn TEXT REFERENCES patient_demographics(mrn)
  provider_id INT NOT NULL
  visit_date TIMESTAMPTZ, visit_type TEXT

clinical_notes               -- v1 notes (initial submission)
  id SERIAL PRIMARY KEY
  csn TEXT UNIQUE REFERENCES encounters(csn)
  note_text TEXT NOT NULL
  date_signed TIMESTAMPTZ DEFAULT NOW()
  status TEXT DEFAULT 'signed'
  authored_by TEXT

clinical_note_versions       -- v2+ notes (amendments)
  id SERIAL PRIMARY KEY
  csn TEXT REFERENCES encounters(csn)
  note_text TEXT NOT NULL
  version_num INT NOT NULL
  is_current BOOLEAN DEFAULT TRUE
  date_signed TIMESTAMPTZ DEFAULT NOW()
  status TEXT DEFAULT 'amended'
  authored_by TEXT
  amendment_reason TEXT
  UNIQUE (csn, version_num)
```

---

## 3. Authentication & Authorization

### Login Flow

1. `POST /api/auth/login` receives `{ email, password }`
2. Provider record fetched by email (lowercase-trimmed)
3. `bcrypt.compare(password, password_hash)` — cost factor 10
4. **Enumeration guard:** identical `INVALID_CREDENTIALS` (401) for wrong email OR wrong password — never reveals which field failed
5. JWT issued (HS256, 24h TTL) containing `{ provider_id, email, first_name, last_name, iat, exp }`
6. Fire-and-forget FHIR auto-sync kicks off (not awaited — login response stays fast)

### JWT Validation (`requireAuth` middleware)

- Splits `Authorization: Bearer <token>` header
- `jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })`
- On success: sets `req.user = { provider_id, email }`
- `TokenExpiredError` → 401 `TOKEN_EXPIRED`
- All other errors → 401 `INVALID_TOKEN`

### Provider Isolation

Every SQL query that accesses patient or appointment data is parameterized with the JWT-sourced `req.user.provider_id`. Providers can never read or write data belonging to another provider.

---

## 4. FHIR R4 Schedule Sync

### Mock FHIR Gateway (`GET /fhir/R4/Encounter`)

- No JWT required (simulates open hospital FHIR endpoint)
- Reads from `simulated_emr.encounters` joined with `patient_demographics`
- Returns a FHIR R4 Bundle (resourceType: "Bundle", type: "searchset")
- Each entry is a FHIR R4 Encounter resource with a non-standard `_demographics` extension block carrying the patient data needed for the cache upsert

### fhirSync Service

- Called via HTTP (axios) — not via direct DB access
- Upserts Encounter entries into `aiscribe_app.app_appointments`
- `ON CONFLICT (csn) DO UPDATE` updates scheduling metadata only — `audio_status` is intentionally excluded from the `DO UPDATE` clause to preserve `Processing`, `SOAP Ready`, and `Submitted` states

### Three Sync Trigger Points

| Trigger | Behavior |
|---|---|
| `POST /api/auth/login` | Fire-and-forget (not awaited) |
| `POST /api/schedule/sync` | Awaited, returns `{ synced: N }` |
| `GET /api/appointments` (zero rows) | Awaited, transparent to the client |

---

## 5. Transcription Pipeline

### Multer Configuration

- `multer.memoryStorage()` — audio lives only in RAM as `req.file.buffer`
- 25 MB file size limit (enforced by multer + a belt-and-suspenders explicit check)
- Allowed MIME types: `audio/mpeg`, `audio/wav`, `audio/wave`, `audio/x-wav`
- Files are **never written to disk** — the buffer is garbage-collected when the handler returns

### Whisper Integration

- Uses Node 18 native `fetch`, `FormData`, and `Blob` — no additional packages
- `AbortController` with 30-second timeout → `TRANSCRIPTION_TIMEOUT` error code
- Multipart form data: field `file` (Blob), field `model` ("whisper-1")
- **Do not set `Content-Type` manually** — `fetch` sets the multipart boundary automatically when body is `FormData`

### audio_status Lifecycle

```
app_appointments.audio_status:
  Pending → Processing (before Whisper call)
           → SOAP Ready (after successful Claude response)
           → Submitted (after Mirth ACK)
```

All `audio_status` updates are fire-and-forget — wrapped in a standalone `try/catch` so DB failures never surface to the clinician.

---

## 6. Claude SOAP Formatter

### System Prompt Assembly Order

The final system prompt is assembled in this fixed order:

```
(a) Base prompt         — custom template (if set) or DEFAULT_CLINICAL_PROMPT
(b) JSON enforcement    — injected after custom templates only (default already has JSON instructions)
(c) Historical context  — injected for follow-up/routine visits (if available)
(d) Control block       — ALWAYS appended last
```

### Three-Step Parse Pipeline

**Step 1 — Extract [CONTROL_BLOCK] first**

Claude is instructed to append a JSON control block at the end of every response:
```
[CONTROL_BLOCK]{"schedule_follow_up": true, "timeline_weeks": 6}[/CONTROL_BLOCK]
```
This is extracted via regex and stripped from the raw text **before** SOAP parsing. If parsed after, the closing delimiter corrupts the `plan` section.

**Step 2 — Parse SOAP JSON**

The cleaned text (control block removed) is parsed as JSON. Optional markdown code fences (```` ``` ```` or ```` ```json ````) are stripped first as a safety net.

**Step 3 — Validate SOAP**

All four keys (`subjective`, `objective`, `assessment`, `plan`) must be present as non-empty strings. Empty string or non-string values fail validation with `SOAP_FORMATTING_FAILED`.

### Historical Context Injection

Only injected for visit types containing "follow" or "routine" (case-insensitive). Fetched from:
1. `clinical_note_versions` (most recent, `is_current = TRUE`) — covers amended notes
2. `clinical_notes` (fallback) — covers v1-only records

The fetch is non-fatal — failures fall back to `null` (no context injected).

### Automated Follow-Up Scheduling

If `controlBlock.schedule_follow_up === true`:
1. Express generates `newCsn = CSN-AUTO-{Date.now()}`
2. `targetDate = now + timeline_weeks * 7 days`
3. Sends `SCHEDULE_FOLLOWUP` payload to Mirth (see §7)
4. `sendSchedule()` is intentionally non-throwing — failure never blocks the SOAP response
5. Follow-up info (`scheduled`, `date`, `csn`) is returned to the browser regardless of Mirth success

---

## 7. Mirth Connect HL7 Integration

### Mirth Channel Design

The `mirth-aiscribe-inbound.xml` channel implements:
- **Source connector:** HTTP Listener on port 8081, path `/aiscribe-inbound/`
- **Source transformer:** JavaScript — detects payload type, builds HL7 or routes follow-up scheduling
- **Destination:** JavaScript Writer — parameterized INSERT into `simulated_emr`

### Note Submission Payload (9 fields)

```json
{
  "csn": "CSN-123456",
  "mrn": "MRN-001",
  "providerId": 1,
  "providerLastName": "Chen",
  "providerFirstName": "Alice",
  "patientLastName": "Smith",
  "patientFirstName": "John",
  "patientDob": "1985-04-12",
  "noteText": "SUBJECTIVE: ...\n\nOBJECTIVE: ...\n\nASSESSMENT: ...\n\nPLAN: ..."
}
```

### HL7 Message Types

| Condition | Message Type | `docStatus` |
|---|---|---|
| Initial submission (`version_num` absent or 1) | MDM^T02 | `AU` |
| Amendment (`version_num` > 1) | MDM^T04 | `LA` |

### Follow-Up Scheduling Payload

```json
{
  "type": "SCHEDULE_FOLLOWUP",
  "mrn": "MRN-001",
  "providerId": 1,
  "targetDate": "2026-10-01T10:00:00.000Z",
  "originCsn": "CSN-123456",
  "timelineWeeks": 12,
  "newCsn": "CSN-AUTO-1751234567890"
}
```

Mirth's source transformer detects `type === 'SCHEDULE_FOLLOWUP'`, skips HL7 building, and routes directly to the JavaScript Writer destination which INSERTs a new row into `simulated_emr.encounters`.

### Mirth ACK Response

```json
{
  "messageId": "MSG20260628150312345",
  "status": "ACK",
  "hl7": "MSH|^~\\&|AISCRIBE|..."
}
```

---

## 8. Idempotency Design

### Problem

Network failures between the browser and the Express API can cause the clinician to click "Submit Note" multiple times. Without protection, each retry would create a duplicate note in the EMR.

### Solution

**Browser-side:** A UUID4 `idempotencyKey` is generated once when transcription succeeds and stored in a `useRef` — it is never regenerated on retry.

**Server-side:** Before calling Mirth, Express checks `submission_idempotency` for `(csn, idempotency_key)`. If found (within 24 hours), returns 409 with the cached Mirth ACK.

**After Mirth success:** The ACK is inserted into `submission_idempotency` with `ON CONFLICT DO NOTHING` — the `UNIQUE(csn, idempotency_key)` constraint is the ultimate guard.

### Key Decision: idempotencyKey Lifecycle

| Event | Key state |
|---|---|
| Transcription succeeds | Key born (`uuidv4()`) |
| Submit retry | Same key reused |
| Back to appointments | Key destroyed |
| Logout | Key destroyed |

---

## 9. Note Amendments & Versioning

### Immutability Principle

Signed notes in `clinical_notes` are **never updated**. Amendments create a new row in `clinical_note_versions`.

### Version Calculation

```sql
SELECT COALESCE(MAX(version_num), 1) + 1 AS next_ver
FROM clinical_note_versions
WHERE csn = $1
```

The first amendment is always v2 (`MAX` returns NULL → `COALESCE` returns 1 → `+ 1` = 2).

### is_current Flag

Mirth manages the `is_current` flag:
- On new amendment: sets all existing rows for the CSN to `is_current = FALSE`, then inserts the new row with `is_current = TRUE`

### Note Fetch Fallback Chain

`GET /api/notes/:csn`:
1. Check `clinical_note_versions WHERE is_current = TRUE` — covers amended notes
2. Fallback to `clinical_notes` — covers v1-only records
3. 404 `NOTE_NOT_FOUND` if neither exists

---

## 10. Patient History & Audit Logging

### Two-Phase Patient History Access

`GET /api/patients/:mrn/history`:

**Phase 1 (aiscribe_app — access guard):**
```sql
SELECT 1 FROM app_appointments
WHERE mrn = $1 AND provider_id = $2
LIMIT 1
```
If no row: 403 `PATIENT_ACCESS_DENIED`. No hospital data is touched.

**Phase 2 (simulated_emr — record fetch):**
Three batch queries using `ANY($csns)` to avoid N+1 round trips:
1. All encounters for the MRN
2. All `clinical_note_versions` (current) for those CSNs
3. All `clinical_notes` (v1) for those CSNs

Result is assembled in JavaScript — note availability priority: `clinical_note_versions` > `clinical_notes` > no note.

### Audit Log — Fire-and-Forget Pattern

```javascript
// Correct — do NOT await, do NOT chain .catch()
auditLogger.logAccess(provider_id, 'NOTE_SIGNED', mrn, csn, req.ip);
```

`logAccess()` catches all errors internally and never throws. Clinical workflow is never blocked by an audit write failure.

---

## 11. Frontend Architecture

### View State Machine

`App.jsx` maintains a single `view` string:
```
login → appointments → upload → editor → success
                                       ↕
                                     settings
```

`navigateTo(view)` wraps `setView()` with `window.scrollTo(0, 0)`.

### PatientSidebar Mount Level

`PatientSidebar` is mounted in `App.jsx` (not inside `Dashboard`). This keeps its state (`selectedMrn`, `historyCache`, `viewerCsn`) alive across all view transitions without remounting.

### idempotencyKeyRef Pattern

Using `useRef` (not `useState`) for the idempotency key means:
- Ref value survives re-renders (stable across retries)
- Changing the ref does not trigger a re-render
- Destroyed (set to `null`) only on deliberate navigation events

### Atomic State Reset

React batches all `setState` calls in the same synchronous event handler into a single re-render. All `handle*` functions that reset workflow state call every setter in one block — no half-reset states are ever rendered.

---

## 12. API Response Envelope

Every endpoint returns the same JSON structure:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

On error:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable description for display in the UI."
  }
}
```

### Error Codes Reference

| Code | HTTP Status | Description |
|---|---|---|
| `MISSING_CREDENTIALS` | 400 | Email or password not provided |
| `INVALID_CREDENTIALS` | 401 | Wrong email or wrong password (same response) |
| `INVALID_TOKEN` | 401 | Malformed or invalid JWT |
| `TOKEN_EXPIRED` | 401 | JWT past its `exp` claim |
| `NO_AUDIO_FILE` | 400 | No file attached to the transcribe request |
| `INVALID_AUDIO_FORMAT` | 400 | File is not .mp3 or .wav |
| `AUDIO_FILE_TOO_LARGE` | 400 | File exceeds 25 MB |
| `TRANSCRIPTION_TIMEOUT` | 422 | Whisper did not respond within 30 seconds |
| `SOAP_FORMATTING_FAILED` | 422 | Claude returned unparseable or invalid output |
| `ENCOUNTER_ACCESS_DENIED` | 403 | CSN does not belong to this provider |
| `PATIENT_ACCESS_DENIED` | 403 | MRN not in this provider's patient list |
| `NOTE_NOT_FOUND` | 404 | No signed note exists for this CSN |
| `MISSING_AMENDMENT_REASON` | 400 | Amendment reason was empty or missing |
| `DUPLICATE_SUBMISSION` | 409 | `(csn, idempotency_key)` already in cache |
| `MIRTH_UNAVAILABLE` | 422 | Mirth unreachable or returned a non-200 response |
| `INTERNAL_SERVER_ERROR` | 500 | Unhandled exception |
