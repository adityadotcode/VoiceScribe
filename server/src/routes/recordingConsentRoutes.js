'use strict';

const express = require('express');
const { createRecordingConsent } = require('../controllers/recordingConsentController');

const router = express.Router();

// Phase 7 / P0-1B — server-authoritative consent event
// All routes are already authenticated via the global authenticate middleware
// applied in routes/index.js before this router is mounted.
router.post('/', createRecordingConsent);

module.exports = router;
