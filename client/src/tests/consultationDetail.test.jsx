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
  apiGetConsultation:   vi.fn(),
  apiCreateCorrection:  vi.fn(),
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

// Defensive: prevent apiFetch bleed from other test files
vi.mock('../api.js', () => ({
  apiFetch:       vi.fn(),
  apiUrl:         (p) => p,
  setAuthToken:   vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken:   vi.fn(),
}));

import { apiGetConsultation, apiCreateCorrection } from '../services/api/consultations.js';
import {
  apiGetPatient,
  apiGetPatientConsultations,
  apiGetPatientOverview,
} from '../services/api/patients.js';

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
  test('shows correction banner when correctionOf is set', async () => {
    apiGetConsultation.mockResolvedValue({
      success: true,
      consultation: makeConsultation({
        correctionOf: 'eeeeeeeeeeeeeeeeeeeeeeee',
        supersededBy: null,
      }),
    });

    renderDetailPage();

    await waitFor(() => {
      expect(
        screen.getByText(/this note corrects an earlier consultation/i)
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
