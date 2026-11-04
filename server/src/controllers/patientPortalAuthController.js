'use strict';

/**
 * patientPortalAuthController — Patient Portal authentication
 *
 * Separate from the doctor authController.  Uses the same JWT infrastructure
 * (jwtSecret / jwtRefreshSecret) but tokens carry role:'patient' and
 * sub: <PatientAccount._id> so they cannot be confused with doctor tokens.
 *
 * Routes (mounted at /api/patient-portal/auth):
 *   POST /invite          — Doctor issues a one-time invite token for a patient.
 *   POST /register        — Patient redeems the token and creates a PatientAccount.
 *   POST /login           — Patient logs in.
 *   POST /refresh         — Rotate access + refresh tokens.
 *   POST /logout          — Invalidate session.
 *   GET  /me              — Return safe account info.
 */

const bcrypt         = require('bcrypt');
const crypto         = require('crypto');
const mongoose       = require('mongoose');
const Patient        = require('../models/Patient');
const PatientAccount = require('../models/PatientAccount');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshTokenFromCookie,
} = require('../services/authService');

const BCRYPT_ROUNDS      = 12;
const INVITE_TTL_HOURS   = 72;
const INVITE_TOKEN_BYTES = 32;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function safeAccount(account) {
  return {
    id:           account._id.toString(),
    email:        account.email,
    displayName:  account.displayName,
    role:         'patient',
    patientId:    account.patientId.toString(),
    doctorUserId: account.doctorUserId.toString(),
  };
}

async function issueTokens(res, account) {
  // Synthesise a user-like object for generateAccessToken / generateRefreshToken
  // so we can reuse the existing authService without modification.
  const userLike = {
    _id:   account._id,
    email: account.email,
    role:  'patient',
  };
  const accessToken             = generateAccessToken(userLike);
  const { token: refreshToken } = generateRefreshToken(account._id);

  account.refreshTokenHash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
  await account.save();

  setRefreshCookie(res, refreshToken);
  return accessToken;
}

// ---------------------------------------------------------------------------
// POST /api/patient-portal/auth/invite
//
// Doctor-only endpoint (requires req.user.role === 'doctor').
// Issues a one-time invite token for a specific patient.
// ---------------------------------------------------------------------------
async function issueInvite(req, res) {
  const { patientId } = req.body ?? {};

  if (!patientId) {
    return res.status(400).json({ success: false, message: 'patientId is required.' });
  }

  if (!mongoose.isValidObjectId(patientId)) {
    return res.status(400).json({ success: false, message: 'patientId is not a valid ID.' });
  }

  try {
    // Verify the patient belongs to the authenticated doctor.
    const patient = await Patient.findOne({
      _id:    patientId,
      userId: req.user.id,
    });

    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    // Check whether a PatientAccount already exists for this patient.
    const existing = await PatientAccount.findOne({ patientId });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A patient portal account already exists for this patient.',
      });
    }

    // Generate a cryptographically random invite token.
    const rawToken  = crypto.randomBytes(INVITE_TOKEN_BYTES).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    patient.portalInviteTokenHash = tokenHash;
    patient.portalInviteExpiresAt = expiresAt;
    patient.portalInviteUsedAt    = null;   // reset any previous used-at
    await patient.save();

    return res.status(201).json({
      success:  true,
      // Return the raw token once — the doctor should send this to the patient.
      // It is never stored in plaintext and cannot be recovered.
      inviteToken: rawToken,
      expiresAt:   expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[patientPortalAuthController] issueInvite error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create invite.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/patient-portal/auth/register
//
// Public — patient redeems the invite token and creates their account.
// ---------------------------------------------------------------------------
async function register(req, res) {
  const { inviteToken, email, password, displayName } = req.body ?? {};

  if (!inviteToken) {
    return res.status(400).json({ success: false, message: 'inviteToken is required.' });
  }

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
    // Find the patient whose invite token matches.
    // We must compare against all patients that have a non-null, non-expired
    // and unused token.  Because tokens are bcrypt-hashed we cannot query by
    // hash directly; instead we iterate candidates.  In practice only one
    // patient will have a token for the exact inviteToken provided.
    //
    // To avoid a full-collection scan we search patients that:
    //   - have a non-null portalInviteTokenHash
    //   - have a future expiry
    //   - have not been used yet
    // This is a small set in any realistic deployment.
    const candidates = await Patient.find({
      portalInviteTokenHash: { $ne: null },
      portalInviteExpiresAt: { $gt: new Date() },
      portalInviteUsedAt:    null,
    }).lean();

    let matchedPatient = null;
    for (const candidate of candidates) {
      const match = await bcrypt.compare(inviteToken, candidate.portalInviteTokenHash);
      if (match) {
        matchedPatient = candidate;
        break;
      }
    }

    if (!matchedPatient) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired invite token.',
      });
    }

    // Check email uniqueness for PatientAccounts.
    const existingAccount = await PatientAccount.findOne({
      email: email.trim().toLowerCase(),
    });
    if (existingAccount) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
      });
    }

    // Create the PatientAccount.
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const account = await PatientAccount.create({
      email:        email.trim().toLowerCase(),
      passwordHash,
      displayName:  displayName.trim(),
      patientId:    matchedPatient._id,
      doctorUserId: matchedPatient.userId,
    });

    // Mark the invite as used (one-time).
    await Patient.findByIdAndUpdate(matchedPatient._id, {
      portalInviteUsedAt: new Date(),
    });

    const accessToken = await issueTokens(res, account);

    return res.status(201).json({
      success: true,
      accessToken,
      account: safeAccount(account),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
      });
    }
    console.error('[patientPortalAuthController] register error:', err.message);
    return res.status(500).json({ success: false, message: 'Registration failed.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/patient-portal/auth/login
// ---------------------------------------------------------------------------
async function login(req, res) {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const GENERIC = 'Invalid credentials.';

  try {
    const account = await PatientAccount.findOne({
      email: String(email).trim().toLowerCase(),
    });

    if (!account || !account.isActive) {
      return res.status(401).json({ success: false, message: GENERIC });
    }

    const match = await bcrypt.compare(password, account.passwordHash);
    if (!match) {
      return res.status(401).json({ success: false, message: GENERIC });
    }

    account.lastLoginAt = new Date();
    const accessToken = await issueTokens(res, account);

    return res.json({
      success: true,
      accessToken,
      account: safeAccount(account),
    });
  } catch (err) {
    console.error('[patientPortalAuthController] login error:', err.message);
    return res.status(500).json({ success: false, message: 'Login failed.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/patient-portal/auth/refresh
// ---------------------------------------------------------------------------
async function refresh(req, res) {
  const rawToken = getRefreshTokenFromCookie(req);

  if (!rawToken) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    const payload   = verifyRefreshToken(rawToken);
    const accountId = payload.sub;

    // Look up in PatientAccount, not User.
    const account = await PatientAccount.findById(accountId);

    if (!account || !account.isActive || !account.refreshTokenHash) {
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const hashMatch = await bcrypt.compare(rawToken, account.refreshTokenHash);
    if (!hashMatch) {
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const accessToken = await issueTokens(res, account);

    return res.json({
      success: true,
      accessToken,
      account: safeAccount(account),
    });
  } catch {
    clearRefreshCookie(res);
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/patient-portal/auth/logout
// ---------------------------------------------------------------------------
async function logout(req, res) {
  clearRefreshCookie(res);

  try {
    const accountId = req.patientAccount?.id;
    if (accountId) {
      await PatientAccount.findByIdAndUpdate(accountId, { refreshTokenHash: null });
    }
  } catch (err) {
    console.error('[patientPortalAuthController] logout DB error:', err.message);
  }

  return res.json({ success: true, message: 'Logged out.' });
}

// ---------------------------------------------------------------------------
// GET /api/patient-portal/auth/me
// ---------------------------------------------------------------------------
async function me(req, res) {
  try {
    const account = await PatientAccount.findById(req.patientAccount.id).lean();
    if (!account || !account.isActive) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    return res.json({ success: true, account: safeAccount(account) });
  } catch (err) {
    console.error('[patientPortalAuthController] me error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
}

module.exports = { issueInvite, register, login, refresh, logout, me };
