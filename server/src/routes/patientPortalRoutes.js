'use strict';

/**
 * patientPortalRoutes — Patient Portal route definitions
 *
 * Mounted at /api/patient-portal in routes/index.js.
 *
 * Two sub-routers:
 *   /auth    — authentication (public + mixed)
 *   /records — patient-accessible clinical records (patient-authenticated)
 *
 * Doctor endpoints (/api/patients, /api/consultations, etc.) are unchanged.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const {
  issueInvite,
  register,
  login,
  refresh,
  logout,
  me,
} = require('../controllers/patientPortalAuthController');

const {
  listApprovedConsultations,
  getApprovedConsultation,
  getOwnPatient,
} = require('../controllers/patientPortalRecordsController');

const { authenticate }        = require('../middleware/authenticate');
const { authenticatePatient } = require('../middleware/authenticatePatient');

const router = express.Router();

const isTest = process.env.NODE_ENV === 'test';

const patientAuthLimiter = isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max:      10,
      standardHeaders: true,
      legacyHeaders:   false,
      message: { success: false, message: 'Too many requests. Please try again later.' },
    });

const inviteLimiter = isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 60 * 1000,  // 1 hour
      max:      5,                // 5 invites per doctor per hour
      standardHeaders: true,
      legacyHeaders:   false,
      message: { success: false, message: 'Too many requests. Please try again later.' },
    });

// ── Auth routes ───────────────────────────────────────────────────────────

// Invite — doctor must be authenticated (req.user.role === 'doctor' implied
// because only doctors have User accounts in the current model).
router.post('/auth/invite',   authenticate, inviteLimiter,      issueInvite);

// Public registration with invite token
router.post('/auth/register', patientAuthLimiter, register);
router.post('/auth/login',    patientAuthLimiter, login);
router.post('/auth/refresh',  patientAuthLimiter, refresh);

// Patient-authenticated
router.post('/auth/logout', authenticatePatient, logout);
router.get('/auth/me',      authenticatePatient, me);

// ── Records routes — patient-authenticated ────────────────────────────────

router.get('/records/patient',               authenticatePatient, getOwnPatient);
router.get('/records/consultations',         authenticatePatient, listApprovedConsultations);
router.get('/records/consultations/:id',     authenticatePatient, getApprovedConsultation);

module.exports = router;
