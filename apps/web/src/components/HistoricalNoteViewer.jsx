/**
 * HistoricalNoteViewer — Window 15
 *
 * Right-side drawer for viewing a historical signed clinical note.
 * Triggered by "View Note" buttons in the PatientSidebar timeline.
 *
 * ── Portal Architecture (React DOM Clipping Safeguard) ────────────────────────
 * This component is ALWAYS rendered via ReactDOM.createPortal(_, document.body)
 * from its parent (PatientSidebar). It does NOT render inside the sidebar's
 * component tree. This ensures the fixed-position drawer and its backdrop
 * always escape all parent stacking contexts and overflow constraints
 * (overflow-y: auto on the sidebar, overflow: hidden on the Dashboard body).
 *
 * The portal target (document.body) is managed by PatientSidebar.jsx.
 * This file only defines the drawer's visual layout and data-fetching logic.
 *
 * ── Layout ────────────────────────────────────────────────────────────────────
 *   Backdrop:   position:fixed, inset:0, rgba overlay (zIndex: 290)
 *               Clicking the backdrop calls onClose()
 *   Drawer:     position:fixed, right:0, top:0, height:100vh, width:480px
 *               zIndex: 300 — renders above the backdrop
 *
 *   Sticky header banner (blue-grey background):
 *     "READ-ONLY ARCHIVED RECORD — Signed [Date] · Version [N]"
 *     + close × button
 *
 *   SOAP content area (overflow-y: auto, flex-grows to fill height):
 *     Parsed via shared parseNoteText() utility from noteParser.js
 *     Each section: uppercase label + readOnly textarea (not disabled)
 *       - readOnly={true}: text is full-contrast and copy-pasteable
 *       - cursor: not-allowed on parent wrapper div (visual cue without blocking selection)
 *
 *   Sticky footer:
 *     CSN badge (monospace) + read-only disclaimer
 *
 * ── Data Flow ─────────────────────────────────────────────────────────────────
 *   On mount: calls GET /api/notes/:csn (getNote from api.js)
 *   Checks clinical_note_versions first (is_current=TRUE), falls back to clinical_notes (v1)
 *   Shows loading spinner, error state with retry, or note content
 *
 * Props:
 *   csn     {string}   — encounter ID whose note to display
 *   onClose {function} — called when the viewer should be dismissed
 *
 * Note immutability — signed notes are never modified; amendments create new versioned rows.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getNote } from '../services/api.js';
import { parseNoteText, formatSignedDate } from '../utils/noteParser.js';

// ── SOAP Section definitions ──────────────────────────────────────────────────
const SOAP_SECTIONS = [
  { key: 'subjective',  label: 'SUBJECTIVE'  },
  { key: 'objective',   label: 'OBJECTIVE'   },
  { key: 'assessment',  label: 'ASSESSMENT'  },
  { key: 'plan',        label: 'PLAN'        },
];

// ── Component ─────────────────────────────────────────────────────────────────

function HistoricalNoteViewer({ csn, onClose }) {
  const [noteData,  setNoteData]  = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // ── Fetch note on mount ──────────────────────────────────────────────────────
  const loadNote = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const res = await getNote(csn);
      if (!res.success || !res.data) {
        throw new Error('Unexpected response from server.');
      }
      setNoteData(res.data);
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ??
        err.message ??
        'Failed to load this historical note. Please try again.';
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [csn]);

  useEffect(() => {
    loadNote();
  }, [loadNote]);

  // ── Keyboard accessibility — close on Escape ─────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // ── Computed display values ──────────────────────────────────────────────────
  const parsedSoap  = noteData ? parseNoteText(noteData.note_text) : null;
  const signedDate  = formatSignedDate(noteData?.date_signed, { hour: undefined, minute: undefined });
  const versionNum  = noteData?.version_num ?? 1;

  // ── Render ───────────────────────────────────────────────────────────────────
  // NOTE: This JSX is rendered into document.body via ReactDOM.createPortal()
  // in PatientSidebar.jsx. The fixed positioning below works because the portal
  // target (document.body) has no transform, filter, or will-change that could
  // create a new containing block.

  return (
    <>
      {/* ── Semi-transparent backdrop ── */}
      <div
        onClick={onClose}
        aria-label="Close historical note viewer"
        style={{
          position:   'fixed',
          inset:      0,
          background: 'rgba(0, 0, 0, 0.45)',
          zIndex:     290,
        }}
      />

      {/* ── Drawer panel ── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Historical clinical note — read only"
        style={{
          position:    'fixed',
          right:       0,
          top:         0,
          height:      '100vh',
          width:       '480px',
          maxWidth:    '100vw',
          zIndex:      300,
          background:  '#ffffff',
          boxShadow:   '-4px 0 24px rgba(0, 0, 0, 0.18)',
          display:     'flex',
          flexDirection: 'column',
          overflow:    'hidden',
        }}
      >
        {/* ── Sticky header banner ── */}
        <div style={{
          flexShrink:   0,
          background:   '#374151',
          color:        '#ffffff',
          padding:      '14px 16px',
          display:      'flex',
          alignItems:   'flex-start',
          justifyContent: 'space-between',
          gap:          '12px',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize:      '0.7rem',
              fontWeight:    '700',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color:         '#9ca3af',
              marginBottom:  '3px',
            }}>
              Archived Clinical Record
            </div>
            <div style={{
              fontSize:    '0.875rem',
              fontWeight:  '600',
              lineHeight:  '1.4',
              color:       '#f9fafb',
            }}>
              READ-ONLY — Signed {signedDate} · Version {versionNum}
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Close historical note viewer"
            style={{
              flexShrink:    0,
              background:    'rgba(255,255,255,0.12)',
              border:        '1px solid rgba(255,255,255,0.20)',
              borderRadius:  '6px',
              width:         '30px',
              height:        '30px',
              cursor:        'pointer',
              color:         '#e5e7eb',
              fontSize:      '1.1rem',
              display:       'flex',
              alignItems:    'center',
              justifyContent: 'center',
              lineHeight:    1,
              transition:    'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.22)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
          >
            ×
          </button>
        </div>

        {/* ── Scrollable SOAP content area ── */}
        <div style={{
          flex:       1,
          overflowY:  'auto',
          background: '#f8f8f8',
          padding:    '16px',
        }}>

          {/* Loading state */}
          {isLoading && (
            <div style={{
              display:        'flex',
              flexDirection:  'column',
              alignItems:     'center',
              justifyContent: 'center',
              padding:        '3rem 1rem',
              gap:            '12px',
              color:          '#6b7280',
            }}>
              <LoadingSpinner />
              <span style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                Loading archived note…
              </span>
            </div>
          )}

          {/* Error state */}
          {!isLoading && loadError && (
            <div style={{
              background:   '#fef2f2',
              border:       '1px solid #fecaca',
              borderRadius: '8px',
              padding:      '1.25rem',
              textAlign:    'center',
            }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>⚠️</div>
              <div style={{ fontWeight: '600', color: '#b91c1c', marginBottom: '6px', fontSize: '0.9rem' }}>
                Failed to load note
              </div>
              <div style={{ fontSize: '0.825rem', color: '#dc2626', marginBottom: '14px' }}>
                {loadError}
              </div>
              <button
                onClick={loadNote}
                style={{
                  padding:      '7px 18px',
                  background:   '#dc2626',
                  color:        '#fff',
                  border:       'none',
                  borderRadius: '6px',
                  cursor:       'pointer',
                  fontWeight:   '600',
                  fontSize:     '0.8rem',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* SOAP content — rendered when note is loaded */}
          {!isLoading && !loadError && noteData && parsedSoap && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {SOAP_SECTIONS.map(({ key, label }) => (
                <SoapSection
                  key={key}
                  label={label}
                  value={parsedSoap[key]}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Sticky footer ── */}
        <div style={{
          flexShrink:   0,
          background:   '#f8f8f8',
          borderTop:    '1px solid #e5e7eb',
          padding:      '10px 16px',
          display:      'flex',
          alignItems:   'center',
          gap:          '10px',
          flexWrap:     'wrap',
        }}>
          {/* CSN badge */}
          <span style={{
            padding:      '2px 8px',
            background:   '#f1f5f9',
            color:        '#475569',
            border:       '1px solid #e2e8f0',
            borderRadius: '5px',
            fontFamily:   'monospace',
            fontSize:     '0.72rem',
            whiteSpace:   'nowrap',
          }}>
            {csn}
          </span>
          <span style={{
            fontSize:   '0.72rem',
            color:      '#9ca3af',
            fontStyle:  'italic',
          }}>
            This record is read-only and cannot be modified
          </span>
        </div>
      </div>
    </>
  );
}

// ── SoapSection — individual SOAP section display ─────────────────────────────
// Uses readOnly={true} (NOT disabled) per medical record copyability rule:
//   - Text remains full-contrast and selectable
//   - Clinicians can highlight and copy text to the active note editor
//   - cursor: not-allowed on the wrapper div provides the visual cue

function SoapSection({ label, value }) {
  const displayValue = value || '[Section not available]';

  return (
    <div>
      {/* Section label */}
      <div style={{
        fontSize:      '0.7rem',
        fontWeight:    '700',
        color:         '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        marginBottom:  '4px',
      }}>
        {label}
      </div>

      {/*
        Wrapper div with cursor: not-allowed provides the visual "locked" indicator
        without preventing text selection inside the readOnly textarea.
        overflow: hidden clips any content overflow cleanly.
      */}
      <div style={{ cursor: 'not-allowed', borderRadius: '6px', overflow: 'hidden' }}>
        <textarea
          readOnly
          value={displayValue}
          rows={4}
          style={{
            display:      'block',
            width:        '100%',
            boxSizing:    'border-box',
            padding:      '9px 11px',
            fontSize:     '0.825rem',
            lineHeight:   '1.65',
            background:   '#ffffff',
            color:        '#1f2937',        // full-contrast — clinical legibility priority
            border:       '1px solid #e5e7eb',
            borderRadius: '6px',
            resize:       'none',
            cursor:       'text',           // override to 'text' inside so selection UX is natural
            fontFamily:   'inherit',
            outline:      'none',
          }}
        />
      </div>
    </div>
  );
}

// ── LoadingSpinner ─────────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display:        'inline-block',
        width:          '24px',
        height:         '24px',
        border:         '3px solid #e5e7eb',
        borderTopColor: '#6b7280',
        borderRadius:   '50%',
        animation:      'aiscribe-spin 0.7s linear infinite',
      }}
    />
  );
}

export default HistoricalNoteViewer;
