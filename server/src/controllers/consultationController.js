const mongoose     = require('mongoose');
const Consultation = require('../models/Consultation');
const Patient      = require('../models/Patient');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate and normalise the incoming body for create/update. */
function parseBody(body) {
  const errors = [];

  const {
    transcript,
    note,
    status,
    speakerUtterances,
    detectedLanguages,
    speakerRoleMapping,
    // Phase 3A create-time fields
    patientId,
    consultationDate,
    encounterType,
  } = body;

  if (transcript !== undefined && typeof transcript !== 'string') {
    errors.push('transcript must be a string');
  }

  if (note !== undefined && (typeof note !== 'object' || Array.isArray(note))) {
    errors.push('note must be an object');
  }

  if (status !== undefined && !['draft', 'approved'].includes(status)) {
    errors.push('status must be "draft" or "approved"');
  }

  if (speakerUtterances !== undefined && !Array.isArray(speakerUtterances)) {
    errors.push('speakerUtterances must be an array');
  }

  if (detectedLanguages !== undefined && !Array.isArray(detectedLanguages)) {
    errors.push('detectedLanguages must be an array');
  }

  if (
    speakerRoleMapping !== undefined &&
    (typeof speakerRoleMapping !== 'object' || Array.isArray(speakerRoleMapping))
  ) {
    errors.push('speakerRoleMapping must be an object');
  }

  if (
    encounterType !== undefined &&
    !['in_person', 'telemedicine', 'upload'].includes(encounterType)
  ) {
    errors.push('encounterType must be one of: in_person, telemedicine, upload');
  }

  if (consultationDate !== undefined) {
    const d = new Date(consultationDate);
    if (isNaN(d.getTime())) errors.push('consultationDate must be a valid date');
  }

  return {
    errors,
    transcript,
    note,
    status,
    speakerUtterances,
    detectedLanguages,
    speakerRoleMapping,
    patientId,
    consultationDate,
    encounterType,
  };
}

/** Validate a MongoDB ObjectId from a route parameter. */
function validateObjectId(id, res) {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ success: false, message: 'Invalid consultation ID.' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// POST /api/consultations
// ---------------------------------------------------------------------------
async function createConsultation(req, res) {
  const { errors, transcript, note, status,
          speakerUtterances, detectedLanguages, speakerRoleMapping,
          patientId, consultationDate, encounterType } = parseBody(req.body);

  if (errors.length) {
    return res.status(400).json({ success: false, message: errors.join('; ') });
  }

  // ── patientId required ────────────────────────────────────────────────
  if (!patientId) {
    return res.status(400).json({ success: false, message: 'patientId is required.' });
  }

  if (!mongoose.isValidObjectId(patientId)) {
    return res.status(400).json({ success: false, message: 'patientId is not a valid ID.' });
  }

  // chief_complaint required when approving immediately
  if (status === 'approved' && !note?.chief_complaint?.trim()) {
    return res.status(400).json({
      success: false,
      message: 'chief_complaint is required when approving a consultation.',
    });
  }

  try {
    // ── Verify the patient belongs to this user and is not archived ───────
    const patient = await Patient.findOne({
      _id:        patientId,
      userId:     req.user.id,
      isArchived: false,
    }).lean();

    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    const doc = await Consultation.create({
      // userId always from verified token — never from the client.
      userId:             req.user.id,
      patientId,
      consultationDate:   consultationDate ? new Date(consultationDate) : new Date(),
      encounterType:      encounterType    ?? 'in_person',
      transcript:         transcript       ?? '',
      note:               note             ?? {},
      status:             status           ?? 'draft',
      approvedAt:         status === 'approved' ? new Date() : null,
      approvedBy:         status === 'approved' ? req.user.id : null,
      speakerUtterances:  speakerUtterances  ?? [],
      detectedLanguages:  detectedLanguages  ?? [],
      speakerRoleMapping: speakerRoleMapping ?? {},
    });

    return res.status(201).json({ success: true, consultation: doc });
  } catch (err) {
    console.error('[consultationController] create error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to save consultation.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/consultations
// ---------------------------------------------------------------------------
async function listConsultations(req, res) {
  try {
    const docs = await Consultation.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .select('_id transcript status note.patient note.chief_complaint createdAt approvedAt')
      .lean();

    return res.json({ success: true, consultations: docs });
  } catch (err) {
    console.error('[consultationController] list error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch consultations.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/consultations/:id
// ---------------------------------------------------------------------------
async function getConsultation(req, res) {
  if (!validateObjectId(req.params.id, res)) return;

  try {
    // Ownership enforced at query level: another user's doc returns null → 404.
    // Never returns 403 so we don't reveal that the resource exists.
    const doc = await Consultation.findOne({
      _id:    req.params.id,
      userId: req.user.id,
    }).lean();

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Consultation not found.' });
    }

    return res.json({ success: true, consultation: doc });
  } catch (err) {
    console.error('[consultationController] get error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch consultation.' });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/consultations/:id
// ---------------------------------------------------------------------------
async function updateConsultation(req, res) {
  if (!validateObjectId(req.params.id, res)) return;

  const { errors, transcript, note, status,
          speakerUtterances, detectedLanguages, speakerRoleMapping } = parseBody(req.body);

  if (errors.length) {
    return res.status(400).json({ success: false, message: errors.join('; ') });
  }

  // chief_complaint required when approving
  if (status === 'approved' && !note?.chief_complaint?.trim()) {
    return res.status(400).json({
      success: false,
      message: 'chief_complaint is required when approving a consultation.',
    });
  }

  try {
    // Ownership enforced at query level.
    const existing = await Consultation.findOne({
      _id:    req.params.id,
      userId: req.user.id,
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Consultation not found.' });
    }

    // Prevent modifying an already-approved consultation.
    if (existing.status === 'approved' && status !== undefined) {
      if (status === 'approved') {
        return res.status(409).json({
          success: false,
          message: 'Consultation is already approved.',
        });
      }
      // Cannot revert an approved consultation back to draft.
      return res.status(403).json({
        success: false,
        message: 'An approved consultation cannot be modified.',
      });
    }

    if (existing.status === 'approved') {
      // Even non-status field changes are blocked on approved docs.
      return res.status(403).json({
        success: false,
        message: 'An approved consultation cannot be modified.',
      });
    }

    if (transcript         !== undefined) existing.transcript         = transcript;
    if (note               !== undefined) existing.note               = note;
    if (speakerUtterances  !== undefined) existing.speakerUtterances  = speakerUtterances;
    if (detectedLanguages  !== undefined) existing.detectedLanguages  = detectedLanguages;
    if (speakerRoleMapping !== undefined) existing.speakerRoleMapping = speakerRoleMapping;
    // patientId and userId are immutable after creation — silently ignore any
    // attempt to change them via PUT.

    if (status !== undefined) {
      existing.status = status;
      if (status === 'approved' && !existing.approvedAt) {
        existing.approvedAt = new Date();
        existing.approvedBy = req.user.id;
      }
    }

    const saved = await existing.save();
    return res.json({ success: true, consultation: saved });
  } catch (err) {
    console.error('[consultationController] update error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update consultation.' });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/consultations/:id   (draft only)
// ---------------------------------------------------------------------------
async function deleteConsultation(req, res) {
  if (!validateObjectId(req.params.id, res)) return;

  try {
    const existing = await Consultation.findOne({
      _id:    req.params.id,
      userId: req.user.id,
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Consultation not found.' });
    }

    if (existing.status === 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Approved consultations cannot be deleted.',
      });
    }

    await existing.deleteOne();
    return res.json({ success: true, message: 'Consultation deleted.' });
  } catch (err) {
    console.error('[consultationController] delete error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to delete consultation.' });
  }
}

module.exports = {
  createConsultation,
  listConsultations,
  getConsultation,
  updateConsultation,
  deleteConsultation,
  createCorrection,
};

// ---------------------------------------------------------------------------
// POST /api/consultations/:id/correct  — Phase 5B
// ---------------------------------------------------------------------------
// Creates a new consultation document that is a correction of an existing
// approved consultation, without mutating the original.
//
// Design rules
// ──────────────
// 1. Source must exist and belong to req.user.id (ownership enforced at DB
//    query level — same pattern as all other consultation endpoints).
// 2. Source must have status === 'approved'.  Draft consultations use the
//    normal PUT endpoint for edits; they cannot be "corrected".
// 3. Source must not already have supersededBy set.  If it does the doctor
//    should correct the replacement, not the superseded original.
// 4. The new correction document starts as status='draft' with no
//    approval metadata (approvedAt=null, approvedBy=null).
// 5. correctionOf is set to the source _id; supersededBy is left null on
//    the new document (nothing has replaced it yet).
// 6. supersededBy on the SOURCE is updated to the new document's _id only
//    AFTER the new document is successfully created (two-phase update to
//    keep the source unchanged if creation fails).
//
// Fields copied from source        Why
// ─────────────────────────────── ─────────────────────────────────────────
// userId                           Same owner — never from client
// patientId                        Same encounter — immutable
// consultationDate                 Same clinical date — it is a correction,
//                                  not a new encounter
// encounterType                    Same encounter type
// transcript                       Source audio / transcript reused
// detectedLanguages                Same source audio
// speakerUtterances                Same source audio
// speakerRoleMapping               Same source audio role assignments
// note                             Starting point the doctor edits
//
// Fields intentionally NOT copied
// ─────────────────────────────── ─────────────────────────────────────────
// status                           New correction starts as 'draft'
// approvedAt                       New correction is not yet approved
// approvedBy                       New correction is not yet approved
// correctionOf                     Set to source._id (overrides any previous)
// supersededBy                     null — nothing has replaced this yet
//
// Optional override via request body
// ─────────────────────────────── ─────────────────────────────────────────
// note                             Doctor may supply a pre-edited note.
//                                  If absent, the source note is copied.
//
async function createCorrection(req, res) {
  if (!validateObjectId(req.params.id, res)) return;

  const userId   = req.user.id;   // always from verified token
  const sourceId = req.params.id;

  // Optionally accept a pre-edited note in the request body.
  // All other fields are derived from the source — never from client input.
  const { note: overrideNote } = req.body ?? {};

  try {
    // ── 1. Fetch and authorise source consultation ───────────────────────
    const source = await Consultation.findOne({
      _id:    sourceId,
      userId,
    });

    if (!source) {
      return res.status(404).json({
        success: false,
        message: 'Consultation not found.',
      });
    }

    // ── 2. Source must be approved ──────────────────────────────────────
    if (source.status !== 'approved') {
      return res.status(409).json({
        success: false,
        message: 'Only approved consultations can be corrected. Use PUT to edit a draft.',
      });
    }

    // ── 3. Source must not already be superseded ─────────────────────────
    // The doctor should be correcting the effective approved consultation,
    // not an already-replaced original.
    if (source.supersededBy) {
      return res.status(409).json({
        success: false,
        message: 'This consultation has already been superseded by a correction. Correct the effective approved consultation instead.',
      });
    }

    // ── 4. Validate override note shape if provided ───────────────────────
    if (overrideNote !== undefined) {
      if (typeof overrideNote !== 'object' || Array.isArray(overrideNote)) {
        return res.status(400).json({
          success: false,
          message: 'note must be an object.',
        });
      }
    }

    // ── 5. Create the correction document ────────────────────────────────
    const correction = await Consultation.create({
      // Ownership — from token only
      userId,

      // Patient/encounter context — preserved from source
      patientId:        source.patientId,
      consultationDate: source.consultationDate,
      encounterType:    source.encounterType,

      // Source audio/transcript data — reused verbatim
      transcript:         source.transcript,
      detectedLanguages:  source.detectedLanguages,
      speakerUtterances:  source.speakerUtterances,
      speakerRoleMapping: source.speakerRoleMapping,

      // Note — doctor-supplied override, or copy of the source note
      note: overrideNote ?? source.note?.toObject?.() ?? source.note ?? {},

      // Correction chain — link back to the source
      correctionOf: source._id,
      supersededBy: null,   // nothing has replaced this new document yet

      // Approval metadata — intentionally cleared; correction starts as draft
      status:     'draft',
      approvedAt: null,
      approvedBy: null,
    });

    // ── 6. Update source — mark it as superseded by the correction ────────
    // Only executed after the new document is successfully persisted.
    source.supersededBy = correction._id;
    await source.save();

    return res.status(201).json({
      success:      true,
      consultation: correction,
    });
  } catch (err) {
    console.error('[consultationController] createCorrection error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to create correction.',
    });
  }
}
