const express = require('express');
const { postExtractNote } = require('../controllers/bedrockController');

const router = express.Router();

router.post('/', postExtractNote);

module.exports = router;
