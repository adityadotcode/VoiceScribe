const express = require('express');
const { postAudio } = require('../controllers/audioController');
const { audioUpload } = require('../middleware/audioUpload');

const router = express.Router();

router.post('/', audioUpload, postAudio);

module.exports = router;
