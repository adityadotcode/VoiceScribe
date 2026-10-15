'use strict';

/**
 * Phase 7 / P0-1C-Fix-A — Audio upload and transcription consent enforcement
 *
 * POST /api/audio       — must validate consentEventId before accepting upload
 * POST /api/transcribe  — must validate consentEventId before starting AWS job
 * POST /api/consultations (scope C) — atomic consent-event linking via
 *                                     findOneAndUpdate, concurrent-request
 *                                     protection, and failed-save recovery
 *
 * Scenarios:
 *
 * POST /api/audio consent enforcement (A)
 *  A1.  Unauthenticated → 401
 *  A2.  Missing consentEventId → 400
 *  A3.  Invalid (non-ObjectId) consentEventId → 400
 *  A4.  consentEventId not found / belongs to another user → 400
 *  A5.  consentEventId already linked → 400
 *  A6.  Missing audio file → 400
 *  A7.  Valid consentEventId + valid file → 200 with objectKey
 *  A8.  Valid consentEventId upload retry — event stays pending after upload
 *  A9.  Client-supplied userId in body is ignored for consent ownership check
 *
 * POST /api/transcribe consent enforcement (B)
 *  B1.  Unauthenticated → 401
 *  B2.  Missing consentEventId → 400
 *  B3.  Invalid (non-ObjectId) consentEventId → 400
 *  B4.  Missing objectKey → 400
 *  B5.  consentEventId belongs to another user → 400
 *  B6.  consentEventId already linked → 400
 *  B7.  Valid consentEventId + valid objectKey → 200 with transcript
 *  B8.  Transcription retry with same pending event → succeeds (event stays pending)
 *  B9.  Transcription failure still returns safe error message
 *
 * POST /api/consultations atomic linking (C)
 *  C1.  Race condition: findOneAndUpdate returns null → 409, consultation rolled back
 *  C2.  Failed consultation creation leaves event pending (recoverable)
 *  C3.  Successful creation + atomic link → 201, event linked
 *  C4.  Manual consultation (no transcript) — no RecordingConsent query
 */

const request  = require('supertest');
const path     = require('path');

// ---------------------------------------------------------------------------
// Mocks — must be declared before requiring app
// ---------------------------------------------------------------------------

jest.mock('../../src/models/Patient', () => ({
  findOne: jest.fn(),
  find:    jest.fn(),
  create:  jest.fn(),
}));
const Patient = require('../../src/models/Patient');

jest.mock('../../src/models/Consultation', () => ({
  findOne:          jest.fn(),
  find:             jest.fn(),
  create:           jest.fn(),
  findOneAndUpdate: jest.fn(),
  aggregate:        jest.fn(),
}));
const Consultation = require('../../src/models/Consultation');

jest.mock('../../src/models/RecordingConsent', () => {
  const mockFn = jest.fn();
  mockFn.findOne          = jest.fn();
  mockFn.findOneAndUpdate = jest.fn();
  mockFn.create           = jest.fn();
  mockFn.WORDING_VERSION  = 'v1';
  mockFn.WORDING_TEXT     = 'I confirm that the patient has been informed…';
  return mockFn;
});
const RecordingConsent = require('../../src/models/RecordingConsent');

jest.mock('../../src/services/s3Service', () => ({
  uploadAudio:       jest.fn(),
  deleteAudioObject: jest.fn().mockResolvedValue(undefined),
}));
const { uploadAudio } = require('../../src/services/s3Service');

jest.mock('../../src/services/transcribeService', () => ({
  transcribeAudio: jest.fn(),
}));
const { transcribeAudio } = require('../../src/services/transcribeService');

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

let app;
beforeAll(() => { app = require('../../src/app'); });
beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const ID_A  = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B  = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const PID_1 = '111111111111111111111111';
const CID_1 = '222222222222222222222222';
const EVT_1 = '333333333333333333333333';

const tokenA = makeToken(ID_A, 'doctora@example.com');
const tokenB = makeToken(ID_B, 'doctorb@example.com');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePatient(overrides = {}) {
  return {
    _id: { toString: () => PID_1 },
    userId: ID_A,
    isArchived: false,
    ...overrides,
  };
}

function makeConsentEvent(overrides = {}) {
  return {
    _id:       { toString: () => EVT_1 },
    userId:    ID_A,
    patientId: PID_1,
    givenAt:   new Date('2026-09-01T09:00:00.000Z'),
    status:    'pending',
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeConsultation(overrides = {}) {
  return {
    _id:      { toString: () => CID_1 },
    userId:   ID_A,
    patientId: PID_1,
    status:   'draft',
    note:     {},
    recordingConsentGivenAt:     null,
    recordingConsentConfirmedBy: null,
    deleteOne: jest.fn().mockResolvedValue(true),
    save:      jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// Minimal buffer to simulate an audio file in multipart uploads
const AUDIO_BUFFER = Buffer.from('FAKE_AUDIO_DATA');

const VALID_TRANSCRIBE_RESULT = {
  jobName:           'voicescribe-123',
  status:            'COMPLETED',
  transcript:        'Patient reports cough.',
  detectedLanguages: [{ code: 'en-IN', duration: 10 }],
  speakerUtterances: [],
};

// ===========================================================================
// A — POST /api/audio consent enforcement
// ===========================================================================

describe('A. POST /api/audio — consent enforcement', () => {

  test('A1. unauthenticated request → 401', async () => {
    const res = await request(app)
      .post('/api/audio')
      .attach('audio', AUDIO_BUFFER, { filename: 'test.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(401);
  });

  test('A2. missing consentEventId → 400', async () => {
    const res = await request(app)
      .post('/api/audio')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('audio', AUDIO_BUFFER, { filename: 'test.webm', contentType: 'audio/webm' });
      // consentEventId intentionally omitted

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/consentEventId is required/i);
  });

  test('A3. invalid (non-ObjectId) consentEventId → 400', async () => {
    const res = await request(app)
      .post('/api/audio')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('consentEventId', 'not-a-valid-id')
      .attach('audio', AUDIO_BUFFER, { filename: 'test.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/consentEventId is not a valid ID/i);
  });

  test('A4. consentEventId not found / wrong user → 400', async () => {
    RecordingConsent.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/audio')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('consentEventId', EVT_1)
      .attach('audio', AUDIO_BUFFER, { filename: 'test.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/recording consent event not found/i);
    // Confirm ownership is enforced via the query
    expect(RecordingConsent.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_A, status: 'pending' })
    );
  });

  test('A4b. consentEventId belongs to another user → 400', async () => {
    // Doctor B's token — but EVT_1 belongs to Doctor A
    RecordingConsent.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/audio')
      .set('Authorization', `Bearer ${tokenB}`)
      .field('consentEventId', EVT_1)
      .attach('audio', AUDIO_BUFFER, { filename: 'test.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(400);
    // Confirm query used Doctor B's ID from the token
    expect(RecordingConsent.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_B })
    );
  });

  test('A5. consentEventId already linked (status !== pending) → 400', async () => {
    // The query uses { status:'pending' } so linked events return null
    RecordingConsent.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/audio')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('consentEventId', EVT_1)
      .attach('audio', AUDIO_BUFFER, { filename: 'test.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(400);
  });

  test('A6. missing audio file → 400 (multer validation)', async () => {
    // No file attached at all — multer has not run yet for the consentEventId
    // check order; the controller checks consentEventId first, then req.file.
    // Here we send consentEventId but omit the file.
    RecordingConsent.findOne.mockResolvedValueOnce(makeConsentEvent());

    const res = await request(app)
      .post('/api/audio')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('consentEventId', EVT_1);
      // no .attach()

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/audio.*required/i);
  });

  test('A7. valid consentEventId + valid file → 200 with objectKey', async () => {
    RecordingConsent.findOne.mockResolvedValueOnce(makeConsentEvent());
    uploadAudio.mockResolvedValueOnce('consultations/2026-09-01-abc.webm');

    const res = await request(app)
      .post('/api/audio')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('consentEventId', EVT_1)
      .attach('audio', AUDIO_BUFFER, { filename: 'test.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.objectKey).toBe('consultations/2026-09-01-abc.webm');
    // Event is NOT linked at upload time — it stays pending for safe retries
    expect(RecordingConsent.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
  });

  test('A8. upload retry with same pending event succeeds (event stays pending)', async () => {
    // Simulate the doctor clicking Upload twice: both requests should succeed
    // because the event is only linked at consultation creation, not at upload.
    RecordingConsent.findOne
      .mockResolvedValueOnce(makeConsentEvent())  // first attempt
      .mockResolvedValueOnce(makeConsentEvent()); // retry
    uploadAudio
      .mockResolvedValueOnce('consultations/first.webm')
      .mockResolvedValueOnce('consultations/retry.webm');

    const res1 = await request(app)
      .post('/api/audio')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('consentEventId', EVT_1)
      .attach('audio', AUDIO_BUFFER, { filename: 'a.webm', contentType: 'audio/webm' });

    const res2 = await request(app)
      .post('/api/audio')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('consentEventId', EVT_1)
      .attach('audio', AUDIO_BUFFER, { filename: 'b.webm', contentType: 'audio/webm' });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body.objectKey).toBe('consultations/retry.webm');
  });

  test('A9. client-supplied userId in form data is not used for ownership check', async () => {
    RecordingConsent.findOne.mockResolvedValueOnce(makeConsentEvent());
    uploadAudio.mockResolvedValueOnce('consultations/safe.webm');

    // Attacker tries to inject their userId alongside the form
    await request(app)
      .post('/api/audio')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('consentEventId', EVT_1)
      .field('userId', ID_B)                    // attacker-supplied
      .attach('audio', AUDIO_BUFFER, { filename: 'test.webm', contentType: 'audio/webm' });

    // Ownership check must use req.user.id (ID_A), not the body field
    expect(RecordingConsent.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_A })
    );
  });
});

// ===========================================================================
// B — POST /api/transcribe consent enforcement
// ===========================================================================

describe('B. POST /api/transcribe — consent enforcement', () => {

  test('B1. unauthenticated request → 401', async () => {
    const res = await request(app)
      .post('/api/transcribe')
      .send({ objectKey: 'consultations/test.webm', consentEventId: EVT_1 });

    expect(res.status).toBe(401);
  });

  test('B2. missing consentEventId → 400', async () => {
    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ objectKey: 'consultations/test.webm' });
      // consentEventId intentionally omitted

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/consentEventId is required/i);
  });

  test('B3. invalid (non-ObjectId) consentEventId → 400', async () => {
    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ objectKey: 'consultations/test.webm', consentEventId: 'not-valid' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/consentEventId is not a valid ID/i);
  });

  test('B4. missing objectKey → 400', async () => {
    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ consentEventId: EVT_1 });
      // objectKey intentionally omitted

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/S3 object key is required/i);
  });

  test('B5. consentEventId belongs to another user → 400', async () => {
    RecordingConsent.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ objectKey: 'consultations/test.webm', consentEventId: EVT_1 });

    expect(res.status).toBe(400);
    expect(RecordingConsent.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_B })
    );
  });

  test('B6. consentEventId already linked → 400', async () => {
    RecordingConsent.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ objectKey: 'consultations/test.webm', consentEventId: EVT_1 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already been used/i);
  });

  test('B7. valid consentEventId + valid objectKey → 200 with transcript', async () => {
    RecordingConsent.findOne.mockResolvedValueOnce(makeConsentEvent());
    transcribeAudio.mockResolvedValueOnce(VALID_TRANSCRIBE_RESULT);

    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ objectKey: 'consultations/test.webm', consentEventId: EVT_1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.transcript).toBe('Patient reports cough.');
    // Event NOT linked at transcription time
    expect(RecordingConsent.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
  });

  test('B8. transcription retry with same pending event succeeds', async () => {
    RecordingConsent.findOne
      .mockResolvedValueOnce(makeConsentEvent())
      .mockResolvedValueOnce(makeConsentEvent());
    transcribeAudio
      .mockResolvedValueOnce(VALID_TRANSCRIBE_RESULT)
      .mockResolvedValueOnce(VALID_TRANSCRIBE_RESULT);

    const r1 = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ objectKey: 'consultations/test.webm', consentEventId: EVT_1 });

    const r2 = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ objectKey: 'consultations/test.webm', consentEventId: EVT_1 });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  test('B9. transcription failure returns safe generic message', async () => {
    RecordingConsent.findOne.mockResolvedValueOnce(makeConsentEvent());
    transcribeAudio.mockRejectedValueOnce(
      new Error('InternalConnectionError: socket closed')
    );

    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ objectKey: 'consultations/test.webm', consentEventId: EVT_1 });

    expect(res.status).toBe(500);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/InternalConnectionError/);
    expect(body).not.toMatch(/socket closed/i);
    expect(res.body.message).toBe('Transcription failed. Please try again.');
  });
});

// ===========================================================================
// C — POST /api/consultations — atomic consent-event linking (scope C)
// ===========================================================================

describe('C. POST /api/consultations — atomic linking', () => {

  // The body we send for tests in this section
  const RECORDED_BODY = {
    patientId:      PID_1,
    transcript:     'Patient reports cough for 3 days.',
    note:           { chief_complaint: 'cough' },
    consentEventId: EVT_1,
  };

  test('C1. concurrent request — findOneAndUpdate returns null → 409, consultation rolled back', async () => {
    // Simulate race condition: pre-flight read succeeds (event looks pending),
    // but by the time we call findOneAndUpdate another request claimed it first.
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    // Pre-flight findOne (lean) returns the pending event
    RecordingConsent.findOne.mockResolvedValueOnce(makeConsentEvent());
    // Consultation is created
    const doc = makeConsultation();
    Consultation.create.mockResolvedValueOnce(doc);
    // Atomic claim fails — another request already linked the event
    RecordingConsent.findOneAndUpdate.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(RECORDED_BODY);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/concurrent request/i);
    // Consultation must be rolled back
    expect(doc.deleteOne).toHaveBeenCalledTimes(1);
  });

  test('C2. failed consultation create leaves event still pending (recoverable)', async () => {
    // If Consultation.create throws, findOneAndUpdate is never called,
    // so the event stays pending and the doctor can retry.
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    RecordingConsent.findOne.mockResolvedValueOnce(makeConsentEvent());
    Consultation.create.mockRejectedValueOnce(new Error('DB write error'));

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(RECORDED_BODY);

    expect(res.status).toBe(500);
    // findOneAndUpdate never reached
    expect(RecordingConsent.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('C3. successful create + atomic link → 201, findOneAndUpdate called with correct filter', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    const event = makeConsentEvent();
    RecordingConsent.findOne.mockResolvedValueOnce(event);
    Consultation.create.mockResolvedValueOnce(makeConsultation());
    // findOneAndUpdate returns the old doc (non-null = success)
    RecordingConsent.findOneAndUpdate.mockResolvedValueOnce(event);

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(RECORDED_BODY);

    expect(res.status).toBe(201);

    // Verify the atomic claim used correct filter and update
    expect(RecordingConsent.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ID_A,
        status: 'pending',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'linked' }),
      }),
      expect.any(Object)
    );
  });

  test('C4. manual consultation (no transcript) — no RecordingConsent queries at all', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Consultation.create.mockResolvedValueOnce(makeConsultation());

    const res = await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        patientId: PID_1,
        note:      { chief_complaint: 'Follow-up' },
        // No transcript, no consentEventId
      });

    expect(res.status).toBe(201);
    expect(RecordingConsent.findOne).not.toHaveBeenCalled();
    expect(RecordingConsent.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
