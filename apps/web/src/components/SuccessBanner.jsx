/**
 * SuccessBanner — Post-submission confirmation screen
 *
 * Displays the Mirth acknowledgment after a note is successfully submitted
 * (HTTP 200) or when a duplicate is detected (HTTP 409 DUPLICATE_SUBMISSION).
 *
 * Two visual variants:
 *   isDuplicate === false → green success header
 *   isDuplicate === true  → amber warning header ("already submitted")
 *
 * Shows:
 *   - Submission outcome header
 *   - Message ID, status, patient details, CSN, visit info, signing provider
 *   - Full HL7 MDM^T02 message in a scrollable monospace block
 *   - "Start New Note" button to reset workflow
 *
 * Props:
 *   mirthAck      {object}   { messageId, status, hl7 }
 *   isDuplicate   {boolean}  true → amber variant with "already submitted" copy
 *   encounter     {object}   Selected encounter (for confirmation details)
 *   provider      {object}   Authenticated provider (for "Signed By" row)
 *   onStartNewNote {function} Resets all workflow state, returns to appointments
 */

import React from 'react';
import StatusMessage from './StatusMessage.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month:  'long',
    day:    'numeric',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

/**
 * Normalise HL7 segment separators for display.
 * Mirth may send \r or the literal string "\\r" as segment delimiters.
 * Convert both to \n so the <pre> block wraps correctly.
 */
function normaliseHl7(hl7Str) {
  if (!hl7Str) return '';
  return hl7Str
    .replace(/\\r/g, '\n')   // literal backslash-r from JSON encoding
    .replace(/\r\n/g, '\n')  // Windows line endings
    .replace(/\r/g, '\n');   // bare carriage returns
}

// ── Sub-component — detail row ────────────────────────────────────────────────

function DetailRow({ label, value, mono = false }) {
  return (
    <>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: '500', fontSize: '0.875rem' }}>
        {label}
      </span>
      <span style={{
        color:      'var(--color-text)',
        fontSize:   '0.875rem',
        fontFamily: mono ? 'monospace' : 'inherit',
        wordBreak:  mono ? 'break-all' : 'normal',
      }}>
        {value || '—'}
      </span>
    </>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

function SuccessBanner({ mirthAck, isDuplicate, encounter, provider, onStartNewNote }) {
  const patient = encounter?.patient ?? {};

  return (
    <div>
      {/* Status header */}
      <div style={{ marginBottom: '1.5rem' }}>
        {isDuplicate ? (
          <StatusMessage
            type="warning"
            message="Note already submitted — this is the original confirmation from your earlier submission. No duplicate was written to the EMR."
          />
        ) : (
          <StatusMessage
            type="success"
            message="Note successfully signed and submitted. The HL7 message has been committed to the EMR."
          />
        )}
      </div>

      {/* Confirmation details card */}
      <div style={{
        background:   'var(--color-white)',
        borderRadius: 'var(--radius)',
        padding:      '2rem',
        border:       '1px solid var(--color-border-light)',
        boxShadow:    'var(--shadow-sm)',
        marginBottom: '1.5rem',
      }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--color-text)', marginBottom: '1.5rem' }}>
          Submission Confirmation
        </h2>

        {/* Detail grid */}
        <div style={{
          display:             'grid',
          gridTemplateColumns: '140px 1fr',
          gap:                 '10px 16px',
          marginBottom:        '1.75rem',
        }}>
          <DetailRow label="Message ID" value={mirthAck?.messageId} mono />
          <DetailRow
            label="Status"
            value={
              <span style={{ color: 'var(--color-success)', fontWeight: '600' }}>
                {mirthAck?.status ?? '—'}
              </span>
            }
          />
          <DetailRow label="Patient"    value={`${patient.first_name ?? ''} ${patient.last_name ?? ''}`.trim()} />
          <DetailRow label="CSN"        value={encounter?.csn}        mono />
          <DetailRow label="Visit Type" value={encounter?.visit_type} />
          <DetailRow label="Visit Date" value={formatDate(encounter?.visit_date)} />
          {provider && (
            <DetailRow
              label="Signed By"
              value={`Dr. ${provider.first_name} ${provider.last_name}`}
            />
          )}
        </div>

        {/* HL7 message block */}
        {mirthAck?.hl7 && (
          <div>
            <div style={{
              fontWeight:   '600',
              color:        'var(--color-text-secondary)',
              fontSize:     '0.875rem',
              marginBottom: '8px',
            }}>
              HL7 MDM^T02 Message
            </div>
            <pre style={{
              background:    'var(--color-bg-subtle)',
              border:        '1px solid var(--color-border-light)',
              borderRadius:  'var(--radius-sm)',
              padding:       '1rem',
              fontSize:      '0.78rem',
              fontFamily:    'Consolas, "Courier New", monospace',
              overflowX:     'auto',
              overflowY:     'auto',
              whiteSpace:    'pre-wrap',
              wordBreak:     'break-all',
              maxHeight:     '300px',
              color:         'var(--color-text-secondary)',
              lineHeight:    '1.65',
              margin:        0,
            }}>
              {normaliseHl7(mirthAck.hl7)}
            </pre>
          </div>
        )}
      </div>

      {/* CTA */}
      <div style={{ textAlign: 'center' }}>
        <button
          onClick={onStartNewNote}
          style={{
            padding:      '12px 36px',
            background:   'var(--color-primary)',
            color:        'var(--color-white)',
            border:       'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight:   '600',
            fontSize:     '1rem',
            cursor:       'pointer',
            transition:   'background 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-primary-dark)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-primary)'; }}
        >
          Start New Note
        </button>
      </div>
    </div>
  );
}

export default SuccessBanner;
