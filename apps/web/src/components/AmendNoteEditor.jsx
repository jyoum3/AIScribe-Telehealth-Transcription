/**
 * AmendNoteEditor — Window 14
 *
 * Full-screen modal overlay for viewing and amending a signed clinical note.
 * Opened when the clinician clicks [View / Amend Note] on a Completed panel card.
 *
 * On mount: calls GET /api/notes/:csn to load the current signed note.
 *
 * LAYOUT — two-column side-by-side:
 *
 *   LEFT COLUMN — "Original Signed Note" (read-only):
 *     - Red/amber security banner: IMMUTABLE SIGNED RECORD warning
 *     - Diagonal CSS watermark "SIGNED" across the note area
 *       (overflow: hidden + z-index: 0 on wrapper to prevent right-column bleed)
 *     - Grey (#f5f5f5) disabled textareas — all four SOAP sections
 *
 *   RIGHT COLUMN — "New Amendment Draft":
 *     - Header showing next version number (v[N])
 *     - Editable textareas for all four SOAP sections (pre-populated)
 *     - Required "Amendment Reason" input (blocks submit if empty)
 *     - "Sign Amendment" button → generates UUID, calls POST /api/notes/amend
 *     - Success banner with version confirmation after Mirth ACK
 *
 * Props:
 *   csn          {string}   — encounter ID to fetch and amend
 *   providerName {string}   — displayed in the security banner (e.g. "Alice Chen")
 *   onClose      {function} — called when the modal is dismissed
 *   onSuccess    {function} — called after a successful amendment (refreshes dashboard)
 *
 * Security note:
 *   The idempotencyKey UUID is generated at the moment "Sign Amendment" is clicked.
 *   If the user clicks multiple times, the same UUID is reused (ref-based) — the
 *   backend 409 dedup ensures only one write reaches the database.
 *
 * Amendments are immutable — creates a new versioned row via MDM^T04. Idempotency key prevents duplicate submissions.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getNote, amendNote } from '../services/api.js';
import { parseNoteText } from '../utils/noteParser.js';

// ── SOAP Section labels ────────────────────────────────────────────────────────
const SOAP_SECTIONS = [
  { key: 'subjective',  label: 'SUBJECTIVE' },
  { key: 'objective',   label: 'OBJECTIVE'  },
  { key: 'assessment',  label: 'ASSESSMENT' },
  { key: 'plan',        label: 'PLAN'       },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// parseNoteText is imported from apps/web/src/utils/noteParser.js (shared utility)
// Do NOT define it inline here — changes to parsing logic must go in noteParser.js.

/**
 * Format an ISO date string into a readable local date+time string.
 */
function formatDate(dateStr) {
  if (!dateStr) return 'Unknown date';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year:   'numeric',
    month:  'long',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

function AmendNoteEditor({ csn, providerName, onClose, onSuccess }) {
  // ── Note loading state ──────────────────────────────────────────────────────
  const [noteData,     setNoteData]     = useState(null);  // { csn, note_text, version_num, date_signed, ... }
  const [isLoading,    setIsLoading]    = useState(true);
  const [loadError,    setLoadError]    = useState(null);

  // ── Amendment draft state ───────────────────────────────────────────────────
  const [draftSoap,    setDraftSoap]    = useState({ subjective: '', objective: '', assessment: '', plan: '' });
  const [amendReason,  setAmendReason]  = useState('');

  // ── Submission state ────────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError,  setSubmitError]  = useState(null);
  const [submitSuccess,setSubmitSuccess]= useState(null); // { version_num, messageId }

  // ── Validation state ────────────────────────────────────────────────────────
  const [reasonError,  setReasonError]  = useState(false);

  // ── Idempotency key — born at first submit click, stable across retries ──────
  const idempotencyKeyRef = useRef(null);

  // ── Load note on mount ──────────────────────────────────────────────────────
  const loadNote = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const res = await getNote(csn);
      if (!res.success || !res.data) throw new Error('Unexpected response shape from server.');

      setNoteData(res.data);
      // Pre-populate draft with current note text
      setDraftSoap(parseNoteText(res.data.note_text));
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ??
        err.message ??
        'Failed to load the signed note. Please close and try again.';
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [csn]);

  useEffect(() => {
    loadNote();
  }, [loadNote]);

  // ── Draft SOAP field handler ─────────────────────────────────────────────────
  function handleDraftChange(key, value) {
    setDraftSoap(prev => ({ ...prev, [key]: value }));
  }

  // ── Submit amendment ────────────────────────────────────────────────────────
  async function handleSignAmendment() {
    // Client-side validation: amendment reason required
    if (!amendReason.trim()) {
      setReasonError(true);
      return;
    }
    setReasonError(false);

    // Generate idempotency key once; reuse on retries
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = uuidv4();
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await amendNote(csn, draftSoap, amendReason.trim(), idempotencyKeyRef.current);

      if (!res.success || !res.data) throw new Error('Unexpected response from server.');

      setSubmitSuccess({
        version_num: res.data.version_num,
        messageId:   res.data.mirth_ack?.messageId ?? '—',
      });

      // Call onSuccess after 2.5s to let the clinician read the confirmation
      setTimeout(() => {
        onSuccess();
      }, 2500);

    } catch (err) {
      // Handle 409 duplicate — treat as informational (not a hard error)
      if (err.response?.status === 409) {
        const cached = err.response.data?.data?.mirthAck;
        setSubmitSuccess({
          version_num: noteData?.version_num ?? '?',
          messageId:   cached?.messageId ?? 'cached',
          isDuplicate: true,
        });
        return;
      }

      const msg =
        err.response?.data?.error?.message ??
        err.message ??
        'Amendment submission failed. Please try again.';
      setSubmitError(msg);
      // Reset the idempotency key so a genuine retry gets a fresh key
      idempotencyKeyRef.current = null;
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Backdrop click — close modal ─────────────────────────────────────────────
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  // ── Computed values ──────────────────────────────────────────────────────────
  const currentVersion = noteData?.version_num ?? 1;
  const nextVersion    = currentVersion + 1;
  const signedDate     = formatDate(noteData?.date_signed);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        onClick={handleBackdropClick}
        style={{
          position:   'fixed',
          inset:      0,
          background: 'rgba(0,0,0,0.60)',
          zIndex:     200,
          display:    'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          overflowY:  'auto',
          padding:    '20px 16px',
        }}
      >
        {/* ── Modal panel ── */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background:   'var(--color-white, #fff)',
            borderRadius: '12px',
            width:        '100%',
            maxWidth:     '1100px',
            boxShadow:    '0 24px 80px rgba(0,0,0,0.30)',
            border:       '1px solid var(--color-border-light, #e5e7eb)',
            overflow:     'hidden',
            flexShrink:   0,
          }}
        >
          {/* ── Modal header bar ── */}
          <div style={{
            display:        'flex',
            justifyContent: 'space-between',
            alignItems:     'center',
            padding:        '1rem 1.5rem',
            borderBottom:   '1px solid var(--color-border-light, #e5e7eb)',
            background:     '#f8fafc',
          }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: 'var(--color-text, #111827)' }}>
                Clinical Note — View &amp; Amend
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)' }}>
                {csn}
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background:  'none',
                border:      '1px solid var(--color-border, #d1d5db)',
                borderRadius: '6px',
                width:        '34px',
                height:       '34px',
                cursor:       'pointer',
                fontSize:     '1.2rem',
                color:        'var(--color-text-muted, #6b7280)',
                display:      'flex',
                alignItems:   'center',
                justifyContent: 'center',
                flexShrink:   0,
              }}
              aria-label="Close amendment editor"
            >
              ×
            </button>
          </div>

          {/* ── Modal body ── */}
          <div style={{ padding: '1.25rem 1.5rem' }}>

            {/* Loading state */}
            {isLoading && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted, #6b7280)' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '12px' }}>⏳</div>
                <div style={{ fontWeight: '500' }}>Loading signed note…</div>
              </div>
            )}

            {/* Load error state */}
            {!isLoading && loadError && (
              <div style={{
                background:   '#fef2f2',
                border:       '1px solid #fecaca',
                borderRadius: '8px',
                padding:      '1.5rem',
                textAlign:    'center',
              }}>
                <div style={{ fontWeight: '600', color: '#b91c1c', marginBottom: '8px' }}>
                  Failed to load note
                </div>
                <div style={{ fontSize: '0.875rem', color: '#dc2626', marginBottom: '16px' }}>
                  {loadError}
                </div>
                <button
                  onClick={loadNote}
                  style={{
                    padding:      '8px 20px',
                    background:   '#dc2626',
                    color:        '#fff',
                    border:       'none',
                    borderRadius: '6px',
                    cursor:       'pointer',
                    fontWeight:   '600',
                  }}
                >
                  Retry
                </button>
              </div>
            )}

            {/* ── Side-by-side editor (rendered when note is loaded) ── */}
            {!isLoading && !loadError && noteData && (
              <>
                {/* Success banner — replaces the editor on success */}
                {submitSuccess ? (
                  <SuccessBanner
                    versionNum={submitSuccess.version_num}
                    messageId={submitSuccess.messageId}
                    isDuplicate={submitSuccess.isDuplicate}
                  />
                ) : (
                  <div style={{
                    display:             'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap:                 '1.25rem',
                    alignItems:          'start',
                  }}>

                    {/* ── LEFT COLUMN — Original Signed Note (read-only) ── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

                      {/* Security banner */}
                      <div style={{
                        background:   '#fff7ed',
                        border:       '1px solid #fed7aa',
                        borderLeft:   '4px solid #ea580c',
                        borderRadius: '6px',
                        padding:      '10px 14px',
                        fontSize:     '0.8rem',
                        color:        '#9a3412',
                        lineHeight:   '1.5',
                      }}>
                        <strong>⚠ IMMUTABLE SIGNED RECORD</strong>
                        {' '}— Digitally signed by Dr. {providerName || 'Unknown'} on {signedDate}.
                        This version is legally locked. Amendments create a new traceable audit version.
                      </div>

                      {/* Column header */}
                      <div style={{ fontWeight: '600', fontSize: '0.875rem', color: 'var(--color-text-muted, #6b7280)' }}>
                        Original Note — v{currentVersion} (Read-Only)
                      </div>

                      {/* SOAP sections — read-only with watermark */}
                      {SOAP_SECTIONS.map(({ key, label }) => (
                        <ReadOnlySection
                          key={key}
                          label={label}
                          value={parseNoteText(noteData.note_text)[key]}
                        />
                      ))}
                    </div>

                    {/* ── RIGHT COLUMN — Amendment Draft (editable) ── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

                      {/* Column header */}
                      <div style={{
                        background:   '#eff6ff',
                        border:       '1px solid #bfdbfe',
                        borderLeft:   '4px solid #2563eb',
                        borderRadius: '6px',
                        padding:      '10px 14px',
                        fontSize:     '0.8rem',
                        color:        '#1e40af',
                        fontWeight:   '500',
                      }}>
                        Amendment Draft — will be saved as <strong>v{nextVersion}</strong>
                      </div>

                      {/* Editable SOAP sections */}
                      {SOAP_SECTIONS.map(({ key, label }) => (
                        <EditableSection
                          key={key}
                          label={label}
                          value={draftSoap[key]}
                          onChange={val => handleDraftChange(key, val)}
                          disabled={isSubmitting}
                        />
                      ))}

                      {/* Amendment Reason field */}
                      <div>
                        <label style={{
                          display:      'block',
                          fontSize:     '0.75rem',
                          fontWeight:   '700',
                          color:        reasonError ? '#dc2626' : 'var(--color-text, #111827)',
                          marginBottom: '4px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}>
                          Amendment Reason <span style={{ color: '#dc2626' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={amendReason}
                          onChange={e => {
                            setAmendReason(e.target.value);
                            if (reasonError && e.target.value.trim()) setReasonError(false);
                          }}
                          disabled={isSubmitting}
                          placeholder="Describe what was changed and why (required)"
                          style={{
                            width:        '100%',
                            boxSizing:    'border-box',
                            padding:      '8px 10px',
                            fontSize:     '0.875rem',
                            border:       `1px solid ${reasonError ? '#dc2626' : 'var(--color-border, #d1d5db)'}`,
                            borderRadius: '6px',
                            background:   isSubmitting ? '#f9fafb' : '#fff',
                            color:        'var(--color-text, #111827)',
                            outline:      'none',
                          }}
                        />
                        {reasonError && (
                          <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#dc2626' }}>
                            Amendment reason is required before signing.
                          </p>
                        )}
                      </div>

                      {/* Submit error */}
                      {submitError && (
                        <div style={{
                          background:   '#fef2f2',
                          border:       '1px solid #fecaca',
                          borderRadius: '6px',
                          padding:      '10px 12px',
                          fontSize:     '0.825rem',
                          color:        '#b91c1c',
                        }}>
                          {submitError}
                        </div>
                      )}

                      {/* Sign Amendment button */}
                      <button
                        onClick={handleSignAmendment}
                        disabled={isSubmitting}
                        style={{
                          padding:      '12px 20px',
                          background:   isSubmitting ? '#9ca3af' : '#1d4ed8',
                          color:        '#fff',
                          border:       'none',
                          borderRadius: '6px',
                          fontWeight:   '700',
                          fontSize:     '0.9rem',
                          cursor:       isSubmitting ? 'not-allowed' : 'pointer',
                          display:      'flex',
                          alignItems:   'center',
                          justifyContent: 'center',
                          gap:          '8px',
                          transition:   'background 0.15s',
                        }}
                      >
                        {isSubmitting ? (
                          <>
                            <SubmitSpinner />
                            Signing Amendment…
                          </>
                        ) : (
                          <>✍ Sign Amendment — Save as v{nextVersion}</>
                        )}
                      </button>

                      {/* Legal disclaimer */}
                      <p style={{
                        margin:    0,
                        fontSize:  '0.72rem',
                        color:     'var(--color-text-muted, #6b7280)',
                        lineHeight: '1.5',
                      }}>
                        By clicking Sign Amendment, you attest that this amendment is accurate
                        and complete. The amendment will be transmitted as an HL7 MDM^T04 message
                        and permanently recorded in the clinical record.
                      </p>
                    </div>

                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── ReadOnlySection — left column SOAP section with watermark ─────────────────

function ReadOnlySection({ label, value }) {
  return (
    <div>
      <div style={{
        fontSize:      '0.72rem',
        fontWeight:    '700',
        color:         'var(--color-text-muted, #6b7280)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom:  '3px',
      }}>
        {label}
      </div>

      {/*
        Watermark wrapper:
          - position: relative  → anchors the ::before pseudo-element
          - overflow: hidden    → CRITICAL: clips the rotated watermark text so it
                                  cannot bleed outside this wrapper into the right column
          - z-index: 0          → establishes stacking context below right column inputs
        The watermark is achieved via a sibling overlay div (React cannot use ::before).
      */}
      <div style={{
        position:     'relative',
        overflow:     'hidden',
        borderRadius: '6px',
        zIndex:       0,
      }}>
        {/* Watermark overlay — positioned inside the clipping wrapper */}
        <div
          aria-hidden="true"
          style={{
            position:       'absolute',
            top:            '50%',
            left:           '50%',
            transform:      'translate(-50%, -50%) rotate(-25deg)',
            fontSize:       '64px',
            fontWeight:     '900',
            color:          '#000',
            opacity:        0.06,
            pointerEvents:  'none',
            userSelect:     'none',
            whiteSpace:     'nowrap',
            zIndex:         1,
          }}
        >
          SIGNED
        </div>

        {/* Read-only textarea
            readOnly={true} instead of disabled:
              - Preserves full text contrast for clinical legibility
              - Text remains selectable and copy-pasteable
              - cursor: not-allowed sits on the wrapper div above, not the textarea,
                so the visual cue still renders correctly
        */}
        <textarea
          readOnly
          value={value || '[Section not available]'}
          rows={5}
          style={{
            position:     'relative',
            zIndex:       2,
            display:      'block',
            width:        '100%',
            boxSizing:    'border-box',
            padding:      '8px 10px',
            fontSize:     '0.825rem',
            lineHeight:   '1.6',
            background:   '#f5f5f5',
            color:        '#374151',        // full-contrast readable text
            border:       '1px solid #e5e7eb',
            borderRadius: '6px',
            resize:       'none',
            cursor:       'not-allowed',    // visual cue — does not block text selection
            fontFamily:   'inherit',
            outline:      'none',
          }}
        />
      </div>
    </div>
  );
}

// ── EditableSection — right column SOAP section ───────────────────────────────

function EditableSection({ label, value, onChange, disabled }) {
  return (
    <div>
      <div style={{
        fontSize:      '0.72rem',
        fontWeight:    '700',
        color:         'var(--color-text, #111827)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom:  '3px',
      }}>
        {label}
      </div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        rows={5}
        style={{
          display:      'block',
          width:        '100%',
          boxSizing:    'border-box',
          padding:      '8px 10px',
          fontSize:     '0.825rem',
          lineHeight:   '1.6',
          background:   disabled ? '#f9fafb' : '#fff',
          color:        'var(--color-text, #111827)',
          border:       '1px solid var(--color-border, #d1d5db)',
          borderRadius: '6px',
          resize:       'vertical',
          fontFamily:   'inherit',
          outline:      'none',
        }}
      />
    </div>
  );
}

// ── SuccessBanner — shown after successful amendment submission ────────────────

function SuccessBanner({ versionNum, messageId, isDuplicate }) {
  return (
    <div style={{
      background:   '#f0fdf4',
      border:       '1px solid #86efac',
      borderLeft:   '4px solid #16a34a',
      borderRadius: '8px',
      padding:      '2rem',
      textAlign:    'center',
    }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>
        {isDuplicate ? '📋' : '✅'}
      </div>
      <div style={{
        fontWeight:   '700',
        fontSize:     '1.05rem',
        color:        '#15803d',
        marginBottom: '8px',
      }}>
        {isDuplicate
          ? `Amendment v${versionNum} already on record`
          : `Amendment v${versionNum} signed and transmitted`}
      </div>
      <div style={{ fontSize: '0.85rem', color: '#166534', lineHeight: '1.6' }}>
        {isDuplicate
          ? 'This amendment was previously submitted. The original record is unchanged.'
          : `Transmitted via HL7 MDM^T04 · Message ID: ${messageId}`}
      </div>
      <div style={{ marginTop: '12px', fontSize: '0.78rem', color: '#4b7c59' }}>
        Returning to dashboard…
      </div>
    </div>
  );
}

// ── SubmitSpinner ─────────────────────────────────────────────────────────────

function SubmitSpinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display:        'inline-block',
        width:          '14px',
        height:         '14px',
        border:         '2px solid rgba(255,255,255,0.35)',
        borderTopColor: '#fff',
        borderRadius:   '50%',
        animation:      'aiscribe-spin 0.7s linear infinite',
        flexShrink:     0,
      }}
    />
  );
}

export default AmendNoteEditor;
