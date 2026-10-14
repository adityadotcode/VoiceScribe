'use strict';

/**
 * RecordingConsent — Phase 7 / P0-1B
 *
 * Stores a server-authoritative record of the moment a doctor confirmed that
 * the patient was informed about audio recording and AI processing and agreed
 * to proceed.
 *
 * Design rules
 * ────────────
 * • userId and givenAt are always set on the server — never from client input.
 * • patientId ownership is verified before creation.
 * • The consent wording version is stored so the exact text shown to the
 *   doctor is preserved in the audit record.
 * • Status transitions: 'pending' → 'linked' (when attached to a consultation).
 *   A 'pending' event can be retried freely; once 'linked' it cannot be
 *   reused for a different consultation.
 * • Null default on linkedConsultationId and linkedAt ensures old documents
 *   remain valid and back-compat is preserved.
 *
 * Trust model
 * ────────────
 * The server-generated givenAt is the authoritative timestamp of the
 * attestation event.  It does not independently prove the patient's identity
 * or verify their verbal agreement — it records the authenticated doctor's
 * attestation at the application level.
 */

const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Consent wording version — stored with every event so the exact text
// shown to the doctor at attestation time is preserved in the audit record.
// When wording changes, increment WORDING_VERSION and update WORDING_TEXT.
// ---------------------------------------------------------------------------
const WORDING_VERSION = 'v1';
const WORDING_TEXT =
  'I confirm that the patient has been informed that this consultation will ' +
  'be audio-recorded and that the audio will be processed by an AI service ' +
  'to generate a transcript and clinical-note draft. The patient has agreed ' +
  'to proceed.';

const RecordingConsentSchema = new mongoose.Schema(
  {
    // Authenticated doctor who confirmed the attestation.
    // Always set from req.user.id (JWT) — never from the client body.
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },

    // Patient for whom consent was confirmed.
    // Ownership (patient.userId === req.user.id) is verified before creation.
    patientId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Patient',
      required: true,
    },

    // Server-generated timestamp of the attestation event.
    // Set to new Date() by the controller — not from req.body.
    givenAt: {
      type:     Date,
      required: true,
    },

    // Version identifier for the wording shown at attestation time.
    // Allows future wording changes to be identified in audit queries.
    wordingVersion: {
      type:     String,
      required: true,
      default:  WORDING_VERSION,
    },

    // Full wording text shown to the doctor at attestation time.
    // Stored verbatim so the event is self-contained.
    wordingText: {
      type:     String,
      required: true,
    },

    // Workflow status.
    //   'pending'  — event created, not yet linked to a consultation.
    //   'linked'   — linked to a specific consultation; cannot be reused.
    status: {
      type:    String,
      enum:    ['pending', 'linked'],
      default: 'pending',
    },

    // Set when this event is linked to a consultation.
    linkedConsultationId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Consultation',
      default: null,
    },

    // Timestamp of when the event was linked to a consultation.
    linkedAt: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,  // createdAt, updatedAt
    strict:     true,
  }
);

// Index: look up pending events by user + patient for the create flow.
RecordingConsentSchema.index({ userId: 1, patientId: 1, status: 1 });

module.exports = mongoose.model('RecordingConsent', RecordingConsentSchema);
module.exports.WORDING_VERSION = WORDING_VERSION;
module.exports.WORDING_TEXT    = WORDING_TEXT;
