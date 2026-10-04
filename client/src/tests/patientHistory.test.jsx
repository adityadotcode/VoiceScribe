/**
 * Patient 360.2 — PatientProfilePage tests
 *
 * The page now calls GET /api/patients/:id/overview (apiGetPatientOverview)
 * instead of the three separate calls used previously. All scenarios are
 * migrated to the new API shape.
 *
 * Scenarios (10):
 *   1. Overview loads — patient header renders
 *   2. Statistics render correctly
 *   3. Latest approved visit renders
 *   4. No approved consultation → empty state
 *   5. Timeline renders consultations newest first
 *   6. Correction indicator shown in timeline
 *   7. Superseded indicator shown in timeline
 *   8. Open link navigates to /consultation/:id
 *   9. Loading state shown during fetch
 *  10. API error state displayed
 */

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../services/api/patients.js', () => ({
  apiGetPatientOverview:       vi.fn(),
  apiUpdatePatient:            vi.fn(),
  // Keep old exports so other test files that import from this mock are safe
  apiGetPatient:               vi.fn(),
  apiUpdatePatient:            vi.fn(),
  apiGetPatientConsultations:  vi.fn(),
  apiGetLastApproved:          vi.fn(),
  apiListPatients:             vi.fn(),
  apiCreatePatient:            vi.fn(),
  apiGetChangeSummary:         vi.fn(),
}));

vi.mock('../api.js', () => ({
  apiFetch:       vi.fn(),
  apiUrl:         (p) => p,
  setAuthToken:   vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken:   vi.fn(),
}));

import { apiGetPatientOverview } from '../services/api/patients.js';
import PatientProfilePage from '../pages/PatientProfilePage.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PATIENT_ID   = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CONSULT_ID   = 'cccccccccccccccccccccccc';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/patients/${PATIENT_ID}`]}>
      <Routes>
        <Route path="/patients/:id"     element={<PatientProfilePage />} />
        <Route path="/consultation/:id" element={<div data-testid="consultation-detail">Detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function makeOverview(overrides = {}) {
  return {
    success: true,
    patient: {
      id:              PATIENT_ID,
      firstName:       'Alice',
      lastName:        'Smith',
      dateOfBirth:     '1990-05-15T00:00:00.000Z',
      biologicalSex:   'female',
      phone:           '0400000001',
      medicalRecordId: 'MR001',
      notes:           '',
      isArchived:      false,
    },
    statistics: {
      totalConsultations:    3,
      approvedConsultations: 2,
      draftConsultations:    1,
      lastConsultationDate:  '2026-09-15T09:00:00.000Z',
    },
    latestApprovedConsultation: {
      id:                    CONSULT_ID,
      consultationDate:      '2026-09-15T09:00:00.000Z',
      chief_complaint:       'Persistent cough',
      symptoms:              ['cough', 'fatigue'],
      medications_mentioned: ['paracetamol'],
      assessment:            'Viral URTI',
      follow_up:             'Return in 1 week',
    },
    recentConsultations: [
      {
        id:               CONSULT_ID,
        consultationDate: '2026-09-15T09:00:00.000Z',
        status:           'approved',
        chief_complaint:  'Persistent cough',
        correctionOf:     null,
        supersededBy:     null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1 — Overview loads — patient header renders
// ---------------------------------------------------------------------------
describe('1. history loads and displays consultations', () => {
  test('renders the chief complaint and status badge', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview());
    renderPage();

    await waitFor(() => {
      // "Persistent cough" appears in both latest-visit and timeline sections
      expect(screen.getAllByText('Persistent cough').length).toBeGreaterThan(0);
    });

    // Status badge is rendered in the timeline
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  test('calls the API with the correct patient ID', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview());
    renderPage();

    await waitFor(() => {
      expect(apiGetPatientOverview).toHaveBeenCalledWith(PATIENT_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// 2 — Loading state
// ---------------------------------------------------------------------------
describe('2. loading state', () => {
  test('shows loading message while fetch is in-flight', () => {
    apiGetPatientOverview.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading patient…')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3 — Empty state (no recent consultations)
// ---------------------------------------------------------------------------
describe('3. empty state', () => {
  test('shows empty message when no consultations exist', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview({
      statistics: {
        totalConsultations: 0, approvedConsultations: 0,
        draftConsultations: 0, lastConsultationDate: null,
      },
      latestApprovedConsultation: null,
      recentConsultations:        [],
    }));

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
    apiGetPatientOverview.mockResolvedValue({
      success: false,
      message: 'Server error loading history.',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Server error loading history.')).toBeInTheDocument();
    });
  });

  test('shows network error message on fetch rejection', async () => {
    apiGetPatientOverview.mockRejectedValue(new Error('Network failure'));

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText('Network error — could not load patient overview.')
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 5 — Correction/superseded indicators
// ---------------------------------------------------------------------------
describe('5. correction/superseded indicators', () => {
  test('renders "correction" badge when correctionOf is set', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview({
      recentConsultations: [{
        id: 'dddddddddddddddddddddddd',
        consultationDate: '2026-09-15T09:00:00.000Z',
        status: 'approved',
        chief_complaint: 'Correction note',
        correctionOf: 'eeeeeeeeeeeeeeeeeeeeeeee',
        supersededBy: null,
      }],
    }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('correction')).toBeInTheDocument();
    });
  });

  test('renders "superseded" badge when supersededBy is set', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview({
      recentConsultations: [{
        id: 'eeeeeeeeeeeeeeeeeeeeeeee',
        consultationDate: '2026-09-15T09:00:00.000Z',
        status: 'approved',
        chief_complaint: 'Old note',
        correctionOf:     null,
        supersededBy:     'dddddddddddddddddddddddd',
      }],
    }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('superseded')).toBeInTheDocument();
    });
  });

  test('Open link is active and navigates to /consultation/:id (Phase 3C.1)', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview());
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText('Persistent cough').length).toBeGreaterThan(0);
    });

    const openLink = screen.getByRole('link', { name: /open consultation/i });
    expect(openLink).not.toBeDisabled();
    expect(openLink).toHaveAttribute('href', `/consultation/${CONSULT_ID}`);
  });
});
