/**
 * FollowUpBanner — AI follow-up scheduling notification (Window 16)
 *
 * Displayed in the editor view between SoapEditor and SubmitPanel when Claude's
 * control block indicates schedule_follow_up === true and Mirth has been notified
 * to create the new encounter.
 *
 * Visual: blue info banner, dismissable with the × button.
 *
 * Props:
 *   date      {string}    ISO 8601 date string for the scheduled follow-up
 *   csn       {string}    The new auto-generated CSN for the follow-up encounter
 *   onDismiss {function}  Called when the × button is clicked
 */

import React from 'react';
import { formatHistoryDate } from '../utils/noteParser.js';

// ---------------------------------------------------------------------------
// FollowUpBanner
// ---------------------------------------------------------------------------

function FollowUpBanner({ date, csn, onDismiss }) {
  if (!date || !csn) return null;

  const formattedDate = formatHistoryDate(date);

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        display:      'flex',
        alignItems:   'flex-start',
        gap:          '12px',
        background:   '#eff6ff',
        border:       '1px solid #bfdbfe',
        borderRadius: 'var(--radius)',
        padding:      '1rem 1.25rem',
        marginBottom: '1rem',
        color:        '#1d4ed8',
      }}
    >
      {/* Icon + message */}
      <div style={{ flex: 1, fontSize: '0.9rem', lineHeight: '1.5' }}>
        <span style={{ fontSize: '1.1rem', marginRight: '6px' }}>📅</span>
        <strong>AI recommended and scheduled a follow-up appointment</strong>
        {' '}for{' '}
        <strong>{formattedDate}</strong>.{' '}
        New CSN:{' '}
        <code style={{
          background:   '#dbeafe',
          padding:      '1px 6px',
          borderRadius: '4px',
          fontFamily:   'monospace',
          fontSize:     '0.875rem',
        }}>
          {csn}
        </code>
      </div>

      {/* Dismiss button */}
      <button
        onClick={onDismiss}
        aria-label="Dismiss follow-up notification"
        style={{
          flexShrink:  0,
          background:  'none',
          border:      'none',
          color:       '#1d4ed8',
          cursor:      'pointer',
          fontSize:    '1.2rem',
          lineHeight:  '1',
          padding:     '0 2px',
          opacity:     0.7,
          transition:  'opacity 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; }}
      >
        ×
      </button>
    </div>
  );
}

export default FollowUpBanner;
