const express   = require('express');
const rateLimit = require('express-rate-limit');
const { register, login, refresh, logout, me } = require('../controllers/authController');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

// ---------------------------------------------------------------------------
// Rate limits — auth routes only
// Brute-force protection on register, login, and refresh.
// In test mode, rate limiting is skipped to avoid flaky tests.
// ---------------------------------------------------------------------------
const isTest = process.env.NODE_ENV === 'test';

const authLimiter = isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs:               15 * 60 * 1000, // 15 minutes
      max:                    10,
      standardHeaders:        true,
      legacyHeaders:          false,
      skipSuccessfulRequests: false,
      message: { success: false, message: 'Too many requests. Please try again later.' },
    });

const refreshLimiter = isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs:        15 * 60 * 1000,
      max:             20,
      standardHeaders: true,
      legacyHeaders:   false,
      message: { success: false, message: 'Too many requests. Please try again later.' },
    });

// ── Public routes ─────────────────────────────────────────────────────────
router.post('/register', authLimiter,    register);
router.post('/login',    authLimiter,    login);
router.post('/refresh',  refreshLimiter, refresh);

// ── Authenticated routes ──────────────────────────────────────────────────
router.post('/logout', authenticate, logout);
router.get( '/me',     authenticate, me);

module.exports = router;
