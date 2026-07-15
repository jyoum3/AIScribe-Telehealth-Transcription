/**
 * Service: HIPAA Audit Logger
 *
 * Fire-and-forget write to aiscribe_app.audit_logs.
 * This function NEVER throws — all errors are caught and logged only.
 * Clinical workflow is never blocked by an audit write failure.
 *
 * Valid action values:
 *   SCHEDULE_VIEWED  — GET /api/appointments
 *   SOAP_GENERATED   — POST /api/transcribe
 *   NOTE_SIGNED      — POST /api/submit-note
 *   NOTE_AMENDED     — POST /api/notes/amend
 *   HISTORY_VIEWED   — GET /api/patients/:mrn/history
 *
 * Usage (fire-and-forget — do NOT await):
 *   auditLogger.logAccess(req.user.provider_id, 'SCHEDULE_VIEWED', null, null, req.ip);
 */

'use strict';

const appDb = require('../db/appDb');

/**
 * Log a HIPAA-relevant access event.
 *
 * @param {number}      operatorId  - provider_id from JWT
 * @param {string}      action      - one of the valid action enum values above
 * @param {string|null} targetMrn   - MRN of the patient involved, or null
 * @param {string|null} targetCsn   - CSN of the encounter involved, or null
 * @param {string|null} ipAddress   - req.ip from Express, or null
 * @returns {Promise<void>}         - always resolves, never rejects
 */
async function logAccess(operatorId, action, targetMrn, targetCsn, ipAddress) {
  try {
    await appDb.query(
      `INSERT INTO audit_logs (operator_id, action, target_mrn, target_csn, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [operatorId, action, targetMrn ?? null, targetCsn ?? null, ipAddress ?? null]
    );
  } catch (err) {
    // Intentionally silent — audit failures must never surface to the clinician
    console.error('[auditLogger] Failed to write audit log entry:', {
      operatorId,
      action,
      targetMrn,
      targetCsn,
      error: err.message,
    });
  }
}

module.exports = { logAccess };
