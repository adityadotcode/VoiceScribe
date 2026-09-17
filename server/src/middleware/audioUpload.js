const multer = require('multer');
const { maxAudioFileBytes } = require('../config/env');

const ALLOWED_MIME_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
]);

function normalizeMimeType(mimeType) {
  return (mimeType || '').split(';')[0].trim().toLowerCase();
}

function isAllowedAudio(mimeType) {
  return ALLOWED_MIME_TYPES.has(normalizeMimeType(mimeType));
}

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: maxAudioFileBytes,
  },
  fileFilter(_req, file, callback) {
    if (isAllowedAudio(file.mimetype)) {
      callback(null, true);
      return;
    }

    const error = new Error('INVALID_AUDIO_TYPE');
    error.statusCode = 400;
    callback(error);
  },
}).single('audio');

module.exports = { audioUpload };
