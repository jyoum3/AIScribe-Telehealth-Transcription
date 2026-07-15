/**
 * Service: Claude SOAP Note Formatter
 *
 * Sends a raw transcript to Anthropic Claude and parses the response into a
 * structured SOAP note with exactly four keys: subjective, objective, assessment, plan.
 *
 * Key behaviors:
 *   - Custom prompt templates: providers can override the default clinical prompt
 *   - Historical context: prior session notes can be injected for longitudinal enrichment
 *   - Control block parsing: Claude appends a [CONTROL_BLOCK] JSON object used to
 *     trigger automated follow-up scheduling via Mirth
 *   - Return value: { soap: {...}, controlBlock: {...} }
 *
 * Error codes thrown:
 *   SOAP_FORMATTING_FAILED → Claude returned malformed JSON, unparseable output,
 *                            or a response missing one of the four required SOAP keys
 */

'use strict';

const axios = require('axios');

const CLAUDE_URL     = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL   = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const CLAUDE_MAX_TOK = 2048;

// Default system prompt — used when no custom_prompt_template is set
const DEFAULT_CLINICAL_PROMPT = `You are a clinical documentation assistant specializing in psychiatric progress notes.

You will receive a transcript of a clinical encounter. Extract and structure the clinical information into a SOAP note.

You MUST respond with ONLY a valid JSON object containing the SOAP sections. No markdown code fences, no explanations, no preamble — just the raw JSON object starting with { and ending with }, followed by the control block described at the end of this prompt.

The JSON object must contain exactly these four string keys:

- "subjective": What the patient reports — symptoms, chief complaint, history of present illness, patient-stated concerns
- "objective": Clinical observations — mental status exam findings, affect, speech, cognition, observable behaviors, vital signs if mentioned
- "assessment": Clinical impression — diagnosis, clinical reasoning, severity assessment, safety considerations
- "plan": Treatment plan — medications, dosage changes, follow-up schedule, therapy referrals, psychoeducation, safety planning

Rules:
1. All four keys are REQUIRED in every response
2. Each value must be a non-empty plain string (no nested objects, no arrays, no markdown)
3. If the transcript does not contain enough information for a section, use exactly this text as the value: "[Section pending clinician input]"
4. Aim for clear, professional clinical language — concise but complete
5. Do NOT fabricate clinical details not present in the transcript`;

const REQUIRED_SOAP_KEYS = ['subjective', 'objective', 'assessment', 'plan'];

// Always appended at the end of every system prompt — triggers follow-up scheduling
const CONTROL_BLOCK_INSTRUCTION = `\n\nSTRUCTURED OUTPUT REQUIREMENT: At the very end of your response, after all SOAP sections, append a JSON control block using these exact delimiters:
[CONTROL_BLOCK]{"schedule_follow_up": true or false, "timeline_weeks": integer 2-12}[/CONTROL_BLOCK]
Set schedule_follow_up to true only if the clinical content indicates a follow-up is clinically warranted within 12 weeks. Set timeline_weeks to the recommended interval.`;

// Injected between the base prompt and the control block when historical context is available
const HISTORICAL_CONTEXT_PREFIX = `\n\nHISTORICAL BASELINE — Previous session note (for longitudinal reference only):\n`;
const HISTORICAL_CONTEXT_SUFFIX = `\n\nIMPORTANT: Use this as reference context only. Do not reproduce it verbatim. Focus on symptom progression, changes in clinical status, and contrast with today's session.`;

// Injected after a CUSTOM prompt template to guarantee valid JSON output
// (the default prompt already contains explicit JSON instructions)
const JSON_FORMAT_ENFORCEMENT = `\n\nCRITICAL OUTPUT FORMAT REQUIREMENT (mandatory — overrides all style instructions above): Your response MUST contain a valid JSON object with exactly these four string keys: "subjective", "objective", "assessment", "plan". Each value must be a non-empty plain string. If style instructions above request markers, bullets, or formatting within sections, apply them inside the string values of the JSON object. Do NOT output plain text, markdown headers, or any structure other than the JSON object followed by the control block described below.`;

// Safe fallback when Claude omits or corrupts the control block
const DEFAULT_CONTROL_BLOCK = { schedule_follow_up: false, timeline_weeks: 4 };

/**
 * Assemble the final system prompt in order:
 *   (a) Base prompt (custom or default)
 *   (b) JSON enforcement clause (custom templates only)
 *   (c) Historical context block (if provided)
 *   (d) Control block instruction (always last)
 */
function buildSystemPrompt(customPromptTemplate, historicalContext) {
  const usingCustom = !!(customPromptTemplate && customPromptTemplate.trim().length > 0);
  const basePrompt  = usingCustom ? customPromptTemplate.trim() : DEFAULT_CLINICAL_PROMPT;
  const jsonClause  = usingCustom ? JSON_FORMAT_ENFORCEMENT : '';
  const history     = historicalContext
    ? HISTORICAL_CONTEXT_PREFIX + historicalContext + HISTORICAL_CONTEXT_SUFFIX
    : '';

  return basePrompt + jsonClause + history + CONTROL_BLOCK_INSTRUCTION;
}

/**
 * Format a raw transcript into a structured SOAP note using Claude.
 *
 * @param {string}      transcript            - Raw text output from Whisper
 * @param {string|null} customPromptTemplate  - Provider's custom prompt (null = use default)
 * @param {string|null} historicalContext     - Prior session note text (null = no context)
 *
 * @returns {Promise<{
 *   soap: { subjective: string, objective: string, assessment: string, plan: string },
 *   controlBlock: { schedule_follow_up: boolean, timeline_weeks: number }
 * }>}
 *
 * @throws {Error} err.code === 'SOAP_FORMATTING_FAILED' on Claude parse/validation failure
 */
async function formatSoapNote(transcript, customPromptTemplate = null, historicalContext = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('[claude] FATAL: ANTHROPIC_API_KEY environment variable is not set');
    throw new Error('Server configuration error: ANTHROPIC_API_KEY is missing.');
  }

  const startTime      = Date.now();
  const usingCustom    = !!(customPromptTemplate && customPromptTemplate.trim().length > 0);
  const usingHistory   = !!historicalContext;
  const systemPrompt   = buildSystemPrompt(customPromptTemplate, historicalContext);

  console.log(
    `[claude] Sending transcript to Claude (${transcript.length} chars) — ` +
    `customPrompt=${usingCustom}, historicalContext=${usingHistory}`
  );

  let response;
  try {
    response = await axios.post(
      CLAUDE_URL,
      {
        model:      CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOK,
        system:     systemPrompt,
        messages: [{
          role:    'user',
          content: `Please structure the following clinical encounter transcript into a SOAP note:\n\n${transcript}`,
        }],
      },
      {
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        timeout: 30_000,
      }
    );
  } catch (err) {
    const status  = err.response?.status;
    const errBody = err.response?.data;
    console.error(`[claude] Claude API request failed (HTTP ${status}):`, errBody || err.message);
    const formattingError = new Error('AI note formatting failed. Please try again or enter the note manually.');
    formattingError.code = 'SOAP_FORMATTING_FAILED';
    throw formattingError;
  }

  const rawText = response.data?.content?.[0]?.text;

  if (!rawText || typeof rawText !== 'string') {
    console.error('[claude] Unexpected response shape from Claude:', JSON.stringify(response.data));
    const shapeError = new Error('AI note formatting failed. Please try again or enter the note manually.');
    shapeError.code = 'SOAP_FORMATTING_FAILED';
    throw shapeError;
  }

  // Step 1 — Extract the [CONTROL_BLOCK] BEFORE parsing SOAP.
  // Residual delimiters will corrupt the plan section if SOAP is parsed first.
  let controlBlock = { ...DEFAULT_CONTROL_BLOCK };
  let textForSoap  = rawText;

  const controlBlockRegex = /\[CONTROL_BLOCK\]([\s\S]*?)\[\/CONTROL_BLOCK\]/;
  const controlMatch = rawText.match(controlBlockRegex);

  if (controlMatch) {
    try {
      const parsed = JSON.parse(controlMatch[1].trim());
      controlBlock = {
        schedule_follow_up: typeof parsed.schedule_follow_up === 'boolean'
          ? parsed.schedule_follow_up
          : DEFAULT_CONTROL_BLOCK.schedule_follow_up,
        timeline_weeks: typeof parsed.timeline_weeks === 'number'
          ? parsed.timeline_weeks
          : DEFAULT_CONTROL_BLOCK.timeline_weeks,
      };
      console.log(
        `[claude] Control block — schedule_follow_up=${controlBlock.schedule_follow_up}, ` +
        `timeline_weeks=${controlBlock.timeline_weeks}`
      );
    } catch {
      console.warn('[claude] Failed to parse control block JSON — using defaults');
      controlBlock = { ...DEFAULT_CONTROL_BLOCK };
    }
    textForSoap = rawText.replace(controlBlockRegex, '').trim();
  } else {
    console.warn('[claude] No [CONTROL_BLOCK] found in Claude response — using defaults');
  }

  // Step 2 — Parse SOAP JSON from the cleaned text
  let soap;
  try {
    // Strip optional markdown code fences in case Claude adds them despite instructions
    const cleaned = textForSoap.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    soap = JSON.parse(cleaned);
  } catch {
    console.error('[claude] Failed to parse SOAP JSON. Cleaned text was:', textForSoap);
    const jsonError = new Error('AI note formatting failed. Please try again or enter the note manually.');
    jsonError.code = 'SOAP_FORMATTING_FAILED';
    throw jsonError;
  }

  // Step 3 — Validate all four required SOAP keys are present and non-empty
  for (const key of REQUIRED_SOAP_KEYS) {
    if (typeof soap[key] !== 'string' || soap[key].trim() === '') {
      console.error(`[claude] SOAP validation failed — key "${key}" is missing or empty`);
      const validationError = new Error('AI note formatting failed. Please try again or enter the note manually.');
      validationError.code = 'SOAP_FORMATTING_FAILED';
      throw validationError;
    }
  }

  const cleanedSoap = {
    subjective: soap.subjective.trim(),
    objective:  soap.objective.trim(),
    assessment: soap.assessment.trim(),
    plan:       soap.plan.trim(),
  };

  console.log(`[claude] SOAP formatting complete in ${Date.now() - startTime}ms`);

  return { soap: cleanedSoap, controlBlock };
}

module.exports = { formatSoapNote };
