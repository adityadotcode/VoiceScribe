/**
 * Phase 3B.1 — Patient consultation history tests
 *
 * Tests for the ConsultationHistorySection rendered inside PatientProfilePage.
 *
 * Strategy:
 *   - Mock the patients API service module (vi.mock) so no real fetch occurs.
 *   - Mock react-router-dom useParams / useNavigate so the component can
 *     render without a real Router context.
 *   - Render PatientProfilePage directly and wait for async state updates.
 *
 * Covered scenarios (5):
 *   1. History loads and displays consultations (normal state)
 *   2. Loading state shown while fetch is in-flight
 *   3. Empty state when no consultations exist
 *   4. Error state when the API call fails
 *   5. Correction/superseded indicators are rendered
 */

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the patients API service
// ---------------------------------------------------------------------------
vi.mock('../services/api/patients.js', () => ({
  apiGetPatient:               vi.fn(),
  apiUpdatePatient:            vi.fn(),
  apiGetPatientConsultations:  vi.fn(),
}));

import {
  apiGetPatient,
  apiGetPatientConsultations,
} from '../services/api/patients.js';

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------
import PatientProfilePage from '../pages/PatientProfilePage.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PATIENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

/** Render PatientProfilePage at /patients/:id via MemoryRouter. */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/patients/${PATIENT_ID}`]}>
      <Routes>
        <Route path="/patients/:id" element={<PatientProfilePage />} />
      </Routes>
    </MemoryRouter>
  );
}

/** Minimal patient fixture. */
function makePatient(overrides = {}) {
  return {
    _id:           PATIENT_ID,
    firstName:     'Alice',
    lastName:      'Smith',
    dateOfBirth:   '1990-05-15T00:00:00.000Z',
    biologicalSex: 'female',
    phone:         '',
    medicalRecordId: '',
    notes:         '',
    isArchived:    false,
    ...overrides,
  };
}

/** Minimal consultation fixture. */
function makeConsultation(overrides = {}) {
  return {
    _id:              'cccccccccccccccccccccccc',
    status:           'approved',
    consultationDate: '2026-09-01T09:00:00.000Z',
    encounterType:    'in_person',
    note:             { chief_complaint: 'Persistent cough' },
    correctionOf:     null,
    supersededBy:     null,
    createdAt:        '2026-09-01T09:05:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: patient loads fine
  apiGetPatient.mockResolvedValue({ success: true, patient: makePatient() });
});

// ---------------------------------------------------------------------------
// 1 — Normal state: history loads and displays
// ---------------------------------------------------------------------------
describe('1. history loads and displays consultations', () => {
  test('renders the chief complaint and status badge', async () => {
    apiGetPatientConsultations.mockResolvedValue({
      success: true,
      consultations: [makeConsultation()],
    });

    renderPage();

    // Wait for the consultation to appear
    await waitFor(() => {
      expect(screen.getByText('Persistent cough')).toBeInTheDocument();
    });

    // Status badge is rendered
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  test('calls the API with the correct patient ID', async () => {
    apiGetPatientConsultations.mockResolvedValue({
      success: true,
      consultations: [makeConsultation()],
    });

    renderPage();

    await waitFor(() => {
      expect(apiGetPatientConsultations).toHaveBeenCalledWith(PATIENT_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// 2 — Loading state
// ---------------------------------------------------------------------------
describe('2. loading state', () => {
  test('shows loading message while fetch is in-flight', async () => {
    // Patient resolves immediately; history never resolves during this check
    apiGetPatientConsultations.mockReturnValue(new Promise(() => {}));

    renderPage();

    // Wait for the patient to load first so the history section is mounted
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    expect(screen.getByText('Loading history…')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3 — Empty state
// ---------------------------------------------------------------------------
describe('3. empty state', () => {
  test('shows empty message when no consultations exist', async () => {
    apiGetPatientConsultations.mockResolvedValue({
      success: true,
      consultations: [],
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText('No consultations recorded for this patient yet.')
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 4 — Error state
// ---------------------------------------------------------------------------
describe('4. error state', () => {
  test('shows error message when API returns success:false', async () => {
    apiGetPatientConsultations.mockResolvedValue({
      success: false,
      message: 'Server error loading history.',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Server error loading history.')).toBeInTheDocument();
    });
  });

  test('shows network error message on fetch rejection', async () => {
    apiGetPatientConsultations.mockRejectedValue(new Error('Network failure'));

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText('Network error — could not load consultation history.')
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 5 — Correction and superseded indicators
// ---------------------------------------------------------------------------
describe('5. correction/superseded indicators', () => {
  test('renders "correction" badge when correctionOf is set', async () => {
    apiGetPatientConsultations.mockResolvedValue({
      success: true,
      consultations: [
        makeConsultation({
          _id:          'dddddddddddddddddddddddd',
          correctionOf: 'eeeeeeeeeeeeeeeeeeeeeeee',
          supersededBy: null,
        }),
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('correction')).toBeInTheDocument();
    });
  });

  test('renders "superseded" badge when supersededBy is set', async () => {
    apiGetPatientConsultations.mockResolvedValue({
      success: true,
      consultations: [
        makeConsultation({
          _id:          'eeeeeeeeeeeeeeeeeeeeeeee',
          correctionOf: null,
          supersededBy: 'dddddddddddddddddddddddd',
        }),
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('superseded')).toBeInTheDocument();
    });
  });

  test('Open button is disabled (deferred to Phase 3B.2)', async () => {
    apiGetPatientConsultations.mockResolvedValue({
      success: true,
      consultations: [makeConsultation()],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Persistent cough')).toBeInTheDocument();
    });

    const openBtn = screen.getByRole('button', { name: /open consultation/i });
    expect(openBtn).toBeDisabled();
  });
});
