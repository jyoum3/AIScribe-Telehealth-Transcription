/**
 * Route: POST /api/auth/login
 *
 * Validates provider credentials against aiscribe_app.providers and issues
 * a signed JWT containing the provider identity.
 *
 * Request body  : { email: string, password: string }
 * Success (200) : { success: true, data: { token, provider }, error: null }
 * Errors        : 400 MISSING_CREDENTIALS | 401 INVALID_CREDENTIALS | 500
 *
 * Security: HS256, 24h TTL. Same INVALID_CREDENTIALS code for wrong email
 * AND wrong password — never reveals which field failed (enumeration guard).
 */

'use strict';

const express  = require('express');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const appDb    = require('../db/appDb');
const fhirSync = require('../services/fhirSync');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        data:    null,
        error:   { code: 'MISSING_CREDENTIALS', message: 'Email and password are required.' },
      });
    }

    // Look up provider — return same 401 whether email is missing or password is wrong
    const result = await appDb.query(
      'SELECT provider_id, email, password_hash, first_name, last_name FROM providers WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    const provider = result.rows[0];

    if (!provider) {
      return res.status(401).json({
        success: false,
        data:    null,
        error:   { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });
    }

    const passwordMatches = await bcrypt.compare(password, provider.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        data:    null,
        error:   { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[auth/login] FATAL: JWT_SECRET environment variable is not set');
      return res.status(500).json({
        success: false,
        data:    null,
        error:   { code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error. Please contact support.' },
      });
    }

    // Issue JWT — includes first/last name so the browser can display the provider
    // name on refresh without an extra API round-trip
    const token = jwt.sign(
      {
        provider_id: provider.provider_id,
        email:       provider.email,
        first_name:  provider.first_name,
        last_name:   provider.last_name,
      },
      secret,
      { algorithm: 'HS256', expiresIn: 86400 }  // 24 hours
    );

    console.log(`[auth/login] Token issued for provider_id=${provider.provider_id}`);

    // Fire-and-forget FHIR auto-sync — pre-populates app_appointments so
    // GET /api/appointments is instant on first dashboard load.
    // Not awaited — login response must stay fast.
    const _now  = new Date();
    const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
    fhirSync.fetchAndCacheSchedule(provider.provider_id, today)
      .then((r) => console.log(`[auto-sync] Cached ${r.synced} appointment(s) for provider_id=${provider.provider_id}`))
      .catch((e) => console.error(`[auto-sync] Sync failed for provider_id=${provider.provider_id} (non-blocking):`, e.message));

    return res.status(200).json({
      success: true,
      data: {
        token,
        provider: {
          provider_id: provider.provider_id,
          email:       provider.email,
          first_name:  provider.first_name,
          last_name:   provider.last_name,
        },
      },
      error: null,
    });

  } catch (err) {
    console.error('[auth/login] Unhandled error:', err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred. Please try again.' },
    });
  }
});

module.exports = router;
