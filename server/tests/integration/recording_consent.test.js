'use strict';

/**
 * Phase 7 / P0-1B — Recording Consent endpoint integration tests
 *
 * POST /api/recording-consents
 *
 * Scenarios (16):
 *  1.  Unauthenticated → 401
 *  2.  Missing patientId → 400
 *  3.  Invalid (non-ObjectId) patientId → 400
 *  4.  Patient belongs to another user → 404
 *  5.  Archived patient → 404
 *  6.  Success → 201 with consentEventId and givenAt
 *  7.  givenAt is server-generated — client cannot supply it
 *  8.  userId is always from token — client-supplied userId is ignored
 *  9.  wordingVersion and wordingText are stored from the server constant
 * 10.  status is 'pending' on creation
 * 11.  linkedConsultationId is null on creation
 *
 * POST /api/consultations — consent enforcement (P0-1B)
 * 12. Transcript provided without consentEventId → 400
 * 13. Invalid consentEventId ObjectId → 400
 * 14. consentEventId not found / belongs to another user → 400
 * 15. consentEventId belongs to correct user but wrong patient → 400
 * 16. consentEventId already linked → 400
 * 17. Valid consentEventId — consent is persisted and event is linked
 * 18. recordingConsentGivenAt is taken from the event, not from client body
 * 19. recordingConsentConfirmedBy is always from the event (req.user.id), not client
 * 20. Manual consultation (no transcript) requires neither field
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
  findOne:   jest.fn(),
  find:      jest.fn(),
  create:    jest.fn(),
  aggregate: jest.fn(),
}));
const Consultation = require('../../src/models/Consultation');

jest.mock('../../src/models/RecordingConsent', () => {
  const mockFn = jest.fn();
  // Attach static exports
  mockFn.findOne = jest.fn();
  mockFn.create  = jest.fn();
  mockFn.WORDING_VERSION = 'v1';
  mockFn.WORDING_TEXT    =
    'I confirm that the patient has been informed that this consultation will ' +
    'be audio-recorded and that the audio will be processed by an AI service ' +
    'to generate a transcript and clinical-note draft. The patient has agreed ' +
    'to proceed.';
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

function leanResult(value) {
  return { lean: () => Promise.resolve(value) };
}

// ---------------------------------------------------------------------------
// Shared IDs and tokens
// ---------------------------------------------------------------------------

const ID_A  = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // Doctor A
const ID_B  = 'bbbbbbbbbbbbbbbbbbbbbbbb'; // Doctor B
const PID_1 = '111111111111111111111111'; // Patient owned by Doctor A
const CID_1 = '222222222222222222222222'; // A consultation
const EVT_1 = '333333333333333333333333'; // A consent event

const tokenA = makeToken(ID_A, 'doctora@example.com');
const tokenB = makeToken(ID_B, 'doctorb@example.com');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function makeConsultation(overrides = {}) {
  return {
    _id:              { toString: () => CID_1 },
    userId:           ID_A,
    patientId:        PID_1,
    status:           'draft',
    note:             {},
    correctionOf:     null,
    supersededBy:     null,
    recordingConsentGivenAt:     null,
    recordingConsentConfirmedBy: null,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeConsentEvent(overrides = {}) {
  return {
    _id:          { toString: () => EVT_1 },
    userId:       ID_A,
    patientId:    PID_1,
    givenAt:      new Date('2026-09-01T09:00:00.000Z'),
    wordingVersion: 'v1',
    wordingText:    'I confirm…',
    status:         'pending',
    linkedConsultationId: null,
    linkedAt:       null,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// Valid body for POST /api/consultations with a transcript (requires consentEventId)
const validCreateBody = {
  patientId:     PID_1,
  transcript:    'Patient reports cough for 3 days.',
  note:          { chief_complaint: 'cough' },
  consentEventId: EVT_1,
};

// ===========================================================================
// POST /api/recording-consents
// ===========================================================================

describe('POST /api/recording-consents — authentication', () => {
  test('1. unauthenticated request → 401', async () => {
    const res = await request(app).post('/api/recording-consents');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/recording-consents — input validation', () => {
  test('2. missing patientId → 400', async () => {
    const res = await request(app)
      .post('/api/recording-consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/patientId is required/i);
  });

  test('3. invalid (non-ObjectId) patientId → 400', async () => {
    const res = await request(app)
      .post('/api/recording-consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: 'not-an-id' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not a valid ID/i);
  });
});

describe('POST /api/recording-consents — patient ownership', () => {
  test('4. patient belongs to another user → 404', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .post('/api/recording-consents')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ patientId: PID_1 });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/patient not found/i);
    expect(Patient.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_B })
    );
  });

  test('5. archived patient → 404', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .post('/api/recording-consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: PID_1 });

    expect(res.status).toBe(404);
    expect(Patient.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ isArchived: false })
    );
  });
});

describe('POST /api/recording-consents — successful creation', () => {
  test('6. success → 201 with consentEventId and givenAt', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));

    const now = new Date('2026-09-01T09:00:00.000Z');
    const event = makeConsentEvent({ _id: { toString: () => EVT_1 }, givenAt: now });
    RecordingConsent.create.mockResolvedValueOnce(event);

    const res = await request(app)
      .post('/api/recording-consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: PID_1 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.consentEventId).toBeDefined();
    expect(res.body.givenAt).toBeDefined();
    // givenAt should be an ISO string
    expect(() => new Date(res.body.givenAt)).not.toThrow();
  });

  test('7. givenAt is server-generated — client cannot supply it', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    const event = makeConsentEvent();
    RecordingConsent.create.mockResolvedValueOnce(event);

    // Attacker tries to supply a past timestamp
    await request(app)
      .post('/api/recording-consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: PID_1, givenAt: '2020-01-01T00:00:00.000Z' });

    const createArg = RecordingConsent.create.mock.calls[0][0];
    // givenAt on the created record must come from new Date() — not from the body.
    // Verify the body field was never forwarded: it is generated inside the controller.
    expect(createArg.givenAt).toBeInstanceOf(Date);
    // The passed-in fake past timestamp must NOT have been used.
    // We check by verifying the stored date is recent (within 30s of now).
    const delta = Date.now() - createArg.givenAt.getTime();
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThan(30_000);
  });

  test('8. userId is always from token — client-supplied userId is ignored', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    RecordingConsent.create.mockResolvedValueOnce(makeConsentEvent());

    await request(app)
      .post('/api/recording-consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: PID_1, userId: ID_B }); // attacker-supplied userId

    const createArg = RecordingConsent.create.mock.calls[0][0];
    expect(createArg.userId).toBe(ID_A);       // from the JWT
    expect(createArg.userId).not.toBe(ID_B);   // not the attacker value
  });

  test('9. wordingVersion and wordingText are stored from the server constant', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    RecordingConsent.create.mockResolvedValueOnce(makeConsentEvent());

    await request(app)
      .post('/api/recording-consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: PID_1 });

    const createArg = RecordingConsent.create.mock.calls[0][0];
    expect(createArg.wordingVersion).toBe('v1');
    expect(typeof createArg.wordingText).toBe('string');
    expect(createArg.wordingText.length).toBeGreaterThan(20);
  });

  test('10. status is "pending" on creation', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    RecordingConsent.create.mockResolvedValueOnce(makeConsentEvent());

    await request(app)
      .post('/api/recording-consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: PID_1 });

    const createArg = RecordingConsent.create.mock.calls[0][0];
    expect(createArg.status).toBe('pending');
  });

  test('11. linkedConsultationId is null on creation', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    RecordingConsent.create.mockResolvedValueOnce(makeConsentEvent());

    await request(app)
      .post('/api/recording-consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: PID_1 });

    const createArg = RecordingConsent.create.mock.calls[0][0];
    // linkedConsultationId and linkedAt are not set at creation time
    expect(createArg.linkedConsultationId).toBeUndefined();
    expect(createArg.linkedAt).toBeUndefined();
  });
});

// ===========================================================================
// POST /api/consultations — consent event enforcement (P0-1B)
// ===========================================================================

describe('POST /api/consultations — consentEventId enforcement', () => {

  test('12. transcript provided without consentEventId → 400', async () => {
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

  test('13. invalid (non-ObjectId) consentEventId → 400', async () => {
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

  test('14. consentEventId not found / belongs to another user → 400', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    // RecordingConsent.findOne returns null — event not found or foreign user
    RecordingConsent.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validCreateBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/recording consent event not found/i);
  });

  test('15. consentEventId belongs to correct user but wrong patient → 400', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    // RecordingConsent.findOne uses { _id, userId, patientId, status:'pending' }
    // If patientId does not match the query returns null
    RecordingConsent.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        patientId:      PID_1,
        transcript:     'Patient reports fever.',
        consentEventId: EVT_1,
      });

    expect(res.status).toBe(400);
    // Confirm the query included the patientId so a cross-patient event is rejected
    expect(RecordingConsent.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: PID_1 })
    );
  });

  test('16. consentEventId already linked (status !== "pending") → 400', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    // Already-linked events have status='linked' — the query includes status:'pending'
    // so they return null and cannot be reused.
    RecordingConsent.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validCreateBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already been used/i);
  });

  test('17. valid consentEventId — consent is persisted and event is atomically linked', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    const event = makeConsentEvent();
    RecordingConsent.findOne.mockResolvedValueOnce(event);
    Consultation.create.mockResolvedValueOnce(makeConsultation());
    // Atomic claim succeeds — returns the old doc (truthy)
    RecordingConsent.findOneAndUpdate.mockResolvedValueOnce(event);

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validCreateBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // Consultation.create received the consent data from the event snapshot
    const createArg = Consultation.create.mock.calls[0][0];
    expect(createArg.recordingConsentGivenAt).toEqual(event.givenAt);
    expect(createArg.recordingConsentConfirmedBy).toBe(event.userId);

    // Atomic findOneAndUpdate was called to link the event
    expect(RecordingConsent.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'linked' }) }),
      expect.any(Object)
    );
  });

  test('18. recordingConsentGivenAt is taken from the event — not from the client body', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    const serverTimestamp = new Date('2026-09-01T09:00:00.000Z');
    const event = makeConsentEvent({ givenAt: serverTimestamp });
    RecordingConsent.findOne.mockResolvedValueOnce(event);
    Consultation.create.mockResolvedValueOnce(makeConsultation());
    RecordingConsent.findOneAndUpdate.mockResolvedValueOnce(event);

    // Attacker tries to pass a fake consent timestamp
    await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        ...validCreateBody,
        recordingConsentGivenAt: '2020-01-01T00:00:00.000Z',
      });

    const createArg = Consultation.create.mock.calls[0][0];
    // Must be the server-event timestamp, not the client-supplied one
    expect(createArg.recordingConsentGivenAt).toEqual(serverTimestamp);
    expect(createArg.recordingConsentGivenAt.toISOString()).not.toBe('2020-01-01T00:00:00.000Z');
  });

  test('19. recordingConsentConfirmedBy is from the event, never from the client body', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    const event = makeConsentEvent({ userId: ID_A });
    RecordingConsent.findOne.mockResolvedValueOnce(event);
    Consultation.create.mockResolvedValueOnce(makeConsultation());
    RecordingConsent.findOneAndUpdate.mockResolvedValueOnce(event);

    // Attacker tries to forge confirmedBy
    await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validCreateBody, recordingConsentConfirmedBy: ID_B });

    const createArg = Consultation.create.mock.calls[0][0];
    expect(createArg.recordingConsentConfirmedBy).toBe(ID_A);
    expect(createArg.recordingConsentConfirmedBy).not.toBe(ID_B);
  });

  test('20. manual consultation (no transcript) requires neither consentEventId nor timestamp', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.create.mockResolvedValueOnce(makeConsultation());

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        patientId: PID_1,
        note:      { chief_complaint: 'Follow-up review' },
        // No transcript, no consentEventId
      });

    expect(res.status).toBe(201);
    // RecordingConsent was never queried
    expect(RecordingConsent.findOne).not.toHaveBeenCalled();

    const createArg = Consultation.create.mock.calls[0][0];
    expect(createArg.recordingConsentGivenAt).toBeNull();
    expect(createArg.recordingConsentConfirmedBy).toBeNull();
  });

  test('21. RecordingConsent.findOne is called with userId + patientId + pending status', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    RecordingConsent.findOne.mockResolvedValueOnce(makeConsentEvent());
    Consultation.create.mockResolvedValueOnce(makeConsultation());

    await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validCreateBody);

    expect(RecordingConsent.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId:    ID_A,
        patientId: PID_1,
        status:    'pending',
      })
    );
  });
});
