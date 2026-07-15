/**
 * Database pool — simulated_emr
 *
 * Read-only access (from Express) to the EMR simulation data:
 * patient demographics, encounters, and clinical notes.
 * Mirth Connect has exclusive write access to this database.
 *
 * The pool is intentionally separate from appDb to enforce
 * strict two-database isolation at the connection level.
 *
 * Connection values are read exclusively from environment variables.
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.SIMULATED_EMR_DB_HOST     || 'localhost',
  port:     Number(process.env.SIMULATED_EMR_DB_PORT) || 5432,
  database: process.env.SIMULATED_EMR_DB_NAME     || 'simulated_emr',
  user:     process.env.SIMULATED_EMR_DB_USER     || 'postgres',
  password: process.env.SIMULATED_EMR_DB_PASSWORD || 'devpassword',
  ssl:      process.env.POSTGRES_SSL_MODE === 'require'
              ? { rejectUnauthorized: false }
              : false,
});

pool.on('error', (err) => {
  console.error('[emrDb] Unexpected pool error:', err.message);
});

/**
 * Execute a parameterized query against simulated_emr.
 *
 * @param {string}  text   - Parameterized SQL (use $1, $2, … placeholders)
 * @param {Array}   params - Ordered array of parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  console.debug(`[emrDb] query (${Date.now() - start}ms):`, text.slice(0, 80));
  return result;
}

module.exports = { query };
