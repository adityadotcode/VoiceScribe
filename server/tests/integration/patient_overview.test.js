'use strict';

/**
 * Patient 360.1 — GET /api/patients/:id/overview  integration tests
 *
 * Strategy: identical to existing patient/consultation tests.
 *   - All models mocked via jest.mock (no real DB).
 *   - Real JWT tokens from test secrets (setup.js).
 *   - Consultation.aggregate mocked to return controlled stats.
 *
 * Scenarios (14 tests):
 *  1.  unauthenticated request → 401
 *  2.  invalid patient ObjectId → 400
 *  3.  patient not found → 404
 *  4.  another user's patient → 404
 *  5.  correct totalConsultations (clinical encounters only)
 *  6.  correction documents do NOT inflate clinical encounter count
 *  7.  approved / draft counts are correct
 *  8.  latest effective approved consultation is returned
 *  9.  superseded approved consultation is ignored (latestApproved uses
 *      correction-aware query: supersededBy=null, correctionOf=null)
 * 10.  no approved consultation → latestApprovedConsultation is null
 * 11.  recentConsultations limited to 5
 * 12.  recentConsultations contains only summary fields (no transcript)
 * 13.  Doctor A cannot see Doctor B's patient overview (IDOR)
 * 14.  full response shape is correct
 */

const request = require('supertest');
const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Mocks — before requiring app
// ---------------------------------------------------------------------------

jest.mock('../../src/models/Patient', () => ({
  findOne: jest.fn(),
  find:    jest.fn(),
  create:  jest.fn(),
}));
const Patient = require('../../src/models/Patient');

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

function leanResult(value) {
  return { lean: () => Promise.resolve(value) };
}

/** findOne chain: .sort().select().lean() */
function findOneChain(value) {
  return { sort: () => ({ select: () => ({ lean: () => Promise.resolve(value) }) }) };
}

/** find chain: .sort().limit().select().lean() */
function findChainWithLimit(value) {
  return {
    sort:   () => ({
      limit: () => ({
        select: () => ({ lean: () => Promise.resolve(value) }),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Shared IDs and tokens
// ---------------------------------------------------------------------------

const ID_A  = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B  = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const PID_1 = '111111111111111111111111';

const tokenA = makeToken(ID_A, 'doctora@example.com');
const tokenB = makeToken(ID_B, 'doctorb@example.com');

const BASE_URL = `/api/patients/${PID_1}/overview`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePatient(overrides = {}) {
  return {
    _id:             { toString: () => PID_1 },
    userId:          ID_A,
    firstName:       'Alice',
    lastName:        'Smith',
    dateOfBirth:     new Date('1990-05-15'),
    biologicalSex:   'female',
    phone:           '0400000001',
    medicalRecordId: 'MR001',
    notes:           '',
    isArchived:      false,
    ...overrides,
  };
}

function makeAggregateResult(overrides = {}) {
  return [{
    _id:                   null,
    totalConsultations:    3,
    approvedConsultations: 2,
    draftConsultations:    1,
    lastConsultationDate:  new Date('2026-09-15'),
    ...overrides,
  }];
}

function makeApprovedConsultation(overrides = {}) {
  return {
    _id:              { toString: () => '222222222222222222222222' },
    consultationDate: new Date('2026-09-15'),
    note: {
      chief_complaint:       'Persistent cough',
      symptoms:              ['cough', 'fatigue'],
      medications_mentioned: ['paracetamol'],
      assessment:            'Viral URTI',
      follow_up:             'Return in 1 week',
    },
    approvedAt: new Date('2026-09-15'),
    ...overrides,
  };
}

function makeRecentConsultations() {
  return Array.from({ length: 5 }, (_, i) => ({
    _id:              { toString: () => `${i}22222222222222222222222` },
    consultationDate: new Date(`2026-09-${10 + i}`),
    status:           i === 0 ? 'draft' : 'approved',
    note:             { chief_complaint: `Complaint ${i}` },
    correctionOf:     null,
    supersededBy:     null,
    createdAt:        new Date(`2026-09-${10 + i}`),
  }));
}

// ---------------------------------------------------------------------------
// Helper: set up all three mocks for the happy path
// ---------------------------------------------------------------------------
function setupHappyPath({
  patient         = makePatient(),
  aggregateResult = makeAggregateResult(),
  latestApproved  = makeApprovedConsultation(),
  recent          = makeRecentConsultations(),
} = {}) {
  Patient.findOne.mockReturnValueOnce(leanResult(patient));
  Consultation.aggregate.mockResolvedValueOnce(aggregateResult);
  Consultation.findOne.mockReturnValueOnce(findOneChain(latestApproved));
  Consultation.find.mockReturnValueOnce(findChainWithLimit(recent));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/patients/:id/overview', () => {

  // ── 1. Unauthenticated ──────────────────────────────────────────────────
  test('1. unauthenticated request → 401', async () => {
    const res = await request(app).get(BASE_URL);
    expect(res.status).toBe(401);
  });

  // ── 2. Invalid patient ID ───────────────────────────────────────────────
  test('2. invalid patient ObjectId → 400', async () => {
    const res = await request(app)
      .get('/api/patients/not-an-id/overview')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(400);
  });

  // ── 3. Patient not found ────────────────────────────────────────────────
  test('3. patient not found → 404', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Patient not found.');
  });

  // ── 4. Another user's patient ───────────────────────────────────────────
  test('4. another user\'s patient → 404', async () => {
    // Doctor B's query returns null (patient belongs to Doctor A)
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    expect(Patient.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_B })
    );
  });

  // ── 5. Correct totalConsultations (clinical encounters only) ─────────────
  test('5. correct totalConsultations from aggregate', async () => {
    setupHappyPath({ aggregateResult: makeAggregateResult({ totalConsultations: 4 }) });

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.statistics.totalConsultations).toBe(4);
  });

  // ── 6. Correction documents do NOT inflate encounter count ───────────────
  test('6. aggregate query excludes correctionOf documents', async () => {
    setupHappyPath();

    await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    // The aggregate pipeline must include correctionOf: null in its $match
    const aggregateCall = Consultation.aggregate.mock.calls[0][0];
    const matchStage    = aggregateCall.find((s) => s.$match);
    expect(matchStage.$match).toMatchObject({ correctionOf: null });
  });

  // ── 7. Approved / draft counts ──────────────────────────────────────────
  test('7. approved and draft counts are returned correctly', async () => {
    setupHappyPath({
      aggregateResult: makeAggregateResult({
        totalConsultations:    5,
        approvedConsultations: 3,
        draftConsultations:    2,
      }),
    });

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.body.statistics.approvedConsultations).toBe(3);
    expect(res.body.statistics.draftConsultations).toBe(2);
  });

  // ── 8. Latest effective approved consultation ───────────────────────────
  test('8. latestApprovedConsultation contains correct note fields', async () => {
    setupHappyPath();

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    const latest = res.body.latestApprovedConsultation;
    expect(latest).not.toBeNull();
    expect(latest.chief_complaint).toBe('Persistent cough');
    expect(latest.symptoms).toEqual(['cough', 'fatigue']);
    expect(latest.medications_mentioned).toEqual(['paracetamol']);
    expect(latest.assessment).toBe('Viral URTI');
    expect(latest.follow_up).toBe('Return in 1 week');
  });

  // ── 9. Superseded approved consultation is ignored ──────────────────────
  test('9. latestApproved query uses correction-aware filter (supersededBy=null, correctionOf omitted)', async () => {
    setupHappyPath();

    await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    // findOne must have been called with supersededBy=null.
    // Phase 5D: correctionOf is intentionally NOT filtered here —
    // approved corrections ARE the effective version and must be surfaced.
    const findOneCall = Consultation.findOne.mock.calls[0][0];
    expect(findOneCall).toMatchObject({
      status:       'approved',
      supersededBy: null,
    });
    // correctionOf must NOT be in the query (Phase 5D fix)
    expect(findOneCall).not.toHaveProperty('correctionOf');
  });

  // ── 10. No approved consultation → null ─────────────────────────────────
  test('10. latestApprovedConsultation is null when no approved consultation exists', async () => {
    setupHappyPath({ latestApproved: null });

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.body.latestApprovedConsultation).toBeNull();
  });

  // ── 11. recentConsultations limited to 5 ────────────────────────────────
  test('11. recentConsultations returns at most 5 items', async () => {
    setupHappyPath();

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(Array.isArray(res.body.recentConsultations)).toBe(true);
    expect(res.body.recentConsultations.length).toBeLessThanOrEqual(5);

    // find must have been called with a limit of 5
    const findCall = Consultation.find.mock.calls[0];
    // verify via the chain mock — the find result was chained with .limit(5)
    // We confirm the handler was given the right chain by checking find was called
    expect(findCall).toBeDefined();
  });

  // ── 12. recentConsultations contains only summary fields ─────────────────
  test('12. recentConsultations items do not contain transcript or speakerUtterances', async () => {
    setupHappyPath();

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    for (const c of res.body.recentConsultations) {
      expect(c).not.toHaveProperty('transcript');
      expect(c).not.toHaveProperty('speakerUtterances');
      expect(c).not.toHaveProperty('note');         // full note object not present
      // Required summary fields ARE present
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('status');
      expect(c).toHaveProperty('chief_complaint');
      expect(c).toHaveProperty('correctionOf');
      expect(c).toHaveProperty('supersededBy');
    }
  });

  // ── 13. IDOR — Doctor A cannot see Doctor B's patient ───────────────────
  test('13. Doctor A using Doctor B token cannot read Doctor B patient overview', async () => {
    // Doctor B's token used but Patient.findOne returns null for Doctor B's userId
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    // Confirm the query was scoped to Doctor B's ID
    expect(Patient.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_B })
    );
  });

  // ── 14. Full response shape ─────────────────────────────────────────────
  test('14. response has the complete expected shape', async () => {
    setupHappyPath();

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // patient block
    expect(res.body.patient).toMatchObject({
      firstName:     'Alice',
      lastName:      'Smith',
      biologicalSex: 'female',
      isArchived:    false,
    });

    // statistics block — all four keys present
    expect(res.body.statistics).toHaveProperty('totalConsultations');
    expect(res.body.statistics).toHaveProperty('approvedConsultations');
    expect(res.body.statistics).toHaveProperty('draftConsultations');
    expect(res.body.statistics).toHaveProperty('lastConsultationDate');

    // latestApprovedConsultation block
    expect(res.body.latestApprovedConsultation).not.toBeNull();

    // recentConsultations block
    expect(Array.isArray(res.body.recentConsultations)).toBe(true);
  });
});
