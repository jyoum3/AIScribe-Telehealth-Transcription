/**
 * Routes: GET /api/patients | GET /api/patients/:mrn/history
 *
 * Both routes require JWT authentication. Provider isolation is enforced at the
 * SQL level — all queries are scoped by the JWT-sourced provider_id.
 *
 * GET /api/patients
 *   Returns all distinct patients for the authenticated provider, assembled from
 *   app_appointments (aiscribe_app) joined with patient_demographics (simulated_emr).
 *
 * GET /api/patients/:mrn/history
 *   Returns all historical encounters for a patient with note availability per encounter.
 *
 *   Strict two-phase execution:
 *     Phase 1 (appDb): confirm MRN belongs to this provider — halt with 403 if not.
 *     Phase 2 (emrDb): fetch encounters and notes — only after Phase 1 passes.
 *   Uses batch ANY($csns) queries to avoid N+1 round trips.
 *   Fires audit log: HISTORY_VIEWED (fire-and-forget).
 */

'use strict';

const express         = require('express');
const appDb           = require('../db/appDb');
const emrDb           = require('../db/emrDb');
const auditLogger     = require('../services/auditLogger');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const { provider_id } = req.user;

    const appResult = await appDb.query(
      `SELECT DISTINCT ON (mrn)
         mrn, patient_first_name, patient_last_name, patient_dob
       FROM   app_appointments
       WHERE  provider_id = $1
       ORDER  BY mrn ASC`,
      [provider_id]
    );

    if (appResult.rows.length === 0) {
      return res.status(200).json({ success: true, data: { patients: [] }, error: null });
    }

    // Batch-fetch gender from simulated_emr — one query for all MRNs
    const mrns = appResult.rows.map(r => r.mrn);
    const emrResult = await emrDb.query(
      `SELECT mrn, gender FROM patient_demographics WHERE mrn = ANY($1)`,
      [mrns]
    );

    const genderMap = {};
    emrResult.rows.forEach(r => { genderMap[r.mrn] = r.gender ?? null; });

    const patients = appResult.rows
      .map(r => ({
        mrn:                r.mrn,
        patient_first_name: r.patient_first_name,
        patient_last_name:  r.patient_last_name,
        patient_dob:        r.patient_dob,
        gender:             genderMap[r.mrn] ?? null,
      }))
      .sort((a, b) => (a.patient_last_name ?? '').localeCompare(b.patient_last_name ?? ''));

    console.log(`[patients] provider_id=${provider_id} returned ${patients.length} patient(s)`);

    return res.status(200).json({ success: true, data: { patients }, error: null });

  } catch (err) {
    console.error('[patients] Unhandled error:', err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred while fetching the patient directory.' },
    });
  }
});

router.get('/:mrn/history', requireAuth, async (req, res) => {
  const { mrn } = req.params;
  const { provider_id } = req.user;

  if (!mrn || mrn.trim() === '') {
    return res.status(400).json({
      success: false,
      data:    null,
      error:   { code: 'MISSING_FIELDS', message: 'MRN is required.' },
    });
  }

  try {
    // Phase 1 — Access guard (appDb ONLY)
    // Confirm MRN belongs to this provider before touching the hospital database.
    const guardResult = await appDb.query(
      `SELECT 1 FROM app_appointments
       WHERE  mrn = $1 AND provider_id = $2
       LIMIT  1`,
      [mrn, provider_id]
    );

    if (guardResult.rows.length === 0) {
      console.warn(`[patients/history] Access denied — provider_id=${provider_id} attempted to access MRN=${mrn}`);
      return res.status(403).json({
        success: false,
        data:    null,
        error:   { code: 'PATIENT_ACCESS_DENIED', message: 'You do not have access to this patient\'s records.' },
      });
    }

    // Phase 2 — Medical record fetch (emrDb)
    // Phase 1 has confirmed access. Three batch queries — no N+1 round trips.

    const encountersResult = await emrDb.query(
      `SELECT csn, visit_date, visit_type
       FROM   encounters
       WHERE  mrn = $1
       ORDER  BY visit_date DESC`,
      [mrn]
    );

    if (encountersResult.rows.length === 0) {
      auditLogger.logAccess(provider_id, 'HISTORY_VIEWED', mrn, null, req.ip);
      return res.status(200).json({ success: true, data: { history: [] }, error: null });
    }

    const csns = encountersResult.rows.map(r => r.csn);

    // Aggregate by CSN: version count + current note text
    const versionsResult = await emrDb.query(
      `SELECT csn,
              COUNT(*)                                                     AS version_count,
              MAX(CASE WHEN is_current = TRUE THEN note_text   END)        AS note_text,
              MAX(CASE WHEN is_current = TRUE THEN date_signed END)        AS date_signed
       FROM   clinical_note_versions
       WHERE  csn = ANY($1)
       GROUP  BY csn`,
      [csns]
    );

    // Base v1 notes (CSNs with no amendments)
    const baseNotesResult = await emrDb.query(
      `SELECT csn, note_text, date_signed
       FROM   clinical_notes
       WHERE  csn = ANY($1)`,
      [csns]
    );

    const versionMap  = {};
    versionsResult.rows.forEach(r => { versionMap[r.csn] = r; });

    const baseNoteMap = {};
    baseNotesResult.rows.forEach(r => { baseNoteMap[r.csn] = r; });

    // Priority: clinical_note_versions (amended) → clinical_notes (v1) → no note
    const history = encountersResult.rows.map(enc => {
      const versionData = versionMap[enc.csn];
      const baseNote    = baseNoteMap[enc.csn];

      if (versionData) {
        return {
          csn:           enc.csn,
          visit_date:    enc.visit_date,
          visit_type:    enc.visit_type,
          has_note:      true,
          version_count: parseInt(versionData.version_count, 10),
          note_text:     versionData.note_text ?? null,
          date_signed:   versionData.date_signed ?? null,
        };
      }

      if (baseNote) {
        return {
          csn:           enc.csn,
          visit_date:    enc.visit_date,
          visit_type:    enc.visit_type,
          has_note:      true,
          version_count: 1,
          note_text:     baseNote.note_text,
          date_signed:   baseNote.date_signed ?? null,
        };
      }

      return {
        csn:           enc.csn,
        visit_date:    enc.visit_date,
        visit_type:    enc.visit_type,
        has_note:      false,
        version_count: 0,
        note_text:     null,
        date_signed:   null,
      };
    });

    console.log(
      `[patients/history] provider_id=${provider_id} MRN=${mrn} → ${history.length} encounter(s), ` +
      `${history.filter(h => h.has_note).length} with notes`
    );

    // Fire-and-forget audit log
    auditLogger.logAccess(provider_id, 'HISTORY_VIEWED', mrn, null, req.ip);

    return res.status(200).json({ success: true, data: { history }, error: null });

  } catch (err) {
    console.error('[patients/history] Unhandled error:', err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred while fetching patient history.' },
    });
  }
});

module.exports = router;
