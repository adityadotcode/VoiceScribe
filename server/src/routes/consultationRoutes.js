const express = require('express');
const {
  createConsultation,
  listConsultations,
  getConsultation,
  updateConsultation,
  deleteConsultation,
  createCorrection,
} = require('../controllers/consultationController');

const router = express.Router();

router.post('/',    createConsultation);
router.get('/',     listConsultations);
router.get('/:id',  getConsultation);
router.put('/:id',  updateConsultation);
router.delete('/:id', deleteConsultation);

// Phase 5B — correction of an approved consultation
router.post('/:id/correct', createCorrection);

module.exports = router;
