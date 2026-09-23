/**
 * Smoke test — Phase 0
 *
 * Verifies that:
 *   1. The Express app module can be imported without errors.
 *   2. The app does NOT call app.listen() at import time
 *      (listen lives in server.js, not app.js).
 *   3. GET /api/health responds with HTTP 200 and the expected shape.
 *
 * This test intentionally does NOT:
 *   - Connect to MongoDB  (no MONGODB_URI that resolves)
 *   - Call AWS services   (no real credentials)
 *   - Start the production listener
 *
 * supertest creates its own ephemeral HTTP server from the Express app,
 * so no port conflict with the dev server is possible.
 */

const request = require('supertest');

// The app must be importable without crashing even in a test environment.
// setup.js (loaded via jest.setupFiles) provides safe fake env vars so that
// env.js validation passes without triggering process.exit(1).
let app;

beforeAll(() => {
  // Require inside beforeAll so any import-time errors surface clearly.
  app = require('../../src/app');
});

describe('Express app — smoke tests', () => {
  test('app module loads without throwing', () => {
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe('function');
  });

  test('GET /api/health returns 200 with expected shape', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('VoiceScribe API');
  });

  test('unknown route returns 404', async () => {
    const res = await request(app).get('/api/does-not-exist');
    // Express 5 returns 404 for unmatched routes by default.
    expect(res.status).toBe(404);
  });
});
