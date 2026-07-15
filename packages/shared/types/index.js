/**
 * AIScribe Shared Type Definitions
 *
 * JSDoc typedefs used by both the Express API (apps/api) and the React
 * frontend (apps/web). Centralising these ensures the shapes are consistent
 * across the full stack without requiring TypeScript compilation.
 *
 * Import in any file:
 *   const { } = require('aiscribe-shared');  // CommonJS (Express)
 *   import { } from 'aiscribe-shared';       // ESM (Vite/React)
 *
 * These types are refined in Window 4 (API contract definition).
 */

'use strict';

// ---------------------------------------------------------------------------
// API Response Envelope
// ---------------------------------------------------------------------------

/**
 * Standard API response wrapper for every endpoint.
 * @template T
 * @typedef {Object} ApiResponse
 * @property {boolean} success      - true on 2xx, false on 4xx/5xx
 * @property {T|null}  data         - payload on success, null on error
 * @property {ApiError|null} error  - error details on failure, null on success
 */

/**
 * @typedef {Object} ApiError
 * @property {string} code    - Machine-readable error code (e.g. "INVALID_TOKEN")
 * @property {string} message - User-friendly description
 */

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * JWT payload embedded in the Bearer token.
 * @typedef {Object} TokenPayload
 * @property {number} provider_id
 * @property {string} email
 * @property {number} iat  - issued-at (Unix seconds)
 * @property {number} exp  - expiry (Unix seconds, 24h from iat)
 */

/**
 * Provider record returned from the PROVIDERS table.
 * @typedef {Object} Provider
 * @property {number} provider_id
 * @property {string} email
 * @property {string} first_name
 * @property {string} last_name
 */

// ---------------------------------------------------------------------------
// Patient & Encounter
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PatientDemographics
 * @property {string} mrn
 * @property {string} first_name
 * @property {string} last_name
 * @property {string} dob       - ISO date string YYYY-MM-DD
 * @property {string} gender
 */

/**
 * Encounter row joined with patient demographics.
 * Returned by GET /api/appointments.
 * @typedef {Object} Encounter
 * @property {string} csn
 * @property {string} mrn
 * @property {number} provider_id
 * @property {string} visit_date   - ISO timestamp
 * @property {string} visit_type
 * @property {PatientDemographics} patient
 */

// ---------------------------------------------------------------------------
// SOAP Note
// ALL FOUR KEYS ARE REQUIRED — no blank sections allowed.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SoapNote
 * @property {string} subjective  - Patient-reported symptoms / chief complaint
 * @property {string} objective   - Clinical observations, vitals, exam findings
 * @property {string} assessment  - Clinical impression and diagnosis
 * @property {string} plan        - Treatment, medications, follow-up, referrals
 */

// ---------------------------------------------------------------------------
// Mirth Submission
// ---------------------------------------------------------------------------

/**
 * Payload sent from Express to the Mirth HTTP listener.
 * @typedef {Object} MirthPayload
 * @property {string} csn
 * @property {string} mrn
 * @property {number} providerId
 * @property {string} providerLastName
 * @property {string} providerFirstName
 * @property {string} patientLastName
 * @property {string} patientFirstName
 * @property {string} patientDob    - YYYY-MM-DD
 * @property {string} noteText      - Formatted SOAP narrative (plain text)
 */

/**
 * Acknowledgment returned by Mirth after a successful database write.
 * @typedef {Object} MirthAck
 * @property {boolean} success
 * @property {string}  messageId   - e.g. "MSG20260624150312345"
 * @property {string}  hl7Message  - Base64 or raw encoded HL7 MDM^T02 string
 */

// ---------------------------------------------------------------------------
// Exports — types are consumed via JSDoc @type annotations; no runtime values
// ---------------------------------------------------------------------------
module.exports = {};
