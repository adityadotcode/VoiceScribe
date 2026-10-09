/**
 * pdfExport.js — Phase 6B
 *
 * Client-side PDF generation for a single approved consultation.
 * Uses jsPDF (v2.x) directly — no React rendering, no server round-trip.
 *
 * The exported document is a plain, professional clinical record with only
 * fields that are actually present in the VoiceScribe data model.
 * No clinical information is invented; absent fields are silently omitted.
 *
 * Public API:
 *   generateConsultationPdf(consultation, patient?) → saves file to disk
 *
 * @param {object} consultation  The full consultation document from the API.
 * @param {object|null} patient  Optional patient record from GET /api/patients/:id.
 */

import { jsPDF } from 'jspdf';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_W   = 210;   // A4 mm
const PAGE_H   = 297;
const MARGIN   = 20;    // left/right margin
const CONTENT_W = PAGE_W - MARGIN * 2;

const FONT_TITLE   = 14;
const FONT_HEADING = 11;
const FONT_BODY    = 10;
const FONT_SMALL   = 8;

const COLOR_HEADING = [30, 30, 30];   // near-black
const COLOR_BODY    = [50, 50, 50];
const COLOR_MUTED   = [110, 110, 110];
const COLOR_RULE    = [200, 200, 200]; // light-grey divider

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-AU', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-AU', {
      dateStyle: 'medium', timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

const ENCOUNTER_LABELS = {
  in_person:    'In person',
  telemedicine: 'Telemedicine',
  upload:       'File upload',
};

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/**
 * A stateful cursor that tracks the current Y position on the page.
 * When content would overflow the current page, addPage() is called
 * automatically before writing.
 */
function makeCursor(doc) {
  let y = MARGIN;

  function ensureSpace(needed = 10) {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  }

  function getY() { return y; }
  function setY(v) { y = v; }
  function advance(delta) { y += delta; }

  return { ensureSpace, getY, setY, advance };
}

/**
 * Wraps a long text string into lines that fit within maxWidth mm.
 * Returns an array of strings.
 */
function wrapText(doc, text, maxWidth, fontSize) {
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(String(text), maxWidth);
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

function drawRule(doc, cursor) {
  cursor.ensureSpace(6);
  const y = cursor.getY();
  doc.setDrawColor(...COLOR_RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  cursor.advance(4);
}

function drawSectionHeading(doc, cursor, title) {
  cursor.ensureSpace(14);
  doc.setFontSize(FONT_HEADING);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLOR_HEADING);
  doc.text(title.toUpperCase(), MARGIN, cursor.getY());
  cursor.advance(2);
  drawRule(doc, cursor);
}

function drawLabelValue(doc, cursor, label, value) {
  if (!value && value !== 0) return;
  const text = String(value);
  const lines = wrapText(doc, text, CONTENT_W - 38, FONT_BODY);
  const lineH = 5;
  cursor.ensureSpace(lineH * lines.length + 2);

  // Label
  doc.setFontSize(FONT_SMALL);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLOR_MUTED);
  doc.text(label, MARGIN, cursor.getY());

  // Value — indented
  doc.setFontSize(FONT_BODY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLOR_BODY);
  lines.forEach((line, i) => {
    if (i > 0) cursor.ensureSpace(lineH);
    doc.text(line, MARGIN + 38, cursor.getY());
    if (i < lines.length - 1) cursor.advance(lineH);
  });
  cursor.advance(lineH + 1);
}

function drawPillRow(doc, cursor, label, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const text = items.join(', ');
  drawLabelValue(doc, cursor, label, text);
}

function drawBodyText(doc, cursor, text) {
  if (!text) return;
  const lines = wrapText(doc, text, CONTENT_W, FONT_BODY);
  const lineH = 5;
  lines.forEach((line) => {
    cursor.ensureSpace(lineH);
    doc.setFontSize(FONT_BODY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLOR_BODY);
    doc.text(line, MARGIN, cursor.getY());
    cursor.advance(lineH);
  });
}

// ---------------------------------------------------------------------------
// Document sections
// ---------------------------------------------------------------------------

function drawDocumentHeader(doc, cursor, consultation, patient) {
  // ── VoiceScribe heading ──────────────────────────────────────────────────
  doc.setFontSize(FONT_TITLE);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLOR_HEADING);
  doc.text('VoiceScribe — Clinical Consultation Record', MARGIN, cursor.getY());
  cursor.advance(7);

  // ── Correction notice ────────────────────────────────────────────────────
  if (consultation.correctionOf) {
    doc.setFontSize(FONT_SMALL);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(180, 100, 0);  // amber
    doc.text(
      'This document represents an approved correction of an earlier consultation.',
      MARGIN,
      cursor.getY(),
    );
    cursor.advance(6);
  }

  drawRule(doc, cursor);

  // ── Patient demographics ─────────────────────────────────────────────────
  if (patient) {
    drawSectionHeading(doc, cursor, 'Patient');
    const fullName = [patient.firstName, patient.lastName].filter(Boolean).join(' ');
    if (fullName) drawLabelValue(doc, cursor, 'Name', fullName);
    if (patient.medicalRecordId) drawLabelValue(doc, cursor, 'Medical record ID', patient.medicalRecordId);
    if (patient.dateOfBirth)     drawLabelValue(doc, cursor, 'Date of birth', fmtDate(patient.dateOfBirth));
    if (patient.biologicalSex)   drawLabelValue(doc, cursor, 'Biological sex', patient.biologicalSex);
    if (patient.phone)           drawLabelValue(doc, cursor, 'Phone', patient.phone);
    cursor.advance(2);
  }

  // ── Consultation metadata ────────────────────────────────────────────────
  drawSectionHeading(doc, cursor, 'Consultation');
  const consultDate = consultation.consultationDate ?? consultation.createdAt;
  if (consultDate) drawLabelValue(doc, cursor, 'Consultation date', fmtDate(consultDate));

  const encounterLabel = ENCOUNTER_LABELS[consultation.encounterType] ?? consultation.encounterType;
  if (encounterLabel) drawLabelValue(doc, cursor, 'Encounter type', encounterLabel);

  drawLabelValue(doc, cursor, 'Status', 'Approved');

  if (consultation.approvedAt) {
    drawLabelValue(doc, cursor, 'Approved at', fmtDateTime(consultation.approvedAt));
  }

  cursor.advance(2);
}

function drawClinicalNote(doc, cursor, note) {
  if (!note) return;

  drawSectionHeading(doc, cursor, 'Clinical Note');

  if (note.chief_complaint) drawLabelValue(doc, cursor, 'Chief complaint', note.chief_complaint);
  if (note.duration)        drawLabelValue(doc, cursor, 'Duration / onset', note.duration);
  if (note.history)         drawLabelValue(doc, cursor, 'History', note.history);

  drawPillRow(doc, cursor, 'Symptoms',             note.symptoms);
  drawPillRow(doc, cursor, 'Observations',         note.observations);
  drawPillRow(doc, cursor, 'Medications mentioned', note.medications_mentioned);

  if (note.assessment) drawLabelValue(doc, cursor, 'Assessment', note.assessment);
  if (note.follow_up)  drawLabelValue(doc, cursor, 'Follow-up', note.follow_up);

  drawPillRow(doc, cursor, 'Missing information', note.missing_information);
  drawPillRow(doc, cursor, 'Uncertain fields',    note.uncertain_fields);

  // V1 compatibility — transcript-extracted patient info
  const p = note.patient;
  if (p?.name || p?.age || p?.sex) {
    cursor.advance(2);
    drawSectionHeading(doc, cursor, 'Noted Patient Info (from transcript)');
    if (p.name) drawLabelValue(doc, cursor, 'Name', p.name);
    if (p.age)  drawLabelValue(doc, cursor, 'Age',  String(p.age));
    if (p.sex)  drawLabelValue(doc, cursor, 'Sex',  p.sex);
  }
}

function drawFooter(doc) {
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(FONT_SMALL);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLOR_MUTED);

    const disclaimer =
      'This document was generated by VoiceScribe and represents the approved clinical ' +
      'documentation as recorded. It is not a substitute for professional clinical judgment.';
    const disclaimerLines = wrapText(doc, disclaimer, CONTENT_W, FONT_SMALL);
    const footerY = PAGE_H - MARGIN + 2;

    // Only draw one line of disclaimer and page number in the footer area
    doc.text(disclaimerLines[0] ?? '', MARGIN, footerY);
    doc.text(`Page ${i} of ${totalPages}`, PAGE_W - MARGIN, footerY, { align: 'right' });
  }
}

// ---------------------------------------------------------------------------
// Safe filename — avoids exposing internal IDs or patient PII in the name
// ---------------------------------------------------------------------------
function buildFilename(consultation) {
  const dateStr = consultation.consultationDate ?? consultation.createdAt;
  let datePart = 'consultation';
  if (dateStr) {
    try {
      datePart = new Date(dateStr)
        .toISOString()
        .slice(0, 10); // YYYY-MM-DD
    } catch { /* keep default */ }
  }
  const correctionSuffix = consultation.correctionOf ? '-correction' : '';
  return `consultation-${datePart}${correctionSuffix}.pdf`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate and save (download) a PDF for a single approved consultation.
 *
 * @param {object}      consultation  Full consultation doc from GET /api/consultations/:id
 * @param {object|null} patient       Patient doc from GET /api/patients/:id (optional)
 * @returns {string}                  The filename used for the saved file
 *
 * @throws {Error} If jsPDF fails or required data is missing
 */
export function generateConsultationPdf(consultation, patient = null) {
  if (!consultation) throw new Error('consultation is required');
  if (consultation.status !== 'approved') {
    throw new Error('Only approved consultations can be exported as PDF.');
  }

  const doc    = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const cursor = makeCursor(doc);

  drawDocumentHeader(doc, cursor, consultation, patient);
  drawClinicalNote(doc, cursor, consultation.note);
  drawFooter(doc);

  const filename = buildFilename(consultation);
  doc.save(filename);
  return filename;
}

// Exported for testing without triggering a save
export { buildFilename, drawDocumentHeader, drawClinicalNote };
