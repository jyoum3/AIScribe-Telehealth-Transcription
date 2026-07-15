/**
 * LoginCard — Provider authentication form
 *
 * Renders the login screen: email + password fields, submit button,
 * loading state, and error banner. On success, calls onLoginSuccess
 * with { token, provider } so App.jsx can store the token and set the view.
 *
 * Client-side validation fires before any API call (no round-trip for
 * obviously empty fields). API errors are displayed verbatim from the
 * response envelope error.message field.
 *
 * Props:
 *   onLoginSuccess {function({ token, provider })} — called on 200 OK
 */

import React, { useState } from 'react';
import { login } from '../services/api.js';
import StatusMessage from './StatusMessage.jsx';

// Shared input style — defined once to keep the JSX clean
const inputStyle = {
  width:        '100%',
  padding:      '10px 12px',
  border:       '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize:     '1rem',
  color:        'var(--color-text)',
  outline:      'none',
  background:   'var(--color-white)',
  transition:   'border-color 0.15s',
};

const labelStyle = {
  display:      'block',
  marginBottom: '6px',
  fontWeight:   '500',
  fontSize:     '0.9rem',
  color:        'var(--color-text-secondary)',
};

function LoginCard({ onLoginSuccess }) {
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    // Client-side pre-flight — no API call for obviously empty fields
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await login(email.trim(), password);
      // Store JWT so Axios interceptor picks it up on all future requests
      localStorage.setItem('aiscribe_token', result.data.token);
      onLoginSuccess(result.data); // { token, provider }
    } catch (err) {
      const apiMessage = err.response?.data?.error?.message;
      setError(apiMessage ?? 'Unable to reach server. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div style={{
      minHeight:      '100vh',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      background:     'var(--color-bg)',
      padding:        '1rem',
    }}>
      <div style={{
        width:        '100%',
        maxWidth:     '420px',
        background:   'var(--color-white)',
        borderRadius: 'var(--radius-lg)',
        padding:      '2.5rem 2rem',
        boxShadow:    'var(--shadow-lg)',
        border:       '1px solid var(--color-border-light)',
      }}>
        {/* Branding */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{
            fontSize:      '1.75rem',
            fontWeight:    '700',
            color:         'var(--color-primary)',
            letterSpacing: '-0.5px',
          }}>
            AIScribe
          </h1>
          <p style={{
            color:     'var(--color-text-muted)',
            marginTop: '4px',
            fontSize:  '0.9rem',
          }}>
            Telehealth Transcription Platform
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          {/* Email */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label htmlFor="login-email" style={labelStyle}>Email Address</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="clinician@hospital.org"
              disabled={isLoading}
              style={inputStyle}
              onFocus={e  => { e.target.style.borderColor = 'var(--color-primary)'; }}
              onBlur={e   => { e.target.style.borderColor = 'var(--color-border)'; }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label htmlFor="login-password" style={labelStyle}>Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={isLoading}
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = 'var(--color-primary)'; }}
              onBlur={e  => { e.target.style.borderColor = 'var(--color-border)'; }}
            />
          </div>

          {/* Error banner */}
          {error && (
            <div style={{ marginBottom: '1rem' }}>
              <StatusMessage type="error" message={error} />
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            style={{
              width:        '100%',
              padding:      '11px',
              background:   isLoading ? '#93c5fd' : 'var(--color-primary)',
              color:        'var(--color-white)',
              border:       'none',
              borderRadius: 'var(--radius-sm)',
              fontWeight:   '600',
              fontSize:     '1rem',
              cursor:       isLoading ? 'not-allowed' : 'pointer',
              transition:   'background 0.2s',
            }}
          >
            {isLoading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--color-text-faint)' }}>
          For authorised clinicians only
        </p>
      </div>
    </div>
  );
}

export default LoginCard;
