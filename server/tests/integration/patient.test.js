/**
 * Phase 2A — Patient API tests
 *
 * Strategy: same as Phase 1A auth tests.
 *   - Patient model mocked via jest.mock (no real DB).
 *   - Real JWT tokens built from test secrets (setup.js).
 *   - Ownership rules verified by inspecting query arguments.
 */

const request = require('supertest');

// ---------------------------------------------------------------------------
// Mocks — declared before requiring app
// ---------------------------------------------------------------------------

jest.mock('../../src/models/Patient', () => {
  const mockModel = {
    findOne:  jest.fn(),
    find:     jest.fn(),
    create:   jest.fn(),
    findById: jest.fn(),
  };
  return mockModel;
});
const Patient = require('../../src/models/Patient');

// ---------------------------------------------------------------------------
// App + token helpers
// ---------------------------------------------------------------------------

let app;
beforeAll(() => { app = require('../../src/app'); });
beforeEach(() => jest.clearAllMocks());

function makeToken(userId, email = 'doc@example.com', role = 'doctor') {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ sub: userId, email, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

const ID_A  = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B  = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const PID_1 = '111111111111111111111111';

const tokenA = makeToken(ID_A, 'doctora@example.com');
const tokenB = makeToken(ID_B, 'doctorb@example.com');

// A valid patient document owned by Doctor A
function makePatient(overrides = {}) {
  return {
    _id:             { toString: () => PID_1 },
    userId:          ID_A,
    firstName:       'Alice',
    lastName:        'Smith',
    dateOfBirth:     new Date('1990-05-15'),
    biologicalSex:   'female',
    phone:           '',
    medicalRecordId: 'MR001',
    notes:           '',
    isArchived:      false,
    save:            jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// lean()-chainable query helper (mirrors Phase 1A pattern)
function leanResult(value) {
  return { lean: () => Promise.resolve(value) };
}

// ---------------------------------------------------------------------------
// 1 — Unauthenticated request
// ---------------------------------------------------------------------------
describe('Authentication guard', () => {
  test('1. unauthenticated POST /api/patients → 401', async () => {
    const res = await request(app).post('/api/patients').send({});
    expect(res.status).toBe(401);
  });

  test('1b. unauthenticated GET /api/patients → 401', async () => {
    const res = await request(app).get('/api/patients');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2 — Create patient
// ---------------------------------------------------------------------------
describe('POST /api/patients', () => {
  const validBody = {
    firstName:   'Alice',
    lastName:    'Smith',
    dateOfBirth: '1990-05-15',
    biologicalSex: 'female',
  };

  test('2. authenticated create patient → 201', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(null)); // no duplicate
    Patient.create.mockResolvedValueOnce(makePatient());

    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.patient).toBeDefined();
  });

  test('3. created patient receives req.user.id as userId (not from client)', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(null));
    Patient.create.mockResolvedValueOnce(makePatient());

    await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validBody);

    const createCall = Patient.create.mock.calls[0][0];
    expect(createCall.userId).toBe(ID_A);
    expect(createCall.userId).not.toBe(ID_B);
  });

  test('4. client-supplied userId is ignored in favour of req.user.id', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(null));
    Patient.create.mockResolvedValueOnce(makePatient());

    await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validBody, userId: 'hacker-id' });

    const createCall = Patient.create.mock.calls[0][0];
    expect(createCall.userId).toBe(ID_A);
    expect(createCall.userId).not.toBe('hacker-id');
  });

  test('missing required fields → 400', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Alice' }); // missing lastName, dateOfBirth, biologicalSex
    expect(res.status).toBe(400);
  });

  test('invalid biologicalSex → 400', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validBody, biologicalSex: 'robot' });
    expect(res.status).toBe(400);
  });

  test('future dateOfBirth → 400', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validBody, dateOfBirth: '2099-01-01' });
    expect(res.status).toBe(400);
  });

  test('10. duplicate medicalRecordId for same user → 409', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(null)); // no name duplicate
    Patient.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));

    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...validBody, medicalRecordId: 'EXISTING' });

    expect(res.status).toBe(409);
  });

  test('11. same medicalRecordId for different users is allowed', async () => {
    // Doctor B creates a patient with MR001 — Doctor A already has it, but
    // the uniqueness is per-userId so this is fine.
    Patient.findOne.mockReturnValueOnce(leanResult(null));
    Patient.create.mockResolvedValueOnce(makePatient({ userId: ID_B }));

    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ ...validBody, medicalRecordId: 'MR001' });

    // Should succeed (201) — conflict only fires if Patient.create throws 11000
    expect(res.status).toBe(201);
  });

  test('15. possible duplicate identity returns 201 with possibleDuplicate signal', async () => {
    // findOne returns an existing patient with same name+DOB
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));
    Patient.create.mockResolvedValueOnce(makePatient({ _id: { toString: () => '222222222222222222222222' } }));

    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validBody);

    // Creation still succeeds (201) — doctor decides, not the system
    expect(res.status).toBe(201);
    expect(res.body.possibleDuplicate).not.toBeNull();
    expect(typeof res.body.possibleDuplicate.message).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 3 — List patients
// ---------------------------------------------------------------------------
describe('GET /api/patients', () => {
  test('5. list returns only the current user\'s patients', async () => {
    Patient.find.mockReturnValueOnce({
      sort:   () => ({ select: () => ({ lean: () => Promise.resolve([makePatient()]) }) }),
    });

    const res = await request(app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    // userId filter must include the requesting user's ID
    const findArg = Patient.find.mock.calls[0][0];
    expect(findArg.userId).toBe(ID_A);
  });

  test('13. archived patients excluded from default list', async () => {
    Patient.find.mockReturnValueOnce({
      sort: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
    });

    await request(app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${tokenA}`);

    const findArg = Patient.find.mock.calls[0][0];
    expect(findArg.isArchived).toBe(false);
  });

  test('14. search query scoped to current user', async () => {
    Patient.find.mockReturnValueOnce({
      sort: () => ({ select: () => ({ lean: () => Promise.resolve([makePatient()]) }) }),
    });

    const res = await request(app)
      .get('/api/patients?search=Alice')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const findArg = Patient.find.mock.calls[0][0];
    expect(findArg.userId).toBe(ID_A);
    expect(findArg.$or).toBeDefined(); // search filter present
  });
});

// ---------------------------------------------------------------------------
// 4 — Get patient
// ---------------------------------------------------------------------------
describe('GET /api/patients/:id', () => {
  test('6. Doctor A cannot GET Doctor B\'s patient → 404', async () => {
    // findOne returns null because userId filter doesn't match Doctor A
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(`/api/patients/${PID_1}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    // Confirm query included ownership filter
    expect(Patient.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID_A })
    );
  });

  test('8. malformed patient ObjectId → 400', async () => {
    const res = await request(app)
      .get('/api/patients/not-a-valid-id')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(400);
  });

  test('9. valid unknown patient ID → 404', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(null));

    const res = await request(app)
      .get(`/api/patients/${PID_1}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });

  test('authenticated GET own patient → 200', async () => {
    Patient.findOne.mockReturnValueOnce(leanResult(makePatient()));

    const res = await request(app)
      .get(`/api/patients/${PID_1}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.patient).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5 — Update patient
// ---------------------------------------------------------------------------
describe('PUT /api/patients/:id', () => {
  test('7. Doctor A cannot UPDATE Doctor B\'s patient → 404', async () => {
    Patient.findOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .put(`/api/patients/${PID_1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Hacker' });

    expect(res.status).toBe(404);
  });

  test('12. archive patient → isArchived:true saved', async () => {
    const patient = makePatient();
    Patient.findOne.mockResolvedValueOnce(patient);

    const res = await request(app)
      .put(`/api/patients/${PID_1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ isArchived: true });

    expect(res.status).toBe(200);
    expect(patient.isArchived).toBe(true);
    expect(patient.save).toHaveBeenCalled();
  });

  test('_id and userId cannot be updated', async () => {
    const patient = makePatient();
    Patient.findOne.mockResolvedValueOnce(patient);

    await request(app)
      .put(`/api/patients/${PID_1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ _id: 'new-id', userId: ID_B, firstName: 'Updated' });

    // Only firstName should have changed
    expect(patient._id.toString()).toBe(PID_1);
    expect(patient.userId).toBe(ID_A);
    expect(patient.firstName).toBe('Updated');
  });

  test('no updatable fields provided → 400', async () => {
    const res = await request(app)
      .put(`/api/patients/${PID_1}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 6 — Regression
// ---------------------------------------------------------------------------
describe('Regression', () => {
  test('16+17. existing smoke tests: GET /api/health still works', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('existing auth: unauthenticated consultation → 401', async () => {
    const res = await request(app).get('/api/consultations');
    expect(res.status).toBe(401);
  });
});
