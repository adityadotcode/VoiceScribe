'use strict';

/**
 * Phase 4D.1 — Bedrock narrative generation tests
 *
 * Tests for the optional generateNarrative flag on
 * POST /api/patients/:id/change-summary
 *
 * Strategy:
 *   - All models mocked via jest.mock (no real DB).
 *   - bedrockService mocked — no real AWS calls.
 *   - Real JWT tokens from setup.js.
 *
 * Scenarios (10):
 *  1.  generateNarrative omitted → Bedrock NOT called, response has no narrative fields
 *  2.  generateNarrative: false → Bedrock NOT called
 *  3.  generateNarrative: true + no previous consultation → Bedrock NOT called
 *  4.  generateNarrative: true + valid comparison → Bedrock IS called
 *  5.  structuredDiff is passed to Bedrock (via narrative function args)
 *  6.  Bedrock response text becomes clinicalSummary in the response
 *  7.  Bedrock failure → structuredDiff still returned, narrativeError present
 *  8.  Internal Bedrock error details not exposed to client
 *  9.  Phase 4B behavior unchanged when generateNarrative omitted
 * 10.  generatedAt ISO timestamp present on success
 */

const request = require('supertest');

// ---------------------------------------------------------------------------
// Mocks — declared before requiring app
// ---------------------------------------------------------------------------

jest.mock('../../src/models/Patient', () => ({
  findOne: jest.fn(),
  find:    jest.fn(),
  create:  jest.fn(),
}));
const Patient = require('../../src/models/Patient');

jest.mock('../../src/models/Consultation', () => ({
  findOne: jest.fn(),
  find:    jest.fn(),
  create:  jest.fn(),
}));
const Consultation = require('../../src/models/Consultation');

// Mock bedrockService — no real AWS calls in tests.
// We mock the whole module so the BedrockRuntimeClient is never instantiated.
jest.mock('../../src/services/bedrockService', () => ({
  extractClinicalNote:           jest.fn(),
  normalizeNote:                 jest.fn(),
  recomputeMissingInformation:   jest.fn(),
  generateChangeSummaryNarrative: jest.fn(),
}));
const { generateChangeSummaryNarrative } = require('../../src/services/bedrockService');

// ---------------------------------------------------------------------------
// App + helpers
// ---------------------------------------------------------------------------

let app;
beforeAll(() => { app = require('../../src/app'); });
beforeEach(() => jest.clearAllMocks());

function makeToken(userId, email = 'doc@example.com', role = 'doctor') {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ sub: userId, email, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

function leanResult(value) {
  return { lean: () => Promise.resolve(value) };
}

function findOneChain(value) {
  return {
    sort: () => ({ select: () => ({ lean: () => Promise.resolve(value) }) }),
  };
}

// ---------------------------------------------------------------------------
// Shared IDs and tokens
// ---------------------------------------------------------------------------

const ID_A  = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PID_1 = '111111111111111111111111';
const CID_1 = '222222222222222222222222';
const CID_2 = '333333333333333333333333';

const tokenA = makeToken(ID_A, 'doctora@example.com');

function makePatient() {
  return { _id: { toString: () => PID_1 }, userId: ID_A, isArchived: false };
}

function makeCurrentConsultation() {
  return {
    _id:              { toString: () => CID_1 },
    userId:           ID_A,
    patientId:        PID_1,
    status:           'draft',
    consultationDate: new Date('2026-09-15'),
    note: {
      chief_complaint:       'persistent cough',
      symptoms:              ['cough', 'fatigue'],
      medications_mentioned: ['paracetamol'],
      observations:          [],
      assessment:            'Likely viral URTI',
      follow_up:             'Return in 1 week',
      history:               '',
    },
  };
}

function makePreviousConsultation() {
  return {
    _id:              { toString: () => CID_2 },
    userId:           ID_A,
    patientId:        PID_1,
    status:           'approved',
    consultationDate: new Date('2026-08-01'),
    correctionOf:     null,
    supersededBy:     null,
    note: {
      chief_complaint:       'cough',
      symptoms:              ['cough'],
      medications_mentioned: [],
      observations:          [],
      assessment:            '',
      follow_up:             '',
      history:               '',
    },
  };
}

const BASE_URL = `/api/patients/${PID_1}/change-summary`;

// ---------------------------------------------------------------------------
// Helpers that set up the three required mock calls for a full diff path
// ---------------------------------------------------------------------------
function setupMocksForFullDiff() {
  Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
  Consultation.findOne.mockReturnValueOnce(leanResult(makeCurrentConsultation()));
  Consultation.findOne.mockReturnValueOnce(findOneChain(makePreviousConsultation()));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/patients/:id/change-summary — Bedrock narrative', () => {

  // ── 1. generateNarrative omitted → Bedrock NOT called ───────────────────
  test('1. generateNarrative omitted → Bedrock NOT called', async () => {
    setupMocksForFullDiff();

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_1 }); // no generateNarrative key

    expect(res.status).toBe(200);
    expect(generateChangeSummaryNarrative).not.toHaveBeenCalled();
    // Narrative fields must be absent — not null, not present
    expect(res.body).not.toHaveProperty('clinicalSummary');
    expect(res.body).not.toHaveProperty('generatedAt');
    expect(res.body).not.toHaveProperty('narrativeError');
  });

  // ── 2. generateNarrative: false → Bedrock NOT called ────────────────────
  test('2. generateNarrative: false → Bedrock NOT called', async () => {
    setupMocksForFullDiff();

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_1, generateNarrative: false });

    expect(res.status).toBe(200);
    expect(generateChangeSummaryNarrative).not.toHaveBeenCalled();
    expect(res.body).not.toHaveProperty('clinicalSummary');
  });

  // ── 3. generateNarrative: true + no previous → Bedrock NOT called ───────
  test('3. generateNarrative: true + no previous consultation → Bedrock NOT called', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.findOne.mockReturnValueOnce(leanResult(makeCurrentConsultation()));
    Consultation.findOne.mockReturnValueOnce(findOneChain(null)); // no previous

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_1, generateNarrative: true });

    expect(res.status).toBe(200);
    expect(res.body.hasPreviousConsultation).toBe(false);
    expect(generateChangeSummaryNarrative).not.toHaveBeenCalled();
    // clinicalSummary present but null, with a narrativeError message
    expect(res.body.clinicalSummary).toBeNull();
    expect(typeof res.body.narrativeError).toBe('string');
  });

  // ── 4. generateNarrative: true + valid comparison → Bedrock called ──────
  test('4. generateNarrative: true + valid comparison → Bedrock IS called', async () => {
    setupMocksForFullDiff();
    generateChangeSummaryNarrative.mockResolvedValueOnce('Test narrative output.');

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_1, generateNarrative: true });

    expect(res.status).toBe(200);
    expect(generateChangeSummaryNarrative).toHaveBeenCalledTimes(1);
  });

  // ── 5. structuredDiff passed to Bedrock ──────────────────────────────────
  test('5. structuredDiff is passed to Bedrock as third argument', async () => {
    setupMocksForFullDiff();
    generateChangeSummaryNarrative.mockResolvedValueOnce('Narrative.');

    await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_1, generateNarrative: true });

    const args = generateChangeSummaryNarrative.mock.calls[0];
    // args[0] = previousNote, args[1] = currentNote, args[2] = structuredDiff
    const structuredDiff = args[2];
    expect(structuredDiff).toBeDefined();
    // structuredDiff must have diff service output shape
    expect(structuredDiff).toHaveProperty('newSymptoms');
    expect(structuredDiff).toHaveProperty('persistingSymptoms');
    expect(structuredDiff).toHaveProperty('assessmentChanged');
    // fatigue is new in the current note
    expect(structuredDiff.newSymptoms).toContain('fatigue');
  });

  // ── 6. Bedrock response becomes clinicalSummary ──────────────────────────
  test('6. Bedrock response text becomes clinicalSummary in response', async () => {
    setupMocksForFullDiff();
    generateChangeSummaryNarrative.mockResolvedValueOnce('Patient presents with new fatigue.');

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_1, generateNarrative: true });

    expect(res.body.clinicalSummary).toBe('Patient presents with new fatigue.');
    expect(typeof res.body.generatedAt).toBe('string');
  });

  // ── 7. Bedrock failure → structuredDiff still returned ───────────────────
  test('7. Bedrock failure → structuredDiff still returned, narrativeError present', async () => {
    setupMocksForFullDiff();
    generateChangeSummaryNarrative.mockRejectedValueOnce(
      new Error('BedrockRuntimeClient: connection timeout')
    );

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_1, generateNarrative: true });

    expect(res.status).toBe(200);
    // Structured diff must still be present
    expect(res.body.structuredDiff).toBeDefined();
    expect(res.body.structuredDiff).toHaveProperty('newSymptoms');
    // clinicalSummary is null on failure
    expect(res.body.clinicalSummary).toBeNull();
    // narrativeError is present
    expect(typeof res.body.narrativeError).toBe('string');
    expect(res.body.narrativeError).toMatch(/unable to generate clinical summary/i);
  });

  // ── 8. Internal Bedrock error details not exposed ────────────────────────
  test('8. internal Bedrock error details are NOT exposed to client', async () => {
    setupMocksForFullDiff();
    generateChangeSummaryNarrative.mockRejectedValueOnce(
      new Error('BedrockRuntimeClient: connection timeout — secret internal message')
    );

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_1, generateNarrative: true });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('BedrockRuntimeClient');
    expect(body).not.toContain('secret internal message');
    expect(body).not.toContain('connection timeout');
  });

  // ── 9. Phase 4B behavior unchanged ──────────────────────────────────────
  test('9. Phase 4B behavior unchanged — no generateNarrative → same shape as before', async () => {
    setupMocksForFullDiff();

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hasPreviousConsultation).toBe(true);
    expect(res.body.previousConsultation).toBeDefined();
    expect(res.body.structuredDiff).toBeDefined();
    // Exactly the Phase 4B keys and no more
    expect(res.body).not.toHaveProperty('clinicalSummary');
    expect(res.body).not.toHaveProperty('generatedAt');
    expect(res.body).not.toHaveProperty('narrativeError');
  });

  // ── 10. generatedAt is ISO timestamp ────────────────────────────────────
  test('10. generatedAt is a valid ISO timestamp when Bedrock succeeds', async () => {
    setupMocksForFullDiff();
    generateChangeSummaryNarrative.mockResolvedValueOnce('Narrative text.');

    const before = new Date();

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_1, generateNarrative: true });

    const after = new Date();

    expect(typeof res.body.generatedAt).toBe('string');
    const ts = new Date(res.body.generatedAt);
    expect(isNaN(ts.getTime())).toBe(false); // is a valid date
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
});
