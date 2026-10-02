'use strict';

/**
 * Global Express error handler.
 *
 * Rules:
 *   - Client responses are always safe generic messages — no stack traces,
 *     no file paths, no internal implementation details.
 *   - Server-side logging uses err.message only for unclassified errors so
 *     stack traces do not accumulate in production log streams.
 *   - HTTP status codes are preserved where they carry meaningful information
 *     (413, 400) but default to 500 for all unrecognised errors.
 */
function errorHandler(err, _req, res, _next) {
  // ── Multer / audio upload errors ────────────────────────────────────────
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'Audio file is too large.',
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.message === 'INVALID_AUDIO_TYPE') {
    return res.status(400).json({
      success: false,
      message: 'Please upload a valid audio file.',
    });
  }

  // ── Unclassified error ───────────────────────────────────────────────────
  // Log message only — never the full error object or stack trace.
  // Stack traces can expose file paths, internal module names, and server
  // configuration details that should not appear in production log streams.
  console.error('[errorHandler] unhandled error:', err.message ?? String(err));

  return res.status(500).json({
    success: false,
    message: 'Something went wrong.',
  });
}

module.exports = { errorHandler };
