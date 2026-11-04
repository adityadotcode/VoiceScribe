'use strict';

/**
 * authenticatePatient — Patient portal authentication middleware
 *
 * Mirrors the doctor authenticate.js but:
 *   1. Expects role:'patient' in the JWT payload.
 *   2. Attaches req.patientAccount = { id, email, role, patientId, doctorUserId }
 *      instead of req.user, so it cannot be confused with a doctor identity.
 *   3. Any token with role !== 'patient' is rejected with 401.
 *
 * This prevents a doctor token from accessing patient-portal endpoints
 * and a patient token from accidentally accessing doctor endpoints.
 */

const { verifyAccessToken } = require('../services/authService');

function authenticatePatient(req, res, next) {
  const authHeader = req.headers['authorization'] || '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    const payload = verifyAccessToken(token);

    // Reject non-patient tokens.
    if (payload.role !== 'patient') {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    req.patientAccount = {
      id:           payload.sub,
      email:        payload.email,
      role:         'patient',
      // patientId and doctorUserId are NOT in the JWT payload to keep
      // tokens compact.  Controllers that need them load the PatientAccount
      // document from the database by req.patientAccount.id.
    };

    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
}

module.exports = { authenticatePatient };
