/**
 * Jest global setup — runs before every test file.
 *
 * Purpose: provide safe placeholder values for the environment variables that
 * env.js validates at import time.  Without these, env.js calls process.exit(1)
 * when required vars are absent, which kills the test runner before any test
 * can run.
 *
 * Values here are clearly fake and safe — they must never reach a real AWS,
 * MongoDB, or JWT production secret.  Tests that exercise AWS or database
 * behaviour must mock those services independently.
 */
process.env.NODE_ENV           = 'test';
process.env.PORT               = '0';   // let OS assign a port (used by supertest)
process.env.MONGODB_URI        = 'mongodb://localhost:27017/voicescribe_test_FAKE';
process.env.AWS_REGION         = 'ap-southeast-2';
process.env.S3_BUCKET_NAME     = 'voicescribe-test-FAKE';
process.env.CLIENT_ORIGIN      = 'http://localhost:5174';

// ── Phase 1A — test-only JWT secrets ──────────────────────────────────────
// These are placeholder values used exclusively by the test runner.
// They are intentionally short and clearly fake.
// Production secrets must never appear here.
process.env.JWT_SECRET         = 'test-jwt-secret-FAKE-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-FAKE-do-not-use-in-production';
process.env.JWT_EXPIRY         = '15m';
process.env.JWT_REFRESH_EXPIRY = '7d';
