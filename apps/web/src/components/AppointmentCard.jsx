/**
 * AppointmentCard — Single encounter card for the split dashboard
 *
 * Used in both dashboard panels via the `variant` prop:
 *
 *   variant='pending'
 *     → Shows StatusBadge pipeline pill for the current audio_status.
 *     → Entire card is clickable — calls onSelect(appointment).
 *     → No lock icon.
 *
 *   variant='completed'
 *     → Shows lock icon + green "Digitally Signed" badge instead of StatusBadge.
 *     → Card has a 4px grey left-border accent to visually distinguish signed records.
 *     → Shows "[View / Amend Note]" link button in the action area.
 *     → Clicking the link button calls onSelect(appointment).
 *
 * Props:
 *   appointment {object}               — row from app_appointments (with patient sub-object)
 *   variant     {'pending'|'completed'} — controls visual mode
 *   onSelect    {function(appointment)} — parent callback on card/link activation
 */

import React, { useState } from 'react';
import StatusBadge from './StatusBadge.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format a UTC ISO timestamp to a local HH:MM AM/PM time string.
 * Uses the browser's (or Node's test) local timezone automatically.
 */
function formatVisitTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour:   '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

function AppointmentCard({ appointment, variant, onSelect }) {
  const [hovered, setHovered] = useState(false);

  const patient      = appointment.patient ?? {};
  const isCompleted  = variant === 'completed';
  const patientName  = `${patient.first_name ?? ''} ${patient.last_name ?? ''}`.trim() || '—';
  const visitTime    = formatVisitTime(appointment.visit_date);

  // ── Pending card — entire card is a click target ─────────────────────────

  if (!isCompleted) {
    return (
      <button
        onClick={() => onSelect(appointment)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display:       'block',
          width:         '100%',
          padding:       '1rem 1.25rem',
          background:    'var(--color-white)',
          border:        `1px solid ${hovered ? 'var(--color-primary)' : 'var(--color-border-light)'}`,
          borderRadius:  'var(--radius)',
          textAlign:     'left',
          cursor:        'pointer',
          boxShadow:     hovered
            ? '0 2px 8px rgba(26,86,219,0.15)'
            : 'var(--shadow-sm)',
          transition:    'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        <CardBody
          patientName={patientName}
          mrn={appointment.mrn}
          visitTime={visitTime}
          visitType={appointment.visit_type}
          csn={appointment.csn}
          rightSlot={<StatusBadge status={appointment.audio_status} />}
        />
      </button>
    );
  }

  // ── Completed card — grey left-border accent, link button for action ──────

  return (
    <div
      style={{
        padding:       '1rem 1.25rem',
        background:    '#fafafa',
        border:        '1px solid var(--color-border-light)',
        borderLeft:    '4px solid #d1d5db',
        borderRadius:  'var(--radius)',
        boxShadow:     'var(--shadow-sm)',
      }}
    >
      <CardBody
        patientName={patientName}
        mrn={appointment.mrn}
        visitTime={visitTime}
        visitType={appointment.visit_type}
        csn={appointment.csn}
        rightSlot={
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
            {/* Lock + Digitally Signed badge */}
            <span style={{
              display:      'inline-flex',
              alignItems:   'center',
              gap:          '5px',
              padding:      '3px 10px',
              background:   '#f0fdf4',
              color:        '#16a34a',
              border:       '1px solid #bbf7d0',
              borderRadius: '12px',
              fontSize:     '0.78rem',
              fontWeight:   '600',
              whiteSpace:   'nowrap',
            }}>
              <span aria-hidden="true">🔒</span>
              Digitally Signed
            </span>

            {/* View / Amend link button */}
            <button
              onClick={() => onSelect(appointment)}
              style={{
                background:  'none',
                border:      'none',
                color:       'var(--color-primary)',
                cursor:      'pointer',
                padding:     '0',
                fontSize:    '0.8rem',
                fontWeight:  '500',
                textDecoration: 'underline',
                textUnderlineOffset: '2px',
              }}
            >
              [View / Amend Note]
            </button>
          </div>
        }
      />
    </div>
  );
}

// ── CardBody — shared inner layout for both variants ─────────────────────────

function CardBody({ patientName, mrn, visitTime, visitType, csn, rightSlot }) {
  return (
    <div style={{
      display:        'flex',
      justifyContent: 'space-between',
      alignItems:     'center',
      flexWrap:       'wrap',
      gap:            '8px',
    }}>
      {/* Left column: patient info */}
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        {/* Patient name */}
        <div style={{
          fontWeight: '600',
          fontSize:   '1rem',
          color:      'var(--color-text)',
          marginBottom: '4px',
        }}>
          {patientName}
        </div>

        {/* Meta row: MRN badge + visit time + visit type */}
        <div style={{
          display:    'flex',
          flexWrap:   'wrap',
          alignItems: 'center',
          gap:        '8px',
          fontSize:   '0.8rem',
        }}>
          {/* MRN badge */}
          <span style={{
            padding:      '2px 7px',
            background:   '#f1f5f9',
            color:        '#475569',
            border:       '1px solid #e2e8f0',
            borderRadius: '6px',
            fontFamily:   'monospace',
            fontSize:     '0.75rem',
          }}>
            MRN: {mrn ?? '—'}
          </span>

          {/* Visit time */}
          <span style={{ color: 'var(--color-text-muted)' }}>
            {visitTime}
          </span>

          {/* Visit type */}
          <span style={{
            padding:      '2px 8px',
            background:   'var(--color-primary-light)',
            color:        'var(--color-primary)',
            borderRadius: '10px',
            fontWeight:   '500',
          }}>
            {visitType ?? '—'}
          </span>
        </div>

        {/* CSN in faint monospace below */}
        <div style={{
          marginTop:  '4px',
          fontSize:   '0.72rem',
          color:      'var(--color-text-faint)',
          fontFamily: 'monospace',
        }}>
          {csn}
        </div>
      </div>

      {/* Right column: status badge or completed controls */}
      <div style={{ flexShrink: 0 }}>
        {rightSlot}
      </div>
    </div>
  );
}

export default AppointmentCard;
