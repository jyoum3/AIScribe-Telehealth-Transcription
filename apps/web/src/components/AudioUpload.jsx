/**
 * AudioUpload — Session recording upload and transcription trigger
 *
 * Allows the clinician to select an .mp3 or .wav file, validates it
 * client-side (MIME type + size) before any API call, then calls
 * POST /api/transcribe. On success, passes transcript + soap up to
 * the parent (App.jsx) via onTranscribeSuccess.
 *
 * Shows a patient identity card above the upload area so the clinician
 * can confirm they are uploading audio for the correct encounter.
 *
 * Window 13: passes the full `encounter` object to `transcribeAudio()` so
 * the backend receives `csn` and `mrn` as multipart fields — enabling
 * audio_status lifecycle updates and SOAP_GENERATED audit logging.
 *
 * Client-side validation catches:
 *   - Wrong MIME type → instant error, no API call
 *   - File > 25 MB   → instant error, no API call
 *
 * States handled:
 *   idle         — file picker (empty or file selected)
 *   fileError    — inline validation error below the drop zone
 *   transcribing — spinner + 30-second warning message
 *   apiError     — specific error messages per error code
 *
 * Props:
 *   encounter          {object}    Selected encounter (for breadcrumb + patient card)
 *   onTranscribeSuccess {function(transcript, soap)}
 *   onBack             {function}  Navigate back to appointment list
 */

import React, { useState, useRef } from 'react';
import { transcribeAudio } from '../services/api.js';
import StatusMessage from './StatusMessage.jsx';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

// MIME types accepted by the browser input and validated in code.
// Include common browser MIME variations for .wav files.
const ACCEPTED_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/vnd.wave',
]);

const ACCEPTED_EXT = new Set(['.mp3', '.wav']);

// Human-friendly messages per API error code
const API_ERROR_MESSAGES = {
  AUDIO_FILE_TOO_LARGE:   'File exceeds the 25 MB limit. Please upload a shorter recording.',
  INVALID_AUDIO_FORMAT:   'Unsupported file type. Please upload an .mp3 or .wav file.',
  TRANSCRIPTION_TIMEOUT:  'Transcription timed out. Please try again with a shorter recording.',
  SOAP_FORMATTING_FAILED: 'AI note formatting failed. Please try again or enter the note manually.',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDob(dobStr) {
  if (!dobStr) return '—';
  return new Date(dobStr).toLocaleDateString('en-US', {
    month: 'long',
    day:   'numeric',
    year:  'numeric',
  });
}

function validateFile(file) {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!ACCEPTED_MIME.has(file.type) && !ACCEPTED_EXT.has(ext)) {
    return 'Unsupported file type. Please upload an .mp3 or .wav file.';
  }
  if (file.size > MAX_SIZE_BYTES) {
    return `File exceeds the 25 MB limit (${formatBytes(file.size)} selected). Please upload a shorter recording.`;
  }
  return null; // null = valid
}

// ── Sub-component — Patient Identity Card ────────────────────────────────────
// Displayed above the upload area so the clinician confirms the correct patient
// before uploading audio.

function PatientCard({ encounter }) {
  if (!encounter) return null;
  const patient = encounter.patient ?? {};

  return (
    <div style={{
      background:   'var(--color-white)',
      borderRadius: 'var(--radius)',
      padding:      '1.25rem 1.5rem',
      border:       '1px solid var(--color-border-light)',
      boxShadow:    'var(--shadow-sm)',
      marginBottom: '1.25rem',
    }}>
      {/* Patient name + visit type badge */}
      <div style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'flex-start',
        flexWrap:       'wrap',
        gap:            '8px',
        marginBottom:   '0.875rem',
      }}>
        <div>
          <div style={{ fontWeight: '700', fontSize: '1.15rem', color: 'var(--color-text)' }}>
            {patient.first_name} {patient.last_name}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginTop: '2px' }}>
            Selected Patient
          </div>
        </div>
        <span style={{
          padding:      '4px 12px',
          background:   'var(--color-primary-light)',
          color:        'var(--color-primary)',
          borderRadius: '12px',
          fontSize:     '0.8rem',
          fontWeight:   '600',
          whiteSpace:   'nowrap',
        }}>
          {encounter.visit_type}
        </span>
      </div>

      {/* Detail grid */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'auto 1fr auto 1fr',
        gap:                 '6px 20px',
        fontSize:            '0.875rem',
      }}>
        <span style={{ color: 'var(--color-text-muted)', fontWeight: '500' }}>MRN</span>
        <span style={{ color: 'var(--color-text)', fontFamily: 'monospace' }}>{encounter.mrn ?? '—'}</span>

        <span style={{ color: 'var(--color-text-muted)', fontWeight: '500' }}>DOB</span>
        <span style={{ color: 'var(--color-text)' }}>{formatDob(patient.dob)}</span>

        <span style={{ color: 'var(--color-text-muted)', fontWeight: '500' }}>CSN</span>
        <span style={{ color: 'var(--color-text)', fontFamily: 'monospace' }}>{encounter.csn ?? '—'}</span>

        <span style={{ color: 'var(--color-text-muted)', fontWeight: '500' }}>Gender</span>
        <span style={{ color: 'var(--color-text)' }}>{patient.gender ?? '—'}</span>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

function AudioUpload({ encounter, onTranscribeSuccess, onBack }) {
  const [selectedFile,    setSelectedFile]    = useState(null);
  const [fileError,       setFileError]       = useState(null);
  const [isTranscribing,  setIsTranscribing]  = useState(false);
  const [transcribeError, setTranscribeError] = useState(null);
  const fileInputRef = useRef(null);

  // ── File selection ──────────────────────────────────────────────────────────

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    setTranscribeError(null);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const validationError = validateFile(file);
    if (validationError) {
      setFileError(validationError);
      setSelectedFile(null);
      e.target.value = ''; // reset so selecting the same file again fires onChange
      return;
    }

    setFileError(null);
    setSelectedFile(file);
  }

  // ── Transcription call ──────────────────────────────────────────────────────

  async function handleTranscribe() {
    if (!selectedFile || isTranscribing) return;

    setTranscribeError(null);
    setIsTranscribing(true);
    try {
      // Window 13: pass the full encounter object so csn + mrn travel with the
      // multipart upload for audio_status lifecycle updates and audit logging.
      const result = await transcribeAudio(selectedFile, encounter);
      // Window 16: extract follow-up info from response and pass as third arg
      const followUpInfo = {
        scheduled: result.data.follow_up_scheduled ?? false,
        date:      result.data.follow_up_date      ?? null,
        csn:       result.data.follow_up_csn       ?? null,
      };
      // Bubble transcript + soap + followUpInfo up to App.jsx
      onTranscribeSuccess(result.data.transcript, result.data.soap, followUpInfo);
    } catch (err) {
      const code    = err.response?.data?.error?.code;
      const message = err.response?.data?.error?.message;
      setTranscribeError(
        API_ERROR_MESSAGES[code] ??
        message ??
        'Transcription failed. Please try again.'
      );
    } finally {
      setIsTranscribing(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const canTranscribe = !!selectedFile && !isTranscribing;

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border:     'none',
            color:      'var(--color-primary)',
            cursor:     'pointer',
            padding:    '0',
            fontSize:   '0.9rem',
            fontWeight: '500',
          }}
        >
          ← Appointments
        </button>
        <span style={{ color: 'var(--color-text-faint)' }}>/</span>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
          {encounter?.patient?.first_name} {encounter?.patient?.last_name}
        </span>
      </div>

      {/* Patient identity card — always shown above the upload area */}
      <PatientCard encounter={encounter} />

      {/* Upload card */}
      <div style={{
        background:   'var(--color-white)',
        borderRadius: 'var(--radius)',
        padding:      '2rem',
        border:       '1px solid var(--color-border-light)',
        boxShadow:    'var(--shadow-sm)',
      }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--color-text)', marginBottom: '0.375rem' }}>
          Upload Session Recording
        </h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          Upload the audio recording from this session to generate a structured SOAP note.
        </p>

        {/* Drop zone / file picker */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => !isTranscribing && fileInputRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          style={{
            border:       `2px dashed ${selectedFile ? 'var(--color-primary)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius)',
            padding:      '2rem',
            textAlign:    'center',
            cursor:       isTranscribing ? 'not-allowed' : 'pointer',
            background:   selectedFile ? 'var(--color-primary-light)' : 'var(--color-bg)',
            transition:   'border-color 0.2s, background 0.2s',
            marginBottom: '1rem',
            userSelect:   'none',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav"
            onChange={handleFileChange}
            disabled={isTranscribing}
            style={{ display: 'none' }}
            aria-label="Select audio file (.mp3 or .wav, max 25 MB)"
          />

          {selectedFile ? (
            <div>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🎵</div>
              <div style={{ fontWeight: '600', color: 'var(--color-text)' }}>{selectedFile.name}</div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
                {formatBytes(selectedFile.size)}
              </div>
              {!isTranscribing && (
                <div style={{ color: 'var(--color-primary)', fontSize: '0.8rem', marginTop: '8px' }}>
                  Click to change file
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>📎</div>
              <div style={{ fontWeight: '500', color: 'var(--color-text-secondary)' }}>
                Click to select a file
              </div>
              <div style={{ color: 'var(--color-text-faint)', fontSize: '0.8rem', marginTop: '6px' }}>
                Accepted formats: .mp3, .wav · Max 25 MB
              </div>
            </div>
          )}
        </div>

        {/* Client-side file validation error */}
        {fileError && (
          <div style={{ marginBottom: '1rem' }}>
            <StatusMessage type="error" message={fileError} />
          </div>
        )}

        {/* Transcription loading state */}
        {isTranscribing && (
          <div style={{ marginBottom: '1rem' }}>
            <StatusMessage
              type="loading"
              message="Transcribing audio — this may take up to 30 seconds. Please wait…"
            />
          </div>
        )}

        {/* API error from transcription */}
        {transcribeError && !isTranscribing && (
          <div style={{ marginBottom: '1rem' }}>
            <StatusMessage type="error" message={transcribeError} />
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handleTranscribe}
          disabled={!canTranscribe}
          style={{
            width:        '100%',
            padding:      '12px',
            background:   canTranscribe ? 'var(--color-primary)' : '#93c5fd',
            color:        'var(--color-white)',
            border:       'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight:   '600',
            fontSize:     '1rem',
            cursor:       canTranscribe ? 'pointer' : 'not-allowed',
            transition:   'background 0.2s',
          }}
        >
          {isTranscribing ? 'Transcribing…' : 'Transcribe Recording'}
        </button>
      </div>
    </div>
  );
}

export default AudioUpload;
