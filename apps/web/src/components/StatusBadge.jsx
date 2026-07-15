/**
 * StatusBadge — Audio pipeline status pill
 *
 * Renders a colored pill for each stage of the audio_status lifecycle:
 *   Pending     → grey
 *   Processing  → amber
 *   SOAP Ready  → blue
 *   Submitted   → green (with checkmark)
 *
 * Props:
 *   status {string} — one of the four lifecycle values from app_appointments.audio_status
 */

import React from 'react';

// Per-status visual configuration
const STATUS_CONFIG = {
  Pending: {
    bg:     '#f3f4f6',
    color:  '#6b7280',
    border: '#d1d5db',
    text:   'Pending',
    icon:   null,
  },
  Processing: {
    bg:     '#fffbeb',
    color:  '#d97706',
    border: '#fde68a',
    text:   'Processing...',
    icon:   null,
  },
  'SOAP Ready': {
    bg:     '#eff6ff',
    color:  '#1d4ed8',
    border: '#bfdbfe',
    text:   'SOAP Ready',
    icon:   null,
  },
  Submitted: {
    bg:     'var(--color-success-light, #f0fdf4)',
    color:  'var(--color-success, #16a34a)',
    border: 'var(--color-success-border, #bbf7d0)',
    text:   'Submitted',
    icon:   '✓',
  },
};

// Fallback config for unknown status values
const FALLBACK_CONFIG = {
  bg:     '#f9fafb',
  color:  '#9ca3af',
  border: '#e5e7eb',
  text:   'Unknown',
  icon:   null,
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? FALLBACK_CONFIG;

  return (
    <span
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          '4px',
        padding:      '3px 10px',
        background:   cfg.bg,
        color:        cfg.color,
        border:       `1px solid ${cfg.border}`,
        borderRadius: '12px',
        fontSize:     '0.78rem',
        fontWeight:   '600',
        whiteSpace:   'nowrap',
        lineHeight:   '1.4',
      }}
    >
      {cfg.icon && <span aria-hidden="true">{cfg.icon}</span>}
      {cfg.text}
    </span>
  );
}

export default StatusBadge;
