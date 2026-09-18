const express = require('express');
const healthRoutes = require('./healthRoutes');
const audioRoutes = require('./audioRoutes');
const transcribeRoutes = require('./transcribeRoutes');
const bedrockRoutes = require('./bedrockRoutes');
const consultationRoutes = require('./consultationRoutes');

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/audio', audioRoutes);
router.use('/transcribe', transcribeRoutes);
router.use('/extract-note', bedrockRoutes);
router.use('/consultations', consultationRoutes);

module.exports = router;
