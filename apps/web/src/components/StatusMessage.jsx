/**
 * StatusMessage — Reusable inline status display
 *
 * Renders a coloured banner for loading, success, error, and warning states.
 * Used by every component that makes async API calls.
 *
 * Props:
 *   type    {string}  'loading' | 'success' | 'error' | 'warning'
 *   message {string}  The text to display — returns null if empty
 */

import React from 'react';

// Per-type visual config
const CONFIG = {
  loading: {
    bg:     '#f3f4f6',
    border: '#d1d5db',
    color:  '#374151',
    icon:   null, // spinner rendered separately
  },
  success: {
    bg:     'var(--color-success-light)',
    border: 'var(--color-success-border)',
    color:  'var(--color-success)',
    icon:   '✅',
  },
  error: {
    bg:     'var(--color-error-light)',
    border: 'var(--color-error-border)',
    color:  'var(--color-error)',
    icon:   '✗',
  },
  warning: {
    bg:     'var(--color-warning-light)',
    border: 'var(--color-warning-border)',
    color:  'var(--color-warning)',
    icon:   '⚠',
  },
};

function StatusMessage({ type = 'error', message }) {
  if (!message) return null;

  const cfg = CONFIG[type] ?? CONFIG.error;

  const containerStyle = {
    display:      'flex',
    alignItems:   'flex-start',
    gap:          '10px',
    padding:      '12px 16px',
    background:   cfg.bg,
    border:       `1px solid ${cfg.border}`,
    borderRadius: 'var(--radius)',
    color:        cfg.color,
    fontSize:     '0.9rem',
    lineHeight:   '1.5',
  };

  const spinnerStyle = {
    flexShrink:   0,
    width:        '18px',
    height:       '18px',
    border:       '2px solid #d1d5db',
    borderTopColor: '#6b7280',
    borderRadius: '50%',
    animation:    'aiscribe-spin 0.7s linear infinite',
    marginTop:    '2px',
  };

  return (
    <div
      style={containerStyle}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      {type === 'loading' ? (
        <span style={spinnerStyle} aria-hidden="true" />
      ) : (
        <span aria-hidden="true" style={{ flexShrink: 0, marginTop: '1px' }}>
          {cfg.icon}
        </span>
      )}
      <span>{message}</span>
    </div>
  );
}

export default StatusMessage;
