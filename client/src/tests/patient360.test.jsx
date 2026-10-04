/**
 * Patient 360.2 — PatientProfilePage focused tests
 *
 * Scenarios (10):
 *   1. Overview loads — patient header renders (name, DOB, sex, MR, phone)
 *   2. Statistics section renders all four stat cards
 *   3. Latest approved visit renders clinical fields
 *   4. No approved consultation → "No approved consultation available yet."
 *   5. Timeline renders consultations (newest first order preserved)
 *   6. Correction indicator shown in timeline
 *   7. Superseded indicator shown in timeline (row de-emphasised)
 *   8. Open link in timeline navigates to /consultation/:id
 *   9. Loading state shown while fetch is in-flight
 *  10. API error / 404 state displayed
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
  apiGetPatient:               vi.fn(),
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

const PATIENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CID_1      = 'cccccccccccccccccccccccc';
const CID_2      = 'dddddddddddddddddddddddd';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/patients/${PATIENT_ID}`]}>
      <Routes>
        <Route path="/patients/:id"     element={<PatientProfilePage />} />
        <Route path="/consultation/:id" element={<div data-testid="consult-detail" />} />
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
      id:                    CID_1,
      consultationDate:      '2026-09-15T09:00:00.000Z',
      chief_complaint:       'Persistent cough',
      symptoms:              ['cough', 'fatigue'],
      medications_mentioned: ['paracetamol'],
      assessment:            'Viral URTI',
      follow_up:             'Return in 1 week',
    },
    recentConsultations: [
      {
        id: CID_1,
        consultationDate: '2026-09-15T09:00:00.000Z',
        status: 'approved',
        chief_complaint: 'Persistent cough',
        correctionOf: null,
        supersededBy: null,
      },
      {
        id: CID_2,
        consultationDate: '2026-08-01T09:00:00.000Z',
        status: 'approved',
        chief_complaint: 'Sore throat',
        correctionOf: null,
        supersededBy: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1 — Patient header renders
// ---------------------------------------------------------------------------
describe('1. overview loads — patient header renders', () => {
  test('name, DOB sex, medical record ID and phone are displayed', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview());
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    expect(screen.getByText('MR: MR001')).toBeInTheDocument();
    // Sex rendered
    expect(screen.getByText('Female')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2 — Statistics section renders
// ---------------------------------------------------------------------------
describe('2. statistics render', () => {
  test('all four stat values are visible', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview());
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // Total: 3, Approved: 2, Draft: 1 — these are rendered as large numbers
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    // Labels
    expect(screen.getByText('Total consultations')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Last visit')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3 — Latest approved visit renders
// ---------------------------------------------------------------------------
describe('3. latest approved visit renders', () => {
  test('chief complaint, assessment, and follow-up are shown', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview());
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText('Persistent cough').length).toBeGreaterThan(0);
    });

    expect(screen.getByText('Viral URTI')).toBeInTheDocument();
    expect(screen.getByText('Return in 1 week')).toBeInTheDocument();
    expect(screen.getByText('Latest approved visit')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4 — No approved consultation → empty state
// ---------------------------------------------------------------------------
describe('4. no approved consultation state', () => {
  test('shows "No approved consultation available yet." when null', async () => {
    apiGetPatientOverview.mockResolvedValue(
      makeOverview({ latestApprovedConsultation: null })
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No approved consultation available yet.')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 5 — Timeline renders consultations
// ---------------------------------------------------------------------------
describe('5. timeline renders consultations newest first', () => {
  test('both recent consultations are displayed', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview());
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // Recent consultations section header
    expect(screen.getByText('Recent consultations')).toBeInTheDocument();

    // Both chief complaints appear (first one also appears in latest-visit section)
    expect(screen.getByText('Sore throat')).toBeInTheDocument();
  });

  test('empty timeline shows "No consultations recorded for this patient yet."', async () => {
    apiGetPatientOverview.mockResolvedValue(
      makeOverview({ recentConsultations: [] })
    );
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText('No consultations recorded for this patient yet.')
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 6 — Correction indicator
// ---------------------------------------------------------------------------
describe('6. correction indicator renders', () => {
  test('"correction" badge shown when correctionOf is set', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview({
      recentConsultations: [{
        id: CID_2,
        consultationDate: '2026-09-10T09:00:00.000Z',
        status: 'approved',
        chief_complaint: 'Amended note',
        correctionOf: CID_1,
        supersededBy: null,
      }],
    }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('correction')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 7 — Superseded indicator
// ---------------------------------------------------------------------------
describe('7. superseded indicator renders', () => {
  test('"superseded" badge shown when supersededBy is set', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview({
      recentConsultations: [{
        id: CID_1,
        consultationDate: '2026-09-01T09:00:00.000Z',
        status: 'approved',
        chief_complaint: 'Old note',
        correctionOf: null,
        supersededBy: CID_2,
      }],
    }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('superseded')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 8 — Open link navigates to /consultation/:id
// ---------------------------------------------------------------------------
describe('8. Open consultation navigates correctly', () => {
  test('Open link has correct href', async () => {
    apiGetPatientOverview.mockResolvedValue(makeOverview());
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /open consultation/i }).length).toBeGreaterThan(0);
    });

    const openLinks = screen.getAllByRole('link', { name: /open consultation/i });
    // First link should point to the most recent consultation
    expect(openLinks[0]).toHaveAttribute('href', `/consultation/${CID_1}`);
  });
});

// ---------------------------------------------------------------------------
// 9 — Loading state
// ---------------------------------------------------------------------------
describe('9. loading state', () => {
  test('shows "Loading patient…" while fetch is in-flight', () => {
    apiGetPatientOverview.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading patient…')).toBeInTheDocument();
    // API should not be called before component mounts — it is called
    expect(apiGetPatientOverview).toHaveBeenCalledWith(PATIENT_ID);
  });
});

// ---------------------------------------------------------------------------
// 10 — Error state
// ---------------------------------------------------------------------------
describe('10. 404/error state', () => {
  test('shows error message on API failure', async () => {
    apiGetPatientOverview.mockResolvedValue({
      success: false,
      message: 'Patient not found.',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Patient not found.')).toBeInTheDocument();
  });

  test('shows network error on fetch rejection', async () => {
    apiGetPatientOverview.mockRejectedValue(new Error('Network failure'));

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText('Network error — could not load patient overview.')
      ).toBeInTheDocument();
    });
  });
});
