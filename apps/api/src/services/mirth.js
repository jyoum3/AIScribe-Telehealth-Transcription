/**
 * Service: Mirth Connect HTTP Client
 *
 * Assembles the JSON payload that Mirth expects, POSTs it to the Mirth HTTP
 * Listener, and parses the JSON acknowledgment response.
 *
 * Flow: Express route → sendToMirth() → Mirth channel → JSON ACK → route → browser
 *
 * Mirth receives the payload, runs its transformer to build an HL7 MDM^T02 (or T04
 * for amendments), writes to simulated_emr.clinical_notes, and returns an ACK
 * containing the messageId, status, and the full HL7 string.
 */

'use strict';

const axios = require('axios');

const MIRTH_URL     = process.env.MIRTH_HTTP_LISTENER_URL || 'http://localhost:8081/aiscribe-inbound/';
const MIRTH_TIMEOUT = 15000;

/**
 * Send a signed SOAP note to the Mirth HTTP Listener and return the HL7 ACK.
 *
 * @param {Object} payload                  - The inbound JSON contract
 * @param {string} payload.csn              - Encounter ID
 * @param {string} payload.mrn              - Patient MRN
 * @param {number} payload.providerId       - Provider integer ID from JWT
 * @param {string} payload.providerLastName
 * @param {string} payload.providerFirstName
 * @param {string} payload.patientLastName
 * @param {string} payload.patientFirstName
 * @param {string} payload.patientDob       - YYYY-MM-DD
 * @param {string} payload.noteText         - Concatenated SOAP text block
 *
 * @returns {Promise<{ messageId: string, status: string, hl7: string }>}
 * @throws {Error} err.code = 'MIRTH_UNAVAILABLE' if Mirth is unreachable or errors
 */
async function sendToMirth(payload) {
  console.log(`[mirth] Sending payload to Mirth for CSN: ${payload.csn}`);

  let response;

  try {
    response = await axios.post(MIRTH_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
      timeout: MIRTH_TIMEOUT,
    });
  } catch (err) {
    const detail = err.response
      ? `HTTP ${err.response.status} — ${JSON.stringify(err.response.data)}`
      : err.message;

    console.error(`[mirth] Mirth unreachable or returned error: ${detail}`);

    const mirthError = new Error('The note could not be delivered to the EMR. Please try again in a moment.');
    mirthError.code   = 'MIRTH_UNAVAILABLE';
    mirthError.detail = detail;
    throw mirthError;
  }

  if (response.status < 200 || response.status >= 300) {
    console.error(`[mirth] Non-200 response from Mirth: ${response.status}`, response.data);
    const mirthError = new Error('The note could not be delivered to the EMR. Please try again in a moment.');
    mirthError.code   = 'MIRTH_UNAVAILABLE';
    mirthError.detail = `HTTP ${response.status}`;
    throw mirthError;
  }

  const ack = response.data;

  if (!ack || !ack.messageId || !ack.status || !ack.hl7) {
    console.error('[mirth] Mirth returned an unexpected ACK shape:', ack);
    const mirthError = new Error('The note could not be delivered to the EMR. Please try again in a moment.');
    mirthError.code   = 'MIRTH_UNAVAILABLE';
    mirthError.detail = 'ACK missing required fields (messageId, status, hl7)';
    throw mirthError;
  }

  console.log(`[mirth] ACK received — MessageID: ${ack.messageId} Status: ${ack.status}`);

  return { messageId: ack.messageId, status: ack.status, hl7: ack.hl7 };
}

/**
 * Build the noteText string from a structured SOAP object.
 * Mirth receives a single flat string — not JSON.
 *
 * @param {{ subjective: string, objective: string, assessment: string, plan: string }} soap
 * @returns {string}
 */
function buildNoteText(soap) {
  return [
    `SUBJECTIVE: ${soap.subjective}`,
    `OBJECTIVE: ${soap.objective}`,
    `ASSESSMENT: ${soap.assessment}`,
    `PLAN: ${soap.plan}`,
  ].join('\n\n');
}

/**
 * Send a follow-up scheduling payload to the Mirth HTTP Listener.
 *
 * This function is intentionally non-throwing — a Mirth scheduling failure
 * must never fail the overall transcription response. Errors are logged only.
 *
 * @param {Object} schedulePayload
 * @param {string} schedulePayload.type           - Always 'SCHEDULE_FOLLOWUP'
 * @param {string} schedulePayload.mrn
 * @param {number} schedulePayload.providerId
 * @param {string} schedulePayload.targetDate     - ISO 8601 target visit date
 * @param {string} schedulePayload.originCsn      - The CSN that triggered scheduling
 * @param {number} schedulePayload.timelineWeeks  - Weeks until follow-up
 * @param {string} schedulePayload.newCsn         - Express-generated CSN for the new encounter
 *
 * @returns {Promise<{ success: boolean, csn: string }>} Always resolves — never rejects.
 */
async function sendSchedule(schedulePayload) {
  const { newCsn } = schedulePayload;

  console.log(
    `[mirth] Sending SCHEDULE_FOLLOWUP — newCsn=${newCsn}, ` +
    `mrn=${schedulePayload.mrn}, targetDate=${schedulePayload.targetDate}`
  );

  try {
    const response = await axios.post(MIRTH_URL, schedulePayload, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      timeout: 5000,
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(`[mirth] SCHEDULE_FOLLOWUP ACK received for newCsn=${newCsn}`);
      return { success: true, csn: newCsn };
    }

    console.error(`[mirth] SCHEDULE_FOLLOWUP non-200 response: HTTP ${response.status}`);
    return { success: false, csn: newCsn };

  } catch (err) {
    const detail = err.response
      ? `HTTP ${err.response.status} — ${JSON.stringify(err.response.data)}`
      : err.message;

    console.error(`[mirth] SCHEDULE_FOLLOWUP failed (non-fatal): ${detail}`);
    return { success: false, csn: newCsn };
  }
}

module.exports = { sendToMirth, buildNoteText, sendSchedule };
