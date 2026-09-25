const express = require('express');
const healthRoutes       = require('./healthRoutes');
const authRoutes         = require('./authRoutes');
const audioRoutes        = require('./audioRoutes');
const transcribeRoutes   = require('./transcribeRoutes');
const bedrockRoutes      = require('./bedrockRoutes');
const consultationRoutes = require('./consultationRoutes');
const patientRoutes      = require('./patientRoutes');
const { authenticate }   = require('../middleware/authenticate');

const router = express.Router();

// ── Public routes ─────────────────────────────────────────────────────────
router.use('/health', healthRoutes);
router.use('/auth',   authRoutes);

// ── Authenticated routes ──────────────────────────────────────────────────
// All routes below require a valid access token.
router.use(authenticate);

router.use('/audio',         audioRoutes);
router.use('/transcribe',    transcribeRoutes);
router.use('/extract-note',  bedrockRoutes);
router.use('/consultations', consultationRoutes);
router.use('/patients',      patientRoutes);

module.exports = router;
