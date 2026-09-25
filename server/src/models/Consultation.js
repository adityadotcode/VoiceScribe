const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    age:  { type: Number, default: null },
    sex:  { type: String, default: '' },
  },
  { _id: false }
);

const NoteSchema = new mongoose.Schema(
  {
    patient:               { type: PatientSchema, default: () => ({}) },
    chief_complaint:       { type: String, default: '' },
    symptoms:              { type: [String], default: [] },
    duration:              { type: String, default: '' },
    history:               { type: String, default: '' },
    observations:          { type: [String], default: [] },
    assessment:            { type: String, default: '' },
    medications_mentioned: { type: [String], default: [] },
    follow_up:             { type: String, default: '' },
    missing_information:   { type: [String], default: [] },
    uncertain_fields:      { type: [String], default: [] },
  },
  { _id: false }
);

const ConsultationSchema = new mongoose.Schema(
  {
    // ── Phase 1A — user ownership ─────────────────────────────────────────
    // userId is nullable so that existing V1 documents (which pre-date
    // authentication) remain valid.  The API layer enforces that all NEW
    // consultations receive userId = req.user.id from the authenticated token.
    // V1 documents with userId: null are invisible to authenticated V2 users
    // because all queries filter by { userId: req.user.id }.
    userId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },

    // ── Phase 3A — patient link ───────────────────────────────────────────
    // Nullable for V1 back-compat; API layer requires it on all new creates.
    patientId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Patient',
      default: null,
    },

    // Date/time of the clinical encounter (defaults to creation time).
    consultationDate: {
      type:    Date,
      default: () => new Date(),
    },

    // How the consultation was conducted.
    encounterType: {
      type:    String,
      enum:    ['in_person', 'telemedicine', 'upload'],
      default: 'in_person',
    },

    // Clinician who approved the note (populated on approve action).
    approvedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },

    // Correction chain — links an amended note to the original it replaces.
    // correctionOf:  the _id of the consultation this note corrects.
    // supersededBy:  the _id of the newer note that replaces this one.
    correctionOf: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Consultation',
      default: null,
    },
    supersededBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Consultation',
      default: null,
    },

    transcript: { type: String, default: '' },
    note:       { type: NoteSchema, default: () => ({}) },
    status: {
      type:    String,
      enum:    ['draft', 'approved'],
      default: 'draft',
    },
    // Set once when the doctor clicks Approve & finalize
    approvedAt: { type: Date, default: null },

    // ── Phase 4 / Phase 5 optional fields ────────────────────────────────
    // All three default to empty so existing documents without these fields
    // continue to load normally.

    // Compact speaker utterances produced by buildSpeakerUtterances().
    // Shape: [{ speaker: 'spk_0'|'spk_1', startTime, endTime, text }]
    speakerUtterances: {
      type: [
        new mongoose.Schema(
          {
            speaker:   { type: String, required: true },
            startTime: { type: Number, required: true },
            endTime:   { type: Number, required: true },
            text:      { type: String, default: '' },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    // Languages detected by Amazon Transcribe IdentifyMultipleLanguages.
    // Shape: [{ code: 'en-IN'|'hi-IN', duration: number|null }]
    detectedLanguages: {
      type: [
        new mongoose.Schema(
          {
            code:     { type: String, required: true },
            duration: { type: Number, default: null },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    // Manual UI role mapping the doctor sets on the review screen.
    // Shape: { spk_0: 'Unknown'|'Patient'|'Clinician', spk_1: ... }
    // Stored as Mixed so any spk_* key is accepted without a fixed schema.
    speakerRoleMapping: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    // Adds createdAt and updatedAt automatically
    timestamps: true,
    // Reject keys not in the schema when using Model.create / doc.set
    strict: true,
  }
);

module.exports = mongoose.model('Consultation', ConsultationSchema);

// Compound index: user-scoped consultation list sorted by newest first.
// Defined after model creation so it is clearly associated with the schema.
// This index powers: Consultation.find({ userId }).sort({ createdAt: -1 })
mongoose.model('Consultation').schema.index({ userId: 1, createdAt: -1 });

// Phase 3A indexes — patient history queries.
// Powers: Consultation.find({ patientId }).sort({ createdAt: -1 })
mongoose.model('Consultation').schema.index({ patientId: 1, createdAt: -1 });
// Powers: last-approved query scoped by both user and patient.
mongoose.model('Consultation').schema.index({ userId: 1, patientId: 1, createdAt: -1 });
