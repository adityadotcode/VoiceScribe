'use strict';

/**
 * audioController — Phase 7 / P0-1C-Fix-A
 *
 * POST /api/audio   (multipart/form-data)
 *
 * Fields:
 *   audio          {File}    The audio recording.
 *   consentEventId {string}  Server-issued RecordingConsent _id (required).
 *
 * Enforcement:
 *   1. Validates consentEventId format (ObjectId).
 *   2. Verifies the consent event exists, belongs to the authenticated user,
 *      and is in 'pending' status (not already linked or consumed).
 *   3. Uploads the audio to S3.
 *   4. Stores the resulting objectKey on the RecordingConsent document so the
 *      transcription step can verify the S3 object belongs to this event.
 *
 * Ownership notes:
 *   • userId check: event.userId === req.user.id (from JWT, never from body).
 *   • patientId cross-check: deferred to POST /api/consultations where
 *     patientId is a required body field.
 *   • S3 key ownership: recorded on the event at this step; verified at
 *     POST /api/transcribe.
 *
 * Status is NOT changed here — the event stays 'pending' so upload retries
 * remain safe (a retry overwrites uploadedObjectKey).
 */

const mongoose         = require('mongoose');
const RecordingConsent = require('../models/RecordingConsent');
const { uploadAudio }  = require('../services/s3Service');

async function postAudio(req, res) {
  // ── 1. Validate consentEventId ──────────────────────────────────────────
  const { consentEventId } = req.body ?? {};

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

  // ── 2. Validate the audio file ─────────────────────────────────────────
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'An audio file is required.',
    });
  }

  try {
    // ── 3. Verify the consent event ─────────────────────────────────────
    const consentEvent = await RecordingConsent.findOne({
      _id:    consentEventId,
      userId: req.user.id,   // ownership enforced via token — never from body
      status: 'pending',     // must not already be linked
    });

    if (!consentEvent) {
      return res.status(400).json({
        success: false,
        message: 'Recording consent event not found, does not belong to this user, or has already been used.',
      });
    }

    // ── 4. Upload to S3 ─────────────────────────────────────────────────
    const objectKey = await uploadAudio(req.file);

    // ── 5. Record the S3 key on the consent event ────────────────────────
    // This associates the uploaded object with the consent event so the
    // transcription step can verify the objectKey was legitimately obtained
    // through this consent flow (not substituted by an attacker).
    // Retry-safe: a re-upload simply overwrites the previous key.
    consentEvent.uploadedObjectKey = objectKey;
    await consentEvent.save();

    return res.json({
      success: true,
      objectKey,
      message: 'Audio uploaded successfully.',
    });
  } catch (error) {
    console.error('[audioController] error:', error.message);
    return res.status(502).json({
      success: false,
      message: 'Audio could not be uploaded. Please try again.',
    });
  }
}

module.exports = { postAudio };
