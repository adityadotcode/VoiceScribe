const mongoose = require('mongoose');
const Patient  = require('../models/Patient');

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

module.exports = { createPatient, listPatients, getPatient, updatePatient };
