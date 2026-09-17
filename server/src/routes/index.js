const express = require('express');
const healthRoutes = require('./healthRoutes');
const audioRoutes = require('./audioRoutes');

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/audio', audioRoutes);

module.exports = router;
