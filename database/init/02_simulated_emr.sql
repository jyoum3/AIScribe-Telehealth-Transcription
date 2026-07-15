-- =============================================================================
-- DATABASE: simulated_emr
-- Purpose:  EMR simulation — patients, encounters, clinical notes
-- Access:   Mirth Connect (Exclusive Write). Express backend (Read-Only).
-- Window:   3 — full schema implemented
-- =============================================================================

\connect postgres

CREATE DATABASE simulated_emr;

\connect simulated_emr

-- -----------------------------------------------------------------------------
-- patient_demographics
-- MRN (Medical Record Number) is the permanent, lifetime patient identifier.
-- A patient retains the same MRN across every visit, every year. The MRN is
-- the top-level anchor that all encounters hang off of.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_demographics (
    mrn        VARCHAR(50) PRIMARY KEY,
    first_name VARCHAR(100),
    last_name  VARCHAR(100),
    dob        DATE,
    gender     VARCHAR(20)
);

-- -----------------------------------------------------------------------------
-- encounters
-- CSN (Contact Serial Number) is the unique identifier for a single visit.
-- One patient (MRN) can have many encounters (CSNs) across multiple visits.
-- provider_id is a plain INT — there is deliberately NO foreign key to
-- aiscribe_app.providers. The two databases must never be joined at the DB
-- level. The logical association is enforced in application
-- code only.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS encounters (
    csn         VARCHAR(50) PRIMARY KEY,
    mrn         VARCHAR(50) REFERENCES patient_demographics(mrn),
    provider_id INT,
    visit_date  TIMESTAMP WITH TIME ZONE,
    visit_type  VARCHAR(50)
);

-- -----------------------------------------------------------------------------
-- clinical_notes
-- One note per encounter (enforced by UNIQUE on csn).
-- Mirth Connect is the exclusive writer — it inserts here after transforming
-- the inbound JSON payload to HL7 MDM^T02 format.
-- Express reads this table in read-only mode only; it never writes here
-- directly, all writes go through the Mirth channel.
-- status defaults to 'SIGNED' — matching the TXA-17 'AU' (authenticated)
-- segment in the outbound HL7 message.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinical_notes (
    note_id     SERIAL      PRIMARY KEY,
    csn         VARCHAR(50) UNIQUE REFERENCES encounters(csn),
    note_text   TEXT        NOT NULL,
    status      VARCHAR(50) DEFAULT 'SIGNED',
    date_signed TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
