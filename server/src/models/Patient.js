const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema(
  {
    // Every patient belongs to exactly one authenticated user.
    // Ownership is always enforced at query level — never trusted from client.
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },

    firstName: {
      type:     String,
      required: true,
      trim:     true,
    },

    lastName: {
      type:     String,
      required: true,
      trim:     true,
    },

    dateOfBirth: {
      type:     Date,
      required: true,
    },

    biologicalSex: {
      type: String,
      enum: ['male', 'female', 'other', 'not_stated'],
      required: true,
    },

    phone: {
      type:    String,
      default: '',
      trim:    true,
    },

    // Doctor's own reference number (e.g. clinic system ID).
    // Unique per userId — two different doctors may have the same value
    // in their separate namespaces.  See index below.
    medicalRecordId: {
      type:    String,
      default: '',
      trim:    true,
    },

    notes: {
      type:    String,
      default: '',
      trim:    true,
    },

    isArchived: {
      type:    Boolean,
      default: false,
    },

    // ── Patient portal invite ─────────────────────────────────────────────
    // A doctor can issue a one-time invite that lets the patient register
    // a PatientAccount linked to this document.
    //
    // portalInviteTokenHash: bcrypt hash of the raw invite token shown to
    //   the doctor.  The raw token is shown once and never stored in plain text.
    // portalInviteExpiresAt: short TTL (e.g. 72 hours).
    // portalInviteUsedAt:    set when the patient registers; token is then void.
    portalInviteTokenHash: {
      type:    String,
      default: null,
    },
    portalInviteExpiresAt: {
      type:    Date,
      default: null,
    },
    portalInviteUsedAt: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
    strict:     true,
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────

// Primary search: alphabetical list scoped to a user
PatientSchema.index({ userId: 1, lastName: 1, firstName: 1 });

// DOB lookup scoped to a user
PatientSchema.index({ userId: 1, dateOfBirth: 1 });

// medicalRecordId must be unique within a user's namespace.
// sparse: true — null / empty-string values are excluded, so a user can have
// many patients without a medicalRecordId without triggering a conflict.
PatientSchema.index(
  { userId: 1, medicalRecordId: 1 },
  {
    unique: true,
    sparse: true,
    // Only enforce uniqueness when medicalRecordId is a non-empty string
    partialFilterExpression: { medicalRecordId: { $exists: true, $ne: '' } },
  }
);

module.exports = mongoose.model('Patient', PatientSchema);
