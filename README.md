# AIScribe — Telehealth Transcription Platform

AI-powered clinical documentation assistant for psychiatric telehealth. Clinicians upload an audio recording of an encounter; AIScribe transcribes it via OpenAI Whisper, formats it into a structured SOAP note via Anthropic Claude, and submits the signed note to a simulated EHR through a Mirth Connect HL7 v2 integration.

---

## Live Demo

https://github.com/user-attachments/assets/dcba7b36-ade8-46e1-bc73-e9f1241006b0

<video src="docs/AISCRIBE-LIVE-DEMO.mp4" width="100%" controls></video>

*Watch the 5-minute walkthrough showcasing real-time Whisper transcription, Claude SOAP generation, Mirth Connect HL7 v2 compilation, and PostgreSQL simulated EMR database writes.*

---

## Features

| Feature | Details |
|---|---|
| 🎙️ Audio Transcription | OpenAI Whisper (`whisper-1`) — in-memory processing, never written to disk |
| 🤖 SOAP Note Generation | Anthropic Claude (`claude-sonnet-4-6`) — structured JSON output with validation |
| 🏥 HL7 v2 Integration | Mirth Connect HTTP Listener → MDM^T02/T04 messages → PostgreSQL EMR |
| 📅 FHIR R4 Schedule Sync | Internal mock FHIR gateway; auto-syncs on login, manual refresh available |
| 📝 Note Amendments | Full versioned amendment workflow with audit trail and idempotency |
| 👥 Patient History Sidebar | Longitudinal view of all encounters and signed notes per patient |
| 🔄 Follow-Up Scheduling | Claude control block signals Mirth to insert a new follow-up encounter |
| ⚙️ Custom AI Prompts | Per-provider Claude prompt templates, stored and applied at transcription time |
| 🔒 HIPAA Audit Logging | Every clinical access event written to `audit_logs` (fire-and-forget, non-blocking) |
| 🔑 JWT Authentication | HS256, 24-hour TTL, enumeration-safe login error handling |

---

## Architecture Overview

```
Browser (React + Vite)
        │
        │ HTTPS / Vite proxy
        ▼
Express API (Node 18)
   ├── JWT auth middleware
   ├── /api/auth/login          → bcrypt compare → JWT issue + FHIR auto-sync
   ├── /api/appointments        → FHIR cache read (aiscribe_app)
   ├── /api/transcribe          → Whisper → Claude → SOAP JSON
   ├── /api/submit-note         → Idempotency check → Mirth → HL7 ACK
   ├── /api/notes/amend         → Mirth → MDM^T04 → versioned note
   ├── /api/patients/history    → Two-phase access guard + batch EMR read
   ├── /fhir/R4/Encounter       → Mock FHIR gateway (no JWT)
   └── /api/providers/me        → Custom prompt template CRUD
        │
        ├── aiscribe_app (PostgreSQL)
        │     providers, app_appointments, audit_logs, submission_idempotency
        │
        └── simulated_emr (PostgreSQL) ← Mirth Connect exclusive writer
              patient_demographics, encounters, clinical_notes, clinical_note_versions

External APIs: OpenAI Whisper · Anthropic Claude
HL7 Broker:   Mirth Connect 4.x (local, Docker-free)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a detailed breakdown of every design decision.

---

## Tech Stack

**Backend:** Node 18 · Express 4 · PostgreSQL 15 · Mirth Connect 4.x  
**Frontend:** React 18 · Vite 5 · Axios  
**AI/ML:** OpenAI Whisper API · Anthropic Claude API  
**HL7:** MDM^T02 (new note) · MDM^T04 (amendment) · FHIR R4 Bundle  
**Auth:** JWT (HS256) · bcrypt  
**DevOps:** Docker Compose (PostgreSQL only)

---

## Local Setup

### Prerequisites

- Node.js ≥ 18
- Docker Desktop (for PostgreSQL)
- Mirth Connect 4.x installed locally
- OpenAI API key
- Anthropic API key

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/AIScribe-Telehealth-Transcription.git
cd AIScribe-Telehealth-Transcription
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# Fill in: JWT_SECRET, OPENAI_API_KEY, ANTHROPIC_API_KEY
```

### 3. Start PostgreSQL

```bash
docker-compose up -d
# Postgres auto-runs database/init/*.sql on first boot
```

### 4. Seed demo data

```bash
npm run seed:clinical
# Creates 2 providers, 10 patients, 30 encounters, 20 pre-signed SOAP notes
```

### 5. Configure Mirth Connect

Import `mirth-aiscribe-inbound.xml` into your local Mirth Connect instance and deploy the channel.

### 6. Start the application

```bash
# Terminal 1 — Express API
npm run api

# Terminal 2 — React frontend
npm run web
```

Open [http://localhost:3000](http://localhost:3000)

**Demo credentials:**
- `alice.chen@aiscribe.dev` / `DevPassword1!`
- `robert.kim@aiscribe.dev` / `DevPassword1!`

---

## Project Structure

```
AIScribe-Telehealth-Transcription/
├── apps/
│   ├── api/                    # Express backend
│   │   └── src/
│   │       ├── db/             # PostgreSQL connection pools (appDb, emrDb)
│   │       ├── middleware/     # JWT auth middleware
│   │       ├── routes/         # REST endpoints
│   │       └── services/       # Whisper, Claude, Mirth, FHIR, audit logger
│   └── web/                    # React frontend (Vite)
│       └── src/
│           ├── components/     # All UI components
│           └── services/       # Axios API client
├── database/
│   └── init/                   # PostgreSQL init SQL (auto-runs in Docker)
│       ├── 01_aiscribe_app.sql
│       ├── 02_simulated_emr.sql
│       ├── 03_seed_data.sql
│       └── 04_phase3_schema.sql
├── packages/
│   └── shared/types/           # Shared JSDoc type definitions
├── mirth-aiscribe-inbound.xml  # Mirth Connect channel export
├── docker-compose.yml
└── .env.example
```

---

## API Reference

All endpoints return the standard envelope:

```json
{ "success": true|false, "data": { ... } | null, "error": { "code": "...", "message": "..." } | null }
```

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | ❌ | Credential validation + JWT issue |
| GET | `/api/appointments` | ✅ | Today's pending encounters (FHIR cache) |
| GET | `/api/appointments/completed` | ✅ | Today's submitted encounters |
| POST | `/api/schedule/sync` | ✅ | Manual FHIR schedule sync |
| POST | `/api/transcribe` | ✅ | Audio → Whisper → Claude → SOAP |
| POST | `/api/submit-note` | ✅ | SOAP → Mirth → HL7 ACK |
| GET | `/api/notes/:csn` | ✅ | Fetch current signed note |
| POST | `/api/notes/amend` | ✅ | Submit note amendment |
| GET | `/api/patients` | ✅ | Provider's patient directory |
| GET | `/api/patients/:mrn/history` | ✅ | Patient encounter + note history |
| GET | `/api/providers/me` | ✅ | Provider profile + custom prompt |
| POST | `/api/providers/me/prompt` | ✅ | Save/reset custom Claude prompt |
| GET | `/fhir/R4/Encounter` | ❌ | Mock FHIR R4 gateway |

Full request/response shapes are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — System design, data model, HL7 contracts, and key engineering decisions
- [`CHANGELOG.md`](CHANGELOG.md) — Feature history and implementation milestones
- [`mirth-aiscribe-inbound.xml`](mirth-aiscribe-inbound.xml) — Mirth Connect channel (importable)

---

## Security Notes

- Audio files are **never written to disk** — processed entirely in RAM via `multer.memoryStorage()`
- Patient data is never logged in console output
- Provider isolation enforced at the SQL level on every query
- All HIPAA-relevant actions are written to `audit_logs` (fire-and-forget, non-blocking)
- Enumeration-safe login: identical `INVALID_CREDENTIALS` response for wrong email or wrong password
- JWT secret is environment-variable only — never hardcoded

---

## Author

**James Youm** — Cloud Computing, new grad 2026  
Built as a portfolio project to demonstrate full-stack healthcare interoperability engineering.

> This is a simulation project. No real patient data is used. The "simulated EMR" database is seeded with fictional demographics.
