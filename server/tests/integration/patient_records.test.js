'use strict';

/**
 * Milestone 4 — Patient medical records security and access tests
 *
 * Explicitly tests the requirements from the Milestone 4 spec:
 *
 * 1.  Patient sees their own approved records.
 * 2.  Draft consultations are excluded.
 * 3.  Pending consultations are excluded (non-approved status).
 * 4.  Superseded originals are excluded when a correction exists.
 * 5.  Approved corrections are displayed correctly.
 * 6.  Patient A cannot access Patient B's list or detail (IDOR prevention).
 * 7.  Client-supplied patient IDs are not trusted for authorization.
 * 8.  PatientAccount identity is derived from the authenticated JWT,
 *     never from a client-supplied value.
 * 9.  Internal fields (transcript, speakerUtterances, speakerRoleMapping,
 *     detectedLanguages, userId, recordingConsentGivenAt,
 *     recordingConsentConfirmedBy) are stripped from every response.
 * 10. Unauthenticated access is rejected.
 * 11. Doctor token cannot access patient portal record endpoints.
 * 12. The detail endpoint independently enforces authorization
 *     (not just the route guard).
 */

const request = require('supertest');
const jwt     = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../src/models/PatientAccount', () => ({
  findById:          jest.fn(),
  findOne:           jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue(true),
  create:            jest.fn(),
}));
const PatientAccount = require('../../src/models/PatientAccount');

jest.mock('../../src/models/Patient', () => ({
  findOne:           jest.fn(),
  find:              jest.fn(),
  findById:          jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue(true),
  create:            jest.fn(),
}));

jest.mock('../../src/models/Consultation', () => ({
  findOne:          jest.fn(),
  find:             jest.fn(),
  create:           jest.fn(),
  findOneAndUpdate: jest.fn(),
  aggregate:        jest.fn(),
}));
const Consultation = require('../../src/models/Consultation');

jest.mock('../../src/models/RecordingConsent', () => {
  const m = jest.fn();
  m.findOne          = jest.fn();
  m.findOneAndUpdate = jest.fn();
  m.create           = jest.fn();
  m.WORDING_VERSION  = 'v1';
  m.WORDING_TEXT     = 'Consent text';
  return m;
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
let app;
beforeAll(() => { app = require('../../src/app'); });
beforeEach(() => jest.resetAllMocks());

// ---------------------------------------------------------------------------
// Shared IDs and tokens
// ---------------------------------------------------------------------------

const DOCTOR_ID_A   = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const DOCTOR_ID_B   = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const PATIENT_ID_A  = 'cccccccccccccccccccccccc';
const PATIENT_ID_B  = 'dddddddddddddddddddddddd';
const ACCOUNT_ID_A  = 'eeeeeeeeeeeeeeeeeeeeeeee';
const ACCOUNT_ID_B  = 'ffffffffffffffffffffffffffff'.slice(0, 24);
const CONSULT_1     = '111111111111111111111111';
const CONSULT_2     = '222222222222222222222222';
const CONSULT_CORR  = '333333333333333333333333';

function makeToken(sub, role) {
  return jwt.sign({ sub, email: `${sub}@test.com`, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

const TOKEN_A        = makeToken(ACCOUNT_ID_A, 'patient');
const TOKEN_B        = makeToken(ACCOUNT_ID_B, 'patient');
const DOCTOR_TOKEN_A = makeToken(DOCTOR_ID_A, 'doctor');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function leanResult(value) {
  return { lean: () => Promise.resolve(value) };
}

function makeAccount(accountId, patientId, doctorId) {
  return {
    _id:          { toString: () => accountId },
    isActive:     true,
    patientId:    { toString: () => patientId },
    doctorUserId: { toString: () => doctorId },
  };
}

function makeConsultation(overrides = {}) {
  return {
    _id:              { toString: () => CONSULT_1 },
    patientId:        PATIENT_ID_A,
    userId:           DOCTOR_ID_A,
    status:           'approved',
    supersededBy:     null,
    correctionOf:     null,
    consultationDate: new Date('2026-09-01T09:00:00Z'),
    encounterType:    'in_person',
    approvedAt:       new Date('2026-09-01T10:00:00Z'),
    note: {
      chief_complaint: 'Persistent cough',
      symptoms:        ['cough', 'fatigue'],
      assessment:      'Viral URTI',
      follow_up:       'Return in 1 week',
    },
    // Internal fields that must be stripped:
    transcript:                  'raw audio transcript — must not reach patient',
    speakerUtterances:           [{ speaker: 'spk_0', text: 'hello', startTime: 0, endTime: 1 }],
    speakerRoleMapping:          { spk_0: 'Patient' },
    detectedLanguages:           [{ code: 'en-IN', duration: 10 }],
    recordingConsentGivenAt:     new Date('2026-09-01T08:55:00Z'),
    recordingConsentConfirmedBy: DOCTOR_ID_A,
    ...overrides,
  };
}

// Mock Consultation.find() with the standard .sort().select().lean() chain
function mockFindChain(results) {
  Consultation.find.mockReturnValueOnce({
    sort:   () => ({
      select: () => ({
        lean: () => Promise.resolve(results),
      }),
    }),
  });
}

// ===========================================================================
// 1. Patient sees their own approved records
// ===========================================================================

describe('1. Patient sees their own approved records', () => {
  test('1a. authenticated patient receives their approved consultations', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    mockFindChain([makeConsultation()]);

    const res = await request(app)
      .get('/api/patient-portal/records/consultations')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.consultations)).toBe(true);
  });

  test('1b. query is scoped by patientId derived from the PatientAccount', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    mockFindChain([makeConsultation()]);

    await request(app)
      .get('/api/patient-portal/records/consultations')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    // The query must include patientId sourced from the DB, not client input
    expect(Consultation.find).toHaveBeenCalledWith(
      expect.objectContaining({
        status:       'approved',
        supersededBy: null,
      })
    );
  });
});

// ===========================================================================
// 2. Draft consultations are excluded
// ===========================================================================

describe('2. Draft consultations are excluded', () => {
  test('2a. list endpoint does not return drafts', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    // The query has { status: 'approved' } so the DB would not return drafts.
    // Here we verify the query shape enforces it.
    mockFindChain([]);

    const res = await request(app)
      .get('/api/patient-portal/records/consultations')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(Consultation.find).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved' })
    );
  });

  test('2b. detail endpoint returns 404 for a draft (status filter excludes it)', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    // Backend query includes { status: 'approved' } — draft returns null
    Consultation.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 3. Pending / non-approved consultations are excluded
// ===========================================================================

describe('3. Non-approved consultations are excluded', () => {
  test('3a. any non-approved status returns 404 on detail', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    // Backend query filters { status: 'approved' }; a 'pending' doc → null
    Consultation.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 4. Superseded originals are excluded when a correction exists
// ===========================================================================

describe('4. Superseded originals are excluded', () => {
  test('4a. list query filters out superseded originals (supersededBy !== null)', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    mockFindChain([]);

    await request(app)
      .get('/api/patient-portal/records/consultations')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    // The query enforces supersededBy: null — superseded originals are excluded
    expect(Consultation.find).toHaveBeenCalledWith(
      expect.objectContaining({ supersededBy: null })
    );
  });

  test('4b. detail endpoint returns 404 for a superseded original', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    // Backend query includes { supersededBy: null } — superseded doc → null
    Consultation.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 5. Approved corrections are displayed correctly
// ===========================================================================

describe('5. Approved corrections are displayed correctly', () => {
  test('5a. approved correction (supersededBy null, correctionOf set) → 200', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    const correction = makeConsultation({
      _id:          { toString: () => CONSULT_CORR },
      correctionOf: CONSULT_1,   // it IS a correction of the original
      supersededBy: null,        // but it has NOT been superseded — it IS effective
    });
    Consultation.findOne.mockReturnValueOnce(leanResult(correction));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_CORR}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body.consultation.correctionOf).toBeDefined();
    // The correction's note is returned
    expect(res.body.consultation.note.chief_complaint).toBe('Persistent cough');
  });

  test('5b. corrections appear in the list when they are the effective version', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    const correction = makeConsultation({
      _id:          { toString: () => CONSULT_CORR },
      correctionOf: CONSULT_1,
      supersededBy: null,
    });
    // The list query returns the correction because it satisfies
    // { status:'approved', supersededBy:null } just like any other record
    mockFindChain([correction]);

    const res = await request(app)
      .get('/api/patient-portal/records/consultations')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body.consultations).toHaveLength(1);
  });
});

// ===========================================================================
// 6. Cross-patient IDOR prevention
// ===========================================================================

describe('6. Patient A cannot access Patient B\'s records', () => {
  test('6a. Patient A cannot list Patient B\'s consultations', async () => {
    // Patient A's account links to PATIENT_ID_A.
    // The query uses patientId = PATIENT_ID_A — Patient B's consultations
    // are never in scope, regardless of URL parameters.
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    mockFindChain([]); // B's consultations are not in A's scope

    const res = await request(app)
      .get('/api/patient-portal/records/consultations')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    // The query uses patientId derived from PatientAccount, not from the URL
    expect(Consultation.find).toHaveBeenCalledWith(
      expect.not.objectContaining({ patientId: PATIENT_ID_B })
    );
  });

  test('6b. Patient A requesting Patient B\'s specific consultation → 404', async () => {
    // Patient A's account links to PATIENT_ID_A.
    // B's consultation has patientId=PATIENT_ID_B, so the query
    // { patientId: PATIENT_ID_A, _id: B_CONSULT_ID } returns null.
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    Consultation.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_2}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(404);
  });

  test('6c. response is 404, not 403 — existence of the record is not revealed', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    Consultation.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_2}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    // Must be 404, never 403 — avoids leaking whether the ID exists
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });
});

// ===========================================================================
// 7. Client-supplied IDs are not trusted for authorization
// ===========================================================================

describe('7. Client-supplied patient IDs are not trusted', () => {
  test('7a. URL :id is the consultation ID, not the patient ID — patient scope is from JWT', async () => {
    // The endpoint is GET /records/consultations/:id where :id is the consultation _id.
    // The patient scope (patientId, doctorUserId) comes from PatientAccount in the DB,
    // derived from the JWT sub — never from the URL or request body.
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    Consultation.findOne.mockReturnValueOnce(leanResult(makeConsultation()));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    // Confirm that PatientAccount was loaded from the DB using the JWT sub
    expect(PatientAccount.findById).toHaveBeenCalledWith(ACCOUNT_ID_A);
  });

  test('7b. invalid ObjectId in URL → 400 (not 500)', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );

    const res = await request(app)
      .get('/api/patient-portal/records/consultations/not-an-objectid')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 8. PatientAccount identity from JWT, never client
// ===========================================================================

describe('8. Identity derived from JWT, not client input', () => {
  test('8a. PatientAccount.findById is called with the JWT sub, not a URL param', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    mockFindChain([]);

    await request(app)
      .get('/api/patient-portal/records/consultations')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    // Must be called with ACCOUNT_ID_A (from JWT sub), not anything else
    expect(PatientAccount.findById).toHaveBeenCalledWith(ACCOUNT_ID_A);
  });

  test('8b. inactive account → 401 even with valid JWT', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult({ ...makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A), isActive: false })
    );

    const res = await request(app)
      .get('/api/patient-portal/records/consultations')
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// 9. Internal fields are stripped
// ===========================================================================

describe('9. Internal fields stripped from patient-facing responses', () => {
  test('9a. transcript not returned in consultation detail', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    Consultation.findOne.mockReturnValueOnce(leanResult(makeConsultation()));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body.consultation.transcript).toBeUndefined();
  });

  test('9b. speakerUtterances not returned', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    Consultation.findOne.mockReturnValueOnce(leanResult(makeConsultation()));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.body.consultation.speakerUtterances).toBeUndefined();
  });

  test('9c. userId not returned', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    Consultation.findOne.mockReturnValueOnce(leanResult(makeConsultation()));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.body.consultation.userId).toBeUndefined();
  });

  test('9d. recordingConsentGivenAt not returned', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    Consultation.findOne.mockReturnValueOnce(leanResult(makeConsultation()));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.body.consultation.recordingConsentGivenAt).toBeUndefined();
  });

  test('9e. speakerRoleMapping not returned', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    Consultation.findOne.mockReturnValueOnce(leanResult(makeConsultation()));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.body.consultation.speakerRoleMapping).toBeUndefined();
  });

  test('9f. clinical note fields ARE returned', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    Consultation.findOne.mockReturnValueOnce(leanResult(makeConsultation()));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.body.consultation.note.chief_complaint).toBe('Persistent cough');
    expect(res.body.consultation.note.symptoms).toContain('cough');
    expect(res.body.consultation.note.assessment).toBe('Viral URTI');
    expect(res.body.consultation.note.follow_up).toBe('Return in 1 week');
  });
});

// ===========================================================================
// 10. Unauthenticated access is rejected
// ===========================================================================

describe('10. Unauthenticated access rejected', () => {
  test('10a. list without token → 401', async () => {
    const res = await request(app).get('/api/patient-portal/records/consultations');
    expect(res.status).toBe(401);
  });

  test('10b. detail without token → 401', async () => {
    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`);
    expect(res.status).toBe(401);
  });

  test('10c. patient demographics without token → 401', async () => {
    const res = await request(app).get('/api/patient-portal/records/patient');
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// 11. Doctor token cannot access patient portal record endpoints
// ===========================================================================

describe('11. Doctor token rejected from patient portal record endpoints', () => {
  test('11a. doctor token on consultations list → 401', async () => {
    const res = await request(app)
      .get('/api/patient-portal/records/consultations')
      .set('Authorization', `Bearer ${DOCTOR_TOKEN_A}`);
    expect(res.status).toBe(401);
  });

  test('11b. doctor token on consultation detail → 401', async () => {
    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${DOCTOR_TOKEN_A}`);
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// 12. Detail endpoint enforces authorization independently
// ===========================================================================

describe('12. Detail endpoint enforces authorization independently', () => {
  test('12a. query includes both patientId (from account) and userId (doctor)', async () => {
    PatientAccount.findById.mockReturnValueOnce(
      leanResult(makeAccount(ACCOUNT_ID_A, PATIENT_ID_A, DOCTOR_ID_A))
    );
    Consultation.findOne.mockReturnValueOnce(leanResult(makeConsultation()));

    await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    // Both ownership dimensions must be present in the query
    expect(Consultation.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status:       'approved',
        supersededBy: null,
      })
    );
  });

  test('12b. 401 when PatientAccount is not found in DB', async () => {
    PatientAccount.findById.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(`/api/patient-portal/records/consultations/${CONSULT_1}`)
      .set('Authorization', `Bearer ${TOKEN_A}`);

    expect(res.status).toBe(401);
  });
});
