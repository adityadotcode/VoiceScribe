'use strict';

/**
 * Phase 5B — POST /api/consultations/:id/correct  integration tests
 *
 * Strategy: all models mocked via jest.mock — no real DB, no real AWS.
 * Real JWT tokens from test secrets (setup.js).
 *
 * Scenarios (12):
 *  1.  Unauthenticated request → 401
 *  2.  Invalid source consultation ObjectId → 400
 *  3.  Source consultation not found → 404
 *  4.  Source consultation belongs to another user → 404
 *  5.  Source consultation is a draft → 409 (only approved can be corrected)
 *  6.  Source consultation already superseded → 409
 *  7.  Successful correction — 201, new document has draft status
 *  8.  Successful correction — approval metadata NOT copied (approvedAt/approvedBy null)
 *  9.  Successful correction — correctionOf set to source _id
 * 10.  Successful correction — original supersededBy updated to new _id
 * 11.  Optional override note is accepted when provided
 * 12.  patientId / userId from source are preserved; client cannot override them
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

jest.mock('../../src/models/Consultation', () => ({
  findOne:   jest.fn(),
  find:      jest.fn(),
  create:    jest.fn(),
  aggregate: jest.fn(),
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

// ---------------------------------------------------------------------------
// Shared IDs and tokens
// ---------------------------------------------------------------------------

const ID_A  = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // Doctor A
const ID_B  = 'bbbbbbbbbbbbbbbbbbbbbbbb'; // Doctor B
const PID_1 = '111111111111111111111111'; // Patient
const CID_1 = '222222222222222222222222'; // Source consultation
const CID_2 = '333333333333333333333333'; // New correction document

const tokenA = makeToken(ID_A, 'doctora@example.com');
const tokenB = makeToken(ID_B, 'doctorb@example.com');

const BASE_URL = `/api/consultations/${CID_1}/correct`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A fully-approved source consultation owned by Doctor A.
 * Has a .save() mock so the controller can call source.supersededBy = ... ; save().
 */
function makeApprovedSource(overrides = {}) {
  const doc = {
    _id:              { toString: () => CID_1 },
    userId:           ID_A,
    patientId:        PID_1,
    status:           'approved',
    consultationDate: new Date('2026-09-01'),
    encounterType:    'in_person',
    transcript:       'Patient reports cough.',
    detectedLanguages: [{ code: 'en-IN', duration: 120 }],
    speakerUtterances: [{ speaker: 'spk_0', startTime: 0, endTime: 5, text: 'Hello.' }],
    speakerRoleMapping: { spk_0: 'Patient' },
    note: {
      chief_complaint: 'Cough',
      symptoms: ['cough'],
      medications_mentioned: [],
      observations: [],
      assessment: 'Viral URTI',
      follow_up: 'Return in 1 week',
      history: '',
      // Mongoose sub-documents have a toObject() method
      toObject: function () { return { ...this, toObject: undefined }; },
    },
    approvedAt:  new Date('2026-09-01T10:00:00Z'),
    approvedBy:  ID_A,
    correctionOf: null,
    supersededBy: null,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
  return doc;
}

/**
 * The newly-created correction document returned by Consultation.create().
 */
function makeCorrectionDoc(overrides = {}) {
  return {
    _id:              { toString: () => CID_2 },
    userId:           ID_A,
    patientId:        PID_1,
    status:           'draft',
    consultationDate: new Date('2026-09-01'),
    encounterType:    'in_person',
    transcript:       'Patient reports cough.',
    note:             { chief_complaint: 'Cough' },
    correctionOf:     CID_1,
    supersededBy:     null,
    approvedAt:       null,
    approvedBy:       null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/consultations/:id/correct', () => {

  // ── 1. Unauthenticated ──────────────────────────────────────────────────
  test('1. unauthenticated request → 401', async () => {
    const res = await request(app).post(BASE_URL);
    expect(res.status).toBe(401);
  });

  // ── 2. Invalid ObjectId ─────────────────────────────────────────────────
  test('2. invalid source consultation ObjectId → 400', async () => {
    const res = await request(app)
      .post('/api/consultations/not-a-valid-id/correct')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(400);
  });

  // ── 3. Not found ────────────────────────────────────────────────────────
  test('3. source consultation not found → 404', async () => {
    Consultation.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Consultation not found.');
  });

  // ── 4. Ownership — another user ─────────────────────────────────────────
  test('4. source consultation owned by another user → 404', async () => {
    // Doctor B uses Doctor A's consultation ID — findOne returns null
    // because the query includes userId: ID_B
    Consultation.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    // Confirm the ownership filter used Doctor B's ID
    expect(Consultation.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_B })
    );
  });

  // ── 5. Draft cannot be corrected ────────────────────────────────────────
  test('5. draft source consultation → 409', async () => {
    Consultation.findOne.mockResolvedValueOnce(
      makeApprovedSource({ status: 'draft', approvedAt: null, approvedBy: null })
    );

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Only approved consultations can be corrected/i);
  });

  // ── 6. Already superseded ───────────────────────────────────────────────
  test('6. already superseded approved consultation → 409', async () => {
    Consultation.findOne.mockResolvedValueOnce(
      makeApprovedSource({ supersededBy: 'eeeeeeeeeeeeeeeeeeeeeeee' })
    );

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already been superseded/i);
  });

  // ── 7. Successful correction — draft status ─────────────────────────────
  test('7. successful correction — new document has draft status', async () => {
    const source = makeApprovedSource();
    Consultation.findOne.mockResolvedValueOnce(source);
    Consultation.create.mockResolvedValueOnce(makeCorrectionDoc());

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.consultation.status).toBe('draft');
  });

  // ── 8. Approval metadata NOT copied ────────────────────────────────────
  test('8. approval metadata is not copied into correction', async () => {
    const source = makeApprovedSource();
    Consultation.findOne.mockResolvedValueOnce(source);
    Consultation.create.mockResolvedValueOnce(makeCorrectionDoc());

    await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    const createArg = Consultation.create.mock.calls[0][0];
    expect(createArg.status).toBe('draft');
    expect(createArg.approvedAt).toBeNull();
    expect(createArg.approvedBy).toBeNull();
  });

  // ── 9. correctionOf set to source _id ──────────────────────────────────
  test('9. correctionOf on new document is set to source _id', async () => {
    const source = makeApprovedSource();
    Consultation.findOne.mockResolvedValueOnce(source);
    Consultation.create.mockResolvedValueOnce(makeCorrectionDoc());

    await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    const createArg = Consultation.create.mock.calls[0][0];
    // correctionOf must reference the source document
    expect(createArg.correctionOf.toString()).toBe(CID_1);
  });

  // ── 10. Original supersededBy updated ──────────────────────────────────
  test('10. original consultation supersededBy is updated to correction _id', async () => {
    const source = makeApprovedSource();
    Consultation.findOne.mockResolvedValueOnce(source);
    Consultation.create.mockResolvedValueOnce(makeCorrectionDoc());

    await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    // The controller must have called source.save() after setting supersededBy
    expect(source.save).toHaveBeenCalledTimes(1);
    // supersededBy should point to the newly-created correction
    expect(source.supersededBy.toString()).toBe(CID_2);
  });

  // ── 11. Optional override note ──────────────────────────────────────────
  test('11. optional override note is used when provided', async () => {
    const source = makeApprovedSource();
    Consultation.findOne.mockResolvedValueOnce(source);
    Consultation.create.mockResolvedValueOnce(
      makeCorrectionDoc({ note: { chief_complaint: 'Corrected cough' } })
    );

    const overrideNote = { chief_complaint: 'Corrected cough', symptoms: ['cough', 'wheeze'] };

    await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ note: overrideNote });

    const createArg = Consultation.create.mock.calls[0][0];
    expect(createArg.note).toEqual(overrideNote);
  });

  // ── 12. patientId and userId from source; client cannot override ────────
  test('12. patientId and userId come from source — client body is ignored', async () => {
    const source = makeApprovedSource();
    Consultation.findOne.mockResolvedValueOnce(source);
    Consultation.create.mockResolvedValueOnce(makeCorrectionDoc());

    // Attacker attempts to inject different ownership
    await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ userId: ID_B, patientId: 'ffffffffffffffffffffffff' });

    const createArg = Consultation.create.mock.calls[0][0];
    // userId must come from the verified token (ID_A)
    expect(createArg.userId).toBe(ID_A);
    // patientId must come from the source document
    expect(createArg.patientId).toBe(PID_1);
  });
});
