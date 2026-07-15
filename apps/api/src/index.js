/**
 * AIScribe Express API — Entry Point
 *
 * CORS enforcement, body parsing, route mounting, and global error handling.
 * All routes follow the standard response envelope: { success, data, error }.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env.local') });

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.EXPRESS_PORT || 3001;

// CORS — only allow requests from the configured frontend origin
app.use(cors({
  origin:         process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  methods:        ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
  maxAge:         3600
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Routes
const authRoutes        = require('./routes/auth');
const appointmentRoutes = require('./routes/appointments');
const transcribeRoutes  = require('./routes/transcribe');
const submitRoutes      = require('./routes/submit');
const fhirRoutes        = require('./routes/fhir');
const scheduleRoutes    = require('./routes/schedule');
const notesRoutes       = require('./routes/notes');
const patientsRoutes    = require('./routes/patients');
const providersRoutes   = require('./routes/providers');

app.use('/api/auth',         authRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/transcribe',   transcribeRoutes);
app.use('/api/submit-note',  submitRoutes);
app.use('/fhir/R4',          fhirRoutes);       // no JWT — simulates open FHIR endpoint
app.use('/api/schedule',     scheduleRoutes);
app.use('/api/notes',        notesRoutes);
app.use('/api/patients',     patientsRoutes);
app.use('/api/providers',    providersRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    data:    { status: 'ok', version: '1.0.0' },
    error:   null
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    data:    null,
    error:   { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' }
  });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.stack || err.message);
  res.status(err.status || 500).json({
    success: false,
    data:    null,
    error: {
      code:    err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected error occurred. Please try again.'
    }
  });
});

app.listen(PORT, () => {
  console.log(`[AIScribe API] Running on http://localhost:${PORT}`);
  console.log(`[AIScribe API] Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
