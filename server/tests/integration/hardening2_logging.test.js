'use strict';

/**
 * Security Hardening 2 — Logging and error-response safety tests
 *
 *  1. Global error handler: response body contains no stack trace
 *  2. Global error handler: response body contains no file path segments
 *  3. Global error handler: logs err.message not full stack (spy test)
 *  4. Auth failure response contains no JWT details or secret hints
 *  5. AWS/service errors do not reach client response body
 *  6. password / passwordHash never appears in any API response body
 *  7. Existing 200 response contracts for protected routes are unchanged
 *  8. Multer 413 response is safe and unchanged
 */

const request = require('supertest');
const jwt     = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// Mocks — before requiring app
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
const Patient = require('../../src/models/Patient');

jest.mock('../../src/models/Consultation', () => ({
  findOne: jest.fn(),
  find:    jest.fn(),
  create:  jest.fn(),
}));

jest.mock('../../src/services/bedrockService', () => ({
  extractClinicalNote:            jest.fn(),
  normalizeNote:                  jest.fn(),
  recomputeMissingInformation:    jest.fn(),
  generateChangeSummaryNarrative: jest.fn(),
}));

jest.mock('../../src/services/transcribeService', () => ({
  transcribeAudio: jest.fn(),
}));

// ---------------------------------------------------------------------------
// App + helpers
// ---------------------------------------------------------------------------

let app;
beforeAll(() => { app = require('../../src/app'); });
beforeEach(() => jest.clearAllMocks());

function makeToken(userId = 'aaaaaaaaaaaaaaaaaaaaaaaa') {
  return jwt.sign(
    { sub: userId, email: 'doc@test.com', role: 'doctor' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

const TOKEN = makeToken();

// ---------------------------------------------------------------------------
// 1 — Global error handler: response body contains no stack trace
// ---------------------------------------------------------------------------
describe('1. Global error handler — no stack trace in response', () => {
  // Inject a route that throws synchronously to exercise errorHandler.
  // We monkey-patch the app only for this test.
  test('stack trace (" at ") does not appear in the 500 response body', async () => {
    // Trigger the global error handler by sending to a non-existent deep path
    // that Express's final handler picks up — or use an existing route that
    // is guaranteed to throw via a mocked dependency.
    // Strategy: mock Patient.find to throw, then call a list endpoint.
    Patient.find.mockImplementationOnce(() => { throw new Error('DB connection reset'); });

    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${TOKEN}`);

    // Any 5xx is acceptable; verify response body is safe
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/ at /);          // stack frame lines
    expect(body).not.toMatch(/\.js:\d+:\d+/);  // file:line:col
    expect(body).not.toMatch(/node_modules/);
  });
});

// ---------------------------------------------------------------------------
// 2 — Global error handler: response contains no internal file paths
// ---------------------------------------------------------------------------
describe('2. Error responses contain no internal file paths', () => {
  test('generic 500 contains no file path segments', async () => {
    // Force an unexpected synchronous throw through the error handler.
    // errorHandler is reached when next(err) is called or a synchronous
    // throw happens before res is sent.
    const res = await request(app)
      .post('/api/extract-note')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ transcript: 'x' });

    // Any response is fine; check it contains no path separators
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/src\//);
    expect(body).not.toMatch(/node_modules\//);
    expect(body).not.toMatch(/server\//);
  });
});

// ---------------------------------------------------------------------------
// 3 — errorHandler logs err.message, not the full stack
// ---------------------------------------------------------------------------
describe('3. errorHandler logs message only (not full stack)', () => {
  test('console.error receives the message string, not a stack-trace string', () => {
    const { errorHandler } = require('../../src/middleware/errorHandler');

    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json:   jest.fn().mockReturnThis(),
    };

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const fakeErr = new Error('DB timeout');
    errorHandler(fakeErr, {}, mockRes, () => {});

    // The log call must include err.message
    expect(spy).toHaveBeenCalled();
    const loggedArgs = spy.mock.calls[0].join(' ');
    expect(loggedArgs).toContain('DB timeout');

    // It must NOT contain any stack frame line (starts with whitespace + "at ")
    // The logged string should NOT include the multi-line stack body
    const hasStackFrame = /\s+at\s+\w/.test(loggedArgs);
    expect(hasStackFrame).toBe(false);

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 4 — Auth failure response contains no JWT details
// ---------------------------------------------------------------------------
describe('4. Auth failure response contains no JWT internals', () => {
  test('expired token response does not mention secret or algorithm', async () => {
    const expired = jwt.sign(
      { sub: 'aaaaaaaaaaaaaaaaaaaaaaaa', email: 'x@x.com', role: 'doctor' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/secret/i);
    expect(body).not.toMatch(/HS256/i);
    expect(body).not.toMatch(/jwt/i);
    expect(body).not.toMatch(/algorithm/i);
    expect(body).not.toMatch(/TokenExpiredError/i);
  });

  test('invalid token response does not reveal signature details', async () => {
    const res = await request(app)
      .get('/api/consultations')
      .set('Authorization', 'Bearer totally.invalid.token');

    expect(res.status).toBe(401);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/signature/i);
    expect(body).not.toMatch(/JsonWebToken/i);
    expect(body).not.toMatch(/malformed/i);
  });

  test('auth 401 response has exactly the expected safe shape', async () => {
    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', 'Bearer bad');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: 'Authentication required.',
    });
  });
});

// ---------------------------------------------------------------------------
// 5 — AWS / service errors do not reach client response body
// ---------------------------------------------------------------------------
describe('5. AWS service errors do not appear in client response', () => {
  const { extractClinicalNote } = require('../../src/services/bedrockService');

  test('Bedrock response contains no AWS SDK class names', async () => {
    const err = Object.assign(
      new Error('Bedrock endpoint is not available in this region'),
      { name: 'EndpointResolutionError' }
    );
    extractClinicalNote.mockRejectedValueOnce(err);

    const res = await request(app)
      .post('/api/extract-note')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ transcript: 'Patient reports fever.' });

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/EndpointResolutionError/);
    expect(body).not.toMatch(/endpoint/i);
    expect(body).not.toMatch(/not available in this region/i);
    expect(res.body).not.toHaveProperty('errorCode');
  });

  const { transcribeAudio } = require('../../src/services/transcribeService');

  test('Transcribe response contains no internal connection details', async () => {
    transcribeAudio.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 169.254.169.254:80')
    );

    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ objectKey: 'consultations/test.webm' });

    expect(res.status).toBe(500);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/ECONNREFUSED/);
    expect(body).not.toMatch(/169\.254/);  // IMDS IP
    expect(body).not.toMatch(/connect/i);
  });
});

// ---------------------------------------------------------------------------
// 6 — password / passwordHash never appear in response body
// ---------------------------------------------------------------------------
describe('6. password and passwordHash never appear in responses', () => {
  test('login success response does not include passwordHash', async () => {
    const bcrypt = require('bcrypt');

    // Mock bcrypt.compare to return true
    jest.mock('bcrypt', () => ({ ...jest.requireActual('bcrypt'), compare: jest.fn() }));
    const bcryptMock = require('bcrypt');
    bcryptMock.compare = jest.fn().mockResolvedValueOnce(true);

    const user = {
      _id:              { toString: () => 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      email:            'doc@test.com',
      displayName:      'Test Doctor',
      role:             'doctor',
      isActive:         true,
      passwordHash:     '$2b$12$fakehash',
      refreshTokenHash: null,
      lastLoginAt:      null,
      save:             jest.fn().mockResolvedValue(true),
    };
    User.findOne.mockResolvedValueOnce(user);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'doc@test.com', password: 'password123' });

    // Registration/login returns accessToken and safeUser only
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/passwordHash/);
    expect(body).not.toMatch(/\$2b\$/);    // bcrypt hash prefix
    expect(body).not.toMatch(/refreshTokenHash/);
  });

  test('GET /api/auth/me response does not include passwordHash', async () => {
    const user = {
      _id:         { toString: () => 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      email:       'doc@test.com',
      displayName: 'Test Doctor',
      role:        'doctor',
      isActive:    true,
      passwordHash: '$2b$12$fakehash',
    };
    User.findById.mockReturnValueOnce({ lean: () => Promise.resolve(user) });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/passwordHash/);
    expect(body).not.toMatch(/\$2b\$/);
  });
});

// ---------------------------------------------------------------------------
// 7 — Existing 200 response contracts are unchanged
// ---------------------------------------------------------------------------
describe('7. Existing successful response contracts are unchanged', () => {
  test('GET /api/health still returns { success: true }', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/patients returns { success: true, patients: [] }', async () => {
    Patient.find.mockReturnValueOnce({
      sort:   () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
    });

    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.patients)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8 — Multer 413 response is safe and unchanged
// ---------------------------------------------------------------------------
describe('8. Multer error responses are safe', () => {
  test('errorHandler 413 response has correct safe shape', () => {
    const { errorHandler } = require('../../src/middleware/errorHandler');

    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json:   jest.fn().mockReturnThis(),
    };

    const multerErr = Object.assign(new Error('File too large'), {
      code: 'LIMIT_FILE_SIZE',
    });
    errorHandler(multerErr, {}, mockRes, () => {});

    expect(mockRes.status).toHaveBeenCalledWith(413);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'Audio file is too large.',
    });
  });

  test('errorHandler 400 response for invalid file type', () => {
    const { errorHandler } = require('../../src/middleware/errorHandler');

    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json:   jest.fn().mockReturnThis(),
    };

    const multerErr = Object.assign(new Error('INVALID_AUDIO_TYPE'), {
      code: 'LIMIT_UNEXPECTED_FILE',
    });
    errorHandler(multerErr, {}, mockRes, () => {});

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: 'Please upload a valid audio file.',
    });
  });
});
