const multer = require('multer');
const { maxAudioFileBytes } = require('../config/env');

const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/x-m4a',
  'audio/flac',
]);

function isAllowedAudioType(mimeType) {
  const normalized = (mimeType || '').split(';')[0].trim().toLowerCase();
  return ALLOWED_AUDIO_TYPES.has(normalized);
}

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: maxAudioFileBytes,
  },
  fileFilter(_req, file, callback) {
    if (isAllowedAudioType(file.mimetype)) {
      callback(null, true);
      return;
    }

    const error = new Error('INVALID_AUDIO_TYPE');
    error.statusCode = 400;
    callback(error);
  },
}).single('audio');

module.exports = { audioUpload, isAllowedAudioType };
