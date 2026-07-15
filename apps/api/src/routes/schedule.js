/**
 * Route: POST /api/schedule/sync
 *
 * Manual trigger for the FHIR sync service. Fetches today's encounters for the
 * authenticated provider from the internal FHIR R4 mock gateway and upserts
 * them into aiscribe_app.app_appointments.
 *
 * Auth required : Yes
 * Success (200) : { success: true, data: { synced: N }, error: null }
 */

'use strict';

const express         = require('express');
const fhirSync        = require('../services/fhirSync');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const { provider_id } = req.user;

    // Use local date — toISOString() returns UTC which can be "tomorrow" after 8 PM Eastern
    const _now  = new Date();
    const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;

    console.log(`[schedule/sync] Manual sync triggered by provider_id=${provider_id} for date=${today}`);

    const result = await fhirSync.fetchAndCacheSchedule(provider_id, today);

    console.log(`[schedule/sync] Sync complete: ${result.synced} appointment(s) upserted`);

    return res.status(200).json({
      success: true,
      data:    { synced: result.synced },
      error:   null,
    });

  } catch (err) {
    console.error('[schedule/sync] Unhandled error:', err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'SYNC_FAILED', message: 'Failed to sync schedule from FHIR gateway. Please try again.' },
    });
  }
});

module.exports = router;
