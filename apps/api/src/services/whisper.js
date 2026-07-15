/**
 * Service: Whisper Audio Transcription
 *
 * Sends an in-memory audio buffer to OpenAI's Whisper API and returns the
 * raw transcript text. Uses Node 18 native fetch, FormData, and Blob —
 * no additional packages required. Audio is never written to disk.
 *
 * Error codes thrown:
 *   TRANSCRIPTION_TIMEOUT  → Whisper did not respond within 30 seconds
 *   All other errors are re-thrown as-is for the route to handle as 500.
 */

'use strict';

const WHISPER_URL   = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';
const TIMEOUT_MS    = 30_000;

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 *
 * @param {Buffer} audioBuffer  - Raw audio file bytes from multer memoryStorage
 * @param {string} mimetype     - MIME type (e.g. 'audio/mpeg')
 * @param {string} filename     - Original filename — Whisper uses the extension to detect codec
 * @returns {Promise<string>}   - Raw transcript text from Whisper
 * @throws {Error}              - err.code === 'TRANSCRIPTION_TIMEOUT' on timeout
 */
async function transcribeAudio(audioBuffer, mimetype, filename) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('[whisper] FATAL: OPENAI_API_KEY environment variable is not set');
    throw new Error('Server configuration error: OPENAI_API_KEY is missing.');
  }

  // Whisper requires: field "file" (Blob with correct MIME) + field "model"
  const blob = new Blob([audioBuffer], { type: mimetype });
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('model', WHISPER_MODEL);

  // AbortController provides a clean timeout without leaving open connections
  const controller    = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startTime     = Date.now();

  try {
    console.log(`[whisper] Sending audio to Whisper API (file: ${filename}, size: ${audioBuffer.length} bytes)`);

    const response = await fetch(WHISPER_URL, {
      method:  'POST',
      headers: {
        // Do NOT set Content-Type manually — fetch sets multipart boundary automatically
        Authorization: `Bearer ${apiKey}`,
      },
      body:   form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[whisper] Whisper API returned ${response.status}:`, errorText);
      throw new Error(`Whisper API error (HTTP ${response.status}): ${errorText}`);
    }

    const data    = await response.json();
    const elapsed = Date.now() - startTime;

    console.log(`[whisper] Transcription complete in ${elapsed}ms — ${data.text.length} chars`);

    return data.text;

  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`[whisper] Transcription timed out after ${TIMEOUT_MS}ms`);
      const timeoutError = new Error('Transcription timed out. Please try again with a shorter recording.');
      timeoutError.code = 'TRANSCRIPTION_TIMEOUT';
      throw timeoutError;
    }
    throw err;

  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = { transcribeAudio };
