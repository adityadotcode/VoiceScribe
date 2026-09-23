/**
 * Jest global setup — runs before every test file.
 *
 * Purpose: provide safe placeholder values for the environment variables that
 * env.js validates at import time.  Without these, env.js calls process.exit(1)
 * when MONGODB_URI / AWS_REGION / S3_BUCKET_NAME are absent, which kills the
 * test runner before any test can run.
 *
 * Values here are clearly fake and safe — they must never reach a real AWS or
 * MongoDB endpoint.  Tests that exercise AWS or database behaviour should mock
 * those services independently.
 */
process.env.NODE_ENV      = 'test';
process.env.PORT          = '0';              // let OS assign a port (used by supertest)
process.env.MONGODB_URI   = 'mongodb://localhost:27017/voicescribe_test_FAKE';
process.env.AWS_REGION    = 'ap-southeast-2';
process.env.S3_BUCKET_NAME = 'voicescribe-test-FAKE';
process.env.CLIENT_ORIGIN = 'http://localhost:5174';
