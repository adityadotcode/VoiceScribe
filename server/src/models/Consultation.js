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
