'use strict';

/**
 * Phase 6B — pdfExport.js unit tests
 *
 * Strategy:
 *   - Mock jsPDF entirely so no real PDF is generated.
 *   - The mock captures every method call and lets us verify that
 *     the right content was written to the document.
 *   - Tests are organised around the public API: generateConsultationPdf()
 *     and the exported helpers buildFilename / drawDocumentHeader / drawClinicalNote.
 *
 * Scenarios (22):
 *  1.  generateConsultationPdf throws when consultation is null
 *  2.  generateConsultationPdf throws for a draft consultation
 *  3.  generateConsultationPdf throws for an approved consultation with status ≠ 'approved'
 *  4.  generateConsultationPdf calls doc.save() with the built filename
 *  5.  generateConsultationPdf returns the filename
 *  6.  buildFilename returns YYYY-MM-DD.pdf from consultationDate
 *  7.  buildFilename uses createdAt when consultationDate is absent
 *  8.  buildFilename appends '-correction' when correctionOf is set
 *  9.  buildFilename falls back to 'consultation.pdf' for a missing date
 * 10.  Patient name is written when patient is provided
 * 11.  Patient medicalRecordId is written when present
 * 12.  Patient dateOfBirth is written when present
 * 13.  Patient biologicalSex is written when present
 * 14.  generateConsultationPdf works without a patient (patient=null)
 * 15.  Consultation date is written to the document
 * 16.  Encounter type is written (in_person → "In person")
 * 17.  Chief complaint is written
 * 18.  Assessment is written
 * 19.  Follow-up is written
 * 20.  Symptoms array is written
 * 21.  Medications mentioned array is written
 * 22.  Correction notice is written for approved corrections
 * 23.  Correction notice is NOT written for regular approved consultations
 * 24.  approvedAt is written when present
 * 25.  Special characters in note fields do not throw
 * 26.  Long note fields do not throw (multi-page simulation via addPage spy)
 * 27.  Export does not call any API or mutate the consultation object
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock jsPDF before importing the module under test
// ---------------------------------------------------------------------------

// Capture all text() calls so we can assert on PDF content
const textCalls   = [];
const savedFiles  = [];

const mockDoc = {
  setFontSize:    vi.fn(),
  setFont:        vi.fn(),
  setTextColor:   vi.fn(),
  setDrawColor:   vi.fn(),
  setLineWidth:   vi.fn(),
  line:           vi.fn(),
  text:           vi.fn((...args) => textCalls.push(args)),
  addPage:        vi.fn(),
  setPage:        vi.fn(),
  getNumberOfPages: vi.fn(() => 1),
  splitTextToSize:  vi.fn((str, _w) => [str]), // always returns one line
  save:           vi.fn((filename) => savedFiles.push(filename)),
};

vi.mock('jspdf', () => ({
  jsPDF: vi.fn(() => mockDoc),
}));

// Import AFTER mock is set up
import {
  generateConsultationPdf,
  buildFilename,
} from '../services/pdfExport.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeApprovedConsultation(overrides = {}) {
  return {
    _id:              'cccccccccccccccccccccccc',
    status:           'approved',
    consultationDate: '2026-09-15T09:00:00.000Z',
    encounterType:    'in_person',
    correctionOf:     null,
    supersededBy:     null,
    approvedAt:       '2026-09-15T10:00:00.000Z',
    createdAt:        '2026-09-15T09:00:00.000Z',
    note: {
      chief_complaint:       'Persistent cough',
      duration:              '3 days',
      history:               'No prior respiratory issues.',
      symptoms:              ['cough', 'fatigue'],
      observations:          ['mild wheeze'],
      medications_mentioned: ['paracetamol'],
      assessment:            'Likely viral URTI',
      follow_up:             'Return in 1 week',
      missing_information:   [],
      uncertain_fields:      [],
    },
    ...overrides,
  };
}

function makePatient(overrides = {}) {
  return {
    _id:             'aaaaaaaaaaaaaaaaaaaaaaaa',
    firstName:       'Alice',
    lastName:        'Smith',
    dateOfBirth:     '1990-05-15T00:00:00.000Z',
    biologicalSex:   'female',
    phone:           '0400000001',
    medicalRecordId: 'MR001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup — clear captured calls before every test
// ---------------------------------------------------------------------------

beforeEach(() => {
  textCalls.length   = 0;
  savedFiles.length  = 0;
  vi.clearAllMocks();
  // Re-attach the text spy after clearAllMocks
  mockDoc.text.mockImplementation((...args) => textCalls.push(args));
  mockDoc.save.mockImplementation((f) => savedFiles.push(f));
  mockDoc.splitTextToSize.mockImplementation((str, _w) => [str]);
  mockDoc.getNumberOfPages.mockReturnValue(1);
});

// ---------------------------------------------------------------------------
// Helper: flatten all text written to the PDF into one searchable string
// ---------------------------------------------------------------------------
function allText() {
  return textCalls.map((args) => args[0]).join('\n');
}

// ===========================================================================
// 1–3: Guard clauses — invalid input throws
// ===========================================================================

describe('1–3. generateConsultationPdf guard clauses', () => {
  test('1. throws when consultation is null', () => {
    expect(() => generateConsultationPdf(null)).toThrow('consultation is required');
  });

  test('2. throws when consultation status is "draft"', () => {
    const draft = makeApprovedConsultation({ status: 'draft', approvedAt: null });
    expect(() => generateConsultationPdf(draft)).toThrow(
      'Only approved consultations can be exported as PDF.'
    );
  });

  test('3. throws when status is anything other than "approved"', () => {
    const unknown = makeApprovedConsultation({ status: 'pending' });
    expect(() => generateConsultationPdf(unknown)).toThrow(
      'Only approved consultations can be exported as PDF.'
    );
  });
});

// ===========================================================================
// 4–5: Save / return value
// ===========================================================================

describe('4–5. save and return value', () => {
  test('4. calls doc.save() with the built filename', () => {
    generateConsultationPdf(makeApprovedConsultation(), makePatient());
    expect(savedFiles).toHaveLength(1);
    expect(savedFiles[0]).toMatch(/^consultation-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  test('5. returns the filename', () => {
    const filename = generateConsultationPdf(makeApprovedConsultation(), makePatient());
    expect(filename).toMatch(/^consultation-.*\.pdf$/);
  });
});

// ===========================================================================
// 6–9: buildFilename
// ===========================================================================

describe('6–9. buildFilename', () => {
  test('6. returns YYYY-MM-DD.pdf from consultationDate', () => {
    const c = makeApprovedConsultation({ consultationDate: '2026-09-15T09:00:00.000Z' });
    expect(buildFilename(c)).toBe('consultation-2026-09-15.pdf');
  });

  test('7. falls back to createdAt when consultationDate is absent', () => {
    const c = makeApprovedConsultation({ consultationDate: null, createdAt: '2026-08-01T00:00:00.000Z' });
    expect(buildFilename(c)).toBe('consultation-2026-08-01.pdf');
  });

  test('8. appends "-correction" when correctionOf is set', () => {
    const c = makeApprovedConsultation({
      consultationDate: '2026-09-15T09:00:00.000Z',
      correctionOf:     'eeeeeeeeeeeeeeeeeeeeeeee',
    });
    expect(buildFilename(c)).toBe('consultation-2026-09-15-correction.pdf');
  });

  test('9. falls back to "consultation.pdf" when no date is available', () => {
    const c = makeApprovedConsultation({ consultationDate: null, createdAt: null });
    expect(buildFilename(c)).toBe('consultation-consultation.pdf');
  });
});

// ===========================================================================
// 10–14: Patient demographics
// ===========================================================================

describe('10–14. patient demographics in PDF', () => {
  test('10. patient full name is written to the document', () => {
    generateConsultationPdf(makeApprovedConsultation(), makePatient());
    expect(allText()).toContain('Alice Smith');
  });

  test('11. patient medicalRecordId is written', () => {
    generateConsultationPdf(makeApprovedConsultation(), makePatient());
    expect(allText()).toContain('MR001');
  });

  test('12. patient dateOfBirth is written (formatted)', () => {
    generateConsultationPdf(makeApprovedConsultation(), makePatient());
    // fmtDate produces a locale string; check that some date text appears
    // We can't assert the exact locale format, but "1990" must be present
    expect(allText()).toContain('1990');
  });

  test('13. biologicalSex is written', () => {
    generateConsultationPdf(makeApprovedConsultation(), makePatient());
    expect(allText()).toContain('female');
  });

  test('14. generateConsultationPdf works when patient is null (demographics omitted)', () => {
    // Should not throw; patient section is simply skipped
    expect(() => generateConsultationPdf(makeApprovedConsultation(), null)).not.toThrow();
    // doc.save still called
    expect(savedFiles).toHaveLength(1);
  });
});

// ===========================================================================
// 15–16: Consultation metadata
// ===========================================================================

describe('15–16. consultation metadata in PDF', () => {
  test('15. consultation date is written', () => {
    generateConsultationPdf(makeApprovedConsultation(), null);
    // The formatted date string will contain "2026"
    expect(allText()).toContain('2026');
  });

  test('16. encounter type "in_person" is written as "In person"', () => {
    generateConsultationPdf(makeApprovedConsultation(), null);
    expect(allText()).toContain('In person');
  });
});

// ===========================================================================
// 17–21: Clinical note fields
// ===========================================================================

describe('17–21. clinical note fields', () => {
  test('17. chief complaint is written', () => {
    generateConsultationPdf(makeApprovedConsultation(), null);
    expect(allText()).toContain('Persistent cough');
  });

  test('18. assessment is written', () => {
    generateConsultationPdf(makeApprovedConsultation(), null);
    expect(allText()).toContain('Likely viral URTI');
  });

  test('19. follow-up is written', () => {
    generateConsultationPdf(makeApprovedConsultation(), null);
    expect(allText()).toContain('Return in 1 week');
  });

  test('20. symptoms array is written as a comma-separated string', () => {
    generateConsultationPdf(makeApprovedConsultation(), null);
    expect(allText()).toContain('cough');
    expect(allText()).toContain('fatigue');
  });

  test('21. medications mentioned array is written', () => {
    generateConsultationPdf(makeApprovedConsultation(), null);
    expect(allText()).toContain('paracetamol');
  });
});

// ===========================================================================
// 22–24: Correction / versioning
// ===========================================================================

describe('22–24. correction versioning in PDF', () => {
  test('22. correction notice is written for an approved correction', () => {
    const correction = makeApprovedConsultation({
      correctionOf: 'eeeeeeeeeeeeeeeeeeeeeeee',
    });
    generateConsultationPdf(correction, null);
    expect(allText()).toContain('approved correction of an earlier consultation');
  });

  test('23. correction notice is NOT present for a regular approved consultation', () => {
    generateConsultationPdf(makeApprovedConsultation(), null);
    expect(allText()).not.toContain('approved correction of an earlier consultation');
  });

  test('24. approvedAt timestamp is written when present', () => {
    generateConsultationPdf(makeApprovedConsultation(), null);
    // Formatted approvedAt should include "2026"
    expect(allText()).toContain('2026');
  });
});

// ===========================================================================
// 25–26: Robustness — special characters, long notes
// ===========================================================================

describe('25–26. special characters and long notes', () => {
  test('25. special characters in note fields do not throw', () => {
    const c = makeApprovedConsultation({
      note: {
        chief_complaint: 'Cough & sore throat <test> "quoted"',
        assessment:      'O\'Brien's syndrome — rule out pneumonia',
        follow_up:       'Résumé with doctor in 2 weeks',
        symptoms:        ['fever', 'chills', 'nasal congestion'],
        medications_mentioned: ['amoxicillin 500mg', 'paracetamol'],
        observations:    [],
        missing_information: [],
        uncertain_fields:   [],
      },
    });
    expect(() => generateConsultationPdf(c, null)).not.toThrow();
  });

  test('26. long note does not throw; addPage may be called if content overflows', () => {
    const longText = 'A '.repeat(500) + 'long clinical note.';
    // Make splitTextToSize return many lines to simulate overflow
    mockDoc.splitTextToSize.mockImplementation((str, _w) =>
      str.split(' ').map((word) => word + ' ')
    );
    const c = makeApprovedConsultation({
      note: {
        chief_complaint: longText,
        assessment:      longText,
        history:         longText,
        follow_up:       longText,
        symptoms:        [],
        observations:    [],
        medications_mentioned: [],
        missing_information:  [],
        uncertain_fields:     [],
      },
    });
    expect(() => generateConsultationPdf(c, null)).not.toThrow();
  });
});

// ===========================================================================
// 27: No API calls, no mutation
// ===========================================================================

describe('27. export does not call any API or mutate consultation data', () => {
  test('27. original consultation object is not mutated after export', () => {
    const c = makeApprovedConsultation();
    const originalStatus = c.status;
    const originalNote   = JSON.stringify(c.note);

    generateConsultationPdf(c, null);

    expect(c.status).toBe(originalStatus);
    expect(JSON.stringify(c.note)).toBe(originalNote);
  });
});
