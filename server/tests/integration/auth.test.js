/**
 * Phase 1A — Authentication and Authorization tests
 *
 * Strategy:
 *   - MongoDB models mocked via jest.mock (no real DB connections).
 *   - bcrypt mocked for speed (still validates API shape).
 *   - jsonwebtoken NOT mocked — real JWT with test secrets from setup.js.
 *   - Rate limiters are bypassed in test mode (authRoutes.js checks NODE_ENV).
 *
 * Query-chaining mocks:
 *   Mongoose methods like findOne().lean() and findById().lean() return
 *   query objects that must be chained.  We mock them to return objects
 *   with a .lean() method that resolves the promise.
 */

const request = require('supertest');

// ---------------------------------------------------------------------------
// Mocks — declared before requiring app
// ---------------------------------------------------------------------------

jest.mock('bcrypt', () => ({
  hash:    jest.fn().mockResolvedValue('$hashed$'),
  compare: jest.fn(),
}));
const bcrypt = require('bcrypt');

// Helper: create a lean-chainable mock query
function leanResult(value) {
  return { lean: () => Promise.resolve(value) };
}

// ── User model mock ──────────────────────────────────────────────────────
jest.mock('../../src/models/User', () => {
  return {
    findOne:           jest.fn(),
    findById:          jest.fn(),
    findByIdAndUpdate: jest.fn().mockResolvedValue(true),
    create:            jest.fn(),
  };
});
const User = require('../../src/models/User');

// ── Patient model mock ───────────────────────────────────────────────────
// Phase 3A: consultationController now imports Patient to verify ownership.
jest.mock('../../src/models/Patient', () => {
  return {
    findOne: jest.fn(),
    find:    jest.fn(),
    create:  jest.fn(),
  };
});
const Patient = require('../../src/models/Patient');

// ── Consultation model mock ──────────────────────────────────────────────
jest.mock('../../src/models/Consultation', () => {
  return {
    find:    jest.fn(),
    findOne: jest.fn(),
    create:  jest.fn(),
  };
});
const Consultation = require('../../src/models/Consultation');

// ---------------------------------------------------------------------------
// App — loaded after mocks
// ---------------------------------------------------------------------------
let app;
beforeAll(() => { app = require('../../src/app'); });
beforeEach(() => { jest.clearAllMocks(); });

// ---------------------------------------------------------------------------
// Shared mock user shape
// ---------------------------------------------------------------------------
function makeMockUser(overrides = {}) {
  return {
    _id:              { toString: () => 'aaaa00000000000000000001' },
    email:            'doctora@example.com',
    displayName:      'Doctor A',
    role:             'doctor',
    isActive:         true,
    lastLoginAt:      null,
    passwordHash:     '$hashed$',
    refreshTokenHash: '$hashed$',
    save:             jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: perform a full login and return { accessToken, cookie }
// ---------------------------------------------------------------------------
async function loginAs(opts = {}) {
  const email    = opts.email    ?? 'doctora@example.com';
  const password = opts.password ?? 'password123';
  const user     = opts.user     ?? makeMockUser();

  bcrypt.compare.mockResolvedValueOnce(true);
  User.findOne.mockResolvedValueOnce(user);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password });

  return {
    accessToken: res.body.accessToken,
    cookie:      res.headers['set-cookie'],
    status:      res.status,
    body:        res.body,
  };
}

// ---------------------------------------------------------------------------
// 1 — REGISTER
// ---------------------------------------------------------------------------
describe('POST /api/auth/register', () => {
  test('1. registers a valid user → 201 + accessToken + safe user shape', async () => {
    User.findOne.mockResolvedValueOnce(null); // no existing user
    User.create.mockResolvedValueOnce(makeMockUser());

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password: 'securepass1', displayName: 'New Doc' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.user).toMatchObject({ email: 'doctora@example.com', role: 'doctor' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.refreshTokenHash).toBeUndefined();
    // Refresh cookie must be set
    const cookies = (res.headers['set-cookie'] || []).join(' ');
    expect(cookies).toContain('voicescribe_refresh');
    expect(cookies.toLowerCase()).toContain('httponly');
  });

  test('2. duplicate email returns 409', async () => {
    User.findOne.mockResolvedValueOnce(makeMockUser()); // email exists

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'exists@example.com', password: 'password123', displayName: 'Doc' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  test('3a. missing email → 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ password: 'password123', displayName: 'Doc' });
    expect(res.status).toBe(400);
  });

  test('3b. invalid email format → 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'password123', displayName: 'Doc' });
    expect(res.status).toBe(400);
  });

  test('3c. password shorter than 8 chars → 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'abc', displayName: 'Doc' });
    expect(res.status).toBe(400);
  });

  test('3d. empty displayName → 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'password123', displayName: '' });
    expect(res.status).toBe(400);
  });

  test('4. password stored as bcrypt hash, never as plaintext', async () => {
    User.findOne.mockResolvedValueOnce(null);
    User.create.mockResolvedValueOnce(makeMockUser());

    await request(app).post('/api/auth/register')
      .send({ email: 'hash@example.com', password: 'plaintext!', displayName: 'Doc' });

    expect(bcrypt.hash).toHaveBeenCalledWith('plaintext!', 12);
    const callArgs = User.create.mock.calls[0][0];
    expect(callArgs.passwordHash).toBe('$hashed$');
    expect(callArgs.password).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2 — LOGIN
// ---------------------------------------------------------------------------
describe('POST /api/auth/login', () => {
  test('5. valid credentials → 200 + accessToken + HttpOnly refresh cookie', async () => {
    const { accessToken, cookie, status } = await loginAs();

    expect(status).toBe(200);
    expect(typeof accessToken).toBe('string');
    const cookieStr = (cookie || []).join(' ');
    expect(cookieStr).toContain('voicescribe_refresh');
    expect(cookieStr.toLowerCase()).toContain('httponly');
  });

  test('6. wrong password → 401 with generic message', async () => {
    bcrypt.compare.mockResolvedValueOnce(false);
    User.findOne.mockResolvedValueOnce(makeMockUser());

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'doctora@example.com', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials.');
  });

  test('6b. unknown email → 401 with same generic message', async () => {
    User.findOne.mockResolvedValueOnce(null);

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials.');
  });

  test('7. inactive user cannot login → 401', async () => {
    User.findOne.mockResolvedValueOnce(makeMockUser({ isActive: false }));

    const res = await request(app).post('/api/auth/login')
      .send({ email: 'doctora@example.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials.');
  });
});

// ---------------------------------------------------------------------------
// 3 — REFRESH
// ---------------------------------------------------------------------------
describe('POST /api/auth/refresh', () => {
  test('8. valid refresh cookie → new accessToken', async () => {
    const { cookie } = await loginAs();
    expect(cookie).toBeDefined();

    bcrypt.compare.mockResolvedValueOnce(true);
    User.findById.mockResolvedValueOnce(makeMockUser());

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
  });

  test('9. refresh without cookie → 401', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  test('10. refresh with tampered token → 401', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'voicescribe_refresh=tampered.jwt.token');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 4 — LOGOUT
// ---------------------------------------------------------------------------
describe('POST /api/auth/logout', () => {
  test('11. logout clears refresh cookie and invalidates DB hash', async () => {
    const { accessToken } = await loginAs();
    expect(accessToken).toBeDefined();

    User.findByIdAndUpdate.mockResolvedValueOnce(true);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // clearCookie sets Expires to epoch or Max-Age=0
    const cookies = (res.headers['set-cookie'] || []).join(' ');
    expect(cookies).toContain('voicescribe_refresh');
    // Express clearCookie uses Expires=Thu, 01 Jan 1970 (epoch)
    expect(cookies).toMatch(/Expires=|Max-Age=0/i);
  });
});

// ---------------------------------------------------------------------------
// 5 — /api/auth/me
// ---------------------------------------------------------------------------
describe('GET /api/auth/me', () => {
  test('12. valid access token → user (no sensitive fields)', async () => {
    const { accessToken } = await loginAs();
    expect(accessToken).toBeDefined();

    // me() calls User.findById(...).lean() — mock with chaining support
    User.findById.mockReturnValueOnce(leanResult(makeMockUser()));

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('doctora@example.com');
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.refreshTokenHash).toBeUndefined();
  });

  test('13. no token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('14. invalid token → 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.jwt.token');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 6 — AUTHORIZATION (consultation ownership)
// ---------------------------------------------------------------------------

// Build real access tokens from test secrets (from setup.js)
function makeToken(userId, email, role = 'doctor') {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ sub: userId, email, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const tokenA = makeToken(ID_A, 'doctora@example.com');
const tokenB = makeToken(ID_B, 'doctorb@example.com');

function makeConsultation(overrides = {}) {
  return {
    _id:       { toString: () => '111111111111111111111111' },
    userId:    ID_A,
    status:    'draft',
    note:      { chief_complaint: 'cough', symptoms: [], missing_information: [] },
    save:      jest.fn().mockResolvedValue(true),
    deleteOne: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('Consultation authorization', () => {
  test('15. listConsultations filters by req.user.id', async () => {
    Consultation.find.mockReturnValueOnce({
      sort: () => ({
        select: () => ({
          lean: () => Promise.resolve([makeConsultation()]),
        }),
      }),
    });

    const res = await request(app)
      .get('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(Consultation.find).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_A })
    );
  });

  test('16. Doctor A cannot GET Doctor B consultation → 404', async () => {
    // findOne returns null because userId filter doesn't match
    Consultation.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get('/api/consultations/111111111111111111111111')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(Consultation.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_A })
    );
  });

  test('17. Doctor A cannot PUT Doctor B consultation → 404', async () => {
    Consultation.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .put('/api/consultations/111111111111111111111111')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ note: { chief_complaint: 'attack', symptoms: [] } });

    expect(res.status).toBe(404);
  });

  test('18. Doctor A cannot DELETE Doctor B consultation → 404', async () => {
    Consultation.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .delete('/api/consultations/111111111111111111111111')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });

  test('19. client-supplied userId is ignored; req.user.id is used', async () => {
    // Phase 3A: createConsultation now requires a patientId and verifies
    // patient ownership, so we must supply both a valid patientId and a
    // Patient.findOne mock that returns a matching patient.
    const patientId = '111111111111111111111111';
    Patient.findOne.mockReturnValueOnce(
      leanResult({ _id: patientId, userId: ID_A, isArchived: false })
    );
    Consultation.create.mockResolvedValueOnce(makeConsultation());

    await request(app)
      .post('/api/consultations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, userId: 'hacker-id', note: { chief_complaint: 'test', symptoms: [] } });

    expect(Consultation.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_A })
    );
    const callArg = Consultation.create.mock.calls[0][0];
    expect(callArg.userId).toBe(ID_A);
    expect(callArg.userId).not.toBe('hacker-id');
  });

  test('21. unauthenticated GET /api/consultations → 401', async () => {
    const res = await request(app).get('/api/consultations');
    expect(res.status).toBe(401);
  });

  test('21b. unauthenticated POST /api/consultations → 401', async () => {
    const res = await request(app).post('/api/consultations').send({});
    expect(res.status).toBe(401);
  });

  test('22. approved consultation cannot be modified → 403', async () => {
    const approved = makeConsultation({ status: 'approved' });
    Consultation.findOne.mockResolvedValueOnce(approved);

    const res = await request(app)
      .put('/api/consultations/111111111111111111111111')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ note: { chief_complaint: 'changed', symptoms: [] } });

    expect(res.status).toBe(403);
    expect(approved.save).not.toHaveBeenCalled();
  });

  test('23. approved consultation cannot be deleted → 403', async () => {
    const approved = makeConsultation({ status: 'approved' });
    Consultation.findOne.mockResolvedValueOnce(approved);

    const res = await request(app)
      .delete('/api/consultations/111111111111111111111111')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
    expect(approved.deleteOne).not.toHaveBeenCalled();
  });

  test('20. malformed :id returns 400', async () => {
    const res = await request(app)
      .get('/api/consultations/not-a-valid-id')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 7 — REGRESSION
// ---------------------------------------------------------------------------
describe('Regression — existing tests still pass', () => {
  test('24. GET /api/health → 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('ok');
  });

  test('25. app module loaded without throwing', () => {
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe('function');
  });

  test('26. unknown /api route without token → 401 (authenticate runs first)', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(401);
  });
});
