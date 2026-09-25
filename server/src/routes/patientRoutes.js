const express = require('express');
const {
  createPatient,
  listPatients,
  getPatient,
  updatePatient,
  listPatientConsultations,
  getLastApproved,
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

module.exports = router;
