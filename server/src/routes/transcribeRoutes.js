const express = require('express');
const { postTranscription } = require('../controllers/transcribeController');

const router = express.Router();

router.post('/', postTranscription);

module.exports = router;