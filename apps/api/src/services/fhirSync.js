/**
 * Service: FHIR Sync
 *
 * Calls the internal FHIR R4 mock gateway and upserts the returned Encounter
 * resources into the aiscribe_app.app_appointments local cache table.
 *
 * Design decisions:
 *   - The FHIR endpoint is consumed via HTTP (axios) — mirrors real-world FHIR
 *     gateway consumption patterns rather than direct database access.
 *   - On CONFLICT (csn), the UPSERT preserves the existing audio_status — a sync
 *     must never reset an in-flight or completed appointment back to 'Pending'.
 *   - This service is the only writer for FHIR-sourced app_appointments rows.
 *
 * Called by:
 *   - POST /api/schedule/sync  (manual sync, JWT required)
 *   - POST /api/auth/login     (auto-sync, fire-and-forget)
 *   - GET  /api/appointments   (zero-row fallback auto-trigger)
 */

'use strict';

const axios = require('axios');
const appDb = require('../db/appDb');

const PORT      = process.env.EXPRESS_PORT || 3001;
const FHIR_BASE = `http://localhost:${PORT}/fhir/R4`;

/**
 * Fetch today's encounters for a provider from the internal FHIR mock gateway
 * and upsert them into aiscribe_app.app_appointments.
 *
 * @param {number} providerId - Provider's integer ID (from JWT payload)
 * @param {string} date       - ISO date string YYYY-MM-DD
 * @returns {Promise<{ synced: number }>} Count of upserted rows
 */
async function fetchAndCacheSchedule(providerId, date) {
  const url = `${FHIR_BASE}/Encounter?provider=${providerId}&date=${date}`;

  console.log(`[fhirSync] Fetching schedule for provider=${providerId} date=${date}`);

  const response = await axios.get(url, { timeout: 10000 });
  const bundle   = response.data;

  if (bundle.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) {
    throw new Error(
      `[fhirSync] Invalid FHIR Bundle received. ` +
      `resourceType="${bundle.resourceType}", entry type="${typeof bundle.entry}"`
    );
  }

  if (bundle.entry.length === 0) {
    console.log(`[fhirSync] No encounters returned for provider=${providerId} on ${date}`);
    return { synced: 0 };
  }

  let synced = 0;

  for (const entry of bundle.entry) {
    const resource = entry.resource;
    const demo     = resource._demographics;

    if (!resource || !demo) {
      console.warn('[fhirSync] Skipping entry with missing resource or _demographics:', entry);
      continue;
    }

    const csn          = resource.id;
    const mrn          = demo.mrn;
    const patientFirst = demo.first_name;
    const patientLast  = demo.last_name;
    const patientDob   = demo.dob;
    const visitDate    = resource.period && resource.period.start;
    const visitType    = resource.type && resource.type[0] && resource.type[0].text;

    if (!csn || !mrn || !visitDate) {
      console.warn('[fhirSync] Skipping entry with incomplete core fields:', { csn, mrn, visitDate });
      continue;
    }

    await appDb.query(
      `INSERT INTO app_appointments
         (csn, mrn, provider_id, patient_first_name, patient_last_name,
          patient_dob, visit_date, visit_type, last_synced)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (csn) DO UPDATE SET
         patient_first_name = EXCLUDED.patient_first_name,
         patient_last_name  = EXCLUDED.patient_last_name,
         visit_date         = EXCLUDED.visit_date,
         visit_type         = EXCLUDED.visit_type,
         last_synced        = NOW()
       -- audio_status intentionally excluded: preserves 'Processing', 'SOAP Ready', 'Submitted'`,
      [csn, mrn, providerId, patientFirst, patientLast, patientDob, visitDate, visitType]
    );

    synced++;
  }

  console.log(`[fhirSync] Upserted ${synced} appointment(s) for provider=${providerId}`);
  return { synced };
}

module.exports = { fetchAndCacheSchedule };
