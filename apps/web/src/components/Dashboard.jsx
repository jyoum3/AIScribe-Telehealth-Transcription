/**
 * Dashboard — Authenticated layout shell (updated Window 15)
 *
 * Renders the sticky header (logo, provider name, logout button) and wraps
 * all authenticated views in a two-column flex layout:
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │  Sticky header (full width, z-index 10)         │
 *   ├─────────────┬───────────────────────────────────┤
 *   │  PatientSidebar  │  Main content (flex: 1)      │
 *   │  (via sidebar    │  (scrollable, max-width       │
 *   │   prop)          │   centered)                  │
 *   └─────────────┴───────────────────────────────────┘
 *
 * Window 15 changes:
 *   - Added optional `sidebar` prop (ReactNode)
 *   - Layout changed from single max-width container to flex-column root with
 *     a flex-row body below the sticky header
 *   - When `sidebar` is null/undefined (login view is excluded — Dashboard
 *     isn't rendered on login), the main content fills full width identically
 *     to the pre-Window-15 layout
 *   - Both sidebar and main content scroll independently
 *   - The sidebar handles its own width and collapse animation internally
 *
 * Props:
 *   provider             {object}    { provider_id, email, first_name, last_name }
 *   onLogout             {function}  Called when the Logout button is clicked
 *   onNavigateToSettings {function}  Optional — called when the ⚙ Settings button is clicked (Window 16)
 *   sidebar              {ReactNode} Optional — PatientSidebar component instance
 *   children             {ReactNode} The active view (appointments, upload, editor, success, settings)
 */

import React from 'react';

function Dashboard({ provider, onLogout, onNavigateToSettings, sidebar, children }) {
  return (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      height:        '100vh',
      overflow:      'hidden',
      background:    'var(--color-bg)',
    }}>

      {/* ── Sticky header — full width, never scrolls ── */}
      <header style={{
        flexShrink:     0,
        zIndex:         10,
        background:     'var(--color-white)',
        borderBottom:   '1px solid var(--color-border-light)',
        boxShadow:      'var(--shadow-sm)',
        height:         '60px',
        padding:        '0 1.5rem',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
      }}>
        {/* Left: brand + provider name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{
            fontWeight:    '700',
            fontSize:      '1.2rem',
            color:         'var(--color-primary)',
            letterSpacing: '-0.5px',
          }}>
            AIScribe
          </span>

          {provider && (
            <>
              <span style={{ color: 'var(--color-border)', fontWeight: '300' }}>|</span>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.95rem' }}>
                Dr. {provider.first_name} {provider.last_name}
              </span>
            </>
          )}
        </div>

        {/* Right: settings + logout (Window 16: Settings button added left of Logout) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>

          {/* ⚙ Settings button — only rendered when handler is provided */}
          {onNavigateToSettings && (
            <button
              onClick={onNavigateToSettings}
              title="AI Documentation Settings"
              style={{
                padding:      '7px 16px',
                background:   'transparent',
                border:       '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color:        'var(--color-text-muted)',
                fontSize:     '0.875rem',
                cursor:       'pointer',
                transition:   'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--color-primary)';
                e.currentTarget.style.color       = 'var(--color-primary)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.color       = 'var(--color-text-muted)';
              }}
            >
              ⚙ Settings
            </button>
          )}

          {/* Logout button */}
          <button
            onClick={onLogout}
            style={{
              padding:      '7px 16px',
              background:   'transparent',
              border:       '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color:        'var(--color-text-muted)',
              fontSize:     '0.875rem',
              cursor:       'pointer',
              transition:   'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-error)';
              e.currentTarget.style.color       = 'var(--color-error)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.color       = 'var(--color-text-muted)';
            }}
          >
            Logout
          </button>

        </div>
      </header>

      {/* ── Body row: [sidebar] + [main content] ── */}
      <div style={{
        flex:     1,
        display:  'flex',
        flexDirection: 'row',
        overflow: 'hidden',       // prevents double scrollbars — children scroll internally
        minHeight: 0,             // critical for flex children to respect parent height
      }}>

        {/* PatientSidebar — rendered here if provided; handles its own width + collapse */}
        {sidebar && sidebar}

        {/* Main content area — scrolls independently of the sidebar */}
        <main style={{
          flex:       1,
          overflowY:  'auto',
          minWidth:   0,          // prevents flex children from overflowing
          padding:    '2rem 1.5rem',
        }}>
          {/* Inner max-width container — keeps content readable on wide screens */}
          <div style={{
            maxWidth: '860px',
            margin:   '0 auto',
          }}>
            {children}
          </div>
        </main>

      </div>
    </div>
  );
}

export default Dashboard;
