/**
 * Routes: GET /api/providers/me | POST /api/providers/me/prompt
 *
 * Provider profile and custom Claude prompt template management.
 * All routes require a valid Bearer JWT.
 *
 * GET  /me           → Return authenticated provider's profile including custom_prompt_template
 * POST /me/prompt    → Save or reset the provider's custom Claude prompt template
 *
 * Note: PATCH is not used — CORS only allows GET, POST, OPTIONS.
 * Data source: aiscribe_app.providers
 */

'use strict';

const express         = require('express');
const { requireAuth } = require('../middleware/auth');
const appDb           = require('../db/appDb');

const router = express.Router();

router.get('/me', requireAuth, async (req, res) => {
  const { provider_id } = req.user;

  try {
    const result = await appDb.query(
      `SELECT provider_id, email, first_name, last_name, custom_prompt_template
       FROM providers
       WHERE provider_id = $1`,
      [provider_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        data:    null,
        error:   { code: 'PROVIDER_NOT_FOUND', message: 'Provider account not found.' },
      });
    }

    const provider = result.rows[0];

    console.log(
      `[providers] GET /me — provider_id=${provider_id}, ` +
      `custom_prompt_template=${provider.custom_prompt_template ? 'SET' : 'null'}`
    );

    return res.status(200).json({
      success: true,
      data:    { provider },
      error:   null,
    });

  } catch (err) {
    console.error(`[providers] GET /me error for provider_id=${provider_id}:`, err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred. Please try again.' },
    });
  }
});

router.post('/me/prompt', requireAuth, async (req, res) => {
  const { provider_id } = req.user;
  const { customPromptTemplate } = req.body;

  try {
    // null/undefined/empty string all write NULL (resets to system default)
    const templateValue = (customPromptTemplate && customPromptTemplate.trim().length > 0)
      ? customPromptTemplate.trim()
      : null;

    const result = await appDb.query(
      `UPDATE providers
       SET custom_prompt_template = $1
       WHERE provider_id = $2
       RETURNING provider_id, email, first_name, last_name, custom_prompt_template`,
      [templateValue, provider_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        data:    null,
        error:   { code: 'PROVIDER_NOT_FOUND', message: 'Provider account not found.' },
      });
    }

    const provider = result.rows[0];

    console.log(
      `[providers] POST /me/prompt — provider_id=${provider_id}, ` +
      `template ${templateValue ? `saved (${templateValue.length} chars)` : 'reset to null'}`
    );

    return res.status(200).json({
      success: true,
      data:    { provider },
      error:   null,
    });

  } catch (err) {
    console.error(`[providers] POST /me/prompt error for provider_id=${provider_id}:`, err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred. Please try again.' },
    });
  }
});

module.exports = router;
