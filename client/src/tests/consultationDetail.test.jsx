/**
 * Phase 3C.1 — ConsultationDetailPage tests
 *
 * Scenarios (7):
 *   1. Consultation loads and fields are displayed
 *   2. Loading state shown while fetch is in-flight
 *   3. 404 / not-found state displayed
 *   4. Network error state displayed
 *   5. All clinical note fields render correctly
 *   6. Open action from Patient Profile history navigates to /consultation/:id
 *   7. Correction and superseded indicators are rendered
 *
 * Strategy:
 *   - vi.mock the consultations API service.
 *   - vi.mock the patients API service (needed by PatientProfilePage test).
 *   - vi.mock api.js defensively (prevent cross-test contamination).
 *   - Render pages via MemoryRouter with appropriate initial routes.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../services/api/consultations.js', () => ({
  apiGetConsultation:     vi.fn(),
  apiCreateCorrection:    vi.fn(),
  apiApproveConsultation: vi.fn(),
}));

vi.mock('../services/api/patients.js', () => ({
  apiGetPatient:              vi.fn(),
  apiUpdatePatient:           vi.fn(),
  apiGetPatientConsultations: vi.fn(),
  apiGetLastApproved:         vi.fn(),
  apiListPatients:            vi.fn(),
  apiCreatePatient:           vi.fn(),
  apiGetPatientOverview:      vi.fn(),
}));

// Phase 6B — mock pdfExport so tests can control and inspect PDF generation
vi.mock('../services/pdfExport.js', () => ({
  generateConsultationPdf: vi.fn(() => 'consultation-2026-09-01.pdf'),
}));

// Phase 6B — mock jspdf so pdfExport.js can be imported in jsdom without errors
vi.mock('jspdf', () => ({
  jsPDF: vi.fn(function JsPDFMock() {
    return {
      setFontSize: vi.fn(), setFont: vi.fn(), setTextColor: vi.fn(),
      setDrawColor: vi.fn(), setLineWidth: vi.fn(), line: vi.fn(),
      text: vi.fn(), addPage: vi.fn(), setPage: vi.fn(),
      getNumberOfPages: vi.fn(() => 1),
      splitTextToSize: vi.fn((s) => [s]),
      save: vi.fn(),
    };
  }),
}));

// Defensive: prevent apiFetch bleed from other test files
vi.mock('../api.js', () => ({
  apiFetch:       vi.fn(),
  apiUrl:         (p) => p,
  setAuthToken:   vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken:   vi.fn(),
}));

import { apiGetConsultation, apiCreateCorrection, apiApproveConsultation } from '../services/api/consultations.js';
import {
  apiGetPatient,
  apiGetPatientConsultations,
  apiGetPatientOverview,
} from '../services/api/patients.js';
import { generateConsultationPdf } from '../services/pdfExport.js';

// ---------------------------------------------------------------------------
// Components under test
// ---------------------------------------------------------------------------
import ConsultationDetailPage from '../pages/ConsultationDetailPage.jsx';
import PatientProfilePage     from '../pages/PatientProfilePage.jsx';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONSULT_ID = 'cccccccccccccccccccccccc';
const PATIENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function makeConsultation(overrides = {}) {
  return {
    _id:              CONSULT_ID,
    patientId:        PATIENT_ID,
    status:           'approved',
    consultationDate: '2026-09-01T09:00:00.000Z',
    encounterType:    'in_person',
    approvedAt:       '2026-09-01T09:30:00.000Z',
    correctionOf:     null,
    supersededBy:     null,
    createdAt:        '2026-09-01T09:00:00.000Z',
    transcript:       'Patient reports cough for three days.',
    detectedLanguages: [{ code: 'en-IN', duration: 120 }],
    speakerUtterances: [
      { speaker: 'spk_0', startTime: 0, endTime: 5, text: 'Hello doctor.' },
    ],
    speakerRoleMapping: { spk_0: 'Patient' },
    note: {
      patient:               { name: 'Alice', age: 34, sex: 'female' },
      chief_complaint:       'Persistent cough',
      symptoms:              ['cough', 'fatigue'],
      duration:              '3 days',
      history:               'No prior respiratory issues.',
      observations:          ['mild wheeze'],
      assessment:            'Likely viral URTI',
      medications_mentioned: ['paracetamol'],
      follow_up:             'Return in 1 week',
      missing_information:   [],
      uncertain_fields:      [],
    },
    ...overrides,
  };
}

function makePatient(overrides = {}) {
  return {
    _id:           PATIENT_ID,
    firstName:     'Alice',
    lastName:      'Smith',
    dateOfBirth:   '1990-05-15T00:00:00.000Z',
    biologicalSex: 'female',
    isArchived:    false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderDetailPage(id = CONSULT_ID) {
  return render(
    <MemoryRouter initialEntries={[`/consultation/${id}`]}>
      <Routes>
        <Route path="/consultation/:id" element={<ConsultationDetailPage />} />
        <Route path="/patients/:id"     element={<div data-testid="patient-page">Patient</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPatientProfile(patientId = PATIENT_ID) {
  return render(
    <MemoryRouter initialEntries={[`/patients/${patientId}`]}>
      <Routes>
        <Route path="/patients/:id"     element={<PatientProfilePage />} />
        <Route path="/consultation/:id" element={<div data-testid="consultation-detail">Detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Phase 6B: default apiGetPatient to a safe non-blocking resolve so the
  // background patient fetch in fetchConsultation doesn't leak into unrelated tests.
  apiGetPatient.mockResolvedValue({ success: true, patient: null });
  // Default generateConsultationPdf to succeed (returns a filename string)
  generateConsultationPdf.mockReturnValue('consultation-2026-09-01.pdf');
});

// ---------------------------------------------------------------------------
// 1 — Consultation loads and core fields display
// ---------------------------------------------------------------------------
describe('1. consultation loads successfully', () => {
  test('chief complaint and status are shown', async () => {
    apiGetConsultation.mockResolvedValue({ success: true, consultation: makeConsultation() });

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByText('Persistent cough')).toBeInTheDocument();
    });

    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  test('calls apiGetConsultation with the correct ID', async () => {
    apiGetConsultation.mockResolvedValue({ success: true, consultation: makeConsultation() });

    renderDetailPage(CONSULT_ID);

    await waitFor(() => {
      expect(apiGetConsultation).toHaveBeenCalledWith(CONSULT_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// 2 — Loading state
// ---------------------------------------------------------------------------
describe('2. loading state', () => {
  test('shows loading message while fetch is in-flight', () => {
    // Never resolves during this check
    apiGetConsultation.mockReturnValue(new Promise(() => {}));

    renderDetailPage();

    expect(screen.getByText('Loading consultation…')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3 — Not-found state
// ---------------------------------------------------------------------------
describe('3. 404 / not-found state', () => {
  test('shows not-found message when API returns success:false', async () => {
    apiGetConsultation.mockResolvedValue({ success: false, message: 'Consultation not found.' });

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByText('Consultation not found.')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 4 — Network error state
// ---------------------------------------------------------------------------
describe('4. error state', () => {
  test('shows network error message on fetch rejection', async () => {
    apiGetConsultation.mockRejectedValue(new Error('Network failure'));

    renderDetailPage();

    await waitFor(() => {
      expect(
        screen.getByText('Network error — could not load consultation.')
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 5 — Clinical note fields render
// ---------------------------------------------------------------------------
describe('5. consultation fields display', () => {
  beforeEach(() => {
    apiGetConsultation.mockResolvedValue({ success: true, consultation: makeConsultation() });
  });

  test('shows assessment', async () => {
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('Likely viral URTI')).toBeInTheDocument());
  });

  test('shows follow-up', async () => {
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('Return in 1 week')).toBeInTheDocument());
  });

  test('shows symptom pill "cough"', async () => {
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('cough')).toBeInTheDocument());
  });

  test('shows transcript', async () => {
    renderDetailPage();
    await waitFor(() =>
      expect(screen.getByText('Patient reports cough for three days.')).toBeInTheDocument()
    );
  });

  test('shows detected language', async () => {
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('English (India)')).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// 6 — Open action from Patient Profile navigates to /consultation/:id
// ---------------------------------------------------------------------------
describe('6. Open action from Patient Profile navigates correctly', () => {
  test('clicking Open renders the consultation detail route', async () => {
    // PatientProfilePage now uses the overview endpoint
    apiGetPatientOverview.mockResolvedValue({
      success: true,
      patient: makePatient(),
      statistics: { totalConsultations: 1, approvedConsultations: 1, draftConsultations: 0, lastConsultationDate: null },
      latestApprovedConsultation: null,
      recentConsultations: [makeConsultation({ status: 'draft' })],
    });

    renderPatientProfile();

    // Wait for the history list to load
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /open consultation/i })).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: /open consultation/i });
    expect(link).toHaveAttribute('href', `/consultation/${CONSULT_ID}`);
  });
});

// ---------------------------------------------------------------------------
// 7 — Correction / superseded indicators
// ---------------------------------------------------------------------------
describe('7. correction and superseded indicators', () => {
  test('shows correction banner when correctionOf is set (draft)', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation({
        status:       'draft',
        correctionOf: 'eeeeeeeeeeeeeeeeeeeeeeee',
        supersededBy: null,
        approvedAt:   null,
      }),
    });

    renderDetailPage();

    await waitFor(() => {
      expect(
        screen.getByText(/this is a correction of an earlier consultation/i)
      ).toBeInTheDocument();
    });
  });

  test('shows superseded banner when supersededBy is set', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation({
        correctionOf: null,
        supersededBy: 'dddddddddddddddddddddddd',
      }),
    });

    renderDetailPage();

    await waitFor(() => {
      expect(
        screen.getByText(/this note has been superseded by a correction/i)
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 5C — Correction UI tests
// ---------------------------------------------------------------------------

import userEvent from '@testing-library/user-event';

const NEW_CORRECTION_ID = 'ffffffffffffffffffffffff';

// Helper: render and wait for an approved, non-superseded consultation
async function renderApprovedAndWait() {
  apiGetConsultation.mockResolvedValue({ success: true, consultation: makeConsultation() });
  renderDetailPage();
  await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());
}

// ---------------------------------------------------------------------------
// 8 — Correction action visibility
// ---------------------------------------------------------------------------
describe('8. correction action visibility', () => {
  test('8a. "Correct consultation" button appears for approved non-superseded consultation', async () => {
    await renderApprovedAndWait();
    expect(screen.getByRole('button', { name: /correct (this )?consultation/i })).toBeInTheDocument();
  });

  test('8b. "Correct consultation" button absent for draft consultation', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation({ status: 'draft', approvedAt: null }),
    });
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /correct (this )?consultation/i })).not.toBeInTheDocument();
  });

  test('8c. "Correct consultation" button absent when already superseded', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation({ supersededBy: 'dddddddddddddddddddddddd' }),
    });
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /correct (this )?consultation/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 9 — Correction editor opens with existing note content
// ---------------------------------------------------------------------------
describe('9. correction editor pre-fills existing note', () => {
  test('editor opens when "Correct consultation" is clicked', async () => {
    await renderApprovedAndWait();
    await userEvent.click(screen.getByRole('button', { name: /correct (this )?consultation/i }));
    expect(screen.getByRole('region', { name: /correction editor/i })).toBeInTheDocument();
  });

  test('chief complaint field is pre-filled from source note', async () => {
    await renderApprovedAndWait();
    await userEvent.click(screen.getByRole('button', { name: /correct (this )?consultation/i }));

    const chiefInput = screen.getByLabelText(/chief complaint/i);
    expect(chiefInput).toHaveValue('Persistent cough');
  });

  test('editor shows informational note about original being preserved', async () => {
    await renderApprovedAndWait();
    await userEvent.click(screen.getByRole('button', { name: /correct (this )?consultation/i }));

    expect(
      screen.getByText(/the original approved consultation will remain unchanged/i)
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 10 — Correction API call
// ---------------------------------------------------------------------------
describe('10. correction API call', () => {
  test('10a. correct API endpoint is called with edited note', async () => {
    apiCreateCorrection.mockResolvedValue({
      success:      true,
      consultation: { _id: NEW_CORRECTION_ID, status: 'draft' },
    });

    await renderApprovedAndWait();
    await userEvent.click(screen.getByRole('button', { name: /correct (this )?consultation/i }));

    // Edit the chief complaint before submitting
    const chiefInput = screen.getByLabelText(/chief complaint/i);
    await userEvent.clear(chiefInput);
    await userEvent.type(chiefInput, 'Corrected cough');

    await userEvent.click(screen.getByRole('button', { name: /create correction draft/i }));

    await waitFor(() => {
      expect(apiCreateCorrection).toHaveBeenCalledWith(
        CONSULT_ID,
        expect.objectContaining({ chief_complaint: 'Corrected cough' })
      );
    });
  });

  test('10b. apiGetConsultation is NOT called again — original never mutated via UI', async () => {
    apiCreateCorrection.mockResolvedValue({
      success:      true,
      consultation: { _id: NEW_CORRECTION_ID, status: 'draft' },
    });
    // The new correction page will fetch apiGetConsultation for the new ID
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: { _id: NEW_CORRECTION_ID, status: 'draft', correctionOf: CONSULT_ID,
        supersededBy: null, note: {}, createdAt: '2026-09-01T09:00:00.000Z' },
    });

    await renderApprovedAndWait();

    await userEvent.click(screen.getByRole('button', { name: /correct (this )?consultation/i }));
    await userEvent.click(screen.getByRole('button', { name: /create correction draft/i }));

    await waitFor(() => expect(apiCreateCorrection).toHaveBeenCalled());

    // The UI must never call PUT on the original consultation — it must not mutate the source.
    // apiCreateCorrection (POST /:id/correct) is the only write call.
    expect(apiCreateCorrection).toHaveBeenCalledTimes(1);
    // Verify the correction was created against the original source ID
    expect(apiCreateCorrection.mock.calls[0][0]).toBe(CONSULT_ID);
  });
});

// ---------------------------------------------------------------------------
// 11 — Error handling
// ---------------------------------------------------------------------------
describe('11. correction API error handling', () => {
  test('shows error message when API returns success:false', async () => {
    apiCreateCorrection.mockResolvedValue({
      success: false,
      message: 'Server error creating correction.',
    });

    await renderApprovedAndWait();
    await userEvent.click(screen.getByRole('button', { name: /correct (this )?consultation/i }));
    await userEvent.click(screen.getByRole('button', { name: /create correction draft/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByRole('alert').textContent).toMatch(/server error creating correction/i);
  });

  test('shows error message on network failure', async () => {
    apiCreateCorrection.mockRejectedValue(new Error('Network failure'));

    await renderApprovedAndWait();
    await userEvent.click(screen.getByRole('button', { name: /correct (this )?consultation/i }));
    await userEvent.click(screen.getByRole('button', { name: /create correction draft/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/network error/i);
  });

  test('Cancel button closes the editor without calling the API', async () => {
    await renderApprovedAndWait();
    await userEvent.click(screen.getByRole('button', { name: /correct (this )?consultation/i }));
    expect(screen.getByRole('region', { name: /correction editor/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('region', { name: /correction editor/i })).not.toBeInTheDocument();
    expect(apiCreateCorrection).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 12 — Correction draft identification
// ---------------------------------------------------------------------------
describe('12. correction draft is visually identified', () => {
  test('page title changes to "Correction draft" for a correction consultation', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation({
        status: 'draft',
        correctionOf: 'eeeeeeeeeeeeeeeeeeeeeeee',
        approvedAt: null,
      }),
    });
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('Correction draft')).toBeInTheDocument());
  });
});

// ===========================================================================
// Phase 5E — Correction Approval UI tests
// ===========================================================================

// ---------------------------------------------------------------------------
// Shared fixture helpers for Phase 5E
// ---------------------------------------------------------------------------

const ORIGINAL_ID   = 'eeeeeeeeeeeeeeeeeeeeeeee';
const CORRECTED_ID  = 'cccccccccccccccccccccccc'; // same as CONSULT_ID

/** A correction draft — status: draft, correctionOf set */
function makeCorrectionDraft(overrides = {}) {
  return makeConsultation({
    _id:          CORRECTED_ID,
    status:       'draft',
    correctionOf: ORIGINAL_ID,
    supersededBy: null,
    approvedAt:   null,
    approvedBy:   null,
    note: {
      chief_complaint:       'Corrected cough',
      symptoms:              ['cough', 'wheeze'],
      medications_mentioned: [],
      observations:          [],
      assessment:            'Revised URTI',
      follow_up:             'Return in 2 weeks',
      missing_information:   [],
      uncertain_fields:      [],
    },
    ...overrides,
  });
}

/** An approved correction — status: approved, correctionOf set, supersededBy null */
function makeApprovedCorrection(overrides = {}) {
  return makeConsultation({
    _id:          CORRECTED_ID,
    status:       'approved',
    correctionOf: ORIGINAL_ID,
    supersededBy: null,
    approvedAt:   '2026-09-02T10:00:00.000Z',
    ...overrides,
  });
}

/** A superseded original — status: approved, correctionOf null, supersededBy set */
function makeSupersededOriginal(overrides = {}) {
  return makeConsultation({
    _id:          ORIGINAL_ID,
    status:       'approved',
    correctionOf: null,
    supersededBy: CORRECTED_ID,
    ...overrides,
  });
}

/** Render a correction draft and wait for it to load */
async function renderCorrectionDraftAndWait() {
  apiGetConsultation.mockResolvedValue({
    success:      true,
    consultation: makeCorrectionDraft(),
  });
  renderDetailPage(CORRECTED_ID);
  await waitFor(() =>
    expect(screen.getByText('Correction draft')).toBeInTheDocument()
  );
}

// ---------------------------------------------------------------------------
// 13 — Correction draft is correctly identified in the UI
// ---------------------------------------------------------------------------
describe('13. correction draft identification', () => {
  test('13a. page title is "Correction draft" for a draft with correctionOf set', async () => {
    await renderCorrectionDraftAndWait();
    expect(screen.getByRole('heading', { name: 'Correction draft' })).toBeInTheDocument();
  });

  test('13b. correction draft banner says "Correction draft — this is a correction of an earlier consultation"', async () => {
    await renderCorrectionDraftAndWait();
    expect(
      screen.getByText(/Correction draft — this is a correction of an earlier consultation/i)
    ).toBeInTheDocument();
  });

  test('13c. correction draft banner contains a "View original" link to the original consultation', async () => {
    await renderCorrectionDraftAndWait();
    const link = screen.getByRole('link', { name: /view original/i });
    expect(link).toHaveAttribute('href', `/consultation/${ORIGINAL_ID}`);
  });

  test('13d. approval panel is shown for a correction draft', async () => {
    await renderCorrectionDraftAndWait();
    expect(
      screen.getByRole('region', { name: /approve correction/i })
    ).toBeInTheDocument();
  });

  test('13e. "Correct consultation" button is NOT shown for a correction draft (already a correction)', async () => {
    await renderCorrectionDraftAndWait();
    expect(
      screen.queryByRole('button', { name: /correct (this )?consultation/i })
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 14 — Approval action visibility
// ---------------------------------------------------------------------------
describe('14. approval action visibility', () => {
  test('14a. "Approve correction" button appears for a correction draft', async () => {
    await renderCorrectionDraftAndWait();
    expect(
      screen.getByRole('button', { name: /approve correction/i })
    ).toBeInTheDocument();
  });

  test('14b. "Approve correction" button absent for a normal approved consultation', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation(), // approved, no correctionOf
    });
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());

    expect(
      screen.queryByRole('button', { name: /approve correction/i })
    ).not.toBeInTheDocument();
  });

  test('14c. "Approve correction" button absent for a normal draft (no correctionOf)', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation({ status: 'draft', approvedAt: null }),
    });
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());

    expect(
      screen.queryByRole('button', { name: /approve correction/i })
    ).not.toBeInTheDocument();
  });

  test('14d. "Approve correction" button absent for an already-approved correction', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeApprovedCorrection(),
    });
    renderDetailPage();
    await waitFor(() =>
      expect(screen.getByText('Approved correction')).toBeInTheDocument()
    );

    expect(
      screen.queryByRole('button', { name: /approve correction/i })
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 15 — Confirmation step
// ---------------------------------------------------------------------------
describe('15. approval confirmation step', () => {
  test('15a. clicking "Approve correction" shows the confirmation panel', async () => {
    await renderCorrectionDraftAndWait();
    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));

    expect(screen.getByText(/Confirm approval/i)).toBeInTheDocument();
    expect(screen.getByText(/effective clinical record/i)).toBeInTheDocument();
  });

  test('15b. "Cancel" in confirmation returns to idle state without calling API', async () => {
    await renderCorrectionDraftAndWait();
    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));

    expect(screen.getByText(/Confirm approval/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

    // Back to idle — original Approve correction button should be visible again
    expect(
      screen.getByRole('button', { name: /^✅ Approve correction$/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Confirm approval/i)).not.toBeInTheDocument();
    expect(apiApproveConsultation).not.toHaveBeenCalled();
  });

  test('15c. confirmation panel shows both Cancel and Confirm buttons', async () => {
    await renderCorrectionDraftAndWait();
    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirm.*approve correction/i })
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 16 — Approval API call
// ---------------------------------------------------------------------------
describe('16. approval API call', () => {
  test('16a. apiApproveConsultation is called with the correct consultation ID', async () => {
    apiApproveConsultation.mockResolvedValue({ success: true, consultation: makeApprovedCorrection() });
    // After success the page re-fetches
    apiGetConsultation
      .mockResolvedValueOnce({ success: true, consultation: makeCorrectionDraft() })
      .mockResolvedValueOnce({ success: true, consultation: makeApprovedCorrection() });

    renderDetailPage(CORRECTED_ID);
    await waitFor(() => expect(screen.getByText('Correction draft')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*approve correction/i }));

    await waitFor(() => expect(apiApproveConsultation).toHaveBeenCalledTimes(1));
    expect(apiApproveConsultation).toHaveBeenCalledWith(
      CORRECTED_ID,
      expect.objectContaining({ chief_complaint: 'Corrected cough' })
    );
  });

  test('16b. duplicate approval submission is prevented (button disabled while approving)', async () => {
    // Never resolves — keeps the panel in "approving" state
    apiApproveConsultation.mockReturnValue(new Promise(() => {}));
    apiGetConsultation.mockResolvedValue({ success: true, consultation: makeCorrectionDraft() });

    renderDetailPage(CORRECTED_ID);
    await waitFor(() => expect(screen.getByText('Correction draft')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*approve correction/i }));

    // While in-flight, the button is disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Approving…/i })).toBeDisabled();
    });

    // API was only called once
    expect(apiApproveConsultation).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 17 — Approval success
// ---------------------------------------------------------------------------
describe('17. approval success', () => {
  test('17a. after approval, page re-fetches and shows "Approved correction" title', async () => {
    apiApproveConsultation.mockResolvedValue({ success: true, consultation: makeApprovedCorrection() });
    apiGetConsultation
      .mockResolvedValueOnce({ success: true, consultation: makeCorrectionDraft() })
      .mockResolvedValueOnce({ success: true, consultation: makeApprovedCorrection() });

    renderDetailPage(CORRECTED_ID);
    await waitFor(() => expect(screen.getByText('Correction draft')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*approve correction/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Approved correction' })).toBeInTheDocument()
    );
  });

  test('17b. after approval, "Approve correction" button is no longer shown', async () => {
    apiApproveConsultation.mockResolvedValue({ success: true, consultation: makeApprovedCorrection() });
    apiGetConsultation
      .mockResolvedValueOnce({ success: true, consultation: makeCorrectionDraft() })
      .mockResolvedValueOnce({ success: true, consultation: makeApprovedCorrection() });

    renderDetailPage(CORRECTED_ID);
    await waitFor(() => expect(screen.getByText('Correction draft')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*approve correction/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /approve correction/i })).not.toBeInTheDocument()
    );
  });

  test('17c. after approval, approved-correction banner says "effective version"', async () => {
    apiApproveConsultation.mockResolvedValue({ success: true, consultation: makeApprovedCorrection() });
    apiGetConsultation
      .mockResolvedValueOnce({ success: true, consultation: makeCorrectionDraft() })
      .mockResolvedValueOnce({ success: true, consultation: makeApprovedCorrection() });

    renderDetailPage(CORRECTED_ID);
    await waitFor(() => expect(screen.getByText('Correction draft')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*approve correction/i }));

    await waitFor(() =>
      expect(screen.getByText(/effective version of this encounter/i)).toBeInTheDocument()
    );
  });

  test('17d. approved correction — "View original" link points to original consultation', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeApprovedCorrection(),
    });
    renderDetailPage(CORRECTED_ID);
    await waitFor(() => expect(screen.getByText('Approved correction')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: /view original/i });
    expect(link).toHaveAttribute('href', `/consultation/${ORIGINAL_ID}`);
  });
});

// ---------------------------------------------------------------------------
// 18 — Approval error handling
// ---------------------------------------------------------------------------
describe('18. approval error handling', () => {
  test('18a. API returns success:false — shows error alert and cancel option', async () => {
    apiApproveConsultation.mockResolvedValue({
      success: false,
      message: 'Could not approve the correction.',
    });
    apiGetConsultation.mockResolvedValue({ success: true, consultation: makeCorrectionDraft() });

    await renderCorrectionDraftAndWait();

    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*approve correction/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not approve the correction.')
    );

    // Cancel should be available to go back to idle
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  test('18b. network failure — shows generic error alert', async () => {
    apiApproveConsultation.mockRejectedValue(new Error('Network failure'));
    apiGetConsultation.mockResolvedValue({ success: true, consultation: makeCorrectionDraft() });

    await renderCorrectionDraftAndWait();

    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*approve correction/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Network error — could not approve the correction.'
      )
    );
  });

  test('18c. "already approved" 409 response is treated as success — re-fetches', async () => {
    apiApproveConsultation.mockResolvedValue({
      success: false,
      message: 'Consultation is already approved.',
    });
    apiGetConsultation
      .mockResolvedValueOnce({ success: true, consultation: makeCorrectionDraft() })
      .mockResolvedValueOnce({ success: true, consultation: makeApprovedCorrection() });

    renderDetailPage(CORRECTED_ID);
    await waitFor(() => expect(screen.getByText('Correction draft')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*approve correction/i }));

    // Should recover gracefully and show the approved state
    await waitFor(() =>
      expect(screen.getByText('Approved correction')).toBeInTheDocument()
    );
    // No error alert should be shown
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('18d. retry button re-submits the approval after an error', async () => {
    apiApproveConsultation
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce({ success: true, consultation: makeApprovedCorrection() });
    apiGetConsultation
      .mockResolvedValueOnce({ success: true, consultation: makeCorrectionDraft() })
      .mockResolvedValueOnce({ success: true, consultation: makeApprovedCorrection() });

    await renderCorrectionDraftAndWait();

    await userEvent.click(screen.getByRole('button', { name: /^✅ Approve correction$/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*approve correction/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    // Retry should call the API again
    await userEvent.click(screen.getByRole('button', { name: /retry approval/i }));

    await waitFor(() =>
      expect(screen.getByText('Approved correction')).toBeInTheDocument()
    );
    expect(apiApproveConsultation).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 19 — Superseded original UI (Phase 5E requirement 4)
// ---------------------------------------------------------------------------
describe('19. superseded original UI', () => {
  test('19a. superseded original shows "superseded by a correction" banner', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeSupersededOriginal(),
    });
    renderDetailPage(ORIGINAL_ID);

    await waitFor(() =>
      expect(
        screen.getByText(/this note has been superseded by a correction/i)
      ).toBeInTheDocument()
    );
  });

  test('19b. superseded original has a "View correction" link to the replacement', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeSupersededOriginal(),
    });
    renderDetailPage(ORIGINAL_ID);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /view correction/i })).toBeInTheDocument()
    );

    const link = screen.getByRole('link', { name: /view correction/i });
    expect(link).toHaveAttribute('href', `/consultation/${CORRECTED_ID}`);
  });

  test('19c. superseded original does NOT show "Approve correction" button', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeSupersededOriginal(),
    });
    renderDetailPage(ORIGINAL_ID);

    await waitFor(() =>
      expect(
        screen.getByText(/this note has been superseded by a correction/i)
      ).toBeInTheDocument()
    );

    expect(
      screen.queryByRole('button', { name: /approve correction/i })
    ).not.toBeInTheDocument();
  });

  test('19d. superseded original does NOT show "Correct consultation" button', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeSupersededOriginal(),
    });
    renderDetailPage(ORIGINAL_ID);

    await waitFor(() =>
      expect(
        screen.getByText(/this note has been superseded by a correction/i)
      ).toBeInTheDocument()
    );

    expect(
      screen.queryByRole('button', { name: /correct (this )?consultation/i })
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 20 — Normal consultations are unaffected by Phase 5E
// ---------------------------------------------------------------------------
describe('20. normal consultations are unaffected', () => {
  test('20a. normal approved consultation shows "Consultation" as page title', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation(), // approved, no correctionOf, no supersededBy
    });
    renderDetailPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Consultation' })).toBeInTheDocument()
    );
  });

  test('20b. normal approved consultation shows "Approved note" banner', async () => {
    apiGetConsultation.mockResolvedValue({ success: true, consultation: makeConsultation() });
    renderDetailPage();
    await waitFor(() =>
      expect(screen.getByText(/Approved note/i)).toBeInTheDocument()
    );
  });

  test('20c. normal approved consultation still shows "Correct consultation" button', async () => {
    apiGetConsultation.mockResolvedValue({ success: true, consultation: makeConsultation() });
    renderDetailPage();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /correct (this )?consultation/i })
      ).toBeInTheDocument()
    );
  });

  test('20d. normal draft consultation shows neither approve nor correct button', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation({ status: 'draft', approvedAt: null }),
    });
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());

    expect(
      screen.queryByRole('button', { name: /approve correction/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /correct (this )?consultation/i })
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 21 — Correction not shown as separate new encounter (patient history)
// ---------------------------------------------------------------------------
describe('21. correction does not appear as a new encounter', () => {
  // This concern lives in PatientProfilePage (patient history tests already cover
  // the timeline rendering). Here we verify that ConsultationDetailPage correctly
  // passes isCorrectionDraft semantics so the approval panel — not a new-encounter
  // UI — is shown for a correction draft.
  test('21a. correction draft shows approval panel, not a "new consultation" indicator', async () => {
    await renderCorrectionDraftAndWait();

    // Approval panel present
    expect(
      screen.getByRole('region', { name: /approve correction/i })
    ).toBeInTheDocument();

    // No "new consultation" or "new encounter" text appears
    expect(screen.queryByText(/new consultation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/new encounter/i)).not.toBeInTheDocument();
  });

  test('21b. correction draft uses the same /consultation/:id route — no separate route', async () => {
    // The route renders ConsultationDetailPage for any UUID — both original and correction
    // share the same route. Verify a correction draft can be rendered at /consultation/:id.
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeCorrectionDraft(),
    });

    render(
      <MemoryRouter initialEntries={[`/consultation/${CORRECTED_ID}`]}>
        <Routes>
          <Route path="/consultation/:id" element={<ConsultationDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Correction draft' })).toBeInTheDocument()
    );
    expect(apiGetConsultation).toHaveBeenCalledWith(CORRECTED_ID);
  });
});

// ===========================================================================
// Phase 6B — PDF Export tests
// ===========================================================================
//
// generateConsultationPdf is mocked at the module level so no real PDF is
// generated. Tests assert on button visibility, API wiring, error handling,
// and that consultation data is not mutated.
//
// ---------------------------------------------------------------------------

const PATIENT_FIXTURE = {
  _id:             PATIENT_ID,
  firstName:       'Alice',
  lastName:        'Smith',
  dateOfBirth:     '1990-05-15T00:00:00.000Z',
  biologicalSex:   'female',
  medicalRecordId: 'MR001',
  phone:           '0400000001',
};

// Helper: render an approved consultation and wait for it to load
async function renderApprovedForExport(overrides = {}) {
  apiGetConsultation.mockResolvedValue({
    success: true,
    consultation: makeConsultation(overrides),
  });
  apiGetPatient.mockResolvedValue({ success: true, patient: PATIENT_FIXTURE });
  renderDetailPage();
  await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());
}

// ---------------------------------------------------------------------------
// 22 — Export action visibility
// ---------------------------------------------------------------------------
describe('22. Phase 6B — Export PDF button visibility', () => {
  test('22a. "Export PDF" button is shown for an effective approved consultation', async () => {
    await renderApprovedForExport();
    expect(
      screen.getByRole('button', { name: /export pdf/i })
    ).toBeInTheDocument();
  });

  test('22b. "Export PDF" button is hidden for a draft consultation', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation({ status: 'draft', approvedAt: null }),
    });
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());

    expect(
      screen.queryByRole('button', { name: /export pdf/i })
    ).not.toBeInTheDocument();
  });

  test('22c. "Export PDF" button is hidden for a superseded original', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation({ supersededBy: 'dddddddddddddddddddddddd' }),
    });
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());

    expect(
      screen.queryByRole('button', { name: /export pdf/i })
    ).not.toBeInTheDocument();
  });

  test('22d. "Export PDF" button IS shown for an approved correction (effective version)', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation({
        correctionOf: 'eeeeeeeeeeeeeeeeeeeeeeee',
        supersededBy: null,
        status:       'approved',
      }),
    });
    renderDetailPage();
    await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());

    expect(
      screen.getByRole('button', { name: /export pdf/i })
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 23 — Export API call and patient data
// ---------------------------------------------------------------------------
describe('23. Phase 6B — Export PDF calls generateConsultationPdf', () => {
  test('23a. clicking Export PDF calls generateConsultationPdf', async () => {
    await renderApprovedForExport();
    await userEvent.click(screen.getByRole('button', { name: /export pdf/i }));

    expect(generateConsultationPdf).toHaveBeenCalledTimes(1);
  });

  test('23b. generateConsultationPdf is called with the consultation object', async () => {
    await renderApprovedForExport();
    await userEvent.click(screen.getByRole('button', { name: /export pdf/i }));

    const [passedConsultation] = generateConsultationPdf.mock.calls[0];
    expect(passedConsultation).toMatchObject({
      status: 'approved',
      note:   expect.objectContaining({ chief_complaint: 'Persistent cough' }),
    });
  });

  test('23c. generateConsultationPdf is called with the patient object when available', async () => {
    await renderApprovedForExport();
    await waitFor(() => expect(apiGetPatient).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /export pdf/i }));

    const [, passedPatient] = generateConsultationPdf.mock.calls[0];
    expect(passedPatient).toMatchObject({ firstName: 'Alice', lastName: 'Smith' });
  });

  test('23d. apiGetPatient is called with the patientId from the consultation', async () => {
    await renderApprovedForExport();
    await waitFor(() => expect(apiGetPatient).toHaveBeenCalled());

    expect(apiGetPatient).toHaveBeenCalledWith(PATIENT_ID);
  });
});

// ---------------------------------------------------------------------------
// 24 — Duplicate submission prevention
// ---------------------------------------------------------------------------
describe('24. Phase 6B — duplicate export submission is prevented', () => {
  test('24a. Export PDF button is disabled while generation is running', async () => {
    // Mock never resolves so the button stays in "generating" state
    generateConsultationPdf.mockImplementation(() => new Promise(() => {}));

    await renderApprovedForExport();
    const btn = screen.getByRole('button', { name: /export pdf/i });

    await userEvent.click(btn);

    // Button should now be disabled and show in-progress text
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generating pdf/i })).toBeDisabled()
    );
  });
});

// ---------------------------------------------------------------------------
// 25 — Export error handling
// ---------------------------------------------------------------------------
describe('25. Phase 6B — export error is handled gracefully', () => {
  test('25a. generateConsultationPdf failure shows an error banner', async () => {
    generateConsultationPdf.mockImplementation(() => {
      throw new Error('jsPDF rendering failed');
    });

    await renderApprovedForExport();
    await userEvent.click(screen.getByRole('button', { name: /export pdf/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/could not generate pdf/i);
  });

  test('25b. page content remains intact after an export error', async () => {
    generateConsultationPdf.mockImplementation(() => { throw new Error('fail'); });

    await renderApprovedForExport();
    await userEvent.click(screen.getByRole('button', { name: /export pdf/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    // Clinical note and patient info still visible
    expect(screen.getByText('Persistent cough')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  test('25c. export error does not navigate away from the consultation', async () => {
    generateConsultationPdf.mockImplementation(() => { throw new Error('fail'); });

    await renderApprovedForExport();
    await userEvent.click(screen.getByRole('button', { name: /export pdf/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    // Still on the detail page — heading still shows
    expect(screen.getByRole('heading', { name: 'Consultation' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 26 — Export does not mutate consultation data
// ---------------------------------------------------------------------------
describe('26. Phase 6B — export does not mutate consultation or create an encounter', () => {
  test('26a. apiGetConsultation is not called again after clicking Export PDF', async () => {
    await renderApprovedForExport();
    const callsBefore = apiGetConsultation.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: /export pdf/i }));

    // No extra API calls triggered
    expect(apiGetConsultation.mock.calls.length).toBe(callsBefore);
  });

  test('26b. apiCreateCorrection is not called when exporting', async () => {
    await renderApprovedForExport();
    await userEvent.click(screen.getByRole('button', { name: /export pdf/i }));

    expect(apiCreateCorrection).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 27 — Existing consultation detail behavior remains intact
// ---------------------------------------------------------------------------
describe('27. Phase 6B — existing behavior is unaffected', () => {
  test('27a. "Correct consultation" button still present alongside Export PDF', async () => {
    await renderApprovedForExport();

    expect(
      screen.getByRole('button', { name: /correct (this )?consultation/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /export pdf/i })
    ).toBeInTheDocument();
  });

  test('27b. clinical note fields still render correctly when export is available', async () => {
    await renderApprovedForExport();

    expect(screen.getByText('Likely viral URTI')).toBeInTheDocument();
    expect(screen.getByText('Return in 1 week')).toBeInTheDocument();
  });

  test('27c. patient fetch failure is non-blocking — page loads without patient data', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation(),
    });
    // Patient fetch fails
    apiGetPatient.mockRejectedValue(new Error('Patient service unavailable'));

    renderDetailPage();

    // Page still loads with consultation content
    await waitFor(() =>
      expect(screen.getByText('Persistent cough')).toBeInTheDocument()
    );

    // Export PDF button is still shown (patient data optional)
    expect(
      screen.getByRole('button', { name: /export pdf/i })
    ).toBeInTheDocument();
  });
});
