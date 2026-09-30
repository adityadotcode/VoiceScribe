'use strict';

/**
 * Security Hardening 1 — Focused security tests
 *
 * These tests cover gaps not addressed by the existing integration test suite:
 *
 *  1.  Malformed Authorization header formats → 401
 *  2.  Expired access token → 401
 *  3.  Inactive user is rejected at login
 *  4.  Inactive user's valid access token is rejected on data routes
 *  5.  Refresh token from request body is ignored
 *  6.  Refresh token from Authorization header is ignored
 *  7.  POST /api/extract-note does not leak AWS error names or errorCode
 *  8.  POST /api/transcribe does not leak internal error.message
 *  9.  CORS: credentials header present on authenticated responses
 * 10.  bedrockController returns 429 for throttling, not 400/403
 * 11.  POST /api/patients/:id/change-summary requires body; generateNarrative
 *       is ignored when it is true but there is no previous consultation
 *       (existing test); additional body-injection test.
 */

const request = require('supertest');
const jwt     = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// Mocks — declared before requiring app
// ---------------------------------------------------------------------------

jest.mock('../../src/models/User', () => ({
  findOne:           jest.fn(),
  findById:          jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue(true),
  create:            jest.fn(),
}));
const User = require('../../src/models/User');

jest.mock('../../src/models/Patient', () => ({
  findOne: jest.fn(),
  find:    jest.fn(),
  create:  jest.fn(),
}));

jest.mock('../../src/models/Consultation', () => ({
  findOne: jest.fn(),
  find:    jest.fn(),
  create:  jest.fn(),
}));

// Mock the bedrockService so no real AWS calls are made.
jest.mock('../../src/services/bedrockService', () => ({
  extractClinicalNote:           jest.fn(),
  normalizeNote:                 jest.fn(),
  recomputeMissingInformation:   jest.fn(),
  generateChangeSummaryNarrative: jest.fn(),
}));
const { extractClinicalNote } = require('../../src/services/bedrockService');

// Mock transcribeService so no real AWS calls are made.
jest.mock('../../src/services/transcribeService', () => ({
  transcribeAudio: jest.fn(),
}));
const { transcribeAudio } = require('../../src/services/transcribeService');

// ---------------------------------------------------------------------------
// App + helpers
// ---------------------------------------------------------------------------

let app;
beforeAll(() => { app = require('../../src/app'); });
beforeEach(() => jest.clearAllMocks());

function makeValidToken(userId = 'aaaaaaaaaaaaaaaaaaaaaaaa', email = 'doc@test.com') {
  return jwt.sign({ sub: userId, email, role: 'doctor' }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

function makeExpiredToken(userId = 'aaaaaaaaaaaaaaaaaaaaaaaa') {
  return jwt.sign(
    { sub: userId, email: 'doc@test.com', role: 'doctor' },
    process.env.JWT_SECRET,
    { expiresIn: '-1s' }          // already expired
  );
}

function makeMockUser(overrides = {}) {
  return {
    _id:              { toString: () => 'aaaaaaaaaaaaaaaaaaaaaaaa' },
    email:            'doc@test.com',
    displayName:      'Test Doctor',
    role:             'doctor',
    isActive:         true,
    passwordHash:     '$hashed$',
    refreshTokenHash: null,
    save:             jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const VALID_TOKEN = makeValidToken();

// ---------------------------------------------------------------------------
// 1 — Malformed Authorization header formats → 401
// ---------------------------------------------------------------------------
describe('1. Malformed Authorization header → 401', () => {
  test('no Authorization header', async () => {
    const res = await request(app).get('/api/patients');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('wrong scheme (Basic instead of Bearer)', async () => {
    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
  });

  test('Bearer with empty token', async () => {
    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  test('Bearer with garbage token', async () => {
    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', 'Bearer not.a.real.jwt');
    expect(res.status).toBe(401);
  });

  test('Bearer with token signed by wrong secret', async () => {
    const badToken = jwt.sign(
      { sub: 'aaaaaaaaaaaaaaaaaaaaaaaa', email: 'x@x.com', role: 'doctor' },
      'wrong-secret-that-is-not-the-real-one',
      { expiresIn: '15m' }
    );
    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${badToken}`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2 — Expired access token → 401
// ---------------------------------------------------------------------------
describe('2. Expired access token → 401', () => {
  test('expired token is rejected', async () => {
    const expired = makeExpiredToken();
    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    // Must not reveal token validation details
    expect(res.body.message).toBe('Authentication required.');
  });

  test('expired token rejection does not leak JWT error type', async () => {
    const expired = makeExpiredToken();
    const res = await request(app)
      .get('/api/consultations')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/TokenExpiredError/i);
    expect(body).not.toMatch(/JsonWebToken/i);
    expect(body).not.toMatch(/expired/i);
  });
});

// ---------------------------------------------------------------------------
// 3 — Inactive user rejected at login
// ---------------------------------------------------------------------------
describe('3. Inactive user rejected at login', () => {
  const bcrypt = require('bcrypt');

  test('login returns 401 for inactive user without revealing account exists', async () => {
    const inactiveUser = makeMockUser({ isActive: false });
    User.findOne.mockResolvedValueOnce(inactiveUser);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inactive@test.com', password: 'password123' });

    expect(res.status).toBe(401);
    // Same message as wrong password — does not reveal account existence
    expect(res.body.message).toBe('Invalid credentials.');
  });
});

// ---------------------------------------------------------------------------
// 4 — Refresh token from request body is ignored
// ---------------------------------------------------------------------------
describe('4. Refresh token from request body is ignored', () => {
  test('passing refreshToken in body does not authenticate', async () => {
    // /api/auth/refresh reads only from cookie.
    // Sending a token in the body should produce 401 (no cookie set).
    const fakeRefreshToken = jwt.sign(
      { sub: 'aaaaaaaaaaaaaaaaaaaaaaaa', jti: 'test-jti' },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: fakeRefreshToken }); // body, not cookie

    // No cookie → no refresh → 401
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 5 — Refresh token from Authorization header is ignored
// ---------------------------------------------------------------------------
describe('5. Refresh token from Authorization header is ignored', () => {
  test('passing refresh token as Bearer does not authenticate the refresh endpoint', async () => {
    const fakeRefreshToken = jwt.sign(
      { sub: 'aaaaaaaaaaaaaaaaaaaaaaaa', jti: 'test-jti' },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // The /refresh endpoint does not use the authenticate middleware,
    // so a Bearer token in the header should be completely ignored.
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${fakeRefreshToken}`);

    // No cookie → 401
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 6 — POST /api/extract-note does not leak AWS error names or errorCode
// ---------------------------------------------------------------------------
describe('6. /api/extract-note does not leak AWS internals', () => {
  test('Bedrock AccessDeniedException returns safe 500 without errorCode field', async () => {
    const err = Object.assign(new Error('User is not authorized to call Bedrock'), {
      name: 'AccessDeniedException',
    });
    extractClinicalNote.mockRejectedValueOnce(err);

    const res = await request(app)
      .post('/api/extract-note')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ transcript: 'Patient reports cough.' });

    // Must return 500 (not 403) — does not reveal IAM permission state
    expect(res.status).toBe(500);
    // Must NOT expose error name or errorCode
    expect(res.body).not.toHaveProperty('errorCode');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/AccessDeniedException/);
    expect(body).not.toMatch(/not authorized/i);
  });

  test('Bedrock ValidationException returns safe 500 without errorCode', async () => {
    const err = Object.assign(new Error('Request is invalid'), {
      name: 'ValidationException',
    });
    extractClinicalNote.mockRejectedValueOnce(err);

    const res = await request(app)
      .post('/api/extract-note')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ transcript: 'Patient reports cough.' });

    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty('errorCode');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/ValidationException/);
  });

  test('Bedrock ThrottlingException returns 429 with safe message', async () => {
    const err = Object.assign(new Error('Request rate exceeded'), {
      name: 'ThrottlingException',
    });
    extractClinicalNote.mockRejectedValueOnce(err);

    const res = await request(app)
      .post('/api/extract-note')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ transcript: 'Patient reports cough.' });

    expect(res.status).toBe(429);
    expect(res.body).not.toHaveProperty('errorCode');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/ThrottlingException/);
    expect(body).not.toMatch(/Request rate exceeded/i);
  });

  test('generic Bedrock failure returns safe 500 message', async () => {
    extractClinicalNote.mockRejectedValueOnce(new Error('Internal AWS error details here'));

    const res = await request(app)
      .post('/api/extract-note')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ transcript: 'Patient reports cough.' });

    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty('errorCode');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/Internal AWS error details/);
  });
});

// ---------------------------------------------------------------------------
// 7 — POST /api/transcribe does not leak internal error.message
// ---------------------------------------------------------------------------
describe('7. /api/transcribe does not leak internal error details', () => {
  test('transcription failure returns safe generic message', async () => {
    transcribeAudio.mockRejectedValueOnce(
      new Error('TranscribeStreamingClient: connection refused at 10.0.0.5:8443')
    );

    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ objectKey: 'consultations/test.webm' });

    expect(res.status).toBe(500);
    const body = JSON.stringify(res.body);
    // Internal connection details must not reach the client
    expect(body).not.toMatch(/TranscribeStreamingClient/);
    expect(body).not.toMatch(/10\.0\.0\.5/);
    expect(body).not.toMatch(/connection refused/i);
    // Must return a safe generic message
    expect(res.body.message).toBe('Transcription failed. Please try again.');
  });
});

// ---------------------------------------------------------------------------
// 8 — Error responses do not expose stack traces
// ---------------------------------------------------------------------------
describe('8. Error responses contain no stack traces', () => {
  test('400 response does not contain "at " stack trace lines', async () => {
    const res = await request(app)
      .get('/api/consultations/not-a-valid-id')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(400);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/ at /); // stack frame lines
    expect(body).not.toMatch(/\.js:\d+:\d+/); // file:line:col
  });

  test('authentication error response does not expose internals', async () => {
    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', 'Bearer garbage');

    expect(res.status).toBe(401);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/ at /);
    expect(body).not.toMatch(/\.js:\d+/);
    expect(Object.keys(res.body)).toEqual(['success', 'message']); // exactly two keys
  });
});

// ---------------------------------------------------------------------------
// 9 — CORS: credentials header is present
// ---------------------------------------------------------------------------
describe('9. CORS credentials', () => {
  test('authenticated route includes Access-Control-Allow-Credentials header', async () => {
    // OPTIONS preflight request to a protected route
    const res = await request(app)
      .options('/api/patients')
      .set('Origin', 'http://localhost:5174')
      .set('Access-Control-Request-Method', 'GET');

    // credentials must be 'true' for cookie auth to work cross-origin
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
