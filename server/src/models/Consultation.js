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
  },
  {
    // Adds createdAt and updatedAt automatically
    timestamps: true,
    // Reject keys not in the schema when using Model.create / doc.set
    strict: true,
  }
);

module.exports = mongoose.model('Consultation', ConsultationSchema);
