const express = require('express');
const healthRoutes = require('./healthRoutes');
const audioRoutes = require('./audioRoutes');
const transcribeRoutes = require('./transcribeRoutes');

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/audio', audioRoutes);
router.use('/transcribe', transcribeRoutes);

module.exports = router;
