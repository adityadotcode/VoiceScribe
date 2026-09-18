const { extractClinicalNote } = require('../services/bedrockService');

/**
 * POST /api/extract-note
 * Body: { "transcript": "..." }
 * Response: { "success": true, "note": { ...structured clinical note... } }
 */
async function postExtractNote(req, res) {
  const { transcript } = req.body;

  if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Request body must contain a non-empty "transcript" string.',
    });
  }

  try {
    const note = await extractClinicalNote(transcript.trim());

    return res.json({
      success: true,
      note,
    });
  } catch (error) {
    console.error('[bedrockController] extractClinicalNote failed:', error);

    // Surface Bedrock-specific error codes when available.
    const statusCode =
      error.name === 'ValidationException' ? 400
      : error.name === 'AccessDeniedException' ? 403
      : error.name === 'ThrottlingException' ? 429
      : 500;

    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to extract clinical note from transcript.',
      errorCode: error.name || 'InternalError',
    });
  }
}

module.exports = { postExtractNote };
