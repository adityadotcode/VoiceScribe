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
 *   2. Loads the RecordingConsent document and verifies:
 *        • _id matches the provided consentEventId
 *        • userId === req.user.id  (authenticated user owns the event)
 *        • status === 'pending'   (not already linked/consumed)
 *   3. Only then accepts the audio file and uploads to S3.
 *
 * Note on patientId:
 *   The audio endpoint does not receive patientId — it only verifies that the
 *   consent event belongs to the authenticated user and is pending.  The full
 *   patientId cross-check occurs at POST /api/consultations where patientId is
 *   a required body field.  This two-layer approach matches the architecture
 *   constraint (multer runs before the body is parsed as JSON).
 *
 * Status is NOT changed here — the event stays 'pending' so upload retries
 * remain safe.  Linking happens atomically at POST /api/consultations.
 */

const mongoose        = require('mongoose');
const RecordingConsent = require('../models/RecordingConsent');
const { uploadAudio }  = require('../services/s3Service');

async function postAudio(req, res) {
  // ── 1. Validate consentEventId ──────────────────────────────────────────
  // After multer processes the multipart body, non-file fields are available
  // in req.body.  consentEventId is sent as a regular FormData field.
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
    // Ownership: the event must belong to the authenticated user.
    // Status:    must be 'pending' (not already linked).
    // patientId cross-check is deferred to POST /api/consultations.
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

    // ── 4. Upload to S3 ─────────────────────────────────────────────────
    const objectKey = await uploadAudio(req.file);

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
