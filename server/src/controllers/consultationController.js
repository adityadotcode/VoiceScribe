const Consultation = require('../models/Consultation');

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

  return {
    errors,
    transcript,
    note,
    status,
    speakerUtterances,
    detectedLanguages,
    speakerRoleMapping,
  };
}

// ---------------------------------------------------------------------------
// POST /api/consultations
// ---------------------------------------------------------------------------
async function createConsultation(req, res) {
  const { errors, transcript, note, status,
          speakerUtterances, detectedLanguages, speakerRoleMapping } = parseBody(req.body);

  if (errors.length) {
    return res.status(400).json({ success: false, message: errors.join('; ') });
  }

  // chief_complaint required when approving immediately
  if (status === 'approved' && !note?.chief_complaint?.trim()) {
    return res.status(400).json({
      success: false,
      message: 'chief_complaint is required when approving a consultation.',
    });
  }

  try {
    const doc = await Consultation.create({
      transcript:         transcript         ?? '',
      note:               note               ?? {},
      status:             status             ?? 'draft',
      approvedAt:         status === 'approved' ? new Date() : null,
      speakerUtterances:  speakerUtterances  ?? [],
      detectedLanguages:  detectedLanguages  ?? [],
      speakerRoleMapping: speakerRoleMapping ?? {},
    });

    return res.status(201).json({ success: true, consultation: doc });
  } catch (err) {
    console.error('[consultationController] create error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save consultation.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/consultations
// ---------------------------------------------------------------------------
async function listConsultations(req, res) {
  try {
    const docs = await Consultation.find()
      .sort({ createdAt: -1 })
      .select('_id transcript status note.patient note.chief_complaint createdAt approvedAt')
      .lean();

    return res.json({ success: true, consultations: docs });
  } catch (err) {
    console.error('[consultationController] list error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch consultations.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/consultations/:id
// ---------------------------------------------------------------------------
async function getConsultation(req, res) {
  try {
    const doc = await Consultation.findById(req.params.id).lean();

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Consultation not found.' });
    }

    return res.json({ success: true, consultation: doc });
  } catch (err) {
    // CastError means the id format is invalid
    if (err.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid consultation ID.' });
    }
    console.error('[consultationController] get error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch consultation.' });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/consultations/:id
// ---------------------------------------------------------------------------
async function updateConsultation(req, res) {
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
    const existing = await Consultation.findById(req.params.id);

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Consultation not found.' });
    }

    // Prevent re-approving an already-approved document
    if (existing.status === 'approved' && status === 'approved') {
      return res.status(409).json({
        success: false,
        message: 'Consultation is already approved.',
      });
    }

    if (transcript         !== undefined) existing.transcript         = transcript;
    if (note               !== undefined) existing.note               = note;
    if (speakerUtterances  !== undefined) existing.speakerUtterances  = speakerUtterances;
    if (detectedLanguages  !== undefined) existing.detectedLanguages  = detectedLanguages;
    if (speakerRoleMapping !== undefined) existing.speakerRoleMapping = speakerRoleMapping;

    if (status !== undefined) {
      existing.status = status;
      if (status === 'approved' && !existing.approvedAt) {
        existing.approvedAt = new Date();
      }
    }

    const saved = await existing.save();
    return res.json({ success: true, consultation: saved });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid consultation ID.' });
    }
    console.error('[consultationController] update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update consultation.' });
  }
}

module.exports = {
  createConsultation,
  listConsultations,
  getConsultation,
  updateConsultation,
};
