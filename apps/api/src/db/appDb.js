/**
 * Database pool — aiscribe_app
 *
 * Handles all web-application data: provider accounts, audit logs,
 * appointment cache, and idempotency records.
 * Express has read/write access. Mirth Connect must never touch this database.
 *
 * Connection values are read exclusively from environment variables.
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.AISCRIBE_APP_DB_HOST     || 'localhost',
  port:     Number(process.env.AISCRIBE_APP_DB_PORT) || 5432,
  database: process.env.AISCRIBE_APP_DB_NAME     || 'aiscribe_app',
  user:     process.env.AISCRIBE_APP_DB_USER     || 'postgres',
  password: process.env.AISCRIBE_APP_DB_PASSWORD || 'devpassword',
  ssl:      process.env.POSTGRES_SSL_MODE === 'require'
              ? { rejectUnauthorized: false }
              : false,
});

pool.on('error', (err) => {
  console.error('[appDb] Unexpected pool error:', err.message);
});

/**
 * Execute a parameterized query against aiscribe_app.
 *
 * @param {string}  text   - Parameterized SQL (use $1, $2, … placeholders)
 * @param {Array}   params - Ordered array of parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  console.debug(`[appDb] query (${Date.now() - start}ms):`, text.slice(0, 80));
  return result;
}

module.exports = { query };
