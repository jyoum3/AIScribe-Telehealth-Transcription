/**
 * AIScribe Web — Root Application Component
 *
 * Central state machine for the full clinician workflow:
 *
 *   login → appointments → upload → editor → success
 *                                 ↕
 *                              settings
 *
 * All application state lives here and flows down as props.
 * No external state management library — React useState + useRef
 * is sufficient for all views and API interactions.
 *
 * Key design decisions:
 *   - idempotencyKeyRef (useRef): Born when transcription succeeds, stable across
 *     all submission attempts for the same encounter-note pair, destroyed on back-nav.
 *     Never regenerated on retry — preserves safety across network failures.
 *   - navigateTo(view): Wraps setView() with window.scrollTo(0, 0) so the clinician
 *     always arrives at the top of the new screen.
 *   - handleLogout(): Atomically resets all state in one synchronous block — React
 *     batches the calls so only one re-render occurs.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

import LoginCard        from './components/LoginCard.jsx';
import Dashboard        from './components/Dashboard.jsx';
import AppointmentList  from './components/AppointmentList.jsx';
import AudioUpload      from './components/AudioUpload.jsx';
import SoapEditor       from './components/SoapEditor.jsx';
import SubmitPanel      from './components/SubmitPanel.jsx';
import SuccessBanner    from './components/SuccessBanner.jsx';
import PatientSidebar   from './components/PatientSidebar.jsx';
import ProviderSettings from './components/ProviderSettings.jsx';
import FollowUpBanner   from './components/FollowUpBanner.jsx';

function App() {

  // View state machine: 'login' | 'appointments' | 'upload' | 'editor' | 'success' | 'settings'
  const [view, setView] = useState('login');

  // Auth
  const [provider, setProvider] = useState(null);

  // Workflow
  const [selectedEncounter,     setSelectedEncounter]     = useState(null);
  const [soapNote,              setSoapNote]              = useState(null);
  const [transcript,            setTranscript]            = useState(null);
  const [mirthAck,              setMirthAck]              = useState(null);
  const [isDuplicateSubmission, setIsDuplicateSubmission] = useState(false);

  // Follow-up scheduling — populated when Claude recommends a follow-up and Mirth is notified
  const [followUpInfo, setFollowUpInfo] = useState({ scheduled: false, date: null, csn: null });

  // Idempotency key — lives only in a ref (no re-render needed, survives failed retries)
  const idempotencyKeyRef = useRef(null);

  const navigateTo = useCallback((newView) => {
    window.scrollTo(0, 0);
    setView(newView);
  }, []);

  // Restore session from localStorage JWT on mount
  useEffect(() => {
    const token = localStorage.getItem('aiscribe_token');
    if (!token) return;

    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Malformed token');
      const payload = JSON.parse(atob(parts[1]));
      if (typeof payload?.exp !== 'number') throw new Error('Missing exp claim');
      if (payload.exp * 1000 <= Date.now()) { handleLogout(); return; }

      setProvider({
        provider_id: payload.provider_id,
        email:       payload.email,
        first_name:  payload.first_name  ?? '',
        last_name:   payload.last_name   ?? '',
      });
      navigateTo('appointments');
    } catch {
      handleLogout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLogout() {
    localStorage.removeItem('aiscribe_token');
    setView('login');
    setProvider(null);
    setSelectedEncounter(null);
    setSoapNote(null);
    setTranscript(null);
    setMirthAck(null);
    setIsDuplicateSubmission(false);
    setFollowUpInfo({ scheduled: false, date: null, csn: null });
    idempotencyKeyRef.current = null;
  }

  function handleLoginSuccess({ token: _token, provider: providerData }) {
    setProvider(providerData);
    navigateTo('appointments');
  }

  function handleEncounterSelected(encounter) {
    setSelectedEncounter(encounter);
    setSoapNote(null);
    setTranscript(null);
    setMirthAck(null);
    setIsDuplicateSubmission(false);
    setFollowUpInfo({ scheduled: false, date: null, csn: null });
    idempotencyKeyRef.current = null;
    navigateTo('upload');
  }

  /**
   * Called by AudioUpload on successful transcription.
   * Idempotency key is born here — tied to this clinician + encounter + AI-generated note.
   */
  function handleTranscribeSuccess(rawTranscript, soap, receivedFollowUpInfo) {
    setTranscript(rawTranscript);
    setSoapNote(soap);
    setFollowUpInfo(receivedFollowUpInfo ?? { scheduled: false, date: null, csn: null });
    idempotencyKeyRef.current = uuidv4();
    navigateTo('editor');
  }

  function handleSubmitSuccess(ack) {
    setMirthAck(ack);
    setIsDuplicateSubmission(false);
    navigateTo('success');
  }

  function handleSubmitDuplicate(cachedAck) {
    setMirthAck(cachedAck);
    setIsDuplicateSubmission(true);
    navigateTo('success');
  }

  function handleBackToAppointments() {
    setSelectedEncounter(null);
    setSoapNote(null);
    setTranscript(null);
    setMirthAck(null);
    setIsDuplicateSubmission(false);
    setFollowUpInfo({ scheduled: false, date: null, csn: null });
    idempotencyKeyRef.current = null;
    navigateTo('appointments');
  }

  function handleBackToUpload() {
    setSoapNote(null);
    setTranscript(null);
    setFollowUpInfo({ scheduled: false, date: null, csn: null });
    idempotencyKeyRef.current = null;
    navigateTo('upload');
  }

  function handleStartNewNote() {
    setSelectedEncounter(null);
    setSoapNote(null);
    setTranscript(null);
    setMirthAck(null);
    setIsDuplicateSubmission(false);
    setFollowUpInfo({ scheduled: false, date: null, csn: null });
    idempotencyKeyRef.current = null;
    navigateTo('appointments');
  }

  function handleNavigateToSettings() { navigateTo('settings'); }
  function handleBackFromSettings()   { navigateTo('appointments'); }

  if (view === 'login') {
    return <LoginCard onLoginSuccess={handleLoginSuccess} />;
  }

  // PatientSidebar is instantiated at this level (not inside Dashboard) so its
  // state persists across view transitions without remounting.
  return (
    <Dashboard
      provider={provider}
      onLogout={handleLogout}
      onNavigateToSettings={handleNavigateToSettings}
      sidebar={
        <PatientSidebar
          activeMrn={selectedEncounter?.mrn ?? null}
        />
      }
    >
      {view === 'appointments' && (
        <AppointmentList
          onEncounterSelected={handleEncounterSelected}
          providerName={provider ? `${provider.first_name} ${provider.last_name}`.trim() : ''}
        />
      )}

      {view === 'upload' && (
        <AudioUpload
          encounter={selectedEncounter}
          onTranscribeSuccess={handleTranscribeSuccess}
          onBack={handleBackToAppointments}
        />
      )}

      {view === 'editor' && (
        <>
          <SoapEditor
            soapNote={soapNote}
            onChange={setSoapNote}
            encounter={selectedEncounter}
            onBack={handleBackToUpload}
          />

          {followUpInfo.scheduled && (
            <FollowUpBanner
              date={followUpInfo.date}
              csn={followUpInfo.csn}
              onDismiss={() => setFollowUpInfo({ scheduled: false, date: null, csn: null })}
            />
          )}

          <SubmitPanel
            csn={selectedEncounter?.csn}
            soapNote={soapNote}
            idempotencyKeyRef={idempotencyKeyRef}
            onSubmitSuccess={handleSubmitSuccess}
            onSubmitDuplicate={handleSubmitDuplicate}
          />
        </>
      )}

      {view === 'success' && (
        <SuccessBanner
          mirthAck={mirthAck}
          isDuplicate={isDuplicateSubmission}
          encounter={selectedEncounter}
          provider={provider}
          onStartNewNote={handleStartNewNote}
        />
      )}

      {view === 'settings' && (
        <ProviderSettings
          onBack={handleBackFromSettings}
        />
      )}
    </Dashboard>
  );
}

export default App;
