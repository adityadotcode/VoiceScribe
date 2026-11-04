'use strict';

/**
 * PatientAccount — Patient Portal identity model
 *
 * Represents a patient's authenticated account, linked to exactly one
 * doctor-owned Patient document.
 *
 * Design decisions:
 *  • Separate from User deliberately — patient tokens have a different `sub`
 *    so they cannot collide with doctor-owned resources without explicit
 *    patient-route authorization.
 *  • patientId links this account to the clinical record owned by the doctor.
 *  • doctorUserId records which doctor's Patient document this account is
 *    associated with.  Used to scope consultation access:
 *      Consultation.find({ patientId, userId: doctorUserId, status:'approved', supersededBy:null })
 *  • The invite token is hashed (bcrypt) so a compromised DB does not reveal
 *    usable tokens.  Only one pending invite per Patient at a time.
 */

const mongoose = require('mongoose');

const PatientAccountSchema = new mongoose.Schema(
  {
    // Email used for patient login.  Unique globally.
    email: {
      type:      String,
      required:  true,
      unique:    true,
      lowercase: true,
      trim:      true,
    },

    // bcrypt hash of the patient's password.
    passwordHash: {
      type:     String,
      required: true,
    },

    // Display name provided during registration.
    displayName: {
      type:     String,
      required: true,
      trim:     true,
    },

    // The Patient document this account is authorised to read.
    // Set at registration time; immutable afterwards.
    patientId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Patient',
      required: true,
    },

    // The doctor (User._id) whose Patient document this is.
    // Used to scope all consultation queries:
    //   { patientId, userId: doctorUserId, ... }
    doctorUserId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },

    // bcrypt hash of the active refresh token for session invalidation.
    refreshTokenHash: {
      type:    String,
      default: null,
    },

    isActive: {
      type:    Boolean,
      default: true,
    },

    lastLoginAt: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
    strict:     true,
  }
);

PatientAccountSchema.index({ email: 1 }, { unique: true });
PatientAccountSchema.index({ patientId: 1 });

module.exports = mongoose.model('PatientAccount', PatientAccountSchema);
