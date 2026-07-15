-- =============================================================================
-- PHASE 3 SCHEMA MIGRATION
-- Purpose:  Evolve both databases to their Phase 3 shape (Window 11)
-- Safe:     All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards
--           so this file can be re-run without errors.
-- Execution order: runs after 01, 02, 03 (alphabetical boot sequence)
-- =============================================================================

-- =============================================================================
-- SECTION A — aiscribe_app additions
-- =============================================================================
\connect aiscribe_app

-- -----------------------------------------------------------------------------
-- providers: add custom_prompt_template column
-- Stores per-provider Claude system prompt override. NULL = use default template.
-- -----------------------------------------------------------------------------
ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS custom_prompt_template TEXT DEFAULT NULL;

-- -----------------------------------------------------------------------------
-- app_appointments — local FHIR schedule cache
-- Populated by fhirSync.js after querying the internal FHIR R4 mock endpoint.
-- Express reads appointments from here (never directly from simulated_emr after
-- Window 12). audio_status tracks the note pipeline lifecycle (§9.8).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_appointments (
    id                SERIAL       PRIMARY KEY,
    csn               VARCHAR(50)  UNIQUE NOT NULL,
    mrn               VARCHAR(50)  NOT NULL,
    provider_id       INT          NOT NULL,
    patient_first_name VARCHAR(100),
    patient_last_name  VARCHAR(100),
    patient_dob       DATE,
    visit_date        TIMESTAMP WITH TIME ZONE,
    visit_type        VARCHAR(50),
    -- Pipeline lifecycle: Pending → Processing → SOAP Ready → Submitted (§9.8)
    audio_status      VARCHAR(50)  DEFAULT 'Pending',
    transcript_id     UUID,
    last_synced       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- audit_logs — HIPAA compliance trail
-- All writes via appDb pool. Fire-and-forget — never blocks clinical workflow.
-- Action types: SCHEDULE_VIEWED, CHART_OPENED, SOAP_GENERATED, NOTE_SIGNED,
--               NOTE_AMENDED, HISTORY_VIEWED
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id          SERIAL       PRIMARY KEY,
    operator_id INT          NOT NULL,
    action      VARCHAR(100) NOT NULL,
    target_mrn  VARCHAR(50),
    target_csn  VARCHAR(50),
    ip_address  VARCHAR(45),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index: supports fast operator + time-range queries for compliance reporting
CREATE INDEX IF NOT EXISTS idx_audit_logs_operator
    ON audit_logs(operator_id, created_at);


-- =============================================================================
-- SECTION B — simulated_emr additions
-- =============================================================================
\connect simulated_emr

-- -----------------------------------------------------------------------------
-- clinical_note_versions — immutable note versioning
-- Signed notes are NEVER updated (no destructive UPDATE on clinical_notes).
-- v1 stays in clinical_notes. v2+ land here as new rows.
-- Before inserting a new version: all existing rows for that CSN are set to
-- is_current = FALSE. The new row enters with is_current = TRUE.
-- Mirth writes here when version_num > 1 (MDM^T04 path — §9.4).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinical_note_versions (
    version_id       SERIAL      PRIMARY KEY,
    csn              VARCHAR(50) REFERENCES encounters(csn),
    note_text        TEXT        NOT NULL,
    version_num      INT         NOT NULL DEFAULT 1,
    is_current       BOOLEAN     NOT NULL DEFAULT TRUE,
    authored_by      INT,
    amendment_reason TEXT,
    status           VARCHAR(50) DEFAULT 'SIGNED',
    date_signed      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Prevents duplicate version numbers for the same encounter
    UNIQUE(csn, version_num)
);

-- Index: supports fast CSN lookups when fetching current/all versions
CREATE INDEX IF NOT EXISTS idx_note_versions_csn
    ON clinical_note_versions(csn);
