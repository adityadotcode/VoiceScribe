'use strict';

/**
 * Phase 5D — Correction Approval and Effective Consultation History
 *
 * Strategy: all models mocked via jest.mock — no real DB, no real AWS.
 * Real JWT tokens from test secrets (setup.js).
 *
 * These tests verify that:
 *   (a) The existing PUT /api/consultations/:id approval flow handles
 *       correction drafts correctly (no second approval mechanism needed).
 *   (b) All effective-history queries (getLastApproved, getChangeSummary,
 *       getPatientOverview) no longer exclude approved corrections.
 *   (c) The aggregate count for clinical encounters still excludes corrections.
 *
 * Scenarios (16):
 *
 *  — Approval flow —
 *  1.  Normal draft approval still works (status → approved, 200)
 *  2.  Correction draft approval works via same PUT endpoint (200)
 *  3.  Approved correction receives approvedAt and approvedBy metadata
 *  4.  Approved correction's correctionOf field is preserved unchanged
 *  5.  Original consultation stays immutable after correction is approved
 *       (PUT on original → 409 already-approved)
 *  6.  Original consultation's supersededBy is NOT modified by approval PUT
 *       (supersededBy was set during createCorrection; approval doesn't touch it)
 *
 *  — getLastApproved: approved correction is effective version —
 *  7.  Approved correction is returned by GET /api/patients/:id/last-approved
 *       (correctionOf is NOT null, supersededBy IS null → should be found)
 *  8.  Superseded original is NOT returned by getLastApproved (supersededBy ≠ null)
 *
 *  — getChangeSummary: approved correction as comparison base —
 *  9.  Approved correction (correctionOf ≠ null, supersededBy = null) IS
 *      selected as the previousConsultation by getChangeSummary
 * 10.  Superseded original (supersededBy ≠ null) is NOT selected as
 *      previousConsultation by getChangeSummary
 *
 *  — getPatientOverview: approved correction as latestApproved —
 * 11.  Approved correction IS returned as latestApprovedConsultation in overview
 * 12.  Superseded original is NOT returned as latestApprovedConsultation
 * 13.  findOne for latestApproved does NOT include correctionOf: null filter
 *
 *  — getPatientOverview: corrections do not inflate encounter count —
 * 14.  Aggregate $match still contains correctionOf: null (corrections not counted)
 * 15.  Patient consultation count does not change when a correction is added
 *
 *  — Integration: end-to-end correction lifecycle —
 * 16.  Full lifecycle: original approved → correction created (draft) →
 *      correction approved → latestApproved returns correction, not original
 */

const request = require('supertest');
const mongoose = require('mongoose');

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

/** Simple lean() chain for Patient.findOne / basic Consultation.findOne */
function leanResult(value) {
  return { lean: () => Promise.resolve(value) };
}

/** findOne → .sort().select().lean() chain */
function findOneChain(value) {
  return { sort: () => ({ select: () => ({ lean: () => Promise.resolve(value) }) }) };
}

/** find → .sort().limit().select().lean() chain */
function findChainWithLimit(value) {
  return {
    sort: () => ({
      limit: () => ({
        select: () => ({ lean: () => Promise.resolve(value) }),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Shared IDs and tokens
// ---------------------------------------------------------------------------

const ID_A  = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // Doctor A
const PID_1 = '111111111111111111111111'; // Patient
const CID_1 = '222222222222222222222222'; // Original consultation
const CID_2 = '333333333333333333333333'; // Correction draft / approved correction

const tokenA = makeToken(ID_A, 'doctora@example.com');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A correction draft (created by POST /correct, awaiting approval) */
function makeCorrectionDraft(overrides = {}) {
  return {
    _id:              CID_2,
    userId:           ID_A,
    patientId:        PID_1,
    status:           'draft',
    consultationDate: new Date('2026-09-01'),
    encounterType:    'in_person',
    correctionOf:     CID_1,   // ← links back to original
    supersededBy:     null,
    approvedAt:       null,
    approvedBy:       null,
    note: {
      chief_complaint: 'Corrected cough',
      symptoms:        ['cough', 'wheeze'],
      medications_mentioned: [],
      observations:    [],
      assessment:      'Revised URTI',
      follow_up:       'Return in 2 weeks',
    },
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

/** An already-approved correction (post-approval state) */
function makeApprovedCorrection(overrides = {}) {
  return {
    _id:              { toString: () => CID_2 },
    userId:           ID_A,
    patientId:        PID_1,
    status:           'approved',
    consultationDate: new Date('2026-09-01'),
    encounterType:    'in_person',
    correctionOf:     CID_1,   // ← this is the key: correctionOf ≠ null
    supersededBy:     null,    // ← not itself replaced → it IS the effective version
    approvedAt:       new Date('2026-09-02T10:00:00Z'),
    approvedBy:       ID_A,
    note: {
      chief_complaint:       'Corrected cough',
      symptoms:              ['cough', 'wheeze'],
      medications_mentioned: [],
      assessment:            'Revised URTI',
      follow_up:             'Return in 2 weeks',
    },
    ...overrides,
  };
}

/** The superseded original (after correction was approved) */
function makeSupersededOriginal(overrides = {}) {
  return {
    _id:              { toString: () => CID_1 },
    userId:           ID_A,
    patientId:        PID_1,
    status:           'approved',
    consultationDate: new Date('2026-09-01'),
    correctionOf:     null,
    supersededBy:     CID_2,   // ← replaced by the correction
    approvedAt:       new Date('2026-09-01T10:00:00Z'),
    approvedBy:       ID_A,
    note: { chief_complaint: 'Original cough' },
    ...overrides,
  };
}

/** Normal draft (no correction relationship) */
function makeNormalDraft(overrides = {}) {
  return {
    _id:              CID_1,
    userId:           ID_A,
    patientId:        PID_1,
    status:           'draft',
    consultationDate: new Date('2026-09-01'),
    encounterType:    'in_person',
    correctionOf:     null,
    supersededBy:     null,
    approvedAt:       null,
    approvedBy:       null,
    note: {
      chief_complaint: 'Cough',
      symptoms:        ['cough'],
      medications_mentioned: [],
      observations:    [],
      assessment:      'URTI',
      follow_up:       'Return in 1 week',
    },
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
    ...overrides,
  };
}

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
    totalConsultations:    2,
    approvedConsultations: 2,
    draftConsultations:    0,
    lastConsultationDate:  new Date('2026-09-01'),
    ...overrides,
  }];
}

// ---------------------------------------------------------------------------
// ── SECTION A: Approval flow ─────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('Phase 5D — Approval flow', () => {

  const NORMAL_PUT  = `/api/consultations/${CID_1}`;
  const CORRECT_PUT = `/api/consultations/${CID_2}`;

  // ── 1. Normal draft approval still works ──────────────────────────────
  test('1. normal draft approval → 200 with approved status', async () => {
    const draft = makeNormalDraft();
    Consultation.findOne.mockResolvedValueOnce(draft);

    const res = await request(app)
      .put(NORMAL_PUT)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        status: 'approved',
        note:   { chief_complaint: 'Cough', symptoms: [], medications_mentioned: [] },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(draft.save).toHaveBeenCalledTimes(1);
    // The draft's status was mutated to 'approved' before save()
    expect(draft.status).toBe('approved');
  });

  // ── 2. Correction draft approval works via same PUT endpoint ───────────
  test('2. correction draft approval via PUT → 200 with approved status', async () => {
    const correctionDraft = makeCorrectionDraft();
    Consultation.findOne.mockResolvedValueOnce(correctionDraft);

    const res = await request(app)
      .put(CORRECT_PUT)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        status: 'approved',
        note:   { chief_complaint: 'Corrected cough', symptoms: [], medications_mentioned: [] },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(correctionDraft.save).toHaveBeenCalledTimes(1);
    expect(correctionDraft.status).toBe('approved');
  });

  // ── 3. Approved correction receives approvedAt and approvedBy ──────────
  test('3. correction draft approval sets approvedAt and approvedBy', async () => {
    const correctionDraft = makeCorrectionDraft();
    Consultation.findOne.mockResolvedValueOnce(correctionDraft);

    await request(app)
      .put(CORRECT_PUT)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        status: 'approved',
        note:   { chief_complaint: 'Corrected cough', symptoms: [], medications_mentioned: [] },
      });

    // approvedAt must be a Date, approvedBy must be the requesting user's ID
    expect(correctionDraft.approvedAt).toBeInstanceOf(Date);
    expect(correctionDraft.approvedBy).toBe(ID_A);
  });

  // ── 4. correctionOf field is preserved after approval ──────────────────
  test('4. correctionOf is preserved unchanged after correction draft is approved', async () => {
    const correctionDraft = makeCorrectionDraft();
    Consultation.findOne.mockResolvedValueOnce(correctionDraft);

    await request(app)
      .put(CORRECT_PUT)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        status: 'approved',
        note:   { chief_complaint: 'Corrected cough', symptoms: [], medications_mentioned: [] },
      });

    // The controller must not clear or alter correctionOf
    expect(correctionDraft.correctionOf).toBe(CID_1);
  });

  // ── 5. Original stays immutable — PUT returns 409 ──────────────────────
  test('5. PUT on already-approved original returns 409 (immutable)', async () => {
    // Original is already approved — findOne returns it as-is.
    // We must include chief_complaint so the pre-findOne validation passes;
    // the 409 is triggered AFTER findOne confirms the doc is already approved.
    const original = {
      _id:    CID_1,
      userId: ID_A,
      status: 'approved',   // already approved
      save:   jest.fn(),
    };
    Consultation.findOne.mockResolvedValueOnce(original);

    const res = await request(app)
      .put(NORMAL_PUT)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        status: 'approved',
        note:   { chief_complaint: 'Cough', symptoms: [], medications_mentioned: [] },
      });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already approved/i);
    // save() must NOT be called on an immutable document
    expect(original.save).not.toHaveBeenCalled();
  });

  // ── 6. supersededBy on original is not touched by PUT ──────────────────
  test('6. approving correction draft does not modify supersededBy on the correction', async () => {
    // The correction draft itself has supersededBy: null (it is not superseded)
    const correctionDraft = makeCorrectionDraft({ supersededBy: null });
    Consultation.findOne.mockResolvedValueOnce(correctionDraft);

    await request(app)
      .put(CORRECT_PUT)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        status: 'approved',
        note:   { chief_complaint: 'Corrected cough', symptoms: [], medications_mentioned: [] },
      });

    // PUT never touches supersededBy; it must still be null
    expect(correctionDraft.supersededBy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ── SECTION B: getLastApproved — effective version ───────────────────────
// ---------------------------------------------------------------------------

describe('Phase 5D — GET /api/patients/:id/last-approved', () => {

  const BASE_URL = `/api/patients/${PID_1}/last-approved`;

  // ── 7. Approved correction IS returned (correctionOf ≠ null is OK) ─────
  test('7. approved correction (correctionOf ≠ null, supersededBy = null) is returned', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    // findOne for the consultation — return an approved correction
    Consultation.findOne.mockReturnValueOnce(
      findOneChain(makeApprovedCorrection())
    );

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Verify it's the correction (chief_complaint from correction fixture)
    expect(res.body.consultation.note.chief_complaint).toBe('Corrected cough');
  });

  // ── 8. Superseded original is NOT returned ─────────────────────────────
  test('8. superseded original (supersededBy ≠ null) is not returned by getLastApproved', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    // When supersededBy filter is applied, original is excluded → mock returns null
    Consultation.findOne.mockReturnValueOnce(findOneChain(null));

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/No approved consultation found/i);
  });

  // ── verify query shape: no correctionOf: null filter ──────────────────
  test('8b. getLastApproved query does NOT include correctionOf: null', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.findOne.mockReturnValueOnce(findOneChain(makeApprovedCorrection()));

    await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    const query = Consultation.findOne.mock.calls[0][0];
    // Query MUST contain supersededBy: null
    expect(query).toMatchObject({ status: 'approved', supersededBy: null });
    // Query MUST NOT contain correctionOf (it was removed in Phase 5D)
    expect(query).not.toHaveProperty('correctionOf');
  });
});

// ---------------------------------------------------------------------------
// ── SECTION C: getChangeSummary — approved correction as comparison base ─
// ---------------------------------------------------------------------------

describe('Phase 5D — POST /api/patients/:id/change-summary', () => {

  const BASE_URL = `/api/patients/${PID_1}/change-summary`;

  // A "new" consultation to compare against the previous
  const CID_NEW = '444444444444444444444444';

  function makeNewConsultation(overrides = {}) {
    return {
      _id:              CID_NEW,
      userId:           ID_A,
      patientId:        PID_1,
      status:           'approved',
      consultationDate: new Date('2026-10-01'),   // later date
      correctionOf:     null,
      supersededBy:     null,
      note: {
        chief_complaint:       'Fever',
        symptoms:              ['fever'],
        medications_mentioned: [],
        observations:          [],
        assessment:            'Flu',
        follow_up:             '3 days',
      },
      ...overrides,
    };
  }

  // ── 9. Approved correction IS selected as previousConsultation ─────────
  test('9. approved correction (correctionOf ≠ null) is valid previousConsultation', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    // Current consultation
    Consultation.findOne.mockReturnValueOnce(leanResult(makeNewConsultation()));
    // Previous consultation — return an approved correction
    Consultation.findOne.mockReturnValueOnce(
      findOneChain({
        _id:              CID_2,
        consultationDate: new Date('2026-09-01'),
        note: {
          chief_complaint:       'Corrected cough',
          symptoms:              ['cough', 'wheeze'],
          medications_mentioned: [],
          observations:          [],
          assessment:            'Revised URTI',
          follow_up:             'Return in 2 weeks',
        },
        correctionOf: CID_1,   // ← correction, NOT an original
        supersededBy: null,
      })
    );

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_NEW });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // hasPreviousConsultation must be true — the approved correction was found
    expect(res.body.hasPreviousConsultation).toBe(true);
    expect(res.body.previousConsultation).not.toBeNull();
  });

  // ── 10. Superseded original is NOT selected as previousConsultation ────
  test('10. superseded original (supersededBy ≠ null) is not selected as previousConsultation', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.findOne.mockReturnValueOnce(leanResult(makeNewConsultation()));
    // When supersededBy filter excludes the original, nothing is found
    Consultation.findOne.mockReturnValueOnce(findOneChain(null));

    const res = await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_NEW });

    expect(res.status).toBe(200);
    expect(res.body.hasPreviousConsultation).toBe(false);
    expect(res.body.previousConsultation).toBeNull();
  });

  // ── verify query shape: no correctionOf: null filter ──────────────────
  test('10b. getChangeSummary previousConsultation query does NOT include correctionOf: null', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.findOne.mockReturnValueOnce(leanResult(makeNewConsultation()));
    Consultation.findOne.mockReturnValueOnce(findOneChain(null));

    await request(app)
      .post(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ currentConsultationId: CID_NEW });

    // Second findOne call = the previousConsultation query
    const prevQuery = Consultation.findOne.mock.calls[1][0];
    expect(prevQuery).toMatchObject({ status: 'approved', supersededBy: null });
    expect(prevQuery).not.toHaveProperty('correctionOf');
  });
});

// ---------------------------------------------------------------------------
// ── SECTION D: getPatientOverview — approved correction in latestApproved ─
// ---------------------------------------------------------------------------

describe('Phase 5D — GET /api/patients/:id/overview (correction-aware)', () => {

  const BASE_URL = `/api/patients/${PID_1}/overview`;

  // Helper: set up mocks for the overview happy path
  function setupOverview({
    patient        = makePatient(),
    aggregateResult = makeAggregateResult(),
    latestApproved  = makeApprovedCorrection(),
    recent          = [],
  } = {}) {
    Patient.findOne.mockReturnValueOnce(leanResult(patient));
    Consultation.aggregate.mockResolvedValueOnce(aggregateResult);
    Consultation.findOne.mockReturnValueOnce(findOneChain(latestApproved));
    Consultation.find.mockReturnValueOnce(findChainWithLimit(recent));
  }

  // ── 11. Approved correction IS returned as latestApprovedConsultation ──
  test('11. approved correction is returned as latestApprovedConsultation', async () => {
    setupOverview({ latestApproved: makeApprovedCorrection() });

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const latest = res.body.latestApprovedConsultation;
    expect(latest).not.toBeNull();
    // chief_complaint from the approved correction fixture
    expect(latest.chief_complaint).toBe('Corrected cough');
  });

  // ── 12. Superseded original is NOT returned as latestApproved ──────────
  test('12. superseded original is not returned as latestApprovedConsultation', async () => {
    // When supersededBy filter excludes the original, latestApproved is null
    setupOverview({ latestApproved: null });

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.latestApprovedConsultation).toBeNull();
  });

  // ── 13. latestApproved findOne does NOT use correctionOf: null filter ──
  test('13. latestApproved findOne query does NOT include correctionOf: null', async () => {
    setupOverview();

    await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    // findOne is the latestApproved query (first findOne call after Patient.findOne)
    const findOneCall = Consultation.findOne.mock.calls[0][0];
    expect(findOneCall).toMatchObject({ status: 'approved', supersededBy: null });
    expect(findOneCall).not.toHaveProperty('correctionOf');
  });

  // ── 14. Aggregate $match still contains correctionOf: null ─────────────
  test('14. aggregate $match for encounter count still contains correctionOf: null', async () => {
    setupOverview();

    await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    const pipeline  = Consultation.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    // Corrections must still be excluded from the clinical encounter count
    expect(matchStage.$match).toMatchObject({ correctionOf: null });
  });

  // ── 15. Correction does not inflate encounter count ─────────────────────
  test('15. correction document does not inflate totalConsultations count', async () => {
    // Scenario: 2 original encounters (plus 1 correction that is excluded)
    // The aggregate mock (which respects correctionOf: null) returns 2 total
    setupOverview({
      aggregateResult: makeAggregateResult({
        totalConsultations:    2,
        approvedConsultations: 2,
        draftConsultations:    0,
      }),
    });

    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    // Count must be 2 (original encounters only) — NOT 3 including the correction
    expect(res.body.statistics.totalConsultations).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ── SECTION E: End-to-end lifecycle simulation ───────────────────────────
// ---------------------------------------------------------------------------

describe('Phase 5D — End-to-end correction lifecycle', () => {

  // ── 16. Full lifecycle: original → correction draft → correction approved
  //        → latestApproved returns correction, not original ──────────────
  test('16. full lifecycle: after correction approval, overview returns correction as latestApproved', async () => {
    // Step 1: GET /api/patients/:id/overview BEFORE correction
    //         latestApproved = original (correctionOf: null, supersededBy: null)
    const originalBeforeCorrection = {
      _id:              { toString: () => CID_1 },
      consultationDate: new Date('2026-09-01'),
      note: {
        chief_complaint:       'Original cough',
        symptoms:              ['cough'],
        medications_mentioned: [],
        assessment:            'URTI',
        follow_up:             '1 week',
      },
      correctionOf: null,
      supersededBy: null,
      approvedAt:   new Date('2026-09-01T10:00:00Z'),
    };

    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.aggregate.mockResolvedValueOnce(makeAggregateResult({ totalConsultations: 1 }));
    Consultation.findOne.mockReturnValueOnce(findOneChain(originalBeforeCorrection));
    Consultation.find.mockReturnValueOnce(findChainWithLimit([]));

    const resBefore = await request(app)
      .get(`/api/patients/${PID_1}/overview`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resBefore.status).toBe(200);
    expect(resBefore.body.latestApprovedConsultation.chief_complaint).toBe('Original cough');

    // --- Mocks reset between steps (handled by beforeEach, but we're in one
    //     test; clear manually for step 2) ---
    jest.clearAllMocks();

    // Step 2: GET /api/patients/:id/overview AFTER correction is approved
    //         Now: original is superseded, correction (correctionOf ≠ null) is effective
    //         The query (status='approved', supersededBy=null) should return the correction
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    // Encounter count stays 1 (correction excluded from aggregate)
    Consultation.aggregate.mockResolvedValueOnce(makeAggregateResult({ totalConsultations: 1 }));
    // latestApproved returns the approved correction (supersededBy: null, correctionOf: CID_1)
    Consultation.findOne.mockReturnValueOnce(findOneChain(makeApprovedCorrection()));
    Consultation.find.mockReturnValueOnce(findChainWithLimit([]));

    const resAfter = await request(app)
      .get(`/api/patients/${PID_1}/overview`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resAfter.status).toBe(200);
    // Correction note replaces original in latestApproved
    expect(resAfter.body.latestApprovedConsultation.chief_complaint).toBe('Corrected cough');
    // Encounter count does NOT increase (correction is not a new encounter)
    expect(resAfter.body.statistics.totalConsultations).toBe(1);
  });
});
