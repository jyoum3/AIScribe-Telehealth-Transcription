/**
 * PatientSidebar — Window 15
 *
 * Left-column patient directory navigator. Provides a persistent, collapsible
 * sidebar that lets a clinician access any patient's longitudinal history in
 * under two clicks without leaving their active workspace.
 *
 * ── Architecture Safeguards ───────────────────────────────────────────────────
 *
 * 1. React Portal for HistoricalNoteViewer (DOM Clipping Safeguard)
 *    The HistoricalNoteViewer drawer is rendered via ReactDOM.createPortal()
 *    targeting document.body — NOT inline inside the sidebar's DOM tree.
 *    This completely sidesteps CSS overflow clipping and stacking context
 *    problems that would arise from the sidebar's overflow-y: auto container.
 *    The drawer uses position:fixed (zIndex 300) and renders at the root DOM
 *    level, unaffected by any parent layout constraints.
 *
 * 2. Split-Brain Chart Safety Guard
 *    The moment selectedMrn changes (any patient row click), viewerCsn is
 *    immediately cleared to null via useEffect. This force-closes any open
 *    historical note drawer before the new patient's history loads.
 *    A provider can NEVER see Patient A's note while viewing Patient B's
 *    timeline — the cascade is enforced at the state level.
 *
 * 3. Dashboard-to-Sidebar Context Synchronization (activeMrn prop)
 *    When a clinician selects a pending appointment card from the dashboard,
 *    App.jsx passes that encounter's MRN as activeMrn to this component.
 *    A useEffect watches [activeMrn, patients]: if the active MRN matches a
 *    patient in the directory, it auto-selects that patient and fetches their
 *    history immediately — eliminating manual navigation.
 *
 * ── State ─────────────────────────────────────────────────────────────────────
 *   collapsed      (bool)         — 48px icon rail vs 280px expanded
 *   patients       (array)        — all distinct patients for this provider
 *   patientsLoading (bool)        — initial patient list fetch
 *   patientsError  (string|null)  — patient list error message
 *   selectedMrn    (string|null)  — currently expanded patient
 *   historyCache   (object)       — keyed by mrn → { loading, error, data }
 *   viewerCsn      (string|null)  — CSN currently open in HistoricalNoteViewer
 *
 * Props:
 *   activeMrn {string|null} — MRN of the currently selected dashboard encounter
 *                             (from App.jsx selectedEncounter?.mrn)
 *
 * History access triggers an audit log entry via the fire-and-forget pattern.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getPatients, getPatientHistory } from '../services/api.js';
import { formatHistoryDate } from '../utils/noteParser.js';
import HistoricalNoteViewer from './HistoricalNoteViewer.jsx';

// ── Width constants ───────────────────────────────────────────────────────────
const SIDEBAR_EXPANDED_WIDTH = 280;
const SIDEBAR_COLLAPSED_WIDTH = 48;

// ── Component ─────────────────────────────────────────────────────────────────

function PatientSidebar({ activeMrn }) {
  const [collapsed,       setCollapsed]       = useState(false);
  const [patients,        setPatients]        = useState([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [patientsError,   setPatientsError]   = useState(null);
  const [selectedMrn,     setSelectedMrn]     = useState(null);
  const [historyCache,    setHistoryCache]    = useState({});
  // viewerCsn: the CSN open in the Portal-mounted HistoricalNoteViewer
  // null = drawer closed; string = drawer open for that CSN
  const [viewerCsn,       setViewerCsn]       = useState(null);

  // ── Fetch patient list on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchPatients() {
      setPatientsLoading(true);
      setPatientsError(null);

      try {
        const res = await getPatients();
        if (!cancelled) {
          setPatients(res.data?.patients ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          const msg =
            err.response?.data?.error?.message ??
            'Failed to load patient directory.';
          setPatientsError(msg);
        }
      } finally {
        if (!cancelled) setPatientsLoading(false);
      }
    }

    fetchPatients();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch history for a given MRN ────────────────────────────────────────────
  const fetchHistory = useCallback(async (mrn) => {
    // Already cached and not in error state — skip re-fetch
    if (historyCache[mrn]?.data && !historyCache[mrn]?.error) return;

    setHistoryCache(prev => ({
      ...prev,
      [mrn]: { loading: true, error: null, data: null },
    }));

    try {
      const res = await getPatientHistory(mrn);
      setHistoryCache(prev => ({
        ...prev,
        [mrn]: { loading: false, error: null, data: res.data?.history ?? [] },
      }));
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ??
        'Failed to load patient history.';
      setHistoryCache(prev => ({
        ...prev,
        [mrn]: { loading: false, error: msg, data: null },
      }));
    }
  }, [historyCache]);

  // ── SPLIT-BRAIN GUARD: clear viewer when patient selection changes ────────────
  // When selectedMrn changes, the HistoricalNoteViewer drawer is immediately
  // closed. A provider can NEVER see Patient A's note while navigating Patient B.
  useEffect(() => {
    setViewerCsn(null); // force-close drawer before fetching new history
    if (selectedMrn) {
      fetchHistory(selectedMrn);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMrn]);

  // ── DASHBOARD-TO-SIDEBAR SYNC: auto-select active encounter's patient ─────────
  // When a clinician clicks an appointment card on the dashboard, App.jsx
  // sets selectedEncounter which flows here as activeMrn. If that MRN exists
  // in the patient directory, auto-select it so the history appears immediately.
  useEffect(() => {
    if (!activeMrn || patients.length === 0) return;
    const match = patients.find(p => p.mrn === activeMrn);
    if (match && activeMrn !== selectedMrn) {
      setSelectedMrn(activeMrn);
      // Un-collapse if sidebar is collapsed so the selection is visible
      if (collapsed) setCollapsed(false);
    }
  // Only re-run when activeMrn changes or patient list first loads
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMrn, patients]);

  // ── Patient row click handler ─────────────────────────────────────────────────
  function handlePatientClick(mrn) {
    if (mrn === selectedMrn) {
      // Toggle: clicking the already-selected patient collapses their timeline
      setSelectedMrn(null);
    } else {
      setSelectedMrn(mrn);
    }
  }

  // ── Sidebar width (CSS transition for smooth collapse/expand) ─────────────────
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Sidebar container ── */}
      <div
        style={{
          width:          `${sidebarWidth}px`,
          minWidth:       `${sidebarWidth}px`,
          height:         '100%',
          background:     '#ffffff',
          borderRight:    '1px solid #e5e7eb',
          display:        'flex',
          flexDirection:  'column',
          overflow:       'hidden',
          transition:     'width 0.2s ease, min-width 0.2s ease',
          flexShrink:     0,
          position:       'relative',
          zIndex:         5,
        }}
      >
        {collapsed ? (
          // ── COLLAPSED STATE — icon rail ──────────────────────────────────────
          <CollapsedRail onExpand={() => setCollapsed(false)} />
        ) : (
          // ── EXPANDED STATE — full patient directory ──────────────────────────
          <ExpandedSidebar
            patients={patients}
            patientsLoading={patientsLoading}
            patientsError={patientsError}
            selectedMrn={selectedMrn}
            historyCache={historyCache}
            onPatientClick={handlePatientClick}
            onViewNote={(csn) => setViewerCsn(csn)}
            onCollapse={() => setCollapsed(true)}
          />
        )}
      </div>

      {/* ── SAFEGUARD 1: HistoricalNoteViewer via React Portal ── */}
      {/* Rendered at document.body — completely outside sidebar's DOM tree.
          This prevents CSS overflow/stacking context from clipping the drawer. */}
      {viewerCsn && createPortal(
        <HistoricalNoteViewer
          csn={viewerCsn}
          onClose={() => setViewerCsn(null)}
        />,
        document.body
      )}
    </>
  );
}

// ── CollapsedRail — 48px icon rail shown when sidebar is collapsed ─────────────

function CollapsedRail({ onExpand }) {
  return (
    <div
      onClick={onExpand}
      title="Expand patient directory"
      style={{
        width:          '100%',
        height:         '100%',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        paddingTop:     '16px',
        gap:            '12px',
        cursor:         'pointer',
        background:     '#ffffff',
      }}
    >
      {/* Directory icon */}
      <span
        aria-hidden="true"
        style={{
          fontSize:   '1.2rem',
          lineHeight: 1,
          color:      '#6b7280',
        }}
      >
        👤
      </span>
      {/* Chevron-right expand button */}
      <span
        style={{
          fontSize:   '1rem',
          color:      '#9ca3af',
          fontWeight: '600',
          lineHeight: 1,
        }}
        aria-label="Expand patient sidebar"
      >
        ›
      </span>
    </div>
  );
}

// ── ExpandedSidebar — full 280px sidebar content ──────────────────────────────

function ExpandedSidebar({
  patients,
  patientsLoading,
  patientsError,
  selectedMrn,
  historyCache,
  onPatientClick,
  onViewNote,
  onCollapse,
}) {
  return (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      height:        '100%',
      overflow:      'hidden',
    }}>
      {/* Header bar */}
      <div style={{
        flexShrink:     0,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '12px 14px',
        borderBottom:   '1px solid #f3f4f6',
        background:     '#fafafa',
      }}>
        <span style={{
          fontWeight:    '700',
          fontSize:      '0.8rem',
          color:         '#374151',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          Patient Directory
        </span>
        {/* Chevron-left collapse button */}
        <button
          onClick={onCollapse}
          title="Collapse patient directory"
          style={{
            background:  'none',
            border:      'none',
            cursor:      'pointer',
            fontSize:    '1.1rem',
            color:       '#9ca3af',
            fontWeight:  '600',
            padding:     '2px 4px',
            lineHeight:  1,
          }}
          aria-label="Collapse patient sidebar"
        >
          ‹
        </button>
      </div>

      {/* Scrollable patient list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Loading state */}
        {patientsLoading && (
          <div style={{
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            padding:        '2rem 1rem',
            gap:            '10px',
            color:          '#9ca3af',
          }}>
            <SidebarSpinner />
            <span style={{ fontSize: '0.78rem' }}>Loading directory…</span>
          </div>
        )}

        {/* Error state */}
        {!patientsLoading && patientsError && (
          <div style={{
            margin:       '12px',
            padding:      '10px 12px',
            background:   '#fef2f2',
            border:       '1px solid #fecaca',
            borderRadius: '6px',
            fontSize:     '0.775rem',
            color:        '#b91c1c',
            lineHeight:   '1.4',
          }}>
            {patientsError}
          </div>
        )}

        {/* Empty state */}
        {!patientsLoading && !patientsError && patients.length === 0 && (
          <div style={{
            padding:    '2rem 1rem',
            textAlign:  'center',
            fontSize:   '0.78rem',
            color:      '#9ca3af',
            lineHeight: '1.5',
          }}>
            No patients found for today's schedule.
          </div>
        )}

        {/* Patient rows */}
        {!patientsLoading && !patientsError && patients.map((patient) => {
          const isSelected = patient.mrn === selectedMrn;
          const histEntry  = historyCache[patient.mrn];

          return (
            <div key={patient.mrn}>
              {/* Patient row */}
              <button
                onClick={() => onPatientClick(patient.mrn)}
                style={{
                  display:         'block',
                  width:           '100%',
                  textAlign:       'left',
                  padding:         '10px 14px',
                  background:      isSelected ? '#eff6ff' : 'transparent',
                  borderLeft:      isSelected ? '3px solid #2563eb' : '3px solid transparent',
                  border:          'none',
                  borderBottom:    '1px solid #f3f4f6',
                  cursor:          'pointer',
                  transition:      'background 0.12s',
                }}
                onMouseEnter={e => {
                  if (!isSelected) e.currentTarget.style.background = '#f9fafb';
                }}
                onMouseLeave={e => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
                aria-expanded={isSelected}
                aria-label={`${patient.patient_first_name} ${patient.patient_last_name}`}
              >
                <div style={{
                  display:         'flex',
                  alignItems:      'center',
                  justifyContent:  'space-between',
                  gap:             '8px',
                }}>
                  {/* Patient name */}
                  <div style={{
                    fontWeight:  '600',
                    fontSize:    '0.85rem',
                    color:       '#111827',
                    lineHeight:  '1.3',
                    whiteSpace:  'nowrap',
                    overflow:    'hidden',
                    textOverflow:'ellipsis',
                  }}>
                    {patient.patient_last_name}, {patient.patient_first_name}
                  </div>
                  {/* Expand/collapse chevron */}
                  <span style={{
                    fontSize:   '0.8rem',
                    color:      '#9ca3af',
                    flexShrink: 0,
                    transition: 'transform 0.15s',
                    transform:  isSelected ? 'rotate(90deg)' : 'none',
                  }}>
                    ›
                  </span>
                </div>
                {/* MRN badge */}
                <div style={{ marginTop: '3px' }}>
                  <span style={{
                    padding:      '1px 6px',
                    background:   '#f1f5f9',
                    color:        '#64748b',
                    border:       '1px solid #e2e8f0',
                    borderRadius: '4px',
                    fontFamily:   'monospace',
                    fontSize:     '0.68rem',
                    whiteSpace:   'nowrap',
                  }}>
                    {patient.mrn}
                  </span>
                </div>
              </button>

              {/* Inline history timeline — shown below the selected patient */}
              {isSelected && (
                <PatientTimeline
                  mrn={patient.mrn}
                  histEntry={histEntry}
                  onViewNote={onViewNote}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PatientTimeline — inline encounter history below a selected patient ────────

function PatientTimeline({ mrn, histEntry, onViewNote }) {
  const containerStyle = {
    background:   '#f8faff',
    borderLeft:   '3px solid #2563eb',
    borderBottom: '1px solid #e5e7eb',
    padding:      '10px 12px',
  };

  // Loading
  if (!histEntry || histEntry.loading) {
    return (
      <div style={{ ...containerStyle, display: 'flex', alignItems: 'center', gap: '8px' }}>
        <SidebarSpinner />
        <span style={{ fontSize: '0.775rem', color: '#9ca3af' }}>Loading history…</span>
      </div>
    );
  }

  // Error
  if (histEntry.error) {
    return (
      <div style={{ ...containerStyle, fontSize: '0.775rem', color: '#b91c1c' }}>
        {histEntry.error}
      </div>
    );
  }

  // Empty
  if (!histEntry.data || histEntry.data.length === 0) {
    return (
      <div style={{ ...containerStyle, fontSize: '0.775rem', color: '#9ca3af', fontStyle: 'italic' }}>
        No prior encounters on record.
      </div>
    );
  }

  // Encounter list
  return (
    <div style={containerStyle}>
      <div style={{
        fontSize:      '0.68rem',
        fontWeight:    '700',
        color:         '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom:  '8px',
      }}>
        Visit History ({histEntry.data.length})
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {histEntry.data.map((enc) => (
          <EncounterRow
            key={enc.csn}
            encounter={enc}
            onViewNote={onViewNote}
          />
        ))}
      </div>
    </div>
  );
}

// ── EncounterRow — single encounter in the history timeline ───────────────────

function EncounterRow({ encounter, onViewNote }) {
  return (
    <div style={{
      background:   '#ffffff',
      border:       '1px solid #e5e7eb',
      borderRadius: '6px',
      padding:      '8px 10px',
    }}>
      {/* Date + visit type row */}
      <div style={{
        display:    'flex',
        alignItems: 'center',
        gap:        '6px',
        flexWrap:   'wrap',
        marginBottom: encounter.has_note ? '6px' : '0',
      }}>
        {/* Visit date */}
        <span style={{ fontSize: '0.78rem', fontWeight: '600', color: '#374151' }}>
          {formatHistoryDate(encounter.visit_date)}
        </span>

        {/* Visit type chip */}
        <span style={{
          padding:      '1px 6px',
          background:   '#eff6ff',
          color:        '#1d4ed8',
          borderRadius: '8px',
          fontSize:     '0.68rem',
          fontWeight:   '500',
          whiteSpace:   'nowrap',
        }}>
          {encounter.visit_type ?? '—'}
        </span>

        {/* Version badge if amended */}
        {encounter.version_count > 1 && (
          <span style={{
            padding:      '1px 5px',
            background:   '#f0fdf4',
            color:        '#15803d',
            border:       '1px solid #bbf7d0',
            borderRadius: '4px',
            fontSize:     '0.65rem',
            fontWeight:   '600',
          }}>
            v{encounter.version_count}
          </span>
        )}
      </div>

      {/* Bottom row: CSN + View Note button */}
      <div style={{
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap:        '6px',
      }}>
        {/* CSN badge */}
        <span style={{
          fontFamily:    'monospace',
          fontSize:      '0.65rem',
          color:         '#94a3b8',
          overflow:      'hidden',
          textOverflow:  'ellipsis',
          whiteSpace:    'nowrap',
          maxWidth:      '140px',
        }}>
          {encounter.csn}
        </span>

        {/* View Note button — only shown if a signed note exists */}
        {encounter.has_note && (
          <button
            onClick={() => onViewNote(encounter.csn)}
            style={{
              background:     'none',
              border:         'none',
              color:          '#2563eb',
              fontSize:       '0.75rem',
              fontWeight:     '600',
              cursor:         'pointer',
              padding:        '0',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
              whiteSpace:     'nowrap',
              flexShrink:     0,
            }}
          >
            View Note
          </button>
        )}
      </div>
    </div>
  );
}

// ── SidebarSpinner — small inline spinner for loading states ──────────────────

function SidebarSpinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display:        'inline-block',
        width:          '14px',
        height:         '14px',
        border:         '2px solid #e5e7eb',
        borderTopColor: '#6b7280',
        borderRadius:   '50%',
        animation:      'aiscribe-spin 0.7s linear infinite',
        flexShrink:     0,
      }}
    />
  );
}

export default PatientSidebar;
