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
    console.error('[transcribeController] transcription failed:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Transcription failed. Please try again.',
    });
  }
}

module.exports = {
  postTranscription,
};