/**
 * SoapEditor — Clinician review and edit surface for AI-generated SOAP notes
 *
 * Pure controlled component — all state lives in App.jsx. Every keystroke
 * in any textarea immediately calls onChange({ ...soapNote, [key]: value })
 * so the parent state is always the single source of truth.
 *
 * This means edits are preserved even if the component unmounts and remounts,
 * because the data never lives inside this component.
 *
 * Four SOAP sections rendered in clinical order:
 *   Subjective → Objective → Assessment → Plan
 *
 * Props:
 *   soapNote   {object}   { subjective, objective, assessment, plan }
 *   onChange   {function} Called on every keystroke with the updated soapNote
 *   encounter  {object}   Used for the breadcrumb display
 *   onBack     {function} Navigate back to the upload screen
 */

import React from 'react';

// ── Section definitions ───────────────────────────────────────────────────────

const SECTIONS = [
  {
    key:         'subjective',
    label:       'Subjective',
    description: 'Patient-reported symptoms, chief complaint, history of present illness',
  },
  {
    key:         'objective',
    label:       'Objective',
    description: 'Clinical observations, vital signs, physical and mental status exam findings',
  },
  {
    key:         'assessment',
    label:       'Assessment',
    description: 'Clinical impression, diagnosis, clinical reasoning',
  },
  {
    key:         'plan',
    label:       'Plan',
    description: 'Proposed treatment, medications, follow-up schedule, referrals',
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

function SoapEditor({ soapNote, onChange, encounter, onBack }) {
  // Guard — should never be null when this view is active, but defensive
  if (!soapNote) return null;

  function handleChange(key, value) {
    onChange({ ...soapNote, [key]: value });
  }

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
          ← Upload
        </button>
        <span style={{ color: 'var(--color-text-faint)' }}>/</span>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
          {encounter?.patient?.first_name} {encounter?.patient?.last_name}
          {encounter?.visit_type ? ` — ${encounter.visit_type}` : ''}
        </span>
        {encounter?.csn && (
          <span style={{ color: 'var(--color-text-faint)', fontSize: '0.8rem', fontFamily: 'monospace' }}>
            ({encounter.csn})
          </span>
        )}
      </div>

      {/* SOAP editor card */}
      <div style={{
        background:   'var(--color-white)',
        borderRadius: 'var(--radius)',
        padding:      '2rem',
        border:       '1px solid var(--color-border-light)',
        boxShadow:    'var(--shadow-sm)',
        marginBottom: '1.5rem',
      }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--color-text)', marginBottom: '0.375rem' }}>
          Review &amp; Edit SOAP Note
        </h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '1.75rem' }}>
          AI-generated note — review and edit all sections before signing. Changes are saved automatically.
        </p>

        {SECTIONS.map((section, idx) => {
          const value = soapNote[section.key] ?? '';
          return (
            <div key={section.key} style={{ marginBottom: idx < SECTIONS.length - 1 ? '1.75rem' : 0 }}>
              {/* Label row */}
              <div style={{ marginBottom: '6px' }}>
                <label
                  htmlFor={`soap-${section.key}`}
                  style={{
                    fontWeight: '600',
                    color:      'var(--color-text)',
                    fontSize:   '0.95rem',
                  }}
                >
                  {section.label}{' '}
                  <span style={{ color: 'var(--color-error)', fontWeight: '400' }} title="Required">*</span>
                </label>
                <p style={{
                  color:     'var(--color-text-faint)',
                  fontSize:  '0.8rem',
                  marginTop: '2px',
                }}>
                  {section.description}
                </p>
              </div>

              {/* Textarea */}
              <textarea
                id={`soap-${section.key}`}
                value={value}
                onChange={e => handleChange(section.key, e.target.value)}
                rows={5}
                style={{
                  width:        '100%',
                  padding:      '10px 12px',
                  border:       '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize:     '0.9375rem',
                  lineHeight:   '1.6',
                  color:        'var(--color-text)',
                  outline:      'none',
                  fontFamily:   'inherit',
                  resize:       'vertical',
                  transition:   'border-color 0.15s',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--color-primary)'; }}
                onBlur={e  => { e.target.style.borderColor = 'var(--color-border)'; }}
              />

              {/* Character count */}
              <div style={{
                textAlign:  'right',
                color:      value.length > 1800 ? 'var(--color-warning)' : 'var(--color-text-faint)',
                fontSize:   '0.75rem',
                marginTop:  '4px',
              }}>
                {value.length} characters
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SoapEditor;
