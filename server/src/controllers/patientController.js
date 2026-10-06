const mongoose              = require('mongoose');
const Patient               = require('../models/Patient');
const Consultation          = require('../models/Consultation');
const { diffNotes }         = require('../services/consultationDiffService');
const { generateChangeSummaryNarrative } = require('../services/bedrockService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SEXES = ['male', 'female', 'other', 'not_stated'];

const MAX_STRING = 200; // generous limit for names, notes, etc.

/** Validate a MongoDB ObjectId from a route parameter. */
function validateObjectId(id, res) {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ success: false, message: 'Invalid patient ID.' });
    return false;
  }
  return true;
}

/** Trim a value if it is a string, otherwise return the original. */
function trimStr(v) {
  return typeof v === 'string' ? v.trim() : v;
}

/**
 * Validate and extract the mutable patient fields from the request body.
 * Returns { errors, fields } where fields contains only the values that
 * were explicitly provided (undefined = not present in body).
 */
function parsePatientBody(body, isCreate = false) {
  const errors = [];
  const fields = {};

  // ── firstName ─────────────────────────────────────────────────────────
  if (body.firstName !== undefined) {
    const v = trimStr(body.firstName);
    if (!v)                   errors.push('firstName is required.');
    else if (v.length > MAX_STRING) errors.push('firstName is too long.');
    else                      fields.firstName = v;
  } else if (isCreate) {
    errors.push('firstName is required.');
  }

  // ── lastName ──────────────────────────────────────────────────────────
  if (body.lastName !== undefined) {
    const v = trimStr(body.lastName);
    if (!v)                   errors.push('lastName is required.');
    else if (v.length > MAX_STRING) errors.push('lastName is too long.');
    else                      fields.lastName = v;
  } else if (isCreate) {
    errors.push('lastName is required.');
  }

  // ── dateOfBirth ───────────────────────────────────────────────────────
  if (body.dateOfBirth !== undefined) {
    const d = new Date(body.dateOfBirth);
    if (isNaN(d.getTime())) {
      errors.push('dateOfBirth must be a valid date.');
    } else if (d > new Date()) {
      errors.push('dateOfBirth cannot be in the future.');
    } else {
      fields.dateOfBirth = d;
    }
  } else if (isCreate) {
    errors.push('dateOfBirth is required.');
  }

  // ── biologicalSex ─────────────────────────────────────────────────────
  if (body.biologicalSex !== undefined) {
    if (!VALID_SEXES.includes(body.biologicalSex)) {
      errors.push(`biologicalSex must be one of: ${VALID_SEXES.join(', ')}.`);
    } else {
      fields.biologicalSex = body.biologicalSex;
    }
  } else if (isCreate) {
    errors.push('biologicalSex is required.');
  }

  // ── Optional fields ───────────────────────────────────────────────────
  if (body.phone !== undefined)           fields.phone           = trimStr(body.phone) ?? '';
  if (body.medicalRecordId !== undefined) fields.medicalRecordId = trimStr(body.medicalRecordId) ?? '';
  if (body.notes !== undefined)           fields.notes           = trimStr(body.notes) ?? '';
  if (body.isArchived !== undefined)      fields.isArchived      = Boolean(body.isArchived);

  return { errors, fields };
}

// ---------------------------------------------------------------------------
// POST /api/patients
// ---------------------------------------------------------------------------
async function createPatient(req, res) {
  const { errors, fields } = parsePatientBody(req.body, true);

  if (errors.length) {
    return res.status(400).json({ success: false, message: errors.join(' ') });
  }

  const userId = req.user.id; // always from verified token, never from client

  try {
    // ── Possible-duplicate check ──────────────────────────────────────────
    // If the same user already has a patient with identical firstName +
    // lastName + dateOfBirth, signal a possible duplicate so the frontend can
    // warn the doctor.  Do NOT block creation — the doctor may legitimately
    // have two patients with the same name and DOB (e.g. twins).
    const possibleDuplicate = await Patient.findOne({
      userId,
      firstName:   fields.firstName,
      lastName:    fields.lastName,
      dateOfBirth: fields.dateOfBirth,
    }).lean();

    const doc = await Patient.create({ userId, ...fields });

    return res.status(201).json({
      success:           true,
      patient:           doc,
      possibleDuplicate: possibleDuplicate
        ? { id: possibleDuplicate._id.toString(), message: 'A patient with this name and date of birth already exists in your records.' }
        : null,
    });
  } catch (err) {
    // Mongoose duplicate-key on medicalRecordId (code 11000)
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A patient with this medical record ID already exists in your records.',
      });
    }
    console.error('[patientController] create error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create patient.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/patients
// ---------------------------------------------------------------------------
async function listPatients(req, res) {
  const userId            = req.user.id;
  const { search, archived } = req.query;

  // Build the base filter — always scoped to the authenticated user.
  const filter = { userId };

  // By default exclude archived; pass ?archived=true to include them.
  if (archived !== 'true') {
    filter.isArchived = false;
  }

  // Optional search: firstName, lastName, medicalRecordId (case-insensitive).
  // Uses a regex that is anchored at the start of each value for better index
  // utilisation on lastName/firstName (the compound index prefix).
  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    filter.$or = [
      { firstName:       rx },
      { lastName:        rx },
      { medicalRecordId: rx },
    ];
  }

  try {
    const patients = await Patient.find(filter)
      .sort({ lastName: 1, firstName: 1 })
      .select('-notes')   // notes can be long; omit from list, include on detail
      .lean();

    return res.json({ success: true, patients });
  } catch (err) {
    console.error('[patientController] list error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch patients.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/patients/:id
// ---------------------------------------------------------------------------
async function getPatient(req, res) {
  if (!validateObjectId(req.params.id, res)) return;

  try {
    // Ownership enforced at query level.  Returns null if _id exists but
    // belongs to another user — the caller cannot distinguish existence.
    const patient = await Patient.findOne({
      _id:    req.params.id,
      userId: req.user.id,
    }).lean();

    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    return res.json({ success: true, patient });
  } catch (err) {
    console.error('[patientController] get error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch patient.' });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/patients/:id
// ---------------------------------------------------------------------------
async function updatePatient(req, res) {
  if (!validateObjectId(req.params.id, res)) return;

  const { errors, fields } = parsePatientBody(req.body, false);

  if (errors.length) {
    return res.status(400).json({ success: false, message: errors.join(' ') });
  }

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ success: false, message: 'No updatable fields provided.' });
  }

  try {
    // Ownership enforced at query level.
    const patient = await Patient.findOne({
      _id:    req.params.id,
      userId: req.user.id,
    });

    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    // Apply updates — never allow _id, userId, or createdAt to change.
    const FORBIDDEN = new Set(['_id', 'userId', 'createdAt']);
    for (const [key, value] of Object.entries(fields)) {
      if (!FORBIDDEN.has(key)) patient[key] = value;
    }

    await patient.save();

    return res.json({ success: true, patient });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A patient with this medical record ID already exists in your records.',
      });
    }
    console.error('[patientController] update error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update patient.' });
  }
}


// ---------------------------------------------------------------------------
// GET /api/patients/:id/consultations
// ---------------------------------------------------------------------------
// Returns a summary list of all consultations for the given patient,
// newest first.  Patient must belong to the authenticated user.
async function listPatientConsultations(req, res) {
  if (!validateObjectId(req.params.id, res)) return;

  const userId    = req.user.id;
  const patientId = req.params.id;

  try {
    // Verify patient ownership before exposing any consultation data.
    const patient = await Patient.findOne({
      _id:    patientId,
      userId,
    }).lean();

    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    // Return summary fields only — full note is available via GET /consultations/:id.
    const consultations = await Consultation.find({ patientId, userId })
      .sort({ createdAt: -1 })
      .select('_id status consultationDate encounterType note.chief_complaint createdAt approvedAt approvedBy correctionOf supersededBy')
      .lean();

    return res.json({ success: true, consultations });
  } catch (err) {
    console.error('[patientController] listPatientConsultations error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch consultations.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/patients/:id/last-approved
// ---------------------------------------------------------------------------
// Returns the most recent approved consultation for this patient that has
// not been superseded by a correction.  Ignores notes where supersededBy is
// set (those are the originals that were replaced) and ignores notes that are
// themselves corrections of another (correctionOf is set) so we only surface
// the canonical, current-approved record.
//
// Correction-aware query:
//   status='approved', supersededBy=null
//   (correctionOf intentionally omitted — Phase 5D: approved corrections ARE
//    the effective version and must be returned here)
//   sorted by consultationDate descending → first result is the current note.
//
// Returns 404 when no such consultation exists (patient has no approved notes
// yet, or all approved notes have been superseded).
async function getLastApproved(req, res) {
  if (!validateObjectId(req.params.id, res)) return;

  const userId    = req.user.id;
  const patientId = req.params.id;

  try {
    // Verify patient ownership.
    const patient = await Patient.findOne({
      _id:    patientId,
      userId,
    }).lean();

    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    const consultation = await Consultation.findOne({
      patientId,
      userId,
      status:       'approved',
      supersededBy: null,
      // NOTE: correctionOf intentionally omitted — an approved correction IS
      // the effective version of a consultation and must be surfaced here.
    })
      .sort({ consultationDate: -1 })
      // Return the full note context fields used for pre-filling a new encounter.
      .select('_id consultationDate encounterType note approvedAt approvedBy createdAt')
      .lean();

    if (!consultation) {
      return res.status(404).json({ success: false, message: 'No approved consultation found for this patient.' });
    }

    return res.json({ success: true, consultation });
  } catch (err) {
    console.error('[patientController] getLastApproved error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch last approved consultation.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/patients/:id/change-summary  — Phase 4B
// ---------------------------------------------------------------------------
// Compares the note of a specified current consultation against the most
// recent effective approved consultation for the same patient, returning a
// deterministic structured diff via consultationDiffService.
//
// Authorization:
//   - Patient must belong to req.user.id.
//   - Current consultation must belong to req.user.id AND to the patient
//     identified by req.params.id.
//   - userId is NEVER taken from the request body.
//
// Previous-consultation selection (correction-aware):
//   Finds the most recent approved consultation where:
//     - patientId  = req.params.id
//     - userId     = req.user.id
//     - status     = 'approved'
//     - supersededBy = null    (not replaced by a correction)
//     - correctionOf = null    (not itself a correction)
//     - consultationDate < currentConsultation.consultationDate
//   Sorted by consultationDate descending → first result is the comparison base.
//
// If no such previous consultation exists, responds with
// { success: true, hasPreviousConsultation: false, ... } (not an error).
async function getChangeSummary(req, res) {
  // ── 1. Validate route param ──────────────────────────────────────────────
  if (!validateObjectId(req.params.id, res)) return;

  const userId    = req.user.id;   // always from token
  const patientId = req.params.id;

  // ── 2. Validate body ─────────────────────────────────────────────────────
  const { currentConsultationId, generateNarrative = false } = req.body;

  if (!currentConsultationId) {
    return res.status(400).json({
      success: false,
      message: 'currentConsultationId is required.',
    });
  }

  if (!mongoose.isValidObjectId(currentConsultationId)) {
    return res.status(400).json({
      success: false,
      message: 'currentConsultationId is not a valid ID.',
    });
  }

  try {
    // ── 3. Authorize patient ─────────────────────────────────────────────
    const patient = await Patient.findOne({ _id: patientId, userId }).lean();

    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    // ── 4. Authorize & fetch current consultation ────────────────────────
    // Must belong to this user AND to this patient to prevent cross-patient
    // comparisons.  userId in the query — never from the client body.
    const currentConsultation = await Consultation.findOne({
      _id:       currentConsultationId,
      userId,
      patientId,
    }).lean();

    if (!currentConsultation) {
      return res.status(404).json({ success: false, message: 'Consultation not found.' });
    }

    // ── 5. Find previous effective approved consultation ─────────────────
    // Correction-aware: ignore notes that have been superseded (old originals)
    // and notes that are themselves corrections of another note.  Only
    // "standing" approved notes are valid comparison bases.
    //
    // We compare against consultationDate (the clinical encounter date).
    // Fall back to createdAt if consultationDate is absent on old documents.
    const currentDate = currentConsultation.consultationDate
      || currentConsultation.createdAt;

    const previousConsultation = await Consultation.findOne({
      patientId,
      userId,
      status:           'approved',
      supersededBy:     null,
      // NOTE: correctionOf intentionally omitted — an approved correction IS
      // the effective version of a consultation and is a valid comparison base.
      // Strictly earlier than the current consultation's encounter date.
      consultationDate: { $lt: currentDate },
    })
      .sort({ consultationDate: -1 })
      .select('_id consultationDate note createdAt')
      .lean();

    // ── 6. No previous consultation — return graceful no-comparison ──────
    if (!previousConsultation) {
      return res.json({
        success:                  true,
        hasPreviousConsultation:  false,
        previousConsultation:     null,
        structuredDiff:           null,
        // Narrative not possible without a previous consultation.
        ...(generateNarrative === true && {
          clinicalSummary:  null,
          narrativeError:   'No previous approved consultation to compare against.',
        }),
      });
    }

    // ── 7. Compute deterministic diff ────────────────────────────────────
    const structuredDiff = diffNotes(
      previousConsultation.note,
      currentConsultation.note,
    );

    // ── 8. Optionally generate Bedrock narrative ──────────────────────────
    // Bedrock is called ONLY when the client explicitly requests it.
    // A failed narrative never prevents the structured diff from being returned.
    let clinicalSummary  = undefined;
    let generatedAt      = undefined;
    let narrativeError   = undefined;

    if (generateNarrative === true) {
      try {
        clinicalSummary = await generateChangeSummaryNarrative(
          previousConsultation.note,
          currentConsultation.note,
          structuredDiff,
        );
        generatedAt = new Date().toISOString();
      } catch (bedrockErr) {
        console.error('[patientController] narrative generation failed:', bedrockErr.message);
        // Do NOT expose internal AWS/Bedrock error details.
        clinicalSummary = null;
        narrativeError  = 'Unable to generate clinical summary.';
      }
    }

    const responseBody = {
      success:                 true,
      hasPreviousConsultation: true,
      previousConsultation: {
        id:               previousConsultation._id,
        consultationDate: previousConsultation.consultationDate
          || previousConsultation.createdAt,
      },
      structuredDiff,
    };

    // Attach narrative fields only when requested to keep the Phase 4B
    // response shape unchanged for callers that don't send generateNarrative.
    if (generateNarrative === true) {
      responseBody.clinicalSummary = clinicalSummary ?? null;
      responseBody.generatedAt     = generatedAt    ?? null;
      if (narrativeError) responseBody.narrativeError = narrativeError;
    }

    return res.json(responseBody);
  } catch (err) {
    console.error('[patientController] getChangeSummary error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to compute change summary.' });
  }
}

module.exports = {
  createPatient,
  listPatients,
  getPatient,
  updatePatient,
  listPatientConsultations,
  getLastApproved,
  getChangeSummary,
  getPatientOverview,
};

// ---------------------------------------------------------------------------
// GET /api/patients/:id/overview  — Patient 360.1
// ---------------------------------------------------------------------------
// Returns a compact 360° overview for a single patient:
//   - Full patient record
//   - Aggregate statistics (total, approved, draft consultations;
//     last consultation date)
//   - Latest effective approved consultation (correction-aware)
//   - 5 most recent consultations (summary fields only)
//
// Consultation counting rules:
//   - Only consultations owned by req.user.id AND linked to this patient.
//   - Corrections (correctionOf !== null) are NOT counted as separate clinical
//     encounters in totalConsultations / approvedConsultations / draftConsultations.
//     They may still appear in recentConsultations for audit visibility.
//
// Latest effective approved consultation:
//   Same semantics as getLastApproved: status='approved', supersededBy=null,
//   correctionOf=null, sorted by consultationDate descending.
//
// Authorization: patient must belong to req.user.id; returns 404 otherwise.
async function getPatientOverview(req, res) {
  if (!validateObjectId(req.params.id, res)) return;

  const userId    = req.user.id;
  const patientId = req.params.id;

  try {
    // ── 1. Verify patient ownership ──────────────────────────────────────
    const patient = await Patient.findOne({ _id: patientId, userId }).lean();

    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found.' });
    }

    // ── 2. Aggregate statistics — clinical encounters only (correctionOf=null)
    // We count only original encounter documents, not correction amendments.
    // A single aggregation pipeline is more efficient than three separate
    // countDocuments calls.
    const statsPipeline = await Consultation.aggregate([
      {
        $match: {
          patientId: patient._id,
          userId:    mongoose.Types.ObjectId.createFromHexString
            ? mongoose.Types.ObjectId.createFromHexString(userId)
            : new mongoose.Types.ObjectId(userId),
          correctionOf: null,   // exclude correction documents
        },
      },
      {
        $group: {
          _id:                  null,
          totalConsultations:   { $sum: 1 },
          approvedConsultations: {
            $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] },
          },
          draftConsultations: {
            $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] },
          },
          lastConsultationDate: { $max: '$consultationDate' },
        },
      },
    ]);

    const stats = statsPipeline[0] ?? {
      totalConsultations:    0,
      approvedConsultations: 0,
      draftConsultations:    0,
      lastConsultationDate:  null,
    };

    // ── 3. Latest effective approved consultation ────────────────────────
    // Correction-aware: supersededBy=null ensures we get the current effective
    // version. correctionOf is intentionally NOT filtered — an approved
    // correction IS the effective note and must be surfaced here.
    const latestApprovedDoc = await Consultation.findOne({
      patientId: patient._id,
      userId:    userId,
      status:       'approved',
      supersededBy: null,
    })
      .sort({ consultationDate: -1 })
      .select('_id consultationDate note approvedAt')
      .lean();

    const latestApproved = latestApprovedDoc
      ? {
          id:                   latestApprovedDoc._id,
          consultationDate:     latestApprovedDoc.consultationDate,
          chief_complaint:      latestApprovedDoc.note?.chief_complaint  ?? null,
          symptoms:             latestApprovedDoc.note?.symptoms          ?? [],
          medications_mentioned: latestApprovedDoc.note?.medications_mentioned ?? [],
          assessment:           latestApprovedDoc.note?.assessment        ?? null,
          follow_up:            latestApprovedDoc.note?.follow_up         ?? null,
        }
      : null;

    // ── 4. Recent consultations — last 5, summary fields only ───────────
    // All consultations (including corrections) are shown here so the doctor
    // has a complete chronological view. Correction status is indicated via
    // the correctionOf / supersededBy fields.
    const recentDocs = await Consultation.find({ patientId: patient._id, userId })
      .sort({ consultationDate: -1, createdAt: -1 })
      .limit(5)
      .select('_id consultationDate status note.chief_complaint correctionOf supersededBy createdAt')
      .lean();

    const recentConsultations = recentDocs.map((c) => ({
      id:               c._id,
      consultationDate: c.consultationDate ?? c.createdAt,
      status:           c.status,
      chief_complaint:  c.note?.chief_complaint ?? null,
      correctionOf:     c.correctionOf  ?? null,
      supersededBy:     c.supersededBy  ?? null,
    }));

    // ── 5. Build and return response ─────────────────────────────────────
    return res.json({
      success: true,
      patient: {
        id:              patient._id,
        firstName:       patient.firstName,
        lastName:        patient.lastName,
        dateOfBirth:     patient.dateOfBirth,
        biologicalSex:   patient.biologicalSex,
        phone:           patient.phone           ?? '',
        medicalRecordId: patient.medicalRecordId ?? '',
        notes:           patient.notes           ?? '',
        isArchived:      patient.isArchived,
      },
      statistics: {
        totalConsultations:    stats.totalConsultations,
        approvedConsultations: stats.approvedConsultations,
        draftConsultations:    stats.draftConsultations,
        lastConsultationDate:  stats.lastConsultationDate ?? null,
      },
      latestApprovedConsultation: latestApproved,
      recentConsultations,
    });
  } catch (err) {
    console.error('[patientController] getPatientOverview error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch patient overview.' });
  }
}
