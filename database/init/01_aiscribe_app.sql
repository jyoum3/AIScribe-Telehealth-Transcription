-- =============================================================================
-- DATABASE: aiscribe_app
-- Purpose:  Web application data — provider auth, session state, idempotency
-- Access:   Express backend (Read/Write). Mirth Connect (NO ACCESS).
-- Window:   3 — full schema implemented
-- =============================================================================

\connect postgres

CREATE DATABASE aiscribe_app;

\connect aiscribe_app

-- -----------------------------------------------------------------------------
-- providers
-- Stores clinician login credentials issued at account creation.
-- password_hash is a bcrypt string (cost factor 10) — the raw password is
-- never stored. Express compares submitted passwords with bcrypt.compare().
-- provider_id is the integer that flows into ENCOUNTERS.provider_id in
-- simulated_emr, establishing the cross-database logical link without any
-- actual foreign key relationship between the two databases.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS providers (
    provider_id   SERIAL       PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255)        NOT NULL,
    first_name    VARCHAR(100),
    last_name     VARCHAR(100)
);

-- -----------------------------------------------------------------------------
-- submission_idempotency
-- Prevents duplicate note submissions.
-- When a note is successfully submitted, Express writes a row here keyed on
-- (csn, idempotency_key). If the identical pair arrives again within 24 hours,
-- Express returns the cached mirth_response without re-calling Mirth or
-- writing a duplicate row to simulated_emr.clinical_notes.
-- The UNIQUE constraint on (csn, idempotency_key) is the enforcement boundary.
-- The supporting index makes the duplicate lookup fast at query time.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submission_idempotency (
    id              SERIAL      PRIMARY KEY,
    csn             VARCHAR(50) NOT NULL,
    idempotency_key UUID        NOT NULL,
    mirth_response  JSONB       NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(csn, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_csn_key
    ON submission_idempotency(csn, idempotency_key);
