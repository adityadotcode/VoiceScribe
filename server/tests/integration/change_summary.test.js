'use strict';

/**
 * Phase 4B — POST /api/patients/:id/change-summary  integration tests
 *
 * Strategy: identical to Phase 3A — all models mocked via jest.mock,
 * real JWT tokens, no real DB.
 *
 * Scenarios (11):
 *  1.  unauthenticated request → 401
 *  2.  invalid patient ObjectId → 400
 *  3.  missing currentConsultationId → 400
 *  4.  invalid currentConsultationId ObjectId → 400
 *  5.  patient owned by another user → 404
 *  6.  consultation owned by another user → 404
 *  7.  consultation belonging to another patient → 404
 *  8.  no previous approved consultation → { hasPreviousConsultation: false }
 *  9.  previous approved consultation exists → correct diff returned
 * 10.  superseded consultation is not selected as previous
 * 11.  client-supplied userId in body is ignored; req.user.id is used
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

/** lean()-chainable mock query (Patient.findOne, Consultation.findOne simple) */
function leanResult(value) {
  return { lean: () => Promise.resolve(value) };
}

/**
 * Chainable mock for:
 *   Consultation.findOne(...).sort(...).select(...).lean()
 * Used for the previous-consultation query.
 */
function findOneChain(value) {
  return {
    sort:   () => ({ select: () => ({ lean: () => Promise.resolve(value) }) }),
  };
}

// ---------------------------------------------------------------------------
// Shared IDs and tokens
// ---------------------------------------------------------------------------

const ID_A  = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // Doctor A
const ID_B  = 'bbbbbbbbbbbbbbbbbbbbbbbb'; // Doctor B
const PID_1 = '111111111111111111111111'; // Patient owned by Doctor A
const CID_1 = '222222222222222222222222'; // Current consultation
const CID_2 = '333333333333333333333333'; // Previous consultation

const tokenA = makeToken(ID_A, 'doctora@example.com');
const tokenB = makeToken(ID_B, 'doctorb@example.com');

/** Minimal patient document owned by Doctor A */
function makePatient(overrides = {}) {
  return {
    _id:        { toString: () => PID_1 },
    userId:     ID_A,
    firstName:  'Alice',
    lastName:   'Smith',
    isArchived: false,
    ...overrides,
  };
}

/** Minimal current consultation owned by Doctor A, belonging to PID_1 */
function makeCurrentConsultation(overrides = {}) {
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
    ...overrides,
  };
}

/** Minimal previous approved consultation owned by Doctor A, belonging to PID_1 */
function makePreviousConsultation(overrides = {}) {
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
    ...overrides,
  };
}

const BASE_URL = `/api/patients/${PID_1}/change-summary`;
const BODY     = { currentConsultationId: CID_1 };

// ---------------------------------------------------------------------------
// 1 — Unauthenticated
// ---------------------------------------------------------------------------
describe('POST /api/patients/:id/change-summary', () => {
  test('1. unauthenticated request → 401', async () => {
    const res = await request(app)
      .post(BASE_URL)
      .send(BODY);
    expect(res.status).toBe(401);
  });

  // ── Input validation ─────────────────────────────────────────────────────

  test('2. invalid patient ObjectId → 400', async () => {
    const res = await request(app)
      .post('/api/patients/not-an-id/change-summary')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(BODY);
    expect(res.status).toBe(400);
  });

  test('3. missing currentConsultationId → 400', async () => {
    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/currentConsultationId is required/i);
  });

  test('4. invalid currentConsultationId ObjectId → 400', async () => {
    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: 'bad-id' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not a valid ID/i);
  });

  // ── Authorization ────────────────────────────────────────────────────────

  test('5. patient owned by another user → 404', async () => {
    // Doctor B's query finds nothing for Doctor A's patient
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenB}`)
      .send(BODY);

    expect(res.status).toBe(404);
    // Query must include Doctor B's userId
    expect(Patient.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_B })
    );
  });

  test('6. consultation owned by another user → 404', async () => {
    // Patient exists for Doctor A; consultation lookup returns null for Doctor B
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient({ userId: ID_B })));
    Consultation.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenB}`)
      .send(BODY);

    expect(res.status).toBe(404);
  });

  test('7. consultation belonging to another patient → 404', async () => {
    // Consultation query includes patientId filter — mismatch returns null
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(BODY);

    expect(res.status).toBe(404);

    // Confirm the Consultation query included patientId
    expect(Consultation.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: PID_1 })
    );
  });

  // ── No-previous-consultation path ────────────────────────────────────────

  test('8. no previous approved consultation → { hasPreviousConsultation: false }', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    // Current consultation found
    Consultation.findOne.mockReturnValueOnce(leanResult(makeCurrentConsultation()));
    // Previous consultation query: no result
    Consultation.findOne.mockReturnValueOnce(findOneChain(null));

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(BODY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hasPreviousConsultation).toBe(false);
    expect(res.body.previousConsultation).toBeNull();
    expect(res.body.structuredDiff).toBeNull();
  });

  // ── Successful diff path ─────────────────────────────────────────────────

  test('9. previous approved consultation exists → correct diff returned', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.findOne.mockReturnValueOnce(leanResult(makeCurrentConsultation()));
    Consultation.findOne.mockReturnValueOnce(findOneChain(makePreviousConsultation()));

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(BODY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hasPreviousConsultation).toBe(true);
    expect(res.body.previousConsultation).toBeDefined();

    const diff = res.body.structuredDiff;
    expect(diff).toBeDefined();

    // Current has 'fatigue' and 'paracetamol'; previous did not → these are "new"
    expect(diff.newSymptoms).toContain('fatigue');
    expect(diff.newMedicationsMentioned).toContain('paracetamol');
    // 'cough' was in both → persisting
    expect(diff.persistingSymptoms).toContain('cough');
    // assessment changed: '' → 'Likely viral URTI'
    expect(diff.assessmentChanged).toBe(true);
    // Diff result always has all expected keys
    expect(diff).toHaveProperty('resolvedSymptoms');
    expect(diff).toHaveProperty('stoppedMedicationsMentioned');
    expect(diff).toHaveProperty('newObservations');
    expect(diff).toHaveProperty('resolvedObservations');
    expect(diff).toHaveProperty('chiefComplaintChanged');
    expect(diff).toHaveProperty('followUpChanged');
    expect(diff).toHaveProperty('historyChanged');
  });

  // ── Correction-aware selection ────────────────────────────────────────────

  test('10. previous-consultation query excludes superseded originals', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.findOne.mockReturnValueOnce(leanResult(makeCurrentConsultation()));
    // Phase 5D: query uses { supersededBy: null } — correctionOf is no longer
    // filtered so that approved corrections are valid comparison bases.
    Consultation.findOne.mockReturnValueOnce(findOneChain(null));

    await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(BODY);

    // Second findOne call is the previousConsultation query
    const prevCall = Consultation.findOne.mock.calls[1][0];
    expect(prevCall).toMatchObject({
      supersededBy: null,
      status:       'approved',
    });
    // correctionOf must NOT appear (Phase 5D fix)
    expect(prevCall).not.toHaveProperty('correctionOf');
  });

  // ── Security: userId from token only ────────────────────────────────────

  test('11. client-supplied userId in body is ignored; req.user.id is used', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.findOne.mockReturnValueOnce(leanResult(makeCurrentConsultation()));
    Consultation.findOne.mockReturnValueOnce(findOneChain(makePreviousConsultation()));

    await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...BODY, userId: ID_B }); // attacker-supplied userId

    // Both Patient.findOne and the first Consultation.findOne must use ID_A
    expect(Patient.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_A })
    );
    expect(Consultation.findOne.mock.calls[0][0]).toMatchObject({ userId: ID_A });
  });
});
