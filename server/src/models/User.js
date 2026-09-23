const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    email: {
      type:      String,
      required:  true,
      unique:    true,
      lowercase: true,
      trim:      true,
    },
    passwordHash: {
      type:     String,
      required: true,
    },
    displayName: {
      type:     String,
      required: true,
      trim:     true,
    },
    role: {
      type:    String,
      enum:    ['doctor'],
      default: 'doctor',
    },
    // bcrypt hash of the active refresh token.
    // null after logout or when no session exists.
    // Storing the hash (not the raw token) allows server-side invalidation
    // without persisting a value that could be used to forge a session.
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
    timestamps: true, // createdAt, updatedAt
    strict:     true,
  }
);

// Compound-unique index on email is implicit from { unique: true } above, but
// we add an explicit index definition here so it shows up in db.indexes() and
// is easy to locate during future schema audits.
UserSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model('User', UserSchema);
