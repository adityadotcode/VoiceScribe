const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require('@aws-sdk/client-bedrock-runtime');

const { awsRegion } = require('../config/env');

const MODEL_ID = 'amazon.nova-lite-v1:0';

// Client uses the default AWS SDK credential chain (env vars, ~/.aws/credentials,
// IAM role, etc.). No access keys are hard-coded.
const bedrockClient = new BedrockRuntimeClient({ region: awsRegion });

// JSON schema for the structured clinical note.  Nova Lite supports the
// Converse API tool_choice + toolSpec pattern to enforce structured JSON output
// without relying on regex extraction from markdown.
const NOTE_TOOL_SPEC = {
  name: 'extract_clinical_note',
  description:
    'Extract ONLY facts that are explicitly stated in the transcript into a structured clinical note. ' +
    'Do NOT invent, infer, or guess any information that is not directly present in the transcript. ' +
    'Do NOT diagnose, prescribe, recommend treatments, or make any medical decisions. ' +
    'If a field has no information in the transcript, leave it as null, an empty array, or an empty string.',
  inputSchema: {
    json: {
      type: 'object',
      properties: {
        patient: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Patient name if stated, otherwise empty string.',
            },
            age: {
              type: ['number', 'null'],
              description: 'Patient age as a number if stated, otherwise null.',
            },
            sex: {
              type: 'string',
              description: 'Patient sex/gender if stated, otherwise empty string.',
            },
          },
          required: ['name', 'age', 'sex'],
        },
        chief_complaint: {
          type: 'string',
          description: 'Primary reason the patient is seeking care, in their own words.',
        },
        symptoms: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of symptoms explicitly mentioned in the transcript.',
        },
        duration: {
          type: 'string',
          description:
            'Duration or onset of symptoms as stated in the transcript, e.g. "fever for 3 days".',
        },
        history: {
          type: 'string',
          description:
            'Any relevant past medical history or context explicitly mentioned.',
        },
        observations: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Clinical observations or examination findings explicitly described in the transcript.',
        },
        assessment: {
          type: 'string',
          description:
            'Any assessment or impression explicitly stated by the clinician in the transcript. ' +
            'Do NOT add your own clinical assessment.',
        },
        medications_mentioned: {
          type: 'array',
          items: { type: 'string' },
          description: 'Medications explicitly mentioned in the transcript.',
        },
        follow_up: {
          type: 'string',
          description: 'Any follow-up instructions or plans explicitly stated in the transcript.',
        },
        missing_information: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Fields typically required for a clinical note that were NOT mentioned in the transcript.',
        },
        uncertain_fields: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Field names where the extracted value is ambiguous or only partially stated.',
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
      'information that is explicitly present in the provided transcript. ' +
      'You MUST NOT invent symptoms, diagnoses, medications, allergies, patient details, ' +
      'or observations that are not directly stated. ' +
      'You MUST NOT diagnose, prescribe medication, recommend treatment, or make any ' +
      'medical decisions. You will call the extract_clinical_note tool with exactly the ' +
      'facts present in the transcript.',
  },
];

/**
 * Calls Amazon Bedrock Nova Lite via the Converse API to extract a structured
 * clinical note from a raw transcript string.
 *
 * @param {string} transcript - Raw transcript text from Amazon Transcribe.
 * @returns {Promise<object>} Structured clinical note matching NOTE_TOOL_SPEC schema.
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
            text: `Please extract the clinical note from the following transcript:\n\n${transcript}`,
          },
        ],
      },
    ],
    toolConfig: {
      tools: [{ toolSpec: NOTE_TOOL_SPEC }],
      // Force the model to always call our extraction tool so we get clean JSON.
      toolChoice: { tool: { name: NOTE_TOOL_SPEC.name } },
    },
  });

  const response = await bedrockClient.send(command);

  // The Converse API returns tool use blocks when toolChoice is forced.
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

  // toolUse.input is already a parsed JS object — no JSON.parse needed.
  const note = toolUseBlock.toolUse.input;

  if (!note || typeof note !== 'object') {
    throw new Error('Bedrock tool use input was empty or not an object');
  }

  return note;
}

module.exports = { extractClinicalNote };
