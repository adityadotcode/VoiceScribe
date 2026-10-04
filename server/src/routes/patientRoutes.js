const express = require('express');
const {
  createPatient,
  listPatients,
  getPatient,
  updatePatient,
  listPatientConsultations,
  getLastApproved,
  getChangeSummary,
  getPatientOverview,
} = require('../controllers/patientController');

const router = express.Router();

// All routes below the authenticate middleware in routes/index.js,
// so every request here already has req.user attached.
router.post('/',    createPatient);
router.get('/',     listPatients);
router.get('/:id',  getPatient);
router.put('/:id',  updatePatient);

// Phase 3A — patient history endpoints
router.get('/:id/consultations', listPatientConsultations);
router.get('/:id/last-approved', getLastApproved);

// Phase 4B — deterministic change summary
router.post('/:id/change-summary', getChangeSummary);

// Patient 360.1 — compact overview
router.get('/:id/overview', getPatientOverview);

module.exports = router;
