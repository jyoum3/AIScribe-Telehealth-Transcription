/**
 * ProviderSettings — AI Documentation Settings page (Window 16)
 *
 * Allows the authenticated provider to view and edit their custom Claude
 * prompt template. The custom template overrides the system default clinical
 * guidance section of the system prompt. The structured output requirement
 * ([CONTROL_BLOCK] instruction) is always appended automatically by the backend
 * and cannot be overridden.
 *
 * On mount: calls GET /api/providers/me to pre-fill the textarea with the
 * provider's current template (or empty if using the system default).
 *
 * Save: calls POST /api/providers/me/prompt with the textarea value.
 *   → green toast "Template saved successfully." on success
 *
 * Reset: calls POST /api/providers/me/prompt with null.
 *   → clears textarea, grey toast "Reset to default template." on success
 *
 * Toast: in-component state { message, type }. Auto-dismisses after 3 seconds.
 * No external toast library needed.
 *
 * Props:
 *   onBack {function}  Navigate back to the appointments dashboard
 */

import React, { useState, useEffect, useRef } from 'react';
import { getProviderMe, savePromptTemplate } from '../services/api.js';

// ---------------------------------------------------------------------------
// ProviderSettings
// ---------------------------------------------------------------------------

function ProviderSettings({ onBack }) {
  const [templateValue,  setTemplateValue]  = useState('');
  const [isLoading,      setIsLoading]      = useState(true);
  const [isSaving,       setIsSaving]       = useState(false);
  const [loadError,      setLoadError]      = useState(null);
  const [toast,          setToast]          = useState(null); // { message, type: 'success'|'reset'|'error' }

  const toastTimerRef = useRef(null);

  // ── Load current template on mount ────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function loadTemplate() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const result = await getProviderMe();
        if (!cancelled) {
          // custom_prompt_template is null if using system default → show empty textarea
          setTemplateValue(result.data?.provider?.custom_prompt_template ?? '');
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err.response?.data?.error?.message ?? 'Failed to load settings. Please refresh the page.';
          setLoadError(msg);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadTemplate();
    return () => { cancelled = true; };
  }, []);

  // ── Toast helper ───────────────────────────────────────────────────────────

  function showToast(message, type) {
    // Cancel any pending dismiss timer before showing a new toast
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  }

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ── Save template ──────────────────────────────────────────────────────────

  async function handleSave() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await savePromptTemplate(templateValue);
      showToast('Template saved successfully.', 'success');
    } catch (err) {
      const msg = err.response?.data?.error?.message ?? 'Failed to save template. Please try again.';
      showToast(msg, 'error');
    } finally {
      setIsSaving(false);
    }
  }

  // ── Reset to default ───────────────────────────────────────────────────────

  async function handleReset() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await savePromptTemplate(null);
      setTemplateValue(''); // clear textarea to reflect default state
      showToast('Reset to default template.', 'reset');
    } catch (err) {
      const msg = err.response?.data?.error?.message ?? 'Failed to reset template. Please try again.';
      showToast(msg, 'error');
    } finally {
      setIsSaving(false);
    }
  }

  // ── Toast styles by type ───────────────────────────────────────────────────

  const toastStyles = {
    success: { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' },
    reset:   { background: '#f9fafb', border: '1px solid #d1d5db', color: '#374151' },
    error:   { background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' },
  };

  const charCount = templateValue.length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Back button */}
      <div style={{ marginBottom: '1.5rem' }}>
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
          ← Dashboard
        </button>
      </div>

      {/* Page title */}
      <h1 style={{
        fontSize:     '1.5rem',
        fontWeight:   '700',
        color:        'var(--color-text)',
        marginBottom: '0.375rem',
      }}>
        AI Documentation Settings
      </h1>
      <p style={{
        color:        'var(--color-text-muted)',
        fontSize:     '0.9rem',
        marginBottom: '2rem',
      }}>
        Manage how Claude generates SOAP notes for your clinical encounters.
      </p>

      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            ...toastStyles[toast.type],
            borderRadius: 'var(--radius-sm)',
            padding:      '10px 16px',
            fontSize:     '0.875rem',
            fontWeight:   '500',
            marginBottom: '1.5rem',
          }}
        >
          {toast.type === 'success' && '✓ '}{toast.message}
        </div>
      )}

      {/* Settings card */}
      <div style={{
        background:   'var(--color-white)',
        borderRadius: 'var(--radius)',
        padding:      '1.75rem',
        border:       '1px solid var(--color-border-light)',
        boxShadow:    'var(--shadow-sm)',
      }}>
        <h2 style={{
          fontSize:     '1rem',
          fontWeight:   '600',
          color:        'var(--color-text)',
          marginBottom: '0.5rem',
        }}>
          Custom Prompt Template
        </h2>

        <p style={{
          color:        'var(--color-text-muted)',
          fontSize:     '0.875rem',
          marginBottom: '1.25rem',
          lineHeight:   '1.5',
        }}>
          Override Claude's default SOAP documentation instructions. Leave blank to use the
          system default. Your template replaces the clinical guidance section — the structured
          output requirement is always appended automatically.
        </p>

        {/* Load error state */}
        {loadError && (
          <div style={{
            background:   '#fef2f2',
            border:       '1px solid #fecaca',
            borderRadius: 'var(--radius-sm)',
            padding:      '10px 14px',
            color:        '#dc2626',
            fontSize:     '0.875rem',
            marginBottom: '1rem',
          }}>
            {loadError}
          </div>
        )}

        {/* Template textarea */}
        <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
          <textarea
            value={templateValue}
            onChange={e => setTemplateValue(e.target.value)}
            disabled={isLoading || isSaving}
            placeholder={
              isLoading
                ? 'Loading current template…'
                : 'Enter your custom prompt template here, or leave blank to use the system default.\n\nExample:\nYou are a clinical documentation assistant. Structure the following transcript into a SOAP note using concise bullet points for each section...'
            }
            style={{
              width:        '100%',
              minHeight:    '300px',
              padding:      '12px 14px',
              fontFamily:   'monospace',
              fontSize:     '0.85rem',
              lineHeight:   '1.6',
              border:       '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              resize:       'vertical',
              background:   (isLoading || isSaving) ? 'var(--color-bg)' : 'var(--color-white)',
              color:        'var(--color-text)',
              boxSizing:    'border-box',
              outline:      'none',
              transition:   'border-color 0.15s',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--color-primary)'; }}
            onBlur={e => { e.target.style.borderColor = 'var(--color-border)'; }}
          />
        </div>

        {/* Character count */}
        <div style={{
          textAlign:    'right',
          color:        'var(--color-text-faint)',
          fontSize:     '0.8rem',
          marginBottom: '1.5rem',
        }}>
          {charCount.toLocaleString()} character{charCount !== 1 ? 's' : ''}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {/* Save Template button */}
          <button
            onClick={handleSave}
            disabled={isLoading || isSaving}
            style={{
              padding:      '9px 20px',
              background:   (isLoading || isSaving) ? '#93c5fd' : 'var(--color-primary)',
              color:        'var(--color-white)',
              border:       'none',
              borderRadius: 'var(--radius-sm)',
              fontWeight:   '600',
              fontSize:     '0.9rem',
              cursor:       (isLoading || isSaving) ? 'not-allowed' : 'pointer',
              transition:   'background 0.2s',
            }}
          >
            {isSaving ? 'Saving…' : 'Save Template'}
          </button>

          {/* Reset to Default button */}
          <button
            onClick={handleReset}
            disabled={isLoading || isSaving}
            style={{
              padding:      '9px 20px',
              background:   'transparent',
              color:        (isLoading || isSaving) ? 'var(--color-text-faint)' : 'var(--color-text-muted)',
              border:       `1px solid ${(isLoading || isSaving) ? 'var(--color-border-light)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-sm)',
              fontWeight:   '500',
              fontSize:     '0.9rem',
              cursor:       (isLoading || isSaving) ? 'not-allowed' : 'pointer',
              transition:   'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              if (!isLoading && !isSaving) {
                e.currentTarget.style.borderColor = 'var(--color-text-secondary)';
                e.currentTarget.style.color       = 'var(--color-text)';
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.color       = 'var(--color-text-muted)';
            }}
          >
            Reset to Default
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProviderSettings;
