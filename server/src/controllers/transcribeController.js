const { transcribeAudio } = require('../services/transcribeService');

async function postTranscription(req, res) {
  const { objectKey } = req.body;

  if (!objectKey) {
    return res.status(400).json({
      success: false,
      message: 'S3 object key is required.',
    });
  }

  try {
    const result = await transcribeAudio(objectKey);

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Transcription failed:', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Transcription failed.',
    });
  }
}

module.exports = {
  postTranscription,
};