const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require('@aws-sdk/client-bedrock-runtime');

const { awsRegion } = require('../config/env');

const MODEL_ID = 'amazon.nova-lite-v1:0';

// Client uses the default AWS SDK credential chain — no hard-coded keys.
const bedrockClient = new BedrockRuntimeClient({ region: awsRegion });

// ============================================================================
// TOOL SPECIFICATION
// ============================================================================
const NOTE_TOOL_SPEC = {
  name: 'extract_clinical_note',
  description:
    'Extract ONLY facts that are explicitly stated in the transcript into a structured ' +
    'clinical note. ' +

    'CRITICAL RULES — READ CAREFULLY: ' +

    '(1) EMPTY VALUES: If information is absent from the transcript, use "" for string fields ' +
    'and [] for array fields. NEVER use ".", "..", "N/A", "NA", "n/a", "not mentioned", ' +
    '"not stated", "none", "null", "unknown", "not applicable", "not available", or any other ' +
    'placeholder text. Only "" and [] are acceptable for absent information. ' +

    '(2) SYMPTOMS: List each symptom as a SEPARATE array item. When the patient mentions ' +
    'multiple symptoms joined by "and" or commas (e.g. "fever, cold and cough"), split them ' +
    'into individual items: ["fever", "cold", "cough"]. Use lowercase. Do NOT combine multiple ' +
    'symptoms into a single string. Do NOT invent symptoms not stated. ' +

    '(3) OBSERVATIONS: Record factual clinical measurements and findings explicitly stated ' +
    '(e.g. "temperature 101 degrees Fahrenheit"). Do NOT interpret measurements as diagnoses. ' +
    'A temperature reading is an observation, not an assessment. ' +

    '(4) ASSESSMENT: Use "" unless a clinician/doctor EXPLICITLY stated a diagnosis or ' +
    'clinical impression (e.g. "the doctor said this is X"). A patient requesting medicine ' +
    'is NOT an assessment. A temperature reading is NOT an assessment. ' +

    '(5) MEDICATIONS: Use [] unless a specific medication was EXPLICITLY named. ' +
    'A patient asking for medicine is NOT a medication mention. ' +

    '(6) HISTORY: Use "" unless past medical history was explicitly described. ' +

    '(7) FOLLOW-UP: Use "" unless follow-up instructions were explicitly given. ' +
    'A patient requesting follow-up is NOT a follow-up instruction. ' +

    '(8) MISSING INFORMATION: Only flag fields that are genuinely absent from the transcript. ' +
    'If the patient stated their age, do NOT include "age" in missing_information. ' +
    'If the patient stated their name, do NOT include "patient name" in missing_information. ' +
    'Typical fields to check: patient name, age, sex, chief complaint, duration, history, ' +
    'observations, assessment, medications, follow-up. ' +

    '(9) Do NOT diagnose, prescribe, recommend treatment, or make medical decisions.',

  inputSchema: {
    json: {
      type: 'object',
      properties: {
        patient: {
          type: 'object',
          description: 'Patient demographics. Use "" for unknown strings, null for unknown age.',
          properties: {
            name: {
              type: 'string',
              description:
                'Patient name if EXPLICITLY stated. Use "" if not stated. ' +
                'NEVER use "." or "N/A" or any placeholder.',
            },
            age: {
              type: ['number', 'null'],
              description: 'Patient age as a number if explicitly stated. null if absent.',
            },
            sex: {
              type: 'string',
              description:
                'Patient biological sex or gender if explicitly stated. ' +
                'Use "" if not stated. NEVER use a placeholder.',
            },
          },
          required: ['name', 'age', 'sex'],
        },

        chief_complaint: {
          type: 'string',
          description:
            'A concise statement of the primary reason the patient is seeking care. ' +
            'CONSTRUCTION RULES: ' +
            '(a) If the patient explicitly states a reason (e.g. "I have fever"), ' +
            'construct it from their stated symptoms and duration. ' +
            'Example: patient says "I have fever for 10 days and also cough and cold" → ' +
            'chief_complaint = "Fever for 10 days with cough and cold". ' +
            '(b) Use only symptoms and durations EXPLICITLY stated — do NOT infer a diagnosis. ' +
            '(c) Do NOT add severity, cause, or medical interpretation not in the transcript. ' +
            '(d) Use "" ONLY when the transcript contains no symptoms or reason whatsoever.',
        },

        symptoms: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Each symptom as a SEPARATE lowercase string. ' +
            'Split comma/and-separated symptom lists into individual items. ' +
            'Use [] if no symptoms were mentioned.',
        },

        duration: {
          type: 'string',
          description:
            'Duration or onset of the main symptom(s) exactly as stated. ' +
            '"fever for ten days" or "cough for two weeks". ' +
            'Use "" if not stated. NEVER use a placeholder.',
        },

        history: {
          type: 'string',
          description:
            'Relevant past medical history EXPLICITLY mentioned. ' +
            'Use "" if not mentioned. NEVER invent or infer.',
        },

        observations: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Clinical observations or measurements EXPLICITLY stated. ' +
            'Include temperature readings, vital signs, and examination findings. ' +
            'A temperature reading is an OBSERVATION, not an assessment or diagnosis. ' +
            'Use [] if none were stated.',
        },

        assessment: {
          type: 'string',
          description:
            'Clinical impression or diagnosis ONLY if a clinician EXPLICITLY stated one ' +
            '(e.g. "the doctor said this is an upper respiratory infection"). ' +
            'Use "" if no assessment was stated by a clinician. ' +
            'NEVER generate, infer, or add your own assessment. ' +
            'Temperature readings are NOT an assessment.',
        },

        medications_mentioned: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Specific medications EXPLICITLY named in the transcript. ' +
            'A patient asking for medicine is NOT a medication mention. ' +
            'Use [] if no specific medication was named.',
        },

        follow_up: {
          type: 'string',
          description:
            'Follow-up instructions ONLY if explicitly given by a clinician. ' +
            'A patient requesting follow-up is NOT a follow-up instruction. ' +
            'Use "" if not stated.',
        },

        missing_information: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Field names that are genuinely absent from the transcript. ' +
            'ONLY flag fields the patient/clinician did NOT mention. ' +
            'Do NOT flag a field that was stated in the transcript. ' +
            'Common items: "patient name", "patient age", "patient sex", ' +
            '"chief complaint", "duration", "history", "observations", ' +
            '"assessment", "medications", "follow-up instructions". ' +
            'Use [] if no information is missing.',
        },

        uncertain_fields: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Field names where the value is genuinely ambiguous or only partially stated. ' +
            'Only include when the transcript is genuinely unclear. Use [] if nothing is uncertain.',
        },
      },

      required: [
        'patient', 'chief_complaint', 'symptoms', 'duration', 'history',
        'observations', 'assessment', 'medications_mentioned', 'follow_up',
        'missing_information', 'uncertain_fields',
      ],
    },
  },
};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================
const SYSTEM_PROMPT = [
  {
    text:
      'You are a medical transcription assistant. Your ONLY job is to extract ' +
      'information EXPLICITLY present in the transcript. ' +

      '\n\nABSOLUTE RULES:' +
      '\n1. Use "" for absent string fields. Use [] for absent array fields.' +
      '\n2. NEVER use ".", "N/A", "NA", "not mentioned", "not stated", "none", ' +
      '"null", "unknown", or any placeholder text.' +
      '\n3. CHIEF COMPLAINT: Construct from explicitly stated symptoms and duration. ' +
      'If the patient says "I have fever for 10 days and cough and cold", write ' +
      '"Fever for 10 days with cough and cold". ' +
      'Only use "" if the transcript contains no symptoms or reason at all. ' +
      'Do NOT diagnose — use the patient\'s own symptom words.' +
      '\n4. SYMPTOMS: Split symptom lists into individual array items. ' +
      '"fever, cold and cough" → ["fever", "cold", "cough"].' +
      '\n5. OBSERVATIONS: Vital signs and measurements (e.g. temperature 101°F) ' +
      'go into observations[], NOT assessment.' +
      '\n6. ASSESSMENT: Only fill if a clinician explicitly stated a clinical impression. ' +
      'A temperature reading is NOT an assessment.' +
      '\n7. MEDICATIONS: Only fill if a specific drug name was mentioned. ' +
      'Asking for medicine is not a medication mention.' +
      '\n8. MISSING INFO: Only flag genuinely absent fields. If age was stated, ' +
      'do NOT flag age as missing. If chief_complaint was constructed from symptoms, ' +
      'do NOT flag it as missing.' +
      '\n9. NEVER invent, infer, diagnose, prescribe, or recommend treatment.' +

      '\n\nCall the extract_clinical_note tool with exactly what was stated.',
  },
];

// ============================================================================
// POST-PROCESSING NORMALIZER
// ============================================================================

/**
 * Pattern matching placeholder-only string values.
 * Any trimmed value matching this is replaced with "".
 */
const PLACEHOLDER_RE = new RegExp(
  [
    '^[.\\s]+$',          // "." "..." "  .  "
    '^n\\/?a$',           // "N/A" "NA" "n/a" "na"
    '^not\\s+mentioned$',
    '^not\\s+stated$',
    '^not\\s+applicable$',
    '^not\\s+available$',
    '^not\\s+provided$',
    '^not\\s+recorded$',
    '^none$',
    '^null$',
    '^unknown$',
    '^unspecified$',
    '^n\\/a$',
  ].join('|'),
  'i'
)

function normalizeString(v) {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  return PLACEHOLDER_RE.test(s) ? '' : s
}

function normalizeArray(v) {
  if (!Array.isArray(v)) return []
  return v.map(normalizeString).filter(Boolean)
}

/**
 * Symptom normalizer.
 *
 * The model sometimes returns ["fever, cold and cough"] as a single string
 * instead of ["fever", "cold", "cough"].
 * This splits any comma/and-separated items that look like symptom lists
 * into individual entries, lowercases each, and deduplicates.
 *
 * Splitting is only done on clear conjunctions. We do NOT split phrases
 * that would change meaning (e.g. "shortness of breath" stays intact).
 */
function normalizeSymptoms(symptoms) {
  if (!Array.isArray(symptoms)) return []

  const expanded = []
  for (const item of symptoms) {
    const s = normalizeString(item)
    if (!s) continue

    // Only split if the item looks like a flat list (short words separated by
    // comma/and — no multi-word phrases with internal spaces beyond 3 words).
    // Strategy: split on ", " or " and " boundaries, then keep results that
    // are short enough to be individual symptoms (≤ 4 words each).
    const parts = s
      .split(/,\s*|\s+and\s+/i)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)

    // Only accept the split if every resulting part is ≤ 4 words
    // (guards against accidentally splitting "shortness of breath and fatigue" wrong)
    const allShort = parts.every((p) => p.split(' ').length <= 4)

    if (parts.length > 1 && allShort) {
      expanded.push(...parts)
    } else {
      expanded.push(s.toLowerCase())
    }
  }

  // Deduplicate (case-insensitive)
  const seen = new Set()
  return expanded.filter((item) => {
    const k = item.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Observation normalizer.
 * Lowercases for consistency; preserves exact numeric values (e.g. "101°F").
 */
function normalizeObservations(observations) {
  return normalizeArray(observations).map((o) => {
    // Preserve numbers/units exactly; only lowercase alphabetic words
    return o.replace(/[a-zA-Z]+/g, (w) => w.toLowerCase())
  })
}

/**
 * Recompute missing_information from the normalized note.
 *
 * The model often under-reports or over-reports missing fields.
 * This function derives missing fields deterministically from the note
 * content itself, making it immune to model hallucination.
 *
 * Returns a sorted, deduplicated array of human-readable field names.
 */
function recomputeMissingInformation(note) {
  const missing = []

  if (!note.patient?.name)         missing.push('patient name')
  if (note.patient?.age === null || note.patient?.age === undefined)
                                   missing.push('patient age')
  if (!note.patient?.sex)          missing.push('patient sex')
  if (!note.chief_complaint)       missing.push('chief complaint')
  if (!note.duration)              missing.push('duration / onset')
  if (!note.history)               missing.push('relevant history')
  if (note.observations.length === 0) missing.push('clinical observations')
  if (!note.assessment)            missing.push('assessment')
  if (note.medications_mentioned.length === 0) missing.push('medications')
  if (!note.follow_up)             missing.push('follow-up instructions')

  return missing
}

/**
 * Apply all normalization rules to the raw Bedrock output.
 * This is the single authoritative post-processing step.
 */
function normalizeNote(raw) {
  // Step 1 — basic field normalization
  const note = {
    patient: {
      name: normalizeString(raw.patient?.name),
      age:  (
        raw.patient?.age !== null &&
        raw.patient?.age !== undefined &&
        raw.patient?.age !== '' &&
        !isNaN(Number(raw.patient?.age)) &&
        Number(raw.patient?.age) > 0   // 0 is not a valid patient age — treat as absent
      ) ? Number(raw.patient.age) : null,
      sex: normalizeString(raw.patient?.sex),
    },
    chief_complaint:       normalizeString(raw.chief_complaint),
    symptoms:              normalizeSymptoms(raw.symptoms),
    duration:              normalizeString(raw.duration),
    history:               normalizeString(raw.history),
    observations:          normalizeObservations(raw.observations),
    assessment:            normalizeString(raw.assessment),
    medications_mentioned: normalizeArray(raw.medications_mentioned),
    follow_up:             normalizeString(raw.follow_up),
    // uncertain_fields comes from the model (can be empty)
    uncertain_fields:      normalizeArray(raw.uncertain_fields),
  }

  // Step 2 — recompute missing_information deterministically
  note.missing_information = recomputeMissingInformation(note)

  return note
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Calls Amazon Bedrock Nova Lite via the Converse API to extract a structured
 * clinical note from a raw transcript string.
 *
 * @param {string} transcript - Raw transcript text from Amazon Transcribe.
 * @returns {Promise<object>} Normalised structured clinical note.
 */
async function extractClinicalNote(transcript) {
  if (!transcript || typeof transcript !== 'string') {
    throw new Error('transcript must be a non-empty string')
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
              'Use "" for absent strings and [] for absent arrays. ' +
              'Split symptom lists into individual array items. ' +
              'For chief_complaint: if the patient states symptoms (e.g. "fever for 10 days ' +
              'and cough"), construct a brief complaint from those symptoms ' +
              '(e.g. "Fever for 10 days with cough"). Do NOT diagnose. ' +
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
  })

  const response = await bedrockClient.send(command)

  const outputMessage = response.output?.message
  if (!outputMessage) throw new Error('Bedrock returned no output message')

  const toolUseBlock = outputMessage.content?.find(
    (block) => block.toolUse?.name === NOTE_TOOL_SPEC.name
  )
  if (!toolUseBlock) {
    throw new Error(`Bedrock response did not contain a "${NOTE_TOOL_SPEC.name}" tool use block`)
  }

  const rawNote = toolUseBlock.toolUse.input
  if (!rawNote || typeof rawNote !== 'object') {
    throw new Error('Bedrock tool use input was empty or not an object')
  }

  const note = normalizeNote(rawNote)

  console.log('[bedrockService] raw  :', JSON.stringify(rawNote))
  console.log('[bedrockService] norm :', JSON.stringify(note))

  return note
}

module.exports = { extractClinicalNote, normalizeNote, recomputeMissingInformation }
