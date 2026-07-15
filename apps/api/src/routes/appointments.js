/**
 * Routes: GET /api/appointments | GET /api/appointments/completed
 *
 * Both routes read from the aiscribe_app.app_appointments local FHIR cache.
 * Provider isolation is enforced via parameterized SQL using the JWT-sourced provider_id.
 * Local date is always derived in Node.js (not PostgreSQL CURRENT_DATE) to avoid
 * UTC/timezone mismatches for providers in non-UTC time zones.
 *
 * GET /api/appointments
 *   Returns today's pending (non-Submitted) appointments for the authenticated provider.
 *   Cache-first: auto-triggers FHIR sync if the cache is empty for today.
 *   Fires audit log: SCHEDULE_VIEWED (fire-and-forget).
 *
 * GET /api/appointments/completed
 *   Returns today's Submitted appointments for the authenticated provider.
 *
 * Auth required : Yes
 * Success (200) : { success: true, data: { appointments: [...] }, error: null }
 */

'use strict';

const express         = require('express');
const appDb           = require('../db/appDb');
const fhirSync        = require('../services/fhirSync');
const auditLogger     = require('../services/auditLogger');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/** Returns today's date as YYYY-MM-DD using local time (not UTC). */
function localDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchCachedAppointments(providerId) {
  return appDb.query(
    `SELECT csn, mrn, provider_id, patient_first_name, patient_last_name,
            patient_dob, visit_date, visit_type, audio_status, transcript_id, last_synced
     FROM   app_appointments
     WHERE  provider_id = $1
       AND  DATE(visit_date) = $2::date
       AND  audio_status != 'Submitted'
     ORDER  BY visit_date ASC`,
    [providerId, localDateString()]
  );
}

async function fetchCompletedAppointments(providerId) {
  return appDb.query(
    `SELECT csn, mrn, provider_id, patient_first_name, patient_last_name,
            patient_dob, visit_date, visit_type, audio_status, transcript_id, last_synced
     FROM   app_appointments
     WHERE  provider_id = $1
       AND  DATE(visit_date) = $2::date
       AND  audio_status = 'Submitted'
     ORDER  BY visit_date ASC`,
    [providerId, localDateString()]
  );
}

function mapAppointmentRow(row) {
  return {
    csn:            row.csn,
    mrn:            row.mrn,
    visit_date:     row.visit_date,
    visit_type:     row.visit_type,
    audio_status:   row.audio_status,
    note_submitted: row.audio_status === 'Submitted',
    patient: {
      first_name: row.patient_first_name,
      last_name:  row.patient_last_name,
      dob:        row.patient_dob,
      gender:     null,
    },
  };
}

// /completed must be registered BEFORE the root '/' to prevent Express
// from matching /completed as a root-level GET with no path segment.
router.get('/completed', requireAuth, async (req, res) => {
  try {
    const { provider_id } = req.user;
    const result = await fetchCompletedAppointments(provider_id);
    const appointments = result.rows.map(mapAppointmentRow);

    console.log(`[appointments/completed] provider_id=${provider_id} returned ${appointments.length} submitted appointment(s)`);

    return res.status(200).json({
      success: true,
      data:    { appointments },
      error:   null,
    });

  } catch (err) {
    console.error('[appointments/completed] Unhandled error:', err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred while fetching completed appointments.' },
    });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const { provider_id } = req.user;

    let result = await fetchCachedAppointments(provider_id);

    // Zero-row fallback — auto-sync if the cache is empty
    if (result.rows.length === 0) {
      const today = localDateString();
      console.log(`[appointments] Cache empty for provider_id=${provider_id} on ${today} — triggering auto-sync`);

      try {
        const syncResult = await fhirSync.fetchAndCacheSchedule(provider_id, today);
        console.log(`[appointments] Auto-sync populated ${syncResult.synced} appointment(s)`);
      } catch (syncErr) {
        console.error('[appointments] Auto-sync failed (non-fatal):', syncErr.message);
      }

      result = await fetchCachedAppointments(provider_id);
    }

    const appointments = result.rows.map(mapAppointmentRow);

    console.log(`[appointments] provider_id=${provider_id} returned ${appointments.length} pending appointment(s)`);

    // Fire-and-forget audit log
    auditLogger.logAccess(provider_id, 'SCHEDULE_VIEWED', null, null, req.ip);

    return res.status(200).json({
      success: true,
      data:    { appointments },
      error:   null,
    });

  } catch (err) {
    console.error('[appointments] Unhandled error:', err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred while fetching appointments.' },
    });
  }
});

module.exports = router;
