'use strict';

/**
 * recordingConsentController — Phase 7 / P0-1B
 *
 * POST /api/recording-consents
 *
 * Creates a server-authoritative recording-consent event.
 *
 * The caller (NewConsultationPage) sends:
 *   { patientId: "<ObjectId>" }
 *
 * The server:
 *   1. Validates the patientId.
 *   2. Verifies the patient belongs to req.user.id (same ownership rule as
 *      consultation creation — IDOR-safe).
 *   3. Generates givenAt = new Date() on the server.
 *   4. Creates a RecordingConsent document.
 *   5. Returns { consentEventId, givenAt } to the frontend.
 *
 * The frontend then passes consentEventId through the recording workflow.
 * At POST /api/consultations the event is verified, copied, and marked linked.
 *
 * Security constraints
 * ─────────────────────
 * • userId is always taken from req.user.id (JWT).  Any userId in req.body
 *   is silently ignored.
 * • givenAt is server-generated.  Any timestamp in req.body is ignored.
 * • The patient must belong to req.user.id — prevents cross-patient injection.
 * • Rejected values follow the project's 404-not-403 convention to avoid
 *   leaking whether a patientId exists for another user.
 */

const mongoose        = require('mongoose');
const Patient         = require('../models/Patient');
const RecordingConsent = require('../models/RecordingConsent');

// ---------------------------------------------------------------------------
// POST /api/recording-consents
// ---------------------------------------------------------------------------
async function createRecordingConsent(req, res) {
  const { patientId } = req.body ?? {};

  // ── 1. Basic validation ─────────────────────────────────────────────────
  if (!patientId) {
    return res.status(400).json({
      success: false,
      message: 'patientId is required.',
    });
  }

  if (!mongoose.isValidObjectId(patientId)) {
    return res.status(400).json({
      success: false,
      message: 'patientId is not a valid ID.',
    });
  }

  try {
    // ── 2. Verify patient ownership ─────────────────────────────────────
    // Same pattern as createConsultation: 404 on missing or foreign patient.
    // isArchived: false — cannot record a consultation for an archived patient.
    const patient = await Patient.findOne({
      _id:        patientId,
      userId:     req.user.id,
      isArchived: false,
    }).lean();

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found.',
      });
    }

    // ── 3. Create the consent event ──────────────────────────────────────
    // givenAt is generated here — never from req.body.
    const givenAt = new Date();

    const event = await RecordingConsent.create({
      userId:         req.user.id,   // always from token
      patientId,
      givenAt,
      wordingVersion: RecordingConsent.WORDING_VERSION,
      wordingText:    RecordingConsent.WORDING_TEXT,
      status:         'pending',
    });

    // ── 4. Return the event ID and authoritative timestamp ──────────────
    return res.status(201).json({
      success:       true,
      consentEventId: event._id.toString(),
      givenAt:        event.givenAt.toISOString(),
    });
  } catch (err) {
    console.error('[recordingConsentController] createRecordingConsent error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to record consent event.',
    });
  }
}

module.exports = { createRecordingConsent };
