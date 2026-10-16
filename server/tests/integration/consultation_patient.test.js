/**
 * Phase 3A — Consultation ↔ Patient integration tests
 *
 * Strategy: same as Phase 1A / Phase 2A.
 *   - All models mocked via jest.mock (no real DB).
 *   - Real JWT tokens built from test secrets (setup.js).
 *   - Ownership rules verified by inspecting mock call arguments.
 *
 * Scenarios covered (12+):
 *  1.  POST /consultations without patientId → 400
 *  2.  POST /consultations with invalid patientId → 400
 *  3.  POST /consultations patient belongs to another user → 404
 *  4.  POST /consultations patient is archived → 404
 *  5.  POST /consultations success → 201 with patientId persisted
 *  6.  POST /consultations userId always from token, never from body
 *  7.  PUT  /consultations/:id attempt to change patientId is silently ignored
 *  8.  PUT  /consultations/:id attempt to change userId is silently ignored
 *  9.  GET  /patients/:id/consultations unauthenticated → 401
 * 10.  GET  /patients/:id/consultations patient belongs to another user → 404
 * 11.  GET  /patients/:id/consultations success → 200 scoped to user+patient
 * 12.  GET  /patients/:id/last-approved no approved note → 404
 * 13.  GET  /patients/:id/last-approved ignores superseded originals
 * 14.  GET  /patients/:id/last-approved success → 200 with note context fields
 * 15.  GET  /patients/:id/last-approved patient belongs to another user → 404
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

// Phase 7 / P0-1B — consent event model mock
jest.mock('../../src/models/RecordingConsent', () => {
  const mockFn = jest.fn();
  mockFn.findOne = jest.fn();
  mockFn.create  = jest.fn();
  mockFn.WORDING_VERSION = 'v1';
  mockFn.WORDING_TEXT    = 'I confirm that the patient has been informed…';
  return mockFn;
});
const RecordingConsent = require('../../src/models/RecordingConsent');

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

/** Wrap a value in a lean()-chainable query object (mirrors Phase 1A/2A). */
function leanResult(value) {
  return { lean: () => Promise.resolve(value) };
}

/**
 * Wrap a value in a fully-chained query object for:
 *   Model.find(...).sort(...).select(...).lean()
 * Used by listPatientConsultations.
 */
function findChain(value) {
  return {
    sort:   () => ({ select: () => ({ lean: () => Promise.resolve(value) }) }),
  };
}

/**
 * Wrap a value in a fully-chained query object for:
 *   Model.findOne(...).sort(...).select(...).lean()
 * Used by getLastApproved.
 */
function findOneChain(value) {
  return {
    sort:   () => ({ select: () => ({ lean: () => Promise.resolve(value) }) }),
  };
}

// ---------------------------------------------------------------------------
// Shared IDs and tokens
// ---------------------------------------------------------------------------

const ID_A  = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // Doctor A's userId
const ID_B  = 'bbbbbbbbbbbbbbbbbbbbbbbb'; // Doctor B's userId
const PID_1 = '111111111111111111111111'; // Patient owned by Doctor A
const CID_1 = '222222222222222222222222'; // Consultation 1
const CID_2 = '333333333333333333333333'; // Consultation 2 (correction)

const tokenA = makeToken(ID_A, 'doctora@example.com');
const tokenB = makeToken(ID_B, 'doctorb@example.com');

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makePatient(overrides = {}) {
  return {
    _id:         { toString: () => PID_1 },
    userId:      ID_A,
    firstName:   'Alice',
    lastName:    'Smith',
    isArchived:  false,
    save:        jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeConsultation(overrides = {}) {
  return {
    _id:              { toString: () => CID_1 },
    userId:           ID_A,
    patientId:        PID_1,
    status:           'draft',
    consultationDate: new Date('2026-09-01'),
    encounterType:    'in_person',
    note:             { chief_complaint: 'cough', symptoms: [] },
    approvedAt:       null,
    approvedBy:       null,
    correctionOf:     null,
    supersededBy:     null,
    save:             jest.fn().mockResolvedValue(true),
    deleteOne:        jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// Valid minimal body for POST /api/consultations
// Phase 7 / P0-1B: consentEventId is required when transcript is non-empty.
// The server validates the event against RecordingConsent; tests mock that model.
const EVT_1 = '333333333333333333333333'; // A consent event ID
const validCreateBody = {
  patientId:      PID_1,
  transcript:     'Patient reports cough for 3 days.',
  note:           { chief_complaint: 'cough' },
  consentEventId: EVT_1,
};

function makeConsentEvent(overrides = {}) {
  return {
    _id:          { toString: () => EVT_1 },
    userId:       ID_A,
    patientId:    PID_1,
    givenAt:      new Date('2026-09-01T09:00:00.000Z'),
    wordingVersion: 'v1',
    status:         'pending',
    linkedConsultationId: null,
    linkedAt:       null,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1 — POST /api/consultations — patientId validation
// ---------------------------------------------------------------------------

describe('POST /api/consultations — patientId required', () => {
  test('1. missing patientId → 400', async () => {
    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ transcript: 'hello' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/patientId is required/i);
  });

  test('2. invalid (non-ObjectId) patientId → 400', async () => {
    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validCreateBody, patientId: 'not-an-id' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not a valid ID/i);
  });

  test('3. patientId belongs to another user → 404', async () => {
    // Patient.findOne returns null — ownership check fails
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validCreateBody);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/patient not found/i);
    // Confirm the query included the requesting user's ID
    expect(Patient.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_A })
    );
  });

  test('4. archived patient → 404', async () => {
    // The controller queries { isArchived: false } so archived patient returns null
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validCreateBody);

    expect(res.status).toBe(404);
    // Confirm the ownership query included isArchived: false
    expect(Patient.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ isArchived: false })
    );
  });
});

// ---------------------------------------------------------------------------
// 2 — POST /api/consultations — successful creation
// ---------------------------------------------------------------------------

describe('POST /api/consultations — successful creation', () => {
  test('5. valid patientId owned by user → 201 with patientId persisted', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    const ev = makeConsentEvent();
    RecordingConsent.findOne.mockResolvedValueOnce(ev);
    RecordingConsent.findOneAndUpdate
      .mockResolvedValueOnce(ev)   // claim
      .mockResolvedValueOnce(ev);  // link
    Consultation.create.mockResolvedValueOnce(makeConsultation());

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validCreateBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const createArg = Consultation.create.mock.calls[0][0];
    expect(createArg.patientId).toBe(PID_1);
  });

  test('6. userId always from token — client-supplied userId is ignored', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    const ev = makeConsentEvent();
    RecordingConsent.findOne.mockResolvedValueOnce(ev);
    RecordingConsent.findOneAndUpdate
      .mockResolvedValueOnce(ev)
      .mockResolvedValueOnce(ev);
    Consultation.create.mockResolvedValueOnce(makeConsultation());

    await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validCreateBody, userId: 'attacker-id' });

    const createArg = Consultation.create.mock.calls[0][0];
    expect(createArg.userId).toBe(ID_A);
    expect(createArg.userId).not.toBe('attacker-id');
  });

  test('5b. unauthenticated POST → 401', async () => {
    const res = await request(app)
      .post('/api/consultations')
      .send(validCreateBody);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 3 — PUT /api/consultations/:id — immutable patientId / userId
// ---------------------------------------------------------------------------

describe('PUT /api/consultations/:id — immutable ownership fields', () => {
  test('7. attempt to change patientId via PUT is silently ignored', async () => {
    const draft = makeConsultation({ status: 'draft' });
    Consultation.findOne.mockResolvedValueOnce(draft);

    await request(app)
      .put(`/api/consultations/${CID_1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: CID_2, transcript: 'updated' }); // CID_2 is a different ID

    // patientId on the saved document must remain unchanged
    expect(draft.patientId).toBe(PID_1);
  });

  test('8. attempt to change userId via PUT is silently ignored', async () => {
    const draft = makeConsultation({ status: 'draft' });
    Consultation.findOne.mockResolvedValueOnce(draft);

    await request(app)
      .put(`/api/consultations/${CID_1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ userId: ID_B, transcript: 'updated' });

    expect(draft.userId).toBe(ID_A);
  });
});

// ---------------------------------------------------------------------------
// 4 — GET /api/patients/:id/consultations
// ---------------------------------------------------------------------------

describe('GET /api/patients/:id/consultations', () => {
  test('9. unauthenticated → 401', async () => {
    const res = await request(app).get(`/api/patients/${PID_1}/consultations`);
    expect(res.status).toBe(401);
  });

  test('10. patient belongs to another user → 404', async () => {
    // Doctor B asks for Doctor A's patient
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(`/api/patients/${PID_1}/consultations`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    expect(Patient.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_B })
    );
  });

  test('11. success — returns consultations scoped to user + patient', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.find.mockReturnValueOnce(findChain([makeConsultation()]));

    const res = await request(app)
      .get(`/api/patients/${PID_1}/consultations`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.consultations)).toBe(true);

    // Confirm Consultation.find was called with both userId and patientId
    expect(Consultation.find).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: PID_1, userId: ID_A })
    );
  });
});

// ---------------------------------------------------------------------------
// 5 — GET /api/patients/:id/last-approved
// ---------------------------------------------------------------------------

describe('GET /api/patients/:id/last-approved', () => {
  test('12. no approved consultation for patient → 404', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.findOne.mockReturnValueOnce(findOneChain(null));

    const res = await request(app)
      .get(`/api/patients/${PID_1}/last-approved`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no approved consultation/i);
  });

  test('13. ignores superseded originals (correction-aware query)', async () => {
    // Phase 5D: the query uses { supersededBy: null } — correctionOf is no longer
    // filtered here because approved corrections ARE the effective version.
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.findOne.mockReturnValueOnce(findOneChain(null));

    await request(app)
      .get(`/api/patients/${PID_1}/last-approved`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(Consultation.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status:       'approved',
        supersededBy: null,
      })
    );
    // correctionOf must NOT appear in the query (Phase 5D fix)
    const query = Consultation.findOne.mock.calls[0][0];
    expect(query).not.toHaveProperty('correctionOf');
  });

  test('14. success → 200 with consultation note context fields', async () => {
    const approvedNote = makeConsultation({
      status:      'approved',
      approvedAt:  new Date('2026-09-10'),
      approvedBy:  ID_A,
      correctionOf: null,
      supersededBy: null,
    });

    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.findOne.mockReturnValueOnce(findOneChain(approvedNote));

    const res = await request(app)
      .get(`/api/patients/${PID_1}/last-approved`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.consultation).toBeDefined();
  });

  test('15. patient belongs to another user → 404', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(`/api/patients/${PID_1}/last-approved`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    expect(Patient.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_B })
    );
  });
});

// ---------------------------------------------------------------------------
// 6 — POST /api/consultations — recording consent (Phase 7 / P0-1B)
// ---------------------------------------------------------------------------

describe('POST /api/consultations — recording consent (P0-1B)', () => {

  test('16. transcript provided without consentEventId → 400', async () => {
    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        patientId:  PID_1,
        transcript: 'Patient reports fever.',
        // consentEventId intentionally omitted
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/consentEventId is required/i);
  });

  test('17. invalid (non-ObjectId) consentEventId → 400', async () => {
    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        patientId:      PID_1,
        transcript:     'Patient reports fever.',
        consentEventId: 'not-valid',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/consentEventId is not a valid ID/i);
  });

  test('18. no transcript (manual entry) → 201 without consentEventId', async () => {
    // Manual consultations have no audio — consent event is not required.
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.create.mockResolvedValueOnce(makeConsultation());

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        patientId: PID_1,
        note:      { chief_complaint: 'Cough' },
      });

    expect(res.status).toBe(201);
    expect(RecordingConsent.findOne).not.toHaveBeenCalled();
  });

  test('19. empty-string transcript → 201 without consentEventId (treated as manual)', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.create.mockResolvedValueOnce(makeConsultation());

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        patientId:  PID_1,
        transcript: '',
        note:       { chief_complaint: 'Cough' },
      });

    expect(res.status).toBe(201);
    expect(RecordingConsent.findOne).not.toHaveBeenCalled();
  });

  test('20. consentEventId not found / belongs to another user → 400', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    RecordingConsent.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validCreateBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/recording consent event not found/i);
  });

  test('21. valid consentEventId — server event givenAt is persisted, not a client timestamp', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    const serverTime = new Date('2026-09-01T09:00:00.000Z');
    const event = makeConsentEvent({ givenAt: serverTime });
    RecordingConsent.findOne.mockResolvedValueOnce(event);
    Consultation.create.mockResolvedValueOnce(makeConsultation());

    await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        ...validCreateBody,
        // Attacker tries to supply a different timestamp
        recordingConsentGivenAt: '2020-01-01T00:00:00.000Z',
      });

    const createArg = Consultation.create.mock.calls[0][0];
    // Must use the server event's givenAt, not the client-supplied timestamp
    expect(createArg.recordingConsentGivenAt).toEqual(serverTime);
    expect(createArg.recordingConsentGivenAt.toISOString()).not.toBe('2020-01-01T00:00:00.000Z');
  });

  test('22. recordingConsentConfirmedBy is from the event — never from the client body', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    const event = makeConsentEvent({ userId: ID_A });
    RecordingConsent.findOne.mockResolvedValueOnce(event);
    Consultation.create.mockResolvedValueOnce(makeConsultation());

    await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validCreateBody, recordingConsentConfirmedBy: ID_B });

    const createArg = Consultation.create.mock.calls[0][0];
    expect(createArg.recordingConsentConfirmedBy).toBe(ID_A);
    expect(createArg.recordingConsentConfirmedBy).not.toBe(ID_B);
  });

  test('23. consent event is atomically linked after successful consultation creation', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    const event = makeConsentEvent();
    RecordingConsent.findOne.mockResolvedValueOnce(event);
    RecordingConsent.findOneAndUpdate
      .mockResolvedValueOnce(event)   // claim step succeeds
      .mockResolvedValueOnce(event);  // link step succeeds
    Consultation.create.mockResolvedValueOnce(makeConsultation());

    await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validCreateBody);

    // Both findOneAndUpdate calls must have been made
    expect(RecordingConsent.findOneAndUpdate).toHaveBeenCalledTimes(2);

    // Claim: pending → claiming
    expect(RecordingConsent.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ status: 'pending' });
    expect(RecordingConsent.findOneAndUpdate.mock.calls[0][1]).toMatchObject({ $set: { status: 'claiming' } });

    // Link: claiming → linked
    expect(RecordingConsent.findOneAndUpdate.mock.calls[1][0]).toMatchObject({ status: 'claiming' });
    expect(RecordingConsent.findOneAndUpdate.mock.calls[1][1]).toMatchObject({
      $set: expect.objectContaining({ status: 'linked' }),
    });
  });

  test('24. PUT /api/consultations/:id does not create or modify consent events', async () => {
    const draft = makeConsultation({ status: 'draft' });
    Consultation.findOne.mockResolvedValueOnce(draft);

    await request(app)
      .put(`/api/consultations/${CID_1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ transcript: 'updated', consentEventId: EVT_1 });

    // UPDATE must not touch RecordingConsent at all
    expect(RecordingConsent.findOne).not.toHaveBeenCalled();
    expect(Consultation.create).not.toHaveBeenCalled();
    expect(draft.save).toHaveBeenCalled();
  });
});
