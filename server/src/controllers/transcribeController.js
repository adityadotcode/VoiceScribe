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
 *   1. Validates objectKey and consentEventId format.
 *   2. Loads the RecordingConsent document and verifies:
 *        • userId === req.user.id    (token-authenticated owner)
 *        • status === 'pending'      (not already linked)
 *        • uploadedObjectKey === objectKey  (S3 key was uploaded for THIS event;
 *              prevents an attacker from substituting a different audio file
 *              after obtaining a legitimate consent event ID)
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
    // The query also checks uploadedObjectKey so that:
    //   (a) the objectKey was genuinely produced by POST /api/audio for this event
    //   (b) an attacker who guesses an objectKey cannot transcribe it without a
    //       matching consent event that explicitly recorded that key
    const consentEvent = await RecordingConsent.findOne({
      _id:               consentEventId,
      userId:            req.user.id,
      status:            'pending',
      uploadedObjectKey: objectKey,     // S3 key must match the uploaded object
    });

    if (!consentEvent) {
      return res.status(400).json({
        success: false,
        message: 'Recording consent event not found, does not belong to this user, has already been used, or the S3 object key does not match the upload.',
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
