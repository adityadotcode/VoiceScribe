'use strict';

/**
 * patientPortalRecordsController — Patient-facing consultation records
 *
 * All handlers load the PatientAccount from DB to get:
 *   - patientId:    the Patient document this account can read
 *   - doctorUserId: the doctor who owns that Patient document
 *
 * These two values are used in every Consultation query to enforce:
 *   1. The consultation belongs to this patient (patientId match).
 *   2. The consultation belongs to this doctor (userId match).
 *   3. Access cannot be obtained by changing a URL parameter.
 *
 * Only approved, non-superseded consultations (effective versions) are
 * exposed — drafts and superseded originals are excluded server-side.
 * Correction documents are included when they are the effective version
 * (approved + supersededBy === null).
 *
 * Exposed fields are deliberately limited: internal S3 keys,
 * raw transcripts, speaker mappings, and consent infrastructure are
 * NOT returned to patients.
 */

const mongoose       = require('mongoose');
const PatientAccount = require('../models/PatientAccount');
const Consultation   = require('../models/Consultation');
const Patient        = require('../models/Patient');

// ---------------------------------------------------------------------------
// Fields returned to the patient for consultation list items.
// Excludes: transcript, speakerUtterances, speakerRoleMapping,
//           detectedLanguages, recordingConsent* fields, userId.
// ---------------------------------------------------------------------------
const LIST_SELECT = [
  '_id',
  'consultationDate',
  'encounterType',
  'approvedAt',
  'correctionOf',
  'note.chief_complaint',
  'note.symptoms',
  'note.assessment',
  'note.follow_up',
].join(' ');

// Fields returned for a single approved consultation detail view.
// Also excludes transcript and raw processing metadata.
const DETAIL_EXCLUDE = [
  'transcript',
  'speakerUtterances',
  'speakerRoleMapping',
  'detectedLanguages',
  'userId',
  'recordingConsentGivenAt',
  'recordingConsentConfirmedBy',
];

// ---------------------------------------------------------------------------
// Helper: resolve PatientAccount → { patientId, doctorUserId }
// Returns null and sends 401 if not found or inactive.
// ---------------------------------------------------------------------------
async function resolveAccount(req, res) {
  const account = await PatientAccount.findById(req.patientAccount.id).lean();
  if (!account || !account.isActive) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return null;
  }
  return account;
}

// ---------------------------------------------------------------------------
// GET /api/patient-portal/records/consultations
//
// Returns the patient's effective approved consultation history.
// Ordered newest first.
// ---------------------------------------------------------------------------
async function listApprovedConsultations(req, res) {
  try {
    const account = await resolveAccount(req, res);
    if (!account) return;

    const consultations = await Consultation.find({
      patientId:    account.patientId,
      userId:       account.doctorUserId,
      status:       'approved',
      supersededBy: null,
    })
      .sort({ consultationDate: -1 })
      .select(LIST_SELECT)
      .lean();

    return res.json({ success: true, consultations });
  } catch (err) {
    console.error('[patientPortalRecordsController] listApprovedConsultations error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch consultations.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/patient-portal/records/consultations/:id
//
// Returns a single approved, effective consultation.
// Rejects: drafts, superseded originals, other patients' records.
// ---------------------------------------------------------------------------
async function getApprovedConsultation(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid consultation ID.' });
  }

  try {
    const account = await resolveAccount(req, res);
    if (!account) return;

    const doc = await Consultation.findOne({
      _id:          req.params.id,
      patientId:    account.patientId,   // cross-patient IDOR prevention
      userId:       account.doctorUserId,
      status:       'approved',
      supersededBy: null,                // exclude superseded originals
    }).lean();

    if (!doc) {
      // Never 403 — return 404 regardless of the reason to avoid leaking
      // whether a consultation ID exists for a different patient.
      return res.status(404).json({ success: false, message: 'Consultation not found.' });
    }

    // Strip internal fields before returning.
    const sanitised = { ...doc };
    for (const field of DETAIL_EXCLUDE) {
      delete sanitised[field];
    }

    return res.json({ success: true, consultation: sanitised });
  } catch (err) {
    console.error('[patientPortalRecordsController] getApprovedConsultation error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch consultation.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/patient-portal/records/patient
//
// Returns the patient's own demographic record (safe fields only).
// Does NOT expose: notes (doctor's admin notes), isArchived, portalInvite*
// ---------------------------------------------------------------------------
async function getOwnPatient(req, res) {
  try {
    const account = await resolveAccount(req, res);
    if (!account) return;

    const patient = await Patient.findById(account.patientId).lean();
    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient record not found.' });
    }

    return res.json({
      success: true,
      patient: {
        firstName:       patient.firstName,
        lastName:        patient.lastName,
        dateOfBirth:     patient.dateOfBirth,
        biologicalSex:   patient.biologicalSex,
        phone:           patient.phone,
        medicalRecordId: patient.medicalRecordId,
      },
    });
  } catch (err) {
    console.error('[patientPortalRecordsController] getOwnPatient error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch patient record.' });
  }
}

module.exports = { listApprovedConsultations, getApprovedConsultation, getOwnPatient };
