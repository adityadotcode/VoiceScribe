const express = require('express');
const {
  createConsultation,
  listConsultations,
  getConsultation,
  updateConsultation,
  deleteConsultation,
} = require('../controllers/consultationController');

const router = express.Router();

router.post('/',    createConsultation);
router.get('/',     listConsultations);
router.get('/:id',  getConsultation);
router.put('/:id',  updateConsultation);
router.delete('/:id', deleteConsultation);

module.exports = router;
