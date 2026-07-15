-- =============================================================================
-- SEED DATA
-- Purpose:   Insert demo providers, patients, and encounters for local dev
-- Passwords: Both providers use raw password DevPassword1! (bcrypt cost 10)
-- Isolation: Provider 1 owns 2 encounters; Provider 2 owns 1 encounter
-- Window:    3 — seed data implemented
-- =============================================================================

-- -----------------------------------------------------------------------------
-- aiscribe_app: 2 demo providers
-- Hashes generated with bcrypt cost factor 10 against password: DevPassword1!
-- Use these credentials when logging in to the app during Windows 5–9.
--   Doctor A: alice.chen@aiscribe.dev     / DevPassword1!  (provider_id = 1)
--   Doctor B: bob.martinez@aiscribe.dev   / DevPassword1!  (provider_id = 2)
-- -----------------------------------------------------------------------------
\connect aiscribe_app

INSERT INTO providers (email, password_hash, first_name, last_name) VALUES
(
    'alice.chen@aiscribe.dev',
    '$2b$10$MTU1ziQbGHlyKigDiX71AOPq47xol/F3/NRxD3oL9h1UT.H6dPKDS',
    'Alice',
    'Chen'
),
(
    'bob.martinez@aiscribe.dev',
    '$2b$10$0KqkSVWA7KzdrVIZ4K9vb.Y9xPeJL3PmBEq2RB3J6DXHbM5vBVE8W',
    'Bob',
    'Martinez'
);

-- -----------------------------------------------------------------------------
-- simulated_emr: 3 demo patients
-- MRN is the permanent patient identifier — one row per unique patient.
-- -----------------------------------------------------------------------------
\connect simulated_emr

INSERT INTO patient_demographics (mrn, first_name, last_name, dob, gender) VALUES
    ('MRN-001', 'Jane',  'Doe',    '1985-03-15', 'Female'),
    ('MRN-002', 'John',  'Smith',  '1972-07-22', 'Male'),
    ('MRN-003', 'Maria', 'Garcia', '1990-11-08', 'Female');

-- -----------------------------------------------------------------------------
-- simulated_emr: 3 demo encounters
-- Provider 1 (Alice Chen)   → CSN-1001 (Jane Doe),   CSN-1002 (John Smith)
-- Provider 2 (Bob Martinez) → CSN-1003 (Maria Garcia)
--
-- Validation test:
--   SELECT csn FROM encounters WHERE provider_id = 1;  → 2 rows
--   SELECT csn FROM encounters WHERE provider_id = 2;  → 1 row
-- -----------------------------------------------------------------------------
INSERT INTO encounters (csn, mrn, provider_id, visit_date, visit_type) VALUES
    ('CSN-1001', 'MRN-001', 1, '2026-06-20 09:00:00+00', 'INITIAL EVALUATION'),
    ('CSN-1002', 'MRN-002', 1, '2026-06-22 10:30:00+00', 'FOLLOW UP'),
    ('CSN-1003', 'MRN-003', 2, '2026-06-23 14:00:00+00', 'MEDICATION REVIEW');
