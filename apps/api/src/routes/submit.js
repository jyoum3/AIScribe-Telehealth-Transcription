/**
 * Route: POST /api/submit-note
 *
 * Accepts the clinician's reviewed SOAP note, validates ownership, checks for
 * duplicate submissions, forwards to Mirth Connect, caches the acknowledgment,
 * and returns the HL7 confirmation to the browser.
 *
 * Flow:
 *   1. requireAuth  → verify JWT, extract provider_id
 *   2. Validate     → csn, soap (all 4 keys, no blanks), idempotencyKey
 *   3. Ownership    → CSN must belong to the authenticated provider
 *   4. Idempotency  → (csn, idempotency_key) already in submission_idempotency? → 409
 *   5. Lookup       → provider name from aiscribe_app
 *   6. Lookup       → patient demographics from simulated_emr
 *   7. Build payload → 9-field Mirth JSON contract
 *   8. Call Mirth   → POST to HTTP listener, receive HL7 ACK
 *   9. Cache        → INSERT into submission_idempotency
 *  10. Update status → app_appointments.audio_status = 'Submitted'
 *  11. Audit log   → NOTE_SIGNED (fire-and-forget)
 *  12. Respond     → 200 { mirthAck, dbWriteConfirmed: true }
 *
 * Error codes: MISSING_FIELDS | INCOMPLETE_SOAP | ENCOUNTER_ACCESS_DENIED |
 *              DUPLICATE_SUBMISSION | MIRTH_UNAVAILABLE
 */

'use strict';

const express         = require('express');
const { requireAuth } = require('../middleware/auth');
const appDb           = require('../db/appDb');
const emrDb           = require('../db/emrDb');
const auditLogger     = require('../services/auditLogger');
const { sendToMirth, buildNoteText } = require('../services/mirth');

const router = express.Router();

const REQUIRED_SOAP_KEYS = ['subjective', 'objective', 'assessment', 'plan'];

router.post('/', requireAuth, async (req, res) => {
  const { csn, soap, idempotencyKey } = req.body;
  const providerId = req.user.provider_id;

  if (!csn || !soap || !idempotencyKey) {
    return res.status(400).json({
      success: false,
      data:    null,
      error:   { code: 'MISSING_FIELDS', message: 'csn, soap, and idempotencyKey are all required.' },
    });
  }

  for (const key of REQUIRED_SOAP_KEYS) {
    if (!soap[key] || typeof soap[key] !== 'string' || soap[key].trim() === '') {
      return res.status(400).json({
        success: false,
        data:    null,
        error:   { code: 'INCOMPLETE_SOAP', message: 'SOAP note must include all four sections: subjective, objective, assessment, and plan.' },
      });
    }
  }

  try {
    // Verify CSN belongs to authenticated provider
    const encounterResult = await emrDb.query(
      `SELECT e.csn, e.mrn, e.visit_date,
              p.first_name AS patient_first_name,
              p.last_name  AS patient_last_name,
              p.dob        AS patient_dob
       FROM   encounters e
       JOIN   patient_demographics p ON p.mrn = e.mrn
       WHERE  e.csn = $1`,
      [csn]
    );

    if (encounterResult.rows.length === 0) {
      console.warn(`[submit-note] CSN not found: ${csn}`);
      return res.status(403).json({
        success: false,
        data:    null,
        error:   { code: 'ENCOUNTER_ACCESS_DENIED', message: 'You do not have permission to submit a note for this encounter.' },
      });
    }

    const encounter = encounterResult.rows[0];

    const ownershipResult = await emrDb.query(
      'SELECT provider_id FROM encounters WHERE csn = $1 AND provider_id = $2',
      [csn, providerId]
    );

    if (ownershipResult.rows.length === 0) {
      console.warn(`[submit-note] provider_id=${providerId} tried to submit for CSN=${csn} (ownership denied)`);
      return res.status(403).json({
        success: false,
        data:    null,
        error:   { code: 'ENCOUNTER_ACCESS_DENIED', message: 'You do not have permission to submit a note for this encounter.' },
      });
    }

    // Check idempotency cache
    const dupeResult = await appDb.query(
      `SELECT mirth_response FROM submission_idempotency
       WHERE  csn = $1 AND idempotency_key = $2
         AND  created_at > NOW() - INTERVAL '24 hours'`,
      [csn, idempotencyKey]
    );

    if (dupeResult.rows.length > 0) {
      const cached = dupeResult.rows[0].mirth_response;
      console.log(`[submit-note] Duplicate detected — CSN=${csn} key=${idempotencyKey} — returning cached ACK`);
      return res.status(409).json({
        success: false,
        data:    { cached: true, mirthAck: cached },
        error:   { code: 'DUPLICATE_SUBMISSION', message: 'This note has already been submitted. Showing the original confirmation.' },
      });
    }

    // Look up provider name
    const providerResult = await appDb.query(
      'SELECT first_name, last_name FROM providers WHERE provider_id = $1',
      [providerId]
    );

    if (providerResult.rows.length === 0) {
      console.error(`[submit-note] provider_id=${providerId} not found in providers table`);
      return res.status(500).json({
        success: false,
        data:    null,
        error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred. Please try again.' },
      });
    }

    const provider = providerResult.rows[0];

    const patientDob = encounter.patient_dob
      ? new Date(encounter.patient_dob).toISOString().slice(0, 10)
      : '';

    // Assemble and send Mirth payload
    const mirthPayload = {
      csn,
      mrn:               encounter.mrn,
      providerId,
      providerLastName:  provider.last_name,
      providerFirstName: provider.first_name,
      patientLastName:   encounter.patient_last_name,
      patientFirstName:  encounter.patient_first_name,
      patientDob,
      noteText:          buildNoteText(soap),
    };

    console.log(`[submit-note] Sending Mirth payload for CSN=${csn} provider=${providerId}`);

    let mirthAck;
    try {
      mirthAck = await sendToMirth(mirthPayload);
    } catch (mirthErr) {
      if (mirthErr.code === 'MIRTH_UNAVAILABLE') {
        return res.status(422).json({
          success: false,
          data:    null,
          error:   { code: 'MIRTH_UNAVAILABLE', message: mirthErr.message },
        });
      }
      throw mirthErr;
    }

    // Cache Mirth response for idempotency
    await appDb.query(
      `INSERT INTO submission_idempotency (csn, idempotency_key, mirth_response)
       VALUES ($1, $2, $3)
       ON CONFLICT (csn, idempotency_key) DO NOTHING`,
      [csn, idempotencyKey, JSON.stringify(mirthAck)]
    );

    console.log(`[submit-note] SUCCESS — CSN=${csn} MessageID=${mirthAck.messageId}`);

    // Update appointment status (non-fatal)
    try {
      await appDb.query(
        `UPDATE app_appointments SET audio_status = 'Submitted' WHERE csn = $1`,
        [csn]
      );
    } catch (statusErr) {
      console.error(`[submit-note] Failed to update audio_status for CSN=${csn}:`, statusErr.message);
    }

    // Fire-and-forget audit log
    auditLogger.logAccess(providerId, 'NOTE_SIGNED', encounter.mrn, csn, req.ip);

    return res.status(200).json({
      success: true,
      data: {
        mirthAck: {
          messageId: mirthAck.messageId,
          status:    mirthAck.status,
          hl7:       mirthAck.hl7,
        },
        dbWriteConfirmed: true,
      },
      error: null,
    });

  } catch (err) {
    console.error('[submit-note] Unhandled error:', err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred. Please try again.' },
    });
  }
});

module.exports = router;
