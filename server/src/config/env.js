const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// ---------------------------------------------------------------------------
// Read and export all configuration from environment variables.
// Required variables are validated at startup so the process fails fast
// with a clear message instead of silently misbehaving at runtime.
// ---------------------------------------------------------------------------

const config = {
  port:              process.env.PORT            || '5000',
  mongodbUri:        process.env.MONGODB_URI     || '',
  clientOrigin:      process.env.CLIENT_ORIGIN   || 'http://localhost:5174',
  awsRegion:         process.env.AWS_REGION      || 'ap-southeast-2',
  s3BucketName:      process.env.S3_BUCKET_NAME  || '',
  maxAudioFileBytes: Number(process.env.MAX_AUDIO_FILE_BYTES) || 25 * 1024 * 1024,

  // ── Phase 1A — JWT configuration ──────────────────────────────────────
  jwtSecret:        process.env.JWT_SECRET         || '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
  jwtExpiry:        process.env.JWT_EXPIRY         || '15m',
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
};

// Validate required variables.  Print only the NAMES, never the values.
const REQUIRED_BASE = ['MONGODB_URI', 'AWS_REGION', 'S3_BUCKET_NAME'];

// JWT secrets are required in production.  In test mode the setup file
// provides placeholder values so the test runner is not blocked.
const REQUIRED_JWT =
  process.env.NODE_ENV === 'test'
    ? []
    : ['JWT_SECRET', 'JWT_REFRESH_SECRET'];

const missing = [...REQUIRED_BASE, ...REQUIRED_JWT].filter(
  (key) => !process.env[key]
);

if (missing.length > 0) {
  console.error(
    `[config] Missing required environment variable(s): ${missing.join(', ')}\n` +
    `         Copy server/.env.example → server/.env and fill in the values.`
  );
  process.exit(1);
}

module.exports = config;
