const express = require('express');
const {
  createPatient,
  listPatients,
  getPatient,
  updatePatient,
} = require('../controllers/patientController');

const router = express.Router();

// All routes below the authenticate middleware in routes/index.js,
// so every request here already has req.user attached.
router.post('/',    createPatient);
router.get('/',     listPatients);
router.get('/:id',  getPatient);
router.put('/:id',  updatePatient);

module.exports = router;
