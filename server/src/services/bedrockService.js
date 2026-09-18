const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require('@aws-sdk/client-bedrock-runtime');

const { awsRegion } = require('../config/env');

const MODEL_ID = 'amazon.nova-lite-v1:0';

// Client uses the default AWS SDK credential chain — no hard-coded keys.
const bedrockClient = new BedrockRuntimeClient({ region: awsRegion });

// ---------------------------------------------------------------------------
// Tool specification
// ---------------------------------------------------------------------------
const NOTE_TOOL_SPEC = {
  name: 'extract_clinical_note',
  description:
    'Extract ONLY facts that are explicitly stated in the transcript into a structured ' +
    'clinical note. ' +
    'CRITICAL RULES: ' +
    '(1) If a field has no information in the transcript you MUST use an empty string "" ' +
    'for string fields and an empty array [] for array fields. ' +
    '(2) NEVER use ".", "N/A", "not mentioned", "none", "unknown", "not stated", or any ' +
    'other placeholder text — use "" or [] instead. ' +
    '(3) Do NOT invent, infer, or guess any information that is not directly present. ' +
    '(4) Do NOT diagnose, prescribe, recommend treatments, or make any medical decisions. ' +
    '(5) assessment MUST be "" unless a clinician explicitly stated an assessment. ' +
    '(6) follow_up MUST be "" unless follow-up instructions were explicitly stated. ' +
    '(7) history MUST be "" unless past medical history was explicitly mentioned. ' +
    '(8) medications_mentioned MUST be [] unless medications were explicitly named.',
  inputSchema: {
    json: {
      type: 'object',
      properties: {
        patient: {
          type: 'object',
          description: 'Patient demographics. Use "" for unknown strings and null for unknown age.',
          properties: {
            name: {
              type: 'string',
              description:
                'Patient name if explicitly stated in the transcript. ' +
                'Use "" (empty string) if not stated. NEVER use "." or "N/A".',
            },
            age: {
              type: ['number', 'null'],
              description:
                'Patient age as a number if explicitly stated. Use null if not stated.',
            },
            sex: {
              type: 'string',
              description:
                'Patient sex or gender if explicitly stated. ' +
                'Use "" (empty string) if not stated. NEVER use "." or "N/A".',
            },
          },
          required: ['name', 'age', 'sex'],
        },
        chief_complaint: {
          type: 'string',
          description:
            'Primary reason the patient is seeking care, in their own words, ' +
            'based only on what they stated. Use "" if not determinable.',
        },
        symptoms: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of symptoms explicitly mentioned by the patient in the transcript. ' +
            'Use [] if no symptoms were mentioned.',
        },
        duration: {
          type: 'string',
          description:
            'Duration or onset of symptoms exactly as stated, e.g. "fever for 30 days". ' +
            'Use "" if no duration was mentioned. NEVER use "." or "N/A".',
        },
        history: {
          type: 'string',
          description:
            'Relevant past medical history explicitly mentioned in the transcript. ' +
            'Use "" if not mentioned. NEVER use "." or any placeholder.',
        },
        observations: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Clinical observations or examination findings explicitly described. ' +
            'Use [] if none were described.',
        },
        assessment: {
          type: 'string',
          description:
            'Assessment or clinical impression ONLY if a clinician explicitly stated one ' +
            'in the transcript. Use "" if no assessment was stated. ' +
            'NEVER generate, infer, or add your own assessment.',
        },
        medications_mentioned: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Medications explicitly named in the transcript. Use [] if none were mentioned.',
        },
        follow_up: {
          type: 'string',
          description:
            'Follow-up instructions or plans ONLY if explicitly stated in the transcript. ' +
            'Use "" if not stated. NEVER infer or suggest follow-up.',
        },
        missing_information: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Names of fields typically required for a clinical note that were NOT present ' +
            'in the transcript, e.g. ["patient name", "age"]. Use [] if nothing is missing.',
        },
        uncertain_fields: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Field names where the extracted value is ambiguous or only partially stated. ' +
            'Use [] if nothing is uncertain.',
        },
      },
      required: [
        'patient',
        'chief_complaint',
        'symptoms',
        'duration',
        'history',
        'observations',
        'assessment',
        'medications_mentioned',
        'follow_up',
        'missing_information',
        'uncertain_fields',
      ],
    },
  },
};

const SYSTEM_PROMPT = [
  {
    text:
      'You are a medical transcription assistant. Your ONLY job is to extract ' +
      'information that is EXPLICITLY present in the provided transcript. ' +
      '\n\nABSOLUTE RULES:' +
      '\n- Use "" (empty string) for any string field where information is absent.' +
      '\n- Use [] (empty array) for any array field where information is absent.' +
      '\n- NEVER use ".", "N/A", "not mentioned", "none", "unknown", or any placeholder text.' +
      '\n- NEVER invent, infer, or guess symptoms, diagnoses, medications, history, or any other field.' +
      '\n- assessment MUST be "" unless a doctor/clinician explicitly stated an assessment in the transcript.' +
      '\n- follow_up MUST be "" unless follow-up instructions were explicitly given in the transcript.' +
      '\n- history MUST be "" unless past medical history was explicitly mentioned.' +
      '\n- Do NOT diagnose, prescribe medication, recommend treatment, or make medical decisions.' +
      '\n\nCall the extract_clinical_note tool with exactly the facts present in the transcript.',
  },
];

// ---------------------------------------------------------------------------
// Post-processing normalizer
//
// Defensive layer applied AFTER parsing the Bedrock response.
// Converts any placeholder strings the model may return into clean empty values,
// regardless of prompt compliance.
// ---------------------------------------------------------------------------

// Values that are semantically "absent" — any trimmed string matching one of
// these (case-insensitive) is replaced with "".
const PLACEHOLDER_PATTERN = /^[.\s]*$|^n\/?a$|^not\s+mentioned$|^not\s+stated$|^none$|^unknown$|^not\s+applicable$|^not\s+available$/i

/**
 * Normalise a single string field.
 * Trims whitespace; replaces placeholder-only strings with "".
 */
function normalizeString(value) {
  if (value === null || value === undefined) return ''
  const s = String(value).trim()
  return PLACEHOLDER_PATTERN.test(s) ? '' : s
}

/**
 * Normalise an array-of-strings field.
 * Removes empty/placeholder items and trims the rest.
 */
function normalizeArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeString(item))
    .filter((item) => item !== '')
}

/**
 * Apply normalization rules to the full note object returned by Bedrock.
 * Only operates on the known schema fields — does not add or remove keys.
 */
function normalizeNote(raw) {
  return {
    patient: {
      name: normalizeString(raw.patient?.name),
      age:  (raw.patient?.age !== null && raw.patient?.age !== undefined && !isNaN(Number(raw.patient?.age)))
              ? Number(raw.patient.age)
              : null,
      sex:  normalizeString(raw.patient?.sex),
    },
    chief_complaint:       normalizeString(raw.chief_complaint),
    symptoms:              normalizeArray(raw.symptoms),
    duration:              normalizeString(raw.duration),
    history:               normalizeString(raw.history),
    observations:          normalizeArray(raw.observations),
    assessment:            normalizeString(raw.assessment),
    medications_mentioned: normalizeArray(raw.medications_mentioned),
    follow_up:             normalizeString(raw.follow_up),
    missing_information:   normalizeArray(raw.missing_information),
    uncertain_fields:      normalizeArray(raw.uncertain_fields),
  }
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Calls Amazon Bedrock Nova Lite via the Converse API to extract a structured
 * clinical note from a raw transcript string.
 *
 * @param {string} transcript - Raw transcript text from Amazon Transcribe.
 * @returns {Promise<object>} Normalised structured clinical note.
 */
async function extractClinicalNote(transcript) {
  if (!transcript || typeof transcript !== 'string') {
    throw new Error('transcript must be a non-empty string');
  }

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            text:
              'Extract the clinical note from the following transcript. ' +
              'For every field where information is absent, use "" for strings and [] for arrays. ' +
              'Do NOT use ".", "N/A", or any placeholder text.\n\n' +
              `TRANSCRIPT:\n${transcript}`,
          },
        ],
      },
    ],
    toolConfig: {
      tools: [{ toolSpec: NOTE_TOOL_SPEC }],
      toolChoice: { tool: { name: NOTE_TOOL_SPEC.name } },
    },
  });

  const response = await bedrockClient.send(command);

  const outputMessage = response.output?.message;
  if (!outputMessage) {
    throw new Error('Bedrock returned no output message');
  }

  const toolUseBlock = outputMessage.content?.find(
    (block) => block.toolUse?.name === NOTE_TOOL_SPEC.name
  );

  if (!toolUseBlock) {
    throw new Error(
      `Bedrock response did not contain a "${NOTE_TOOL_SPEC.name}" tool use block`
    );
  }

  const rawNote = toolUseBlock.toolUse.input;

  if (!rawNote || typeof rawNote !== 'object') {
    throw new Error('Bedrock tool use input was empty or not an object');
  }

  // Apply defensive normalization before returning
  const note = normalizeNote(rawNote)

  console.log('[bedrockService] raw note:', JSON.stringify(rawNote))
  console.log('[bedrockService] normalized note:', JSON.stringify(note))

  return note;
}

module.exports = { extractClinicalNote };
