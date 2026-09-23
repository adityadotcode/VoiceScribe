const jwt  = require('jsonwebtoken');
const crypto = require('crypto');
const { jwtSecret, jwtRefreshSecret, jwtExpiry, jwtRefreshExpiry } = require('../config/env');

// ---------------------------------------------------------------------------
// Access token
// ---------------------------------------------------------------------------

/**
 * Generate a short-lived access token.
 * Payload: { sub, email, role }
 */
function generateAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role },
    jwtSecret,
    { expiresIn: jwtExpiry, algorithm: 'HS256' }
  );
}

/**
 * Verify and decode an access token.
 * Returns the payload or throws if invalid/expired.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
}

// ---------------------------------------------------------------------------
// Refresh token
// ---------------------------------------------------------------------------

/**
 * Generate a long-lived refresh token.
 * Each token has a unique jti so it can be individually invalidated.
 * Payload: { sub, jti }
 */
function generateRefreshToken(userId) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: userId.toString(), jti },
    jwtRefreshSecret,
    { expiresIn: jwtRefreshExpiry, algorithm: 'HS256' }
  );
  return { token, jti };
}

/**
 * Verify and decode a refresh token.
 * Returns the payload or throws if invalid/expired.
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, jwtRefreshSecret, { algorithms: ['HS256'] });
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const REFRESH_COOKIE_NAME = 'voicescribe_refresh';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Set the HTTP-only refresh token cookie on the response.
 * secure: true in production, false in development.
 */
function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     '/',
    maxAge:   REFRESH_COOKIE_MAX_AGE_MS,
  });
}

/**
 * Clear the refresh token cookie.
 */
function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     '/',
  });
}

/**
 * Read the refresh token from the cookie, or return null.
 */
function getRefreshTokenFromCookie(req) {
  return req.cookies?.[REFRESH_COOKIE_NAME] ?? null;
}

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshTokenFromCookie,
  REFRESH_COOKIE_NAME,
};
