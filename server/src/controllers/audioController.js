const { uploadAudio } = require('../services/s3Service');

async function postAudio(req, res) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'An audio file is required.',
    });
  }

  try {
    const objectKey = await uploadAudio(req.file);

    return res.json({
      success: true,
      objectKey,
      message: 'Audio uploaded successfully.',
    });
  } catch (error) {
    console.error('S3 upload failed:', error);

    return res.status(502).json({
      success: false,
      message: 'Audio could not be uploaded. Please try again.',
    });
  }
}

module.exports = { postAudio };
