/**
 * seedClinicalData.js
 * =============================================================================
 * Enterprise Clinical Data Seeder — Window 11
 *
 * Creates two provider accounts, 10 patients (5 per doctor), 10 today's
 * encounters, 20 historical encounters, and 20 signed SOAP notes with realistic
 * psychiatric clinical text.
 *
 * Also seeds 1 dedicated DEMO patient (Jordan Ellis, MRN-A006) under Dr. Alice
 * Chen with a full 3-appointment ADHD arc:
 *   H1 (8 wks ago) — Initial Evaluation, ADHD diagnosis, Adderall XR 10 mg
 *   H2 (4 wks ago) — Follow-up #1, partial response, increased to 20 mg
 *   TODAY          — Follow-up #2 (no note — live demo encounter)
 *
 * Usage:
 *   npm run seed:clinical            (from project root)
 *   node apps/api/scripts/seedClinicalData.js
 * =============================================================================
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Database connections
// ---------------------------------------------------------------------------
const appDb = new Pool({
  host:     process.env.AISCRIBE_APP_DB_HOST     || 'localhost',
  port:     parseInt(process.env.AISCRIBE_APP_DB_PORT || '5432'),
  database: process.env.AISCRIBE_APP_DB_NAME     || 'aiscribe_app',
  user:     process.env.AISCRIBE_APP_DB_USER     || 'postgres',
  password: process.env.AISCRIBE_APP_DB_PASSWORD || 'devpassword',
});

const emrDb = new Pool({
  host:     process.env.SIMULATED_EMR_DB_HOST     || 'localhost',
  port:     parseInt(process.env.SIMULATED_EMR_DB_PORT || '5432'),
  database: process.env.SIMULATED_EMR_DB_NAME     || 'simulated_emr',
  user:     process.env.SIMULATED_EMR_DB_USER     || 'postgres',
  password: process.env.SIMULATED_EMR_DB_PASSWORD || 'devpassword',
});

// ---------------------------------------------------------------------------
// Date helpers — NO hardcoded strings
// ---------------------------------------------------------------------------

/**
 * Returns a Date set to today's date at the given decimal hour (local time).
 * E.g. todayAt(11.75) → today at 11:45:00
 */
function todayAt(decimalHour) {
  const d = new Date();
  const hours = Math.floor(decimalHour);
  const minutes = Math.round((decimalHour - hours) * 60);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/**
 * Returns a Date set to N weeks ago at the given hour (local time).
 */
function weeksAgo(n, hour = 10) {
  const d = new Date(Date.now() - n * 7 * 24 * 60 * 60 * 1000);
  d.setHours(hour, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// Provider seed data
// Bcrypt hashes for 'DevPassword1!' (cost factor 10) — match 03_seed_data.sql
// ---------------------------------------------------------------------------
const PROVIDERS = [
  {
    provider_id:   1,
    email:         'alice.chen@aiscribe.dev',
    password_hash: '$2b$10$MTU1ziQbGHlyKigDiX71AOPq47xol/F3/NRxD3oL9h1UT.H6dPKDS',
    first_name:    'Alice',
    last_name:     'Chen',
  },
  {
    provider_id:   2,
    email:         'bob.martinez@aiscribe.dev',
    password_hash: '$2b$10$0KqkSVWA7KzdrVIZ4K9vb.Y9xPeJL3PmBEq2RB3J6DXHbM5vBVE8W',
    first_name:    'Bob',
    last_name:     'Martinez',
  },
];

// ---------------------------------------------------------------------------
// Patient seed data — 5 per provider, realistic demographics
// ---------------------------------------------------------------------------
const PATIENTS_ALICE = [
  { mrn: 'MRN-A001', first_name: 'Emily',    last_name: 'Thompson', dob: '1988-04-12', gender: 'Female' },
  { mrn: 'MRN-A002', first_name: 'James',    last_name: 'Whitfield', dob: '1975-09-03', gender: 'Male'   },
  { mrn: 'MRN-A003', first_name: 'Sarah',    last_name: 'Nakamura',  dob: '1993-01-28', gender: 'Female' },
  { mrn: 'MRN-A004', first_name: 'David',    last_name: 'Okafor',    dob: '1968-06-17', gender: 'Male'   },
  { mrn: 'MRN-A005', first_name: 'Linda',    last_name: 'Ramirez',   dob: '1981-11-05', gender: 'Female' },
];

const PATIENTS_BOB = [
  { mrn: 'MRN-B001', first_name: 'Michael',  last_name: 'Torres',   dob: '1972-02-20', gender: 'Male'   },
  { mrn: 'MRN-B002', first_name: 'Jennifer', last_name: 'Hayes',    dob: '1985-07-14', gender: 'Female' },
  { mrn: 'MRN-B003', first_name: 'Robert',   last_name: 'Kim',      dob: '1990-03-30', gender: 'Male'   },
  { mrn: 'MRN-B004', first_name: 'Patricia', last_name: 'Nguyen',   dob: '1965-10-22', gender: 'Female' },
  { mrn: 'MRN-B005', first_name: 'Charles',  last_name: 'Bennett',  dob: '1978-08-09', gender: 'Male'   },
];

// ---------------------------------------------------------------------------
// Demo patient — Jordan Ellis (MRN-A006) under Dr. Alice Chen
// 3-appointment ADHD arc seeded for live demo use
// ---------------------------------------------------------------------------
const DEMO_PATIENT = {
  mrn:        'MRN-A006',
  first_name: 'Jordan',
  last_name:  'Ellis',
  dob:        '1992-06-15',
  gender:     'Male',
};

// ---------------------------------------------------------------------------
// Today's encounter schedule (visit_type, CSN prefix)
// Today's times: 10:00, 11:45, 13:30, 15:15, 16:45
// ---------------------------------------------------------------------------
const TODAY_SCHEDULE = [
  { patientIndex: 0, visit_type: 'Initial Evaluation',    hour: 10.00  },
  { patientIndex: 1, visit_type: 'Follow-up',             hour: 11.75  },
  { patientIndex: 2, visit_type: 'Follow-up',             hour: 13.50  },
  { patientIndex: 3, visit_type: 'Routine Consultation',  hour: 15.25  },
  { patientIndex: 4, visit_type: 'Follow-up',             hour: 16.75  },
];

// ---------------------------------------------------------------------------
// Historical encounter config
// historicalWeeks: array of week offsets (positive integers)
// noteCount must match historicalWeeks.length
// ---------------------------------------------------------------------------
const HISTORY_CONFIG = [
  { patientSlot: 1, historicalWeeks: [4]            },  // Patient 2: 1 past encounter
  { patientSlot: 2, historicalWeeks: [4, 8]         },  // Patient 3: 2 past encounters
  { patientSlot: 3, historicalWeeks: [4, 8, 12]     },  // Patient 4: 3 past encounters
  { patientSlot: 4, historicalWeeks: [4, 8, 12, 16] },  // Patient 5: 4 past encounters
];

// ---------------------------------------------------------------------------
// Realistic psychiatric SOAP note templates
// The note builder fills in patient name, visit type, and date dynamically.
// ---------------------------------------------------------------------------
function buildSoapNote(patientFirstName, patientLastName, visitType, visitDate, weekOffset, providerLastName) {
  const visitDateStr = visitDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const isFollowUp   = visitType.toLowerCase().includes('follow') || visitType.toLowerCase().includes('consultation');

  const subjective = isFollowUp
    ? `${patientFirstName} ${patientLastName} is a returning patient presenting for ${visitType.toLowerCase()} on ${visitDateStr}. ` +
      `Patient reports a moderate improvement in mood compared to last session ${weekOffset} week(s) ago. ` +
      `Sleep has been inconsistent, averaging 5–6 hours per night with frequent early-morning awakening. ` +
      `Appetite remains decreased; patient endorses 4–5 lb weight loss since prior visit. ` +
      `PHQ-9 score today: 12 (moderate). Patient denies active suicidal ideation or intent. ` +
      `Medication adherence is reported as good. Patient denies substance use. ` +
      `Work functioning mildly impaired; patient took two unplanned absences last week due to anhedonia.`
    : `${patientFirstName} ${patientLastName} is a new patient presenting for initial psychiatric evaluation on ${visitDateStr}. ` +
      `Chief complaint: persistent low mood and anxiety for the past 3–4 months. ` +
      `Patient reports difficulty concentrating at work, social withdrawal, and loss of interest in previously enjoyed activities. ` +
      `Denies current suicidal ideation. Sleep onset insomnia present (taking 60–90 minutes to fall asleep). ` +
      `No prior psychiatric history. Family history significant for major depressive disorder (mother). ` +
      `Denies alcohol or substance use. PHQ-9 today: 14 (moderate). GAD-7: 11 (moderate).`;

  const objective =
    `Mental Status Examination: ${patientFirstName} ${patientLastName} is a well-groomed individual who appears stated age. ` +
    `Alert and oriented ×4. Cooperative with examination. ` +
    `Speech: normal rate, rhythm, and volume. ` +
    `Mood: described as "low" by patient. Affect: dysthymic, constricted range, mood-congruent. ` +
    `Thought process: linear and goal-directed. Thought content: no delusions, no hallucinations, no obsessions. ` +
    `Insight: intact. Judgment: intact. ` +
    `Cognition: intact to gross testing (serial 7s, recall 3/3). ` +
    `Suicidal ideation: denied. Homicidal ideation: denied. ` +
    `Vital signs reviewed from nursing intake: BP 118/76 mmHg, HR 72 bpm, weight 162 lbs.`;

  const assessment = isFollowUp
    ? `1. Major Depressive Disorder, moderate severity (ICD-10: F32.1) — partial response to current pharmacotherapy. ` +
      `PHQ-9 improved from prior visit (was 15, now 12) but remains in moderate range. ` +
      `Sleep disturbance and appetite suppression persist as residual symptoms. ` +
      `No evidence of hypomanic or manic episodes. Anxious features present but not meeting threshold for comorbid GAD at this time. ` +
      `2. Occupational impairment secondary to MDD — patient missing work due to anhedonia. Risk level: low.`
    : `1. Major Depressive Disorder, moderate severity (ICD-10: F32.1) — new diagnosis based on DSM-5 criteria. ` +
      `Meets criteria: depressed mood, anhedonia, sleep disturbance, concentration difficulty, weight change, duration > 2 months. ` +
      `2. Generalized Anxiety Disorder (ICD-10: F41.1) — GAD-7 score of 11 indicates moderate symptom burden. ` +
      `Rule out: bipolar disorder (no prior manic/hypomanic episodes reported; monitor longitudinally). Risk level: low.`;

  const plan = isFollowUp
    ? `1. Continue current SSRI (sertraline 100 mg daily) — no dose change at this time given partial response trajectory. ` +
      `Reassess in 4 weeks; consider augmentation if PHQ-9 remains above 10. ` +
      `2. Referral placed for cognitive behavioral therapy (CBT) — patient agreeable, referral sent to Dr. Rivera's outpatient clinic. ` +
      `3. Sleep hygiene education provided: consistent wake time, stimulus control techniques reviewed. ` +
      `4. Return to clinic in 4 weeks or sooner if worsening. Patient instructed to call crisis line (988) if suicidal thoughts emerge. ` +
      `5. Labs: TSH ordered to rule out thyroid contribution. Results to be reviewed at next visit. ` +
      `Electronically signed by Dr. ${providerLastName}.`
    : `1. Initiate sertraline 50 mg daily ×2 weeks, then increase to 100 mg daily if tolerated. ` +
      `Patient counseled on delayed onset of action (4–6 weeks), common side effects (nausea, initial activation), and importance of adherence. ` +
      `2. Referral for outpatient CBT placed — targeting both depressive and anxious symptoms. ` +
      `3. Safety planning completed: patient identifies wife as support person; crisis line (988) provided. ` +
      `4. PHQ-9 and GAD-7 to be repeated at 4-week follow-up appointment. ` +
      `5. Labs ordered: CBC, CMP, TSH, lipid panel (baseline pre-medication). ` +
      `6. Follow-up appointment scheduled in 4 weeks. ` +
      `Electronically signed by Dr. ${providerLastName}.`;

  return `SUBJECTIVE:\n${subjective}\n\nOBJECTIVE:\n${objective}\n\nASSESSMENT:\n${assessment}\n\nPLAN:\n${plan}`;
}

// ---------------------------------------------------------------------------
// ADHD-specific SOAP note builders — Demo Patient (Jordan Ellis)
// ---------------------------------------------------------------------------

/**
 * Appointment 1 — Initial Evaluation (8 weeks ago)
 * Diagnosis: ADHD Combined Presentation (F90.2)
 * Treatment initiated: Adderall XR 10 mg QAM
 */
function buildAdhdInitialNote(visitDate) {
  const visitDateStr = visitDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const subjective =
    `Jordan Ellis is a new patient presenting for initial psychiatric evaluation on ${visitDateStr}. ` +
    `Chief complaint: longstanding difficulty sustaining attention, chronic disorganization, and significant impulsivity that have worsened over the past two years. ` +
    `Patient is a 33-year-old male currently employed as a Senior Product Manager overseeing a cross-functional team of 12. ` +
    `He reports frequent missed deadlines despite high effort, difficulty prioritizing competing tasks, losing track of key decisions in back-to-back meetings, ` +
    `and impulsively context-switching mid-task. He was recently placed on a formal Performance Improvement Plan at work, which precipitated this referral. ` +
    `Patient endorses a childhood history consistent with ADHD — frequently lost homework, was described as "smart but scattered" by teachers, ` +
    `and was never formally evaluated. Symptoms present in at least two settings (work and home). ` +
    `Denies current depressive or manic symptoms. Denies substance use. Caffeine use approximately 3 cups of coffee daily as self-directed focus aid. ` +
    `PHQ-9: 5 (minimal). GAD-7: 6 (mild, below diagnostic threshold). ` +
    `Adult ADHD Self-Report Scale (ASRS v1.1) administered: score 52/72, highly consistent with ADHD.`;

  const objective =
    `Mental Status Examination: Jordan Ellis is a well-dressed, articulate male who appears stated age. ` +
    `Alert and oriented ×4. Cooperative and engaged with examination. ` +
    `Speech: normal rate with occasional tangential digressions requiring redirection. ` +
    `Mood: described as "frustrated but hopeful." Affect: mildly anxious, reactive, mood-congruent. ` +
    `Thought process: circumstantial at times; goal-directed with clinical redirection. ` +
    `Thought content: no delusions, no hallucinations, no obsessions. ` +
    `Insight: intact — patient demonstrates strong self-awareness of his deficits. Judgment: intact. ` +
    `Cognition: digit span 5 forward, 4 reverse (below expected range for age and education level). ` +
    `Suicidal ideation: denied. Homicidal ideation: denied. ` +
    `Vital signs reviewed: BP 122/78 mmHg, HR 76 bpm, weight 178 lbs.`;

  const assessment =
    `1. Attention-Deficit/Hyperactivity Disorder, Combined Presentation (ICD-10: F90.2) — new diagnosis. ` +
    `Patient meets DSM-5 criteria: ≥5 inattentive symptoms and ≥5 hyperactive/impulsive symptoms present in multiple settings, ` +
    `onset prior to age 12 (per collateral history), duration >6 months, and causing significant occupational impairment. ` +
    `ASRS score of 52/72 supports diagnosis. ` +
    `2. Caffeine use disorder, mild — patient consuming 3+ cups daily as self-medication for focus; addressed in counseling. ` +
    `Rule out: anxiety disorder as primary etiology (PHQ-9 and GAD-7 sub-threshold; ADHD-driven anxiety more likely). ` +
    `Risk level: low.`;

  const plan =
    `1. Initiate Adderall XR (amphetamine salts, extended-release) 10 mg QAM. ` +
    `Patient counseled on mechanism of action, expected onset of therapeutic effect (1–3 weeks for full benefit), ` +
    `common side effects (decreased appetite, dry mouth, elevated HR/BP, insomnia if taken too late), ` +
    `and the importance of consistent morning dosing — no later than 9:00 AM. ` +
    `2. Baseline labs ordered: CBC, CMP, fasting lipid panel — to be reviewed at 4-week follow-up. ` +
    `3. Blood pressure monitoring: patient to log weekly home BP readings; target <130/80 mmHg on stimulant therapy. ` +
    `4. Nutrition counseling: encouraged to eat a full breakfast before medication takes effect to mitigate appetite suppression at lunch. ` +
    `5. Caffeine reduction plan: taper from 3 cups to 1 cup daily over 2 weeks to avoid withdrawal and reduce cardiovascular stacking with stimulant. ` +
    `6. Psychoeducation provided: ADHD reframed as a neurobiological condition, not a character deficit. Written resources provided. ` +
    `7. Workplace accommodations discussed: patient agreeable to requesting extended deadline windows through HR. ` +
    `8. Follow-up appointment scheduled in 4 weeks to assess medication response and tolerability. ` +
    `Electronically signed by Dr. Chen.`;

  return `SUBJECTIVE:\n${subjective}\n\nOBJECTIVE:\n${objective}\n\nASSESSMENT:\n${assessment}\n\nPLAN:\n${plan}`;
}

/**
 * Appointment 2 — Follow-up #1 (4 weeks ago)
 * Partial response to Adderall XR 10 mg; dose increased to 20 mg QAM
 */
function buildAdhdFollowUp1Note(visitDate) {
  const visitDateStr = visitDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const subjective =
    `Jordan Ellis is a returning patient presenting for follow-up on ${visitDateStr}, ` +
    `4 weeks after initiation of Adderall XR 10 mg QAM for Adult ADHD, Combined Presentation (F90.2). ` +
    `Patient reports meaningful improvement in morning productivity. ` +
    `He notes arriving to morning standups prepared with organized notes, completing focused deep-work blocks without getting pulled off task, ` +
    `and feeling "more like myself before the job got so complicated." ` +
    `However, he consistently reports the medication effect diminishing by approximately 1:30–2:00 PM, ` +
    `after which concentration difficulties and task-switching return to near-baseline levels. ` +
    `Afternoon meetings, sprint planning sessions, and late-day stakeholder calls remain significantly challenging. ` +
    `Side effects reported: decreased appetite at lunch (eating smaller portions, not skipping meals entirely); ` +
    `mild dry mouth in the mornings; no insomnia — consistently taking medication before 8:30 AM. ` +
    `Denies irritability, mood changes, palpitations, or anxiety increase. No substance use. ` +
    `Caffeine reduced to 1 cup daily as discussed. ` +
    `Home BP log reviewed: readings ranging 118–128 / 74–80 mmHg — within acceptable parameters. ` +
    `PHQ-9: 4 (minimal). GAD-7: 5 (mild, sub-threshold).`;

  const objective =
    `Mental Status Examination: Jordan Ellis appears well-groomed and notably more organized in presentation compared to initial evaluation. ` +
    `Alert and oriented ×4. Cooperative and engaged. ` +
    `Speech: normal rate and volume. Thought process: more linear and goal-directed — fewer tangential digressions than prior visit. ` +
    `Mood: described as "optimistic but still frustrated in the afternoons." Affect: euthymic, full range, mood-congruent. ` +
    `No psychotic features. Insight: intact. Judgment: intact. ` +
    `Vital signs reviewed: BP 124/80 mmHg, HR 74 bpm, weight 176 lbs (2 lb decrease since last visit, attributed to reduced appetite at lunch).`;

  const assessment =
    `1. ADHD, Combined Presentation (F90.2) — partial response to Adderall XR 10 mg QAM. ` +
    `Clinically meaningful morning improvement documented with clear residual afternoon deficit. ` +
    `Duration of effect appears insufficient — consistent with inter-individual pharmacokinetic variability in XR formulation absorption. ` +
    `No tolerability concerns identified. Weight and BP remain within acceptable parameters for stimulant therapy. ` +
    `2. Caffeine use disorder, mild — significantly improved; patient now at 1 cup daily as recommended. ` +
    `Risk level: low.`;

  const plan =
    `1. Increase Adderall XR to 20 mg QAM — targeting more consistent afternoon therapeutic coverage. ` +
    `Patient counseled on expected improvement in duration of effect, potential for slightly increased appetite suppression, ` +
    `and continued importance of morning timing (no later than 9:00 AM). ` +
    `2. Continue weekly home BP log; target maintained at <130/80 mmHg. ` +
    `3. Nutrition plan maintained: full breakfast before medication onset; adequate caloric intake encouraged despite reduced appetite. ` +
    `4. Labs reviewed: CBC and CMP within normal limits. Fasting LDL mildly elevated at 118 mg/dL — ` +
    `dietary modifications discussed; recheck in 6 months. No changes to stimulant plan based on labs. ` +
    `5. Patient to note any new side effects at 20 mg — specifically mood changes, sleep disruption, or cardiovascular symptoms. ` +
    `6. Workplace update: patient submitted accommodation request; HR meeting scheduled. ` +
    `7. Follow-up in 4 weeks to assess response to dose increase. ` +
    `Electronically signed by Dr. Chen.`;

  return `SUBJECTIVE:\n${subjective}\n\nOBJECTIVE:\n${objective}\n\nASSESSMENT:\n${assessment}\n\nPLAN:\n${plan}`;
}

// ---------------------------------------------------------------------------
// Seeding functions
// ---------------------------------------------------------------------------

async function seedProviders() {
  console.log('\n[1/6] Seeding providers → aiscribe_app.providers...');
  for (const p of PROVIDERS) {
    await appDb.query(
      `INSERT INTO providers (provider_id, email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [p.provider_id, p.email, p.password_hash, p.first_name, p.last_name]
    );
    console.log(`   → ${p.first_name} ${p.last_name} (provider_id=${p.provider_id}) — OK`);
  }
}

async function seedPatients(patients) {
  for (const pt of patients) {
    await emrDb.query(
      `INSERT INTO patient_demographics (mrn, first_name, last_name, dob, gender)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [pt.mrn, pt.first_name, pt.last_name, pt.dob, pt.gender]
    );
  }
}

async function seedTodaysEncounters(patients, providerId, csnPrefix) {
  for (let i = 0; i < TODAY_SCHEDULE.length; i++) {
    const slot       = TODAY_SCHEDULE[i];
    const patient    = patients[slot.patientIndex];
    const csn        = `${csnPrefix}100${i + 1}`;
    const visitDate  = todayAt(slot.hour);

    await emrDb.query(
      `INSERT INTO encounters (csn, mrn, provider_id, visit_date, visit_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [csn, patient.mrn, providerId, visitDate.toISOString(), slot.visit_type]
    );
  }
}

async function seedHistoricalData(patients, providerId, csnPrefix, providerLastName) {
  for (const config of HISTORY_CONFIG) {
    const patient = patients[config.patientSlot];
    const pNum    = config.patientSlot + 1;  // Patient slot 1 = "Patient 2", etc.

    for (let h = 0; h < config.historicalWeeks.length; h++) {
      const weekOffset  = config.historicalWeeks[h];
      const histNum     = h + 1;
      const csn         = `CSN-${csnPrefix}-P${pNum}-H${histNum}`;
      const visitDate   = weeksAgo(weekOffset);
      const visitType   = config.patientSlot === 3 ? 'Routine Consultation' : 'Follow-up';

      // Insert historical encounter
      await emrDb.query(
        `INSERT INTO encounters (csn, mrn, provider_id, visit_date, visit_type)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [csn, patient.mrn, providerId, visitDate.toISOString(), visitType]
      );

      // Insert signed SOAP note for this historical encounter
      const noteText = buildSoapNote(
        patient.first_name,
        patient.last_name,
        visitType,
        visitDate,
        weekOffset,
        providerLastName
      );

      // date_signed is set to the historical visit date for realistic data
      await emrDb.query(
        `INSERT INTO clinical_notes (csn, note_text, status, date_signed)
         VALUES ($1, $2, 'SIGNED', $3)
         ON CONFLICT DO NOTHING`,
        [csn, noteText, visitDate.toISOString()]
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Demo patient seeder — Jordan Ellis, ADHD arc (3 appointments)
// ---------------------------------------------------------------------------

/**
 * Seeds the dedicated demo patient (Jordan Ellis, MRN-A006) under Dr. Alice
 * Chen (provider_id=1) with the following arc:
 *
 *   CSN-A-DEMO-H1   — 8 weeks ago — Initial Evaluation (ADHD Dx, Adderall XR 10 mg)  — SIGNED note
 *   CSN-A-DEMO-H2   — 4 weeks ago — Follow-up #1 (partial response, up to 20 mg)     — SIGNED note
 *   CSN-A-DEMO-TODAY — today      — Follow-up #2 (live demo encounter, no note yet)
 */
async function seedDemoPatient() {
  console.log('\n[6/6] Seeding demo patient → Jordan Ellis (MRN-A006)...');

  // 1. Insert patient demographics
  await emrDb.query(
    `INSERT INTO patient_demographics (mrn, first_name, last_name, dob, gender)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [
      DEMO_PATIENT.mrn,
      DEMO_PATIENT.first_name,
      DEMO_PATIENT.last_name,
      DEMO_PATIENT.dob,
      DEMO_PATIENT.gender,
    ]
  );
  console.log(`   → ${DEMO_PATIENT.first_name} ${DEMO_PATIENT.last_name} (${DEMO_PATIENT.mrn}) — OK`);

  // -------------------------------------------------------------------------
  // Appointment 1 — Initial Evaluation (8 weeks ago)
  // -------------------------------------------------------------------------
  const appt1Date = weeksAgo(8, 10);
  await emrDb.query(
    `INSERT INTO encounters (csn, mrn, provider_id, visit_date, visit_type)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    ['CSN-A-DEMO-H1', DEMO_PATIENT.mrn, 1, appt1Date.toISOString(), 'Initial Evaluation']
  );
  const appt1Note = buildAdhdInitialNote(appt1Date);
  await emrDb.query(
    `INSERT INTO clinical_notes (csn, note_text, status, date_signed)
     VALUES ($1, $2, 'SIGNED', $3)
     ON CONFLICT DO NOTHING`,
    ['CSN-A-DEMO-H1', appt1Note, appt1Date.toISOString()]
  );
  console.log(`   → Appointment 1 (CSN-A-DEMO-H1): Initial Evaluation, 8 wks ago — SIGNED note — OK`);

  // -------------------------------------------------------------------------
  // Appointment 2 — Follow-up #1 (4 weeks ago)
  // -------------------------------------------------------------------------
  const appt2Date = weeksAgo(4, 10);
  await emrDb.query(
    `INSERT INTO encounters (csn, mrn, provider_id, visit_date, visit_type)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    ['CSN-A-DEMO-H2', DEMO_PATIENT.mrn, 1, appt2Date.toISOString(), 'Follow-up']
  );
  const appt2Note = buildAdhdFollowUp1Note(appt2Date);
  await emrDb.query(
    `INSERT INTO clinical_notes (csn, note_text, status, date_signed)
     VALUES ($1, $2, 'SIGNED', $3)
     ON CONFLICT DO NOTHING`,
    ['CSN-A-DEMO-H2', appt2Note, appt2Date.toISOString()]
  );
  console.log(`   → Appointment 2 (CSN-A-DEMO-H2): Follow-up #1, 4 wks ago — SIGNED note — OK`);

  // -------------------------------------------------------------------------
  // Appointment 3 — Follow-up #2 (TODAY — live demo encounter, no note)
  // -------------------------------------------------------------------------
  const appt3Date = todayAt(14.0); // 2:00 PM slot for the demo
  await emrDb.query(
    `INSERT INTO encounters (csn, mrn, provider_id, visit_date, visit_type)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    ['CSN-A-DEMO-TODAY', DEMO_PATIENT.mrn, 1, appt3Date.toISOString(), 'Follow-up']
  );
  console.log(`   → Appointment 3 (CSN-A-DEMO-TODAY): Follow-up #2, TODAY at 2:00 PM — no note (live demo) — OK`);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
async function main() {
  console.log('============================================================');
  console.log('  AIScribe Enterprise Clinical Seeder — Window 11');
  console.log('============================================================');

  try {
    // 1. Providers
    await seedProviders();

    // 2. Patients
    console.log('\n[2/6] Seeding patients → simulated_emr.patient_demographics...');
    await seedPatients(PATIENTS_ALICE);
    console.log(`   → Alice's patients (MRN-A001 through MRN-A005) — OK`);
    await seedPatients(PATIENTS_BOB);
    console.log(`   → Bob's patients (MRN-B001 through MRN-B005) — OK`);

    // 3. Today's encounters
    console.log('\n[3/6] Seeding today\'s encounters → simulated_emr.encounters...');
    await seedTodaysEncounters(PATIENTS_ALICE, 1, 'CSN-A');
    console.log(`   → Alice's encounters (CSN-A1001 through CSN-A1005) — OK`);
    await seedTodaysEncounters(PATIENTS_BOB, 2, 'CSN-B');
    console.log(`   → Bob's encounters (CSN-B1001 through CSN-B1005) — OK`);

    // 4. Historical encounters + signed notes
    console.log('\n[4/6] Seeding historical encounters + clinical notes...');
    await seedHistoricalData(PATIENTS_ALICE, 1, 'A', 'Chen');
    console.log(`   → Alice's historical encounters + notes (10 encounters, 10 notes) — OK`);
    await seedHistoricalData(PATIENTS_BOB, 2, 'B', 'Martinez');
    console.log(`   → Bob's historical encounters + notes (10 encounters, 10 notes) — OK`);

    // 5. Summary (standard patients)
    console.log('\n[5/6] Verifying standard row counts...');
    const patientCount    = await emrDb.query(`SELECT COUNT(*) FROM patient_demographics WHERE mrn LIKE 'MRN-A%' OR mrn LIKE 'MRN-B%'`);
    const todayEncounters = await emrDb.query(`SELECT COUNT(*) FROM encounters WHERE DATE(visit_date) = CURRENT_DATE AND (csn LIKE 'CSN-A1%' OR csn LIKE 'CSN-B1%')`);
    const histEncounters  = await emrDb.query(`SELECT COUNT(*) FROM encounters WHERE csn LIKE 'CSN-A-%' OR csn LIKE 'CSN-B-%'`);
    const clinicalNotes   = await emrDb.query(`SELECT COUNT(*) FROM clinical_notes WHERE csn LIKE 'CSN-A-%' OR csn LIKE 'CSN-B-%'`);

    console.log(`   Patients seeded (standard):        ${patientCount.rows[0].count} (expected 10)`);
    console.log(`   Today's encounters seeded:         ${todayEncounters.rows[0].count} (expected 10)`);
    console.log(`   Historical encounters seeded:      ${histEncounters.rows[0].count} (expected 20)`);
    console.log(`   Signed clinical notes seeded:      ${clinicalNotes.rows[0].count} (expected 20)`);

    // 6. Demo patient — Jordan Ellis
    await seedDemoPatient();

    // Demo patient summary verification
    const demoPatient   = await emrDb.query(`SELECT COUNT(*) FROM patient_demographics WHERE mrn = 'MRN-A006'`);
    const demoEncounters = await emrDb.query(`SELECT COUNT(*) FROM encounters WHERE mrn = 'MRN-A006'`);
    const demoNotes     = await emrDb.query(`SELECT COUNT(*) FROM clinical_notes WHERE csn LIKE 'CSN-A-DEMO-%'`);

    console.log(`\n   Demo patient seeded:               ${demoPatient.rows[0].count} (expected 1)`);
    console.log(`   Demo encounters seeded:            ${demoEncounters.rows[0].count} (expected 3)`);
    console.log(`   Demo signed notes seeded:          ${demoNotes.rows[0].count} (expected 2)`);
    console.log(`   Demo live encounter (no note):     CSN-A-DEMO-TODAY — ready for upload`);

    console.log('\n✅  Seeding complete. All data is idempotent (re-run safe).');
    console.log('============================================================\n');

  } catch (err) {
    console.error('\n❌  Seeder failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await appDb.end();
    await emrDb.end();
  }
}

main();
