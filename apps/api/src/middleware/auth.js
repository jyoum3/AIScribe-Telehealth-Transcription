/**
 * Auth Middleware — Bearer Token Validation
 *
 * Validates the JWT passed in the Authorization header on every protected route.
 * On success, attaches the decoded payload to req.user so downstream handlers
 * can read req.user.provider_id without re-parsing the token.
 *
 * Error codes: INVALID_TOKEN | TOKEN_EXPIRED
 *
 * Usage:
 *   const { requireAuth } = require('../middleware/auth');
 *   router.get('/appointments', requireAuth, handler);
 */

'use strict';

const jwt = require('jsonwebtoken');

/**
 * Express middleware that enforces a valid Bearer JWT.
 *
 * - Valid token   → decodes payload, sets req.user, calls next()
 * - Expired token → 401 TOKEN_EXPIRED
 * - Bad/missing   → 401 INVALID_TOKEN
 *
 * @type {import('express').RequestHandler}
 */
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
      return res.status(401).json({
        success: false,
        data: null,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Authentication token is required.',
        },
      });
    }

    const token = parts[1];
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error('[auth] FATAL: JWT_SECRET environment variable is not set');
      return res.status(500).json({
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Server configuration error. Please contact support.',
        },
      });
    }

    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });

    // Attach provider identity to the request for downstream handlers
    req.user = {
      provider_id: decoded.provider_id,
      email: decoded.email,
    };

    return next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        data: null,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Your session has expired. Please log in again.',
        },
      });
    }

    console.error('[auth] Token verification failed:', err.message);
    return res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Authentication token is invalid. Please log in again.',
      },
    });
  }
}

module.exports = { requireAuth };
