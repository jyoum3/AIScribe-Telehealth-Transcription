/**
 * SubmitPanel — Sign & Submit action bar
 *
 * Renders the "Sign & Submit Note" button below the SOAP editor.
 * Contains all submission logic including double-click protection,
 * client-side SOAP validation, idempotency key handling, and
 * specific error handling per API error code.
 *
 * Key safety mechanisms:
 *
 *   1. isSubmittingRef (useRef) — synchronous guard that blocks concurrent
 *      invocations before React has had a chance to re-render and disable
 *      the button. Solves the rapid double-click race condition.
 *
 *   2. idempotencyKeyRef — read-only here. The key is generated in App.jsx
 *      when transcription completes and lives in a ref. This component never
 *      generates or clears it. This means:
 *        - Failed submissions (MIRTH_UNAVAILABLE etc.) preserve the key so
 *          the retry uses the same UUID → backend returns 409 with cached
 *          confirmation if the note already committed despite network failure.
 *        - The clinician can retry safely without risk of duplicate writes.
 *
 *   3. 409 DUPLICATE_SUBMISSION → routed to onSubmitDuplicate (not treated
 *      as an error) so App.jsx can show the cached HL7 confirmation banner.
 *
 * Props:
 *   csn               {string}   Encounter identifier
 *   soapNote          {object}   { subjective, objective, assessment, plan }
 *   idempotencyKeyRef {React.MutableRefObject<string>}
 *   onSubmitSuccess   {function(mirthAck)}  Called on 200 OK
 *   onSubmitDuplicate {function(mirthAck)}  Called on 409 DUPLICATE_SUBMISSION
 */

import React, { useState, useRef } from 'react';
import { submitNote } from '../services/api.js';
import StatusMessage from './StatusMessage.jsx';

const REQUIRED_SOAP_KEYS = ['subjective', 'objective', 'assessment', 'plan'];

const API_ERROR_MESSAGES = {
  MIRTH_UNAVAILABLE:       'The EMR system is currently unreachable. Your note has been preserved — please try again in a moment.',
  ENCOUNTER_ACCESS_DENIED: 'You do not have permission to submit a note for this encounter.',
  INCOMPLETE_SOAP:         'SOAP note must include all four sections with non-empty content.',
  MISSING_FIELDS:          'Required fields are missing. Please refresh the page and try again.',
  INVALID_TOKEN:           'Your session is invalid. Please log in again.',
  TOKEN_EXPIRED:           'Your session has expired. Please log in again.',
};

function SubmitPanel({ csn, soapNote, idempotencyKeyRef, onSubmitSuccess, onSubmitDuplicate }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError,  setSubmitError]  = useState(null);

  // Synchronous double-click guard — useRef updates outside React's render cycle.
  // When Click #2 fires, this check is already true before any async code ran.
  const isSubmittingRef = useRef(false);

  async function handleSubmit() {
    // ── Guard 1: block concurrent invocations synchronously ──────────────────
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // ── Guard 2: client-side SOAP validation (no API call for empty fields) ─
      for (const key of REQUIRED_SOAP_KEYS) {
        const val = soapNote?.[key];
        if (!val || typeof val !== 'string' || val.trim() === '') {
          setSubmitError(
            `SOAP note is incomplete — the "${key}" section cannot be empty. All four sections are required before signing.`
          );
          return; // finally block resets both guards
        }
      }

      // ── Guard 3: verify idempotency key exists ────────────────────────────
      const key = idempotencyKeyRef.current;
      if (!key) {
        setSubmitError('Internal error: missing submission key. Please refresh the page and try again.');
        return;
      }

      // ── Submit ────────────────────────────────────────────────────────────
      const result = await submitNote(csn, soapNote, key);

      if (result.success) {
        onSubmitSuccess(result.data.mirthAck);
      }

    } catch (err) {
      const code    = err.response?.data?.error?.code;
      const message = err.response?.data?.error?.message;

      if (code === 'DUPLICATE_SUBMISSION') {
        // 409 — note already in EMR. Show cached confirmation as success variant.
        // Key is preserved in ref — this is intentional (the key matched the record).
        const cachedAck = err.response?.data?.data?.mirthAck;
        onSubmitDuplicate(cachedAck);
        return; // finally still runs
      }

      // All other errors — idempotency key is NOT cleared here.
      // If the error was MIRTH_UNAVAILABLE and the note actually committed before
      // the network dropped, the next retry with the same key will return 409
      // with the cached confirmation — which is the correct safe outcome.
      setSubmitError(
        API_ERROR_MESSAGES[code] ??
        message ??
        'Submission failed. Please check your connection and try again.'
      );

    } finally {
      // Reset both guards regardless of path taken through the try block
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{
      background:   'var(--color-white)',
      borderRadius: 'var(--radius)',
      padding:      '1.5rem 2rem',
      border:       '1px solid var(--color-border-light)',
      boxShadow:    'var(--shadow-sm)',
    }}>
      {/* Action row */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        flexWrap:       'wrap',
        gap:            '1rem',
      }}>
        <div>
          <div style={{ fontWeight: '600', color: 'var(--color-text)' }}>
            Ready to Sign?
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '2px' }}>
            This will transmit the note to the EMR via HL7 MDM^T02.
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          style={{
            padding:      '12px 28px',
            background:   isSubmitting ? '#93c5fd' : 'var(--color-primary)',
            color:        'var(--color-white)',
            border:       'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight:   '600',
            fontSize:     '1rem',
            cursor:       isSubmitting ? 'not-allowed' : 'pointer',
            transition:   'background 0.2s',
            whiteSpace:   'nowrap',
          }}
        >
          {isSubmitting ? 'Submitting…' : 'Sign & Submit Note'}
        </button>
      </div>

      {/* Loading indicator */}
      {isSubmitting && (
        <div style={{ marginTop: '1rem' }}>
          <StatusMessage type="loading" message="Submitting note to EMR — please wait…" />
        </div>
      )}

      {/* Error display */}
      {submitError && !isSubmitting && (
        <div style={{ marginTop: '1rem' }}>
          <StatusMessage type="error" message={submitError} />
        </div>
      )}
    </div>
  );
}

export default SubmitPanel;
