/**
 * Route: GET /fhir/R4/Encounter
 *
 * Simulated FHIR R4 mock gateway. Reads from simulated_emr and returns a
 * standards-compliant FHIR R4 Bundle (searchset) containing Encounter resources
 * for a given provider on a given date.
 *
 * This route requires NO JWT — it simulates an open hospital FHIR API endpoint
 * that any authorized internal service can call.
 *
 * Query params (both required):
 *   provider — integer provider_id
 *   date     — ISO date string (YYYY-MM-DD)
 *
 * Success (200) : FHIR R4 Bundle JSON
 * Errors        : 400 (missing params) | 500
 */

'use strict';

const express = require('express');
const emrDb   = require('../db/emrDb');

const router = express.Router();

/**
 * Build a FHIR R4 Encounter resource from a database row.
 *
 * @param {Object} row - DB row: csn, mrn, provider_id, visit_date, visit_type,
 *                        first_name, last_name, dob, gender
 * @returns {Object} FHIR R4 Encounter resource
 */
function buildFhirEncounter(row) {
  return {
    resourceType: 'Encounter',
    id:           row.csn,
    status:       'planned',
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code:   'AMB',
    },
    type:    [{ text: row.visit_type }],
    subject: {
      reference: `Patient/${row.mrn}`,
      display:   `${row.first_name} ${row.last_name}`,
    },
    participant: [
      { individual: { reference: `Practitioner/${row.provider_id}` } },
    ],
    period: { start: row.visit_date },
    // _demographics is a non-standard extension carrying patient data
    // so the sync service can hydrate the cache without a second EMR query
    _demographics: {
      mrn:        row.mrn,
      first_name: row.first_name,
      last_name:  row.last_name,
      dob:        row.dob,
      gender:     row.gender,
    },
  };
}

router.get('/Encounter', async (req, res) => {
  try {
    const { provider, date } = req.query;

    if (!provider || !date) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity:    'error',
          code:        'required',
          diagnostics: 'Query parameters "provider" (integer) and "date" (YYYY-MM-DD) are both required.',
        }],
      });
    }

    const providerId = parseInt(provider, 10);
    if (isNaN(providerId)) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity:    'error',
          code:        'value',
          diagnostics: 'Query parameter "provider" must be a valid integer.',
        }],
      });
    }

    const result = await emrDb.query(
      `SELECT e.csn, e.mrn, e.provider_id, e.visit_date, e.visit_type,
              pd.first_name, pd.last_name, pd.dob, pd.gender
       FROM   encounters e
       JOIN   patient_demographics pd ON pd.mrn = e.mrn
       WHERE  e.provider_id = $1
         AND  DATE(e.visit_date) = $2::date
       ORDER  BY e.visit_date ASC`,
      [providerId, date]
    );

    const entries = result.rows.map((row) => ({
      fullUrl:  `urn:uuid:${row.csn}`,
      resource: buildFhirEncounter(row),
    }));

    const bundle = {
      resourceType: 'Bundle',
      type:         'searchset',
      total:        entries.length,
      entry:        entries,
    };

    console.log(`[fhir] GET /Encounter provider=${providerId} date=${date} → ${entries.length} result(s)`);

    return res.status(200).json(bundle);

  } catch (err) {
    console.error('[fhir] Unhandled error:', err.stack || err.message);
    return res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity:    'error',
        code:        'exception',
        diagnostics: 'An unexpected error occurred while processing the FHIR request.',
      }],
    });
  }
});

module.exports = router;
