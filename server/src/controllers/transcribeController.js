'use strict';

/**
 * transcribeController — Phase 7 / P0-1C-Fix-A
 *
 * POST /api/transcribe   (application/json)
 *
 * Body:
 *   objectKey      {string}  S3 object key from the preceding upload step.
 *   consentEventId {string}  Server-issued RecordingConsent _id (required).
 *
 * Enforcement:
 *   1. Validates consentEventId format (ObjectId).
 *   2. Loads the RecordingConsent document and verifies:
 *        • userId === req.user.id  (authenticated user owns the event)
 *        • status === 'pending'   (not already linked/consumed)
 *   3. Only then starts the AWS Transcribe job.
 *
 * Status is NOT changed here — the event stays 'pending' so transcription
 * retries remain safe.  Linking happens atomically at POST /api/consultations.
 */

const mongoose         = require('mongoose');
const RecordingConsent = require('../models/RecordingConsent');
const { transcribeAudio } = require('../services/transcribeService');

async function postTranscription(req, res) {
  const { objectKey, consentEventId } = req.body ?? {};

  // ── 1. Validate objectKey ────────────────────────────────────────────────
  if (!objectKey) {
    return res.status(400).json({
      success: false,
      message: 'S3 object key is required.',
    });
  }

  // ── 2. Validate consentEventId ──────────────────────────────────────────
  if (!consentEventId) {
    return res.status(400).json({
      success: false,
      message: 'consentEventId is required.',
    });
  }

  if (!mongoose.isValidObjectId(consentEventId)) {
    return res.status(400).json({
      success: false,
      message: 'consentEventId is not a valid ID.',
    });
  }

  try {
    // ── 3. Verify the consent event ─────────────────────────────────────
    // Same checks as the audio upload step: ownership + pending status.
    const consentEvent = await RecordingConsent.findOne({
      _id:    consentEventId,
      userId: req.user.id,
      status: 'pending',
    });

    if (!consentEvent) {
      return res.status(400).json({
        success: false,
        message: 'Recording consent event not found, does not belong to this user, or has already been used.',
      });
    }

    // ── 4. Start AWS Transcribe job ─────────────────────────────────────
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

module.exports = { postTranscription };
