const { extractClinicalNote } = require('../services/bedrockService');
const { deleteAudioObject }   = require('../services/s3Service');

/**
 * POST /api/extract-note
 * Body: { "transcript": "...", "objectKey": "consultations/abc.webm" }
 *
 * objectKey is optional. When present and extraction succeeds, the temporary
 * S3 audio object is deleted. If deletion fails, the error is logged but the
 * response is unaffected — the clinical workflow has already completed.
 *
 * Response: { "success": true, "note": { ...structured clinical note... } }
 */
async function postExtractNote(req, res) {
  const { transcript, objectKey } = req.body;

  if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Request body must contain a non-empty "transcript" string.',
    });
  }

  try {
    const note = await extractClinicalNote(transcript.trim());

    // ── S3 audio cleanup ────────────────────────────────────────────────────
    // Deletion is triggered ONLY here — after BOTH transcription (which ran
    // in the previous /api/transcribe step) AND Bedrock extraction have
    // succeeded. If we reach this line, the full processing pipeline is done.
    // deleteAudioObject swallows its own errors, so failures here can never
    // affect the response sent to the doctor.
    if (objectKey && typeof objectKey === 'string' && objectKey.trim()) {
      // Fire-and-forget: do not await so the HTTP response is not delayed
      // by a potentially slow S3 DeleteObject round-trip.
      deleteAudioObject(objectKey.trim()).catch((err) => {
        // deleteAudioObject already swallows errors internally; this is a
        // belt-and-suspenders guard in case of an unexpected throw.
        console.error('[bedrockController] unexpected deletion error:', err.message);
      });
    }

    return res.json({
      success: true,
      note,
    });
  } catch (error) {
    // Bedrock failed — do NOT delete the audio (objectKey not touched here).
    console.error('[bedrockController] extractClinicalNote failed:', error);

    const statusCode =
      error.name === 'ValidationException'  ? 400
      : error.name === 'AccessDeniedException' ? 403
      : error.name === 'ThrottlingException'  ? 429
      : 500;

    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to extract clinical note from transcript.',
      errorCode: error.name || 'InternalError',
    });
  }
}

module.exports = { postExtractNote };
