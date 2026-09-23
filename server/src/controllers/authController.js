const bcrypt = require('bcrypt');
const User   = require('../models/User');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshTokenFromCookie,
} = require('../services/authService');

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Basic email format check. */
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Safe user object — never includes passwordHash or refreshTokenHash. */
function safeUser(user) {
  return {
    id:          user._id.toString(),
    email:       user.email,
    displayName: user.displayName,
    role:        user.role,
  };
}

/** Issue access + refresh tokens, store hash, set cookie, return access token. */
async function issueTokens(res, user) {
  const accessToken               = generateAccessToken(user);
  const { token: refreshToken }   = generateRefreshToken(user._id);

  // Store bcrypt hash so we can verify on refresh without storing the raw token.
  user.refreshTokenHash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
  await user.save();

  setRefreshCookie(res, refreshToken);
  return accessToken;
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
async function register(req, res) {
  const { email, password, displayName } = req.body ?? {};

  // --- Input validation ---
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'A valid email address is required.' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  }
  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    return res.status(400).json({ success: false, message: 'Display name is required.' });
  }

  try {
    // --- Email uniqueness ---
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    // --- Create user ---
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({
      email:       email.trim().toLowerCase(),
      passwordHash,
      displayName: displayName.trim(),
    });

    const accessToken = await issueTokens(res, user);

    return res.status(201).json({
      success: true,
      accessToken,
      user: safeUser(user),
    });
  } catch (err) {
    // Mongoose duplicate-key error (race condition between uniqueness check and insert)
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }
    console.error('[authController] register error:', err.message);
    return res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
async function login(req, res) {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  // Use the same response for all failure cases to avoid leaking whether
  // the email exists.
  const GENERIC_ERROR = 'Invalid credentials.';

  try {
    const user = await User.findOne({ email: String(email).trim().toLowerCase() });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: GENERIC_ERROR });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ success: false, message: GENERIC_ERROR });
    }

    user.lastLoginAt = new Date();
    const accessToken = await issueTokens(res, user); // also saves user

    return res.json({
      success: true,
      accessToken,
      user: safeUser(user),
    });
  } catch (err) {
    console.error('[authController] login error:', err.message);
    return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------
async function refresh(req, res) {
  const rawToken = getRefreshTokenFromCookie(req);

  if (!rawToken) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    const payload = verifyRefreshToken(rawToken);
    const userId  = payload.sub;

    const user = await User.findById(userId);

    if (!user || !user.isActive || !user.refreshTokenHash) {
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    // Verify the raw token matches the stored hash.
    const hashMatch = await bcrypt.compare(rawToken, user.refreshTokenHash);
    if (!hashMatch) {
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    // Rotate: issue new access + refresh tokens, replace stored hash.
    const accessToken = await issueTokens(res, user);

    return res.json({
      success: true,
      accessToken,
      user: safeUser(user),
    });
  } catch {
    // verifyRefreshToken throws for expired or invalid tokens.
    clearRefreshCookie(res);
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
async function logout(req, res) {
  // Clear the cookie immediately regardless of whether the DB update succeeds.
  clearRefreshCookie(res);

  try {
    // Invalidate the stored token hash so the refresh token cannot be reused
    // even if someone has the cookie value.
    const userId = req.user?.id; // may be present if the access token was valid
    if (userId) {
      await User.findByIdAndUpdate(userId, { refreshTokenHash: null });
    }
  } catch (err) {
    // Log but do not fail — the cookie has already been cleared.
    console.error('[authController] logout DB error:', err.message);
  }

  return res.json({ success: true, message: 'Logged out successfully.' });
}

// ---------------------------------------------------------------------------
// GET /api/auth/me   (requires authenticate middleware)
// ---------------------------------------------------------------------------
async function me(req, res) {
  try {
    const user = await User.findById(req.user.id).lean();

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    return res.json({ success: true, user: safeUser(user) });
  } catch (err) {
    console.error('[authController] me error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
}

module.exports = { register, login, refresh, logout, me };
