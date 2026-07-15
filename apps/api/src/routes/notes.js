/**
 * Routes: POST /api/notes/amend | GET /api/notes/:csn
 *
 * POST /api/notes/amend
 *   Submits a clinical note amendment. Signed notes are immutable — amendments
 *   create a new versioned row in clinical_note_versions via Mirth (MDM^T04).
 *   Version number is calculated as MAX(version_num)+1; first amendment is always v2.
 *   Provider ownership is verified against the JWT — never from request body.
 *
 * GET /api/notes/:csn
 *   Fetches the current signed note for a CSN.
 *   Fallback chain: clinical_note_versions (is_current=TRUE) → clinical_notes (v1).
 *
 * Architecture: Mirth is the exclusive writer to simulated_emr. Express only writes
 * to aiscribe_app (submission_idempotency, audit_logs).
 *
 * Error codes: NOTE_NOT_FOUND | MISSING_FIELDS | INCOMPLETE_SOAP |
 *              MISSING_AMENDMENT_REASON | DUPLICATE_SUBMISSION |
 *              ENCOUNTER_ACCESS_DENIED | MIRTH_UNAVAILABLE
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

// POST /amend is declared first (static paths before wildcard /:csn)
router.post('/amend', requireAuth, async (req, res) => {
  const { csn, amendedSoap, amendmentReason, idempotencyKey } = req.body;

  if (!csn || !amendedSoap || !idempotencyKey) {
    return res.status(400).json({
      success: false,
      data:    null,
      error:   { code: 'MISSING_FIELDS', message: 'csn, amendedSoap, amendmentReason, and idempotencyKey are all required.' },
    });
  }

  if (!amendmentReason || typeof amendmentReason !== 'string' || amendmentReason.trim() === '') {
    return res.status(400).json({
      success: false,
      data:    null,
      error:   { code: 'MISSING_AMENDMENT_REASON', message: 'An amendment reason is required. Please describe what was changed and why.' },
    });
  }

  for (const key of REQUIRED_SOAP_KEYS) {
    if (!amendedSoap[key] || typeof amendedSoap[key] !== 'string' || amendedSoap[key].trim() === '') {
      return res.status(400).json({
        success: false,
        data:    null,
        error:   { code: 'INCOMPLETE_SOAP', message: 'Amended SOAP note must include all four sections: subjective, objective, assessment, and plan.' },
      });
    }
  }

  try {
    // Check idempotency cache
    const dupeResult = await appDb.query(
      `SELECT mirth_response FROM submission_idempotency
       WHERE  csn = $1 AND idempotency_key = $2
         AND  created_at > NOW() - INTERVAL '24 hours'`,
      [csn, idempotencyKey]
    );

    if (dupeResult.rows.length > 0) {
      const cached = dupeResult.rows[0].mirth_response;
      console.log(`[notes/amend] Duplicate detected — CSN=${csn} key=${idempotencyKey}`);
      return res.status(409).json({
        success: false,
        data:    { cached: true, mirthAck: cached },
        error:   { code: 'DUPLICATE_SUBMISSION', message: 'This amendment has already been submitted. Showing the original confirmation.' },
      });
    }

    // provider_id comes from verified JWT — never from request body
    const providerId = req.user.provider_id;

    const encounterResult = await emrDb.query(
      `SELECT e.csn, e.mrn, e.visit_date, e.provider_id,
              p.first_name AS patient_first_name,
              p.last_name  AS patient_last_name,
              p.dob        AS patient_dob
       FROM   encounters e
       JOIN   patient_demographics p ON p.mrn = e.mrn
       WHERE  e.csn = $1`,
      [csn]
    );

    if (encounterResult.rows.length === 0) {
      console.warn(`[notes/amend] CSN not found: ${csn}`);
      return res.status(403).json({
        success: false,
        data:    null,
        error:   { code: 'ENCOUNTER_ACCESS_DENIED', message: 'You do not have permission to amend a note for this encounter.' },
      });
    }

    const encounter = encounterResult.rows[0];

    if (encounter.provider_id !== providerId) {
      console.warn(`[notes/amend] provider_id=${providerId} tried to amend CSN=${csn} (ownership denied)`);
      return res.status(403).json({
        success: false,
        data:    null,
        error:   { code: 'ENCOUNTER_ACCESS_DENIED', message: 'You do not have permission to amend a note for this encounter.' },
      });
    }

    // Verify an original signed note exists
    const noteExistsResult = await emrDb.query(
      `SELECT 1 FROM clinical_notes WHERE csn = $1
       UNION ALL
       SELECT 1 FROM clinical_note_versions WHERE csn = $1 AND is_current = TRUE
       LIMIT 1`,
      [csn]
    );

    if (noteExistsResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        data:    null,
        error:   { code: 'NOTE_NOT_FOUND', message: 'No signed note found for this encounter. A note must be submitted before it can be amended.' },
      });
    }

    // v1 lives in clinical_notes; first amendment is always v2
    const versionResult = await emrDb.query(
      `SELECT COALESCE(MAX(version_num), 1) + 1 AS next_ver
       FROM   clinical_note_versions
       WHERE  csn = $1`,
      [csn]
    );

    const nextVersion = parseInt(versionResult.rows[0].next_ver, 10);

    console.log(`[notes/amend] Next version for CSN=${csn}: v${nextVersion}`);

    const providerResult = await appDb.query(
      'SELECT first_name, last_name FROM providers WHERE provider_id = $1',
      [providerId]
    );

    if (providerResult.rows.length === 0) {
      console.error(`[notes/amend] provider_id=${providerId} not found`);
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

    // Mirth source transformer detects version_num > 1 → MDM^T04, docStatus=LA
    const mirthPayload = {
      csn,
      mrn:               encounter.mrn,
      providerId,
      providerLastName:  provider.last_name,
      providerFirstName: provider.first_name,
      patientLastName:   encounter.patient_last_name,
      patientFirstName:  encounter.patient_first_name,
      patientDob,
      noteText:          buildNoteText(amendedSoap),
      version_num:       nextVersion,
      amendmentReason:   amendmentReason.trim(),
    };

    console.log(`[notes/amend] Sending Mirth amendment payload — CSN=${csn} v${nextVersion}`);

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

    await appDb.query(
      `INSERT INTO submission_idempotency (csn, idempotency_key, mirth_response)
       VALUES ($1, $2, $3)
       ON CONFLICT (csn, idempotency_key) DO NOTHING`,
      [csn, idempotencyKey, JSON.stringify(mirthAck)]
    );

    console.log(`[notes/amend] SUCCESS — CSN=${csn} v${nextVersion} MsgID=${mirthAck.messageId}`);

    // Fire-and-forget audit log
    auditLogger.logAccess(providerId, 'NOTE_AMENDED', encounter.mrn, csn, req.ip);

    return res.status(200).json({
      success: true,
      data: {
        version_num: nextVersion,
        mirth_ack: {
          messageId: mirthAck.messageId,
          status:    mirthAck.status,
          hl7:       mirthAck.hl7,
        },
      },
      error: null,
    });

  } catch (err) {
    console.error('[notes/amend] Unhandled error:', err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred. Please try again.' },
    });
  }
});

// GET /:csn registered after static path /amend
router.get('/:csn', requireAuth, async (req, res) => {
  const { csn } = req.params;

  if (!csn || csn.trim() === '') {
    return res.status(400).json({
      success: false,
      data:    null,
      error:   { code: 'MISSING_FIELDS', message: 'CSN is required.' },
    });
  }

  try {
    // Check clinical_note_versions first (amended notes — v2+)
    const versionResult = await emrDb.query(
      `SELECT csn, note_text, version_num, date_signed, status, authored_by
       FROM   clinical_note_versions
       WHERE  csn = $1 AND is_current = TRUE
       LIMIT  1`,
      [csn]
    );

    if (versionResult.rows.length > 0) {
      const row = versionResult.rows[0];
      console.log(`[notes/get] Found version v${row.version_num} for CSN=${csn}`);
      return res.status(200).json({
        success: true,
        data: {
          csn:         row.csn,
          note_text:   row.note_text,
          version_num: row.version_num,
          date_signed: row.date_signed,
          status:      row.status,
          authored_by: row.authored_by,
        },
        error: null,
      });
    }

    // Fallback to clinical_notes (v1 — initial note, never amended)
    const v1Result = await emrDb.query(
      `SELECT csn, note_text, date_signed, status
       FROM   clinical_notes
       WHERE  csn = $1
       LIMIT  1`,
      [csn]
    );

    if (v1Result.rows.length > 0) {
      const row = v1Result.rows[0];
      console.log(`[notes/get] Found v1 note in clinical_notes for CSN=${csn}`);
      return res.status(200).json({
        success: true,
        data: {
          csn:         row.csn,
          note_text:   row.note_text,
          version_num: 1,
          date_signed: row.date_signed,
          status:      row.status,
          authored_by: null,
        },
        error: null,
      });
    }

    console.warn(`[notes/get] No signed note found for CSN=${csn}`);
    return res.status(404).json({
      success: false,
      data:    null,
      error:   { code: 'NOTE_NOT_FOUND', message: 'No signed note found for this encounter.' },
    });

  } catch (err) {
    console.error('[notes/get] Unhandled error:', err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred. Please try again.' },
    });
  }
});

module.exports = router;
