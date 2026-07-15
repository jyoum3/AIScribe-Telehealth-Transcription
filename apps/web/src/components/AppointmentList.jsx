/**
 * AppointmentList — Split Dashboard (Window 13, updated Window 14)
 *
 * Restructured from a single list to a two-panel split dashboard.
 *
 * TOP PANEL — "Pending Actions / Active Queue"
 *   Fetches GET /api/appointments (audio_status != 'Submitted')
 *   Renders AppointmentCard with variant='pending'
 *   Clicking a card → calls onEncounterSelected(appointment) → opens upload workflow
 *
 * BOTTOM PANEL — "Completed Interactions / Signed Records"
 *   Fetches GET /api/appointments/completed (audio_status = 'Submitted')
 *   Renders AppointmentCard with variant='completed'
 *   Clicking [View / Amend Note] → opens AmendNoteEditor full-screen overlay (Window 14)
 *
 * Both panels are fetched concurrently via Promise.all on mount and after sync.
 *
 * REFRESH SCHEDULE button (top right):
 *   Calls POST /api/schedule/sync → re-fetches both panels
 *   Shows loading spinner during sync
 *
 * Props:
 *   onEncounterSelected {function(appointment)} — parent (App.jsx) opens upload view
 *   providerName        {string}                — passed to AmendNoteEditor security banner
 *
 * Window 14 changes:
 *   - Replaced AmendStubModal placeholder with real AmendNoteEditor component
 *   - handleAmendSuccess re-fetches both panels after a successful amendment
 *   - providerName prop added and threaded through to AmendNoteEditor
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  getAppointments,
  getCompletedAppointments,
  syncSchedule,
} from '../services/api.js';
import AppointmentCard  from './AppointmentCard.jsx';
import AmendNoteEditor  from './AmendNoteEditor.jsx';
import StatusMessage    from './StatusMessage.jsx';

// ── Component ─────────────────────────────────────────────────────────────────

function AppointmentList({ onEncounterSelected, providerName }) {
  // Pending / completed panel state
  const [pendingAppointments,   setPendingAppointments]   = useState([]);
  const [completedAppointments, setCompletedAppointments] = useState([]);

  // Shared loading / error state (covers initial concurrent fetch)
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Refresh button state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  // Amendment editor state — null = closed, object = open for that appointment
  const [amendTarget, setAmendTarget] = useState(null);

  // ── Data fetching ──────────────────────────────────────────────────────────

  /**
   * Fetch both panels concurrently.
   * showLoading=true on initial mount, false on background refresh after sync.
   */
  const fetchBothPanels = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setLoadError(null);

    try {
      const [pendingRes, completedRes] = await Promise.all([
        getAppointments(),
        getCompletedAppointments(),
      ]);

      setPendingAppointments(pendingRes.data?.appointments ?? []);
      setCompletedAppointments(completedRes.data?.appointments ?? []);
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ??
        'Failed to load appointments. Check your connection.';
      setLoadError(msg);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchBothPanels(true);
  }, [fetchBothPanels]);

  // ── Refresh schedule handler ───────────────────────────────────────────────

  async function handleRefreshSchedule() {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncError(null);

    try {
      await syncSchedule();
      // Re-fetch both panels without showing the full loading spinner
      await fetchBothPanels(false);
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ??
        'Schedule sync failed. Please try again.';
      setSyncError(msg);
    } finally {
      setIsSyncing(false);
    }
  }

  // ── Amendment handlers ─────────────────────────────────────────────────────

  /** Open the amendment editor for a completed appointment card */
  function handleAmendSelect(appointment) {
    setAmendTarget(appointment);
  }

  /** Close the amendment editor without refreshing */
  function handleAmendClose() {
    setAmendTarget(null);
  }

  /**
   * Called by AmendNoteEditor after a successful amendment submission.
   * Closes the editor and re-fetches both panels (the completed panel version
   * badge may update in a future window; for now a fresh fetch is sufficient).
   */
  function handleAmendSuccess() {
    setAmendTarget(null);
    // Silent background refresh — no full loading spinner
    fetchBothPanels(false);
  }

  // ── Loading state ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{ paddingTop: '2rem' }}>
        <StatusMessage type="loading" message="Loading today's schedule…" />
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div>
        <StatusMessage type="error" message={loadError} />
        <button
          onClick={() => fetchBothPanels(true)}
          style={{
            marginTop:    '12px',
            padding:      '8px 18px',
            background:   'var(--color-primary)',
            color:        'var(--color-white)',
            border:       'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight:   '500',
            cursor:       'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Dashboard header row ── */}
      <div style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        marginBottom:   '1.75rem',
        flexWrap:       'wrap',
        gap:            '12px',
      }}>
        <h2 style={{
          fontSize:   '1.3rem',
          fontWeight: '600',
          color:      'var(--color-text)',
          margin:     0,
        }}>
          Today's Schedule
        </h2>

        {/* Refresh Schedule button */}
        <button
          onClick={handleRefreshSchedule}
          disabled={isSyncing}
          style={{
            display:      'inline-flex',
            alignItems:   'center',
            gap:          '6px',
            padding:      '8px 16px',
            background:   isSyncing ? '#e0e7ff' : 'var(--color-primary-light)',
            color:        isSyncing ? '#6366f1' : 'var(--color-primary)',
            border:       '1px solid var(--color-primary)',
            borderRadius: 'var(--radius-sm)',
            fontWeight:   '500',
            fontSize:     '0.875rem',
            cursor:       isSyncing ? 'not-allowed' : 'pointer',
            transition:   'background 0.15s',
          }}
        >
          {isSyncing ? (
            <>
              <SyncSpinner />
              Syncing…
            </>
          ) : (
            <>↻ Refresh Schedule</>
          )}
        </button>
      </div>

      {/* Sync error banner (non-fatal, shows below header) */}
      {syncError && (
        <div style={{ marginBottom: '1rem' }}>
          <StatusMessage type="error" message={syncError} />
        </div>
      )}

      {/* ── TOP PANEL — Pending Actions ── */}
      <PanelSection
        title="Pending Actions"
        count={pendingAppointments.length}
        accentColor="#1a56db"
        emptyMessage="No pending appointments for today"
        emptyIcon="📋"
      >
        {pendingAppointments.map((appt) => (
          <AppointmentCard
            key={appt.csn}
            appointment={appt}
            variant="pending"
            onSelect={onEncounterSelected}
          />
        ))}
      </PanelSection>

      {/* Spacer between panels */}
      <div style={{ height: '1.75rem' }} />

      {/* ── BOTTOM PANEL — Completed Interactions ── */}
      <PanelSection
        title="Completed Interactions"
        count={completedAppointments.length}
        accentColor="#16a34a"
        emptyMessage="No signed records for today"
        emptyIcon="✅"
      >
        {completedAppointments.map((appt) => (
          <AppointmentCard
            key={appt.csn}
            appointment={appt}
            variant="completed"
            onSelect={handleAmendSelect}
          />
        ))}
      </PanelSection>

      {/* ── Amendment Editor overlay (Window 14) ── */}
      {amendTarget && (
        <AmendNoteEditor
          csn={amendTarget.csn}
          providerName={providerName}
          onClose={handleAmendClose}
          onSuccess={handleAmendSuccess}
        />
      )}
    </div>
  );
}

// ── PanelSection — reusable panel wrapper ─────────────────────────────────────

function PanelSection({ title, count, accentColor, emptyMessage, emptyIcon, children }) {
  return (
    <section>
      {/* Panel header */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          '10px',
        marginBottom: '1rem',
        paddingBottom: '0.625rem',
        borderBottom: `2px solid ${accentColor}22`,
      }}>
        <h3 style={{
          fontSize:   '1rem',
          fontWeight: '600',
          color:      'var(--color-text)',
          margin:     0,
        }}>
          {title}
        </h3>
        {/* Count badge */}
        <span style={{
          display:      'inline-flex',
          alignItems:   'center',
          justifyContent: 'center',
          minWidth:     '24px',
          height:       '24px',
          padding:      '0 7px',
          background:   `${accentColor}18`,
          color:        accentColor,
          borderRadius: '12px',
          fontSize:     '0.78rem',
          fontWeight:   '700',
          border:       `1px solid ${accentColor}40`,
        }}>
          {count}
        </span>
      </div>

      {/* Panel content */}
      {count === 0 ? (
        <div style={{
          textAlign:    'center',
          padding:      '2.5rem 0',
          color:        'var(--color-text-muted)',
          background:   '#fafafa',
          borderRadius: 'var(--radius)',
          border:       '1px dashed var(--color-border-light)',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>{emptyIcon}</div>
          <div style={{ fontWeight: '500', fontSize: '0.9rem' }}>{emptyMessage}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {children}
        </div>
      )}
    </section>
  );
}

// ── SyncSpinner — tiny inline spinner for the Refresh button ──────────────────

function SyncSpinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display:        'inline-block',
        width:          '14px',
        height:         '14px',
        border:         '2px solid #c7d2fe',
        borderTopColor: '#4f46e5',
        borderRadius:   '50%',
        animation:      'aiscribe-spin 0.7s linear infinite',
        flexShrink:     0,
      }}
    />
  );
}

export default AppointmentList;
