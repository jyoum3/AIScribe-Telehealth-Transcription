/**
 * Route: POST /api/transcribe
 *
 * Accepts a multipart audio file upload, transcribes it via OpenAI Whisper,
 * and formats the transcript into a structured SOAP note via Anthropic Claude.
 *
 * Pipeline:
 *   1. Multer validates format (.mp3/.wav) and size (≤25 MB) in memory — no disk writes
 *   2. Fetches provider's custom_prompt_template from aiscribe_app
 *   3. Fetches visit_type + mrn from app_appointments for historical context routing
 *   4. Fetches most recent signed note (follow-up/routine visits only) for longitudinal enrichment
 *   5. Transcribes audio via Whisper → raw transcript
 *   6. Formats transcript into SOAP via Claude → { soap, controlBlock }
 *   7. If Claude recommends a follow-up: sends SCHEDULE_FOLLOWUP to Mirth (non-fatal)
 *   8. Returns transcript + SOAP + follow-up scheduling info
 *
 * Auth required  : Yes — requireAuth validates the Bearer JWT
 * Content-Type   : multipart/form-data
 * Fields         : audio (file), csn (text, optional), mrn (text, optional)
 *
 * Success (200)  : { success: true, data: { transcript, soap, follow_up_scheduled,
 *                   follow_up_date, follow_up_csn }, error: null }
 * Error codes    : NO_AUDIO_FILE | INVALID_AUDIO_FORMAT | AUDIO_FILE_TOO_LARGE |
 *                  TRANSCRIPTION_TIMEOUT | SOAP_FORMATTING_FAILED
 *
 * All audio_status DB updates and audit log writes are fire-and-forget — they are
 * wrapped in their own try/catch and never fail the transcription response.
 */

'use strict';

const express             = require('express');
const multer              = require('multer');
const { requireAuth }     = require('../middleware/auth');
const { transcribeAudio } = require('../services/whisper');
const { formatSoapNote }  = require('../services/claude');
const { sendSchedule }    = require('../services/mirth');
const appDb               = require('../db/appDb');
const emrDb               = require('../db/emrDb');
const auditLogger         = require('../services/auditLogger');

const router = express.Router();

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg',  // .mp3
  'audio/wav',   // .wav (standard)
  'audio/wave',  // .wav (Chrome)
  'audio/x-wav', // .wav (Windows legacy)
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error('Unsupported file type. Please upload an .mp3 or .wav file.');
      err.code  = 'INVALID_AUDIO_FORMAT';
      cb(err, false);
    }
  },
});

/** Update audio_status in app_appointments — non-fatal, never throws. */
async function updateAudioStatus(csn, status) {
  if (!csn) return;
  try {
    await appDb.query(
      `UPDATE app_appointments SET audio_status = $1 WHERE csn = $2`,
      [status, csn]
    );
    console.log(`[transcribe] audio_status → '${status}' for CSN=${csn}`);
  } catch (err) {
    console.error(`[transcribe] Failed to update audio_status for CSN=${csn}:`, err.message);
  }
}

/**
 * Fetch most recent signed note for a patient for longitudinal enrichment.
 * Only injected for follow-up and routine visit types. Non-fatal — returns null on any failure.
 *
 * Fallback chain: clinical_note_versions (amended, is_current=TRUE) → clinical_notes (v1)
 */
async function fetchHistoricalContext(visitType, mrn) {
  if (!mrn || !visitType) return null;

  const vt = visitType.toLowerCase();
  if (!vt.includes('follow') && !vt.includes('routine')) {
    console.log(`[transcribe] No historical context for visit_type='${visitType}' (Initial Evaluation)`);
    return null;
  }

  try {
    // Check clinical_note_versions first (most recent amended note)
    const versionsResult = await emrDb.query(
      `SELECT cnv.note_text
       FROM   clinical_note_versions cnv
       JOIN   encounters e ON e.csn = cnv.csn
       WHERE  e.mrn = $1 AND cnv.is_current = TRUE
       ORDER  BY cnv.date_signed DESC
       LIMIT  1`,
      [mrn]
    );

    if (versionsResult.rows.length > 0) {
      console.log(`[transcribe] Historical context found (clinical_note_versions) for MRN=${mrn}`);
      return versionsResult.rows[0].note_text;
    }

    // Fallback to v1 notes
    const notesResult = await emrDb.query(
      `SELECT cn.note_text
       FROM   clinical_notes cn
       JOIN   encounters e ON e.csn = cn.csn
       WHERE  e.mrn = $1
       ORDER  BY cn.date_signed DESC
       LIMIT  1`,
      [mrn]
    );

    if (notesResult.rows.length > 0) {
      console.log(`[transcribe] Historical context found (clinical_notes) for MRN=${mrn}`);
      return notesResult.rows[0].note_text;
    }

    console.log(`[transcribe] No historical notes found for MRN=${mrn}`);
    return null;

  } catch (err) {
    console.error(`[transcribe] Failed to fetch historical context for MRN=${mrn}:`, err.message);
    return null;
  }
}

// Two-stage handler: multer upload → transcribeHandler
router.post('/', requireAuth, (req, res, next) => {
  upload.single('audio')(req, res, (multerErr) => {
    if (multerErr) {
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          data:    null,
          error:   { code: 'AUDIO_FILE_TOO_LARGE', message: 'File exceeds the 25 MB limit. Please upload a shorter recording.' },
        });
      }
      if (multerErr.code === 'INVALID_AUDIO_FORMAT') {
        return res.status(400).json({
          success: false,
          data:    null,
          error:   { code: 'INVALID_AUDIO_FORMAT', message: 'Unsupported file type. Please upload an .mp3 or .wav file.' },
        });
      }
      return next(multerErr);
    }
    transcribeHandler(req, res, next);
  });
});

async function transcribeHandler(req, res, next) {
  const csn         = req.body?.csn ?? null;
  const mrnFromForm = req.body?.mrn ?? null;

  try {
    const { provider_id } = req.user;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        data:    null,
        error:   { code: 'NO_AUDIO_FILE', message: 'An audio file is required. Accepted formats: .mp3 and .wav.' },
      });
    }

    const { buffer, mimetype, originalname, size } = req.file;

    console.log(
      `[transcribe] provider_id=${provider_id} CSN=${csn} — ` +
      `${originalname} (${size} bytes, ${mimetype})`
    );

    if (size > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        data:    null,
        error:   { code: 'AUDIO_FILE_TOO_LARGE', message: 'File exceeds the 25 MB limit. Please upload a shorter recording.' },
      });
    }

    // Mark as Processing before the Whisper call (fire-and-forget)
    updateAudioStatus(csn, 'Processing');

    // Fetch provider's custom prompt template (non-fatal — falls back to null/default)
    let customPromptTemplate = null;
    try {
      const providerResult = await appDb.query(
        `SELECT custom_prompt_template FROM providers WHERE provider_id = $1`,
        [provider_id]
      );
      if (providerResult.rows.length > 0) {
        customPromptTemplate = providerResult.rows[0].custom_prompt_template ?? null;
      }
      console.log(
        `[transcribe] Custom prompt for provider_id=${provider_id}: ` +
        (customPromptTemplate ? `SET (${customPromptTemplate.length} chars)` : 'null (using default)')
      );
    } catch (err) {
      console.error(`[transcribe] Failed to fetch custom_prompt_template:`, err.message);
    }

    // Fetch visit_type and authoritative mrn from app_appointments (non-fatal)
    let visitType = null;
    let mrn       = mrnFromForm;

    if (csn) {
      try {
        const apptResult = await appDb.query(
          `SELECT visit_type, mrn FROM app_appointments WHERE csn = $1`,
          [csn]
        );
        if (apptResult.rows.length > 0) {
          visitType = apptResult.rows[0].visit_type ?? null;
          mrn       = apptResult.rows[0].mrn ?? mrnFromForm;
          console.log(`[transcribe] CSN=${csn} — visit_type='${visitType}', mrn=${mrn}`);
        }
      } catch (err) {
        console.error(`[transcribe] Failed to fetch visit_type for CSN=${csn}:`, err.message);
      }
    }

    // Fetch prior note for longitudinal enrichment (non-fatal — returns null on failure)
    const historicalContext = await fetchHistoricalContext(visitType, mrn);

    // Transcribe audio via Whisper
    let transcript;
    try {
      transcript = await transcribeAudio(buffer, mimetype, originalname);
    } catch (whisperErr) {
      if (whisperErr.code === 'TRANSCRIPTION_TIMEOUT') {
        return res.status(422).json({
          success: false,
          data:    null,
          error:   { code: 'TRANSCRIPTION_TIMEOUT', message: 'Transcription timed out. Please try again with a shorter recording.' },
        });
      }
      throw whisperErr;
    }

    // Format transcript into SOAP via Claude
    let soap, controlBlock;
    try {
      const result = await formatSoapNote(transcript, customPromptTemplate, historicalContext);
      soap         = result.soap;
      controlBlock = result.controlBlock;
    } catch (claudeErr) {
      if (claudeErr.code === 'SOAP_FORMATTING_FAILED') {
        return res.status(422).json({
          success: false,
          data:    null,
          error:   { code: 'SOAP_FORMATTING_FAILED', message: 'AI note formatting failed. Please try again or enter the note manually.' },
        });
      }
      throw claudeErr;
    }

    // Mark as SOAP Ready (fire-and-forget)
    updateAudioStatus(csn, 'SOAP Ready');

    // Audit log (fire-and-forget)
    auditLogger.logAccess(provider_id, 'SOAP_GENERATED', mrn, csn, req.ip);

    // If Claude recommends a follow-up, send SCHEDULE_FOLLOWUP to Mirth (non-fatal)
    let followUpScheduled = false;
    let followUpDate      = null;
    let followUpCsn       = null;

    if (controlBlock.schedule_follow_up === true && mrn) {
      const newCsn     = `CSN-AUTO-${Date.now()}`;
      const targetDate = new Date(Date.now() + controlBlock.timeline_weeks * 7 * 24 * 3600 * 1000);

      console.log(
        `[transcribe] Claude recommends follow-up in ${controlBlock.timeline_weeks} weeks — ` +
        `sending SCHEDULE_FOLLOWUP to Mirth (newCsn=${newCsn})`
      );

      const scheduleResult = await sendSchedule({
        type:          'SCHEDULE_FOLLOWUP',
        mrn,
        providerId:    provider_id,
        targetDate:    targetDate.toISOString(),
        originCsn:     csn,
        timelineWeeks: controlBlock.timeline_weeks,
        newCsn,
      });

      // Report follow-up info regardless of Mirth success — CSN is already generated
      followUpScheduled = true;
      followUpDate      = targetDate.toISOString();
      followUpCsn       = newCsn;

      if (!scheduleResult.success) {
        console.warn(`[transcribe] Mirth SCHEDULE_FOLLOWUP failed for newCsn=${newCsn} (non-fatal)`);
      }
    }

    console.log(
      `[transcribe] Complete for provider_id=${provider_id} CSN=${csn} — ` +
      `follow_up_scheduled=${followUpScheduled}`
    );

    return res.status(200).json({
      success: true,
      data: {
        transcript,
        soap,
        follow_up_scheduled: followUpScheduled,
        follow_up_date:      followUpDate,
        follow_up_csn:       followUpCsn,
      },
      error: null,
    });

  } catch (err) {
    console.error('[transcribe] Unhandled error:', err.stack || err.message);
    return res.status(500).json({
      success: false,
      data:    null,
      error:   { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred during transcription. Please try again.' },
    });
  }
}

module.exports = router;
