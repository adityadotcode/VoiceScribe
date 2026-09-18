const express = require('express');
const {
  createConsultation,
  listConsultations,
  getConsultation,
  updateConsultation,
} = require('../controllers/consultationController');

const router = express.Router();

router.post('/',    createConsultation);
router.get('/',     listConsultations);
router.get('/:id',  getConsultation);
router.put('/:id',  updateConsultation);

module.exports = router;
