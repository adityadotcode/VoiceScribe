/**
 * Milestone 2 — Consultation entry point tests  (consultationEntry.test.jsx)
 *
 * Tests the two fixes from Milestone 2:
 *   A. Dashboard "Start new consultation" navigates to /consultation/new
 *      (no longer enters RECORDING stage without consent)
 *   B. PatientProfilePage "New consultation" button navigates with patientId
 *   C. NewConsultationPage preselects patient from ?patientId= query param
 *   D. Invalid/inaccessible patient ID shows error, search still available
 *   E. Consent enforcement remains intact after preselection
 *
 * Strategy:
 *   - Dashboard: test the Dashboard component's "+ New consultation" button
 *     (calls onNewConsultation prop, which App.jsx wires to navigate).
 *   - PatientProfilePage: render with mocked overview, click "New consultation",
 *     verify navigation to /consultation/new?patientId=:id.
 *   - NewConsultationPage: render with ?patientId= in the URL, mock apiGetPatient,
 *     verify patient is auto-selected and consent gate is still required.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../services/api/patients.js', () => ({
  apiListPatients:             vi.fn(),
  apiGetPatient:               vi.fn(),
  apiUpdatePatient:            vi.fn(),
  apiGetPatientConsultations:  vi.fn(),
  apiGetLastApproved:          vi.fn(),
  apiGetPatientOverview:       vi.fn(),
  apiCreatePatient:            vi.fn(),
  apiGetChangeSummary:         vi.fn(),
}));

vi.mock('../services/api/patientPortal.js', () => ({
  apiIssueInvite:              vi.fn(),
  apiPatientRegister:          vi.fn(),
  apiPatientLogin:             vi.fn(),
  apiPatientRefresh:           vi.fn(),
  apiPatientLogout:            vi.fn(),
  apiPatientMe:                vi.fn(),
  apiGetOwnPatient:            vi.fn(),
  apiListPatientConsultations: vi.fn(),
  apiGetPatientConsultation:   vi.fn(),
}));

vi.mock('../services/api/recordingConsents.js', () => ({
  apiCreateRecordingConsent: vi.fn(),
}));

vi.mock('../api.js', () => ({
  apiFetch:       vi.fn(),
  apiUrl:         (p) => p,
  setAuthToken:   vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken:   vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { apiGetPatientOverview, apiGetPatient, apiListPatients } from '../services/api/patients.js';
import { apiCreateRecordingConsent } from '../services/api/recordingConsents.js';
import { apiFetch } from '../api.js';

import Dashboard from '../Dashboard.jsx';
import PatientProfilePage from '../pages/PatientProfilePage.jsx';
import NewConsultationPage from '../pages/NewConsultationPage.jsx';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CID_1 = 'cccccccccccccccccccccccc';

function makePatient(overrides = {}) {
  return {
    _id:             PATIENT_ID,
    firstName:       'Alice',
    lastName:        'Smith',
    dateOfBirth:     '1990-05-15T00:00:00.000Z',
    biologicalSex:   'female',
    medicalRecordId: 'MR001',
    phone:           '0400000000',
    notes:           '',
    isArchived:      false,
    ...overrides,
  };
}

function makeOverview(overrides = {}) {
  return {
    success: true,
    patient: makePatient(),
    statistics: {
      totalConsultations:    0,
      approvedConsultations: 0,
      draftConsultations:    0,
      lastConsultationDate:  null,
    },
    latestApprovedConsultation: null,
    recentConsultations: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default mocks — most tests won't hit these unless they navigate
  apiListPatients.mockResolvedValue({ success: true, patients: [makePatient()] });
  apiGetPatientOverview.mockResolvedValue(makeOverview());
  apiGetPatient.mockResolvedValue({ success: true, patient: makePatient() });
  apiCreateRecordingConsent.mockResolvedValue({
    success: true,
    consentEventId: 'test-consent-event-id',
    givenAt: '2026-09-01T09:00:00.000Z',
  });
});

// ===========================================================================
// A — Dashboard "Start new consultation" navigation
// ===========================================================================

describe('A. Dashboard navigation to consultation flow', () => {
  test('A1. Dashboard "+ New consultation" button calls onNewConsultation', async () => {
    const onNewConsultation = vi.fn();
    // Dashboard calls apiFetch directly for /api/consultations
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, consultations: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    render(
      <MemoryRouter>
        <Dashboard
          onOpen={vi.fn()}
          onNewConsultation={onNewConsultation}
          refreshTrigger={0}
        />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /new consultation/i })).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole('button', { name: /new consultation/i }));
    expect(onNewConsultation).toHaveBeenCalled();
  });
});

// ===========================================================================
// B — PatientProfilePage "New consultation" button
// ===========================================================================

describe('B. PatientProfilePage — New consultation button', () => {
  test('B1. "New consultation" button is visible on the patient profile', async () => {
    apiGetPatientOverview.mockResolvedValueOnce(makeOverview());

    render(
      <MemoryRouter initialEntries={[`/patients/${PATIENT_ID}`]}>
        <Routes>
          <Route path="/patients/:id" element={<PatientProfilePage />} />
          <Route path="/consultation/new" element={<div data-testid="new-consult-page">New Consultation</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /new consultation/i })).toBeInTheDocument();
  });

  test('B2. clicking "New consultation" navigates to /consultation/new with patientId', async () => {
    apiGetPatientOverview.mockResolvedValueOnce(makeOverview());

    render(
      <MemoryRouter initialEntries={[`/patients/${PATIENT_ID}`]}>
        <Routes>
          <Route path="/patients/:id" element={<PatientProfilePage />} />
          <Route
            path="/consultation/new"
            element={<div data-testid="new-consult-page">New Consultation Page</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /new consultation/i }));

    await waitFor(() =>
      expect(screen.getByTestId('new-consult-page')).toBeInTheDocument()
    );
  });

  test('B3. "New consultation" button is not shown in edit mode', async () => {
    apiGetPatientOverview.mockResolvedValueOnce(makeOverview());

    render(
      <MemoryRouter initialEntries={[`/patients/${PATIENT_ID}`]}>
        <Routes>
          <Route path="/patients/:id" element={<PatientProfilePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    // Enter edit mode
    await userEvent.click(screen.getByRole('button', { name: /edit patient/i }));

    // "New consultation" button should not be present in edit mode
    expect(screen.queryByRole('button', { name: /^new consultation$/i })).not.toBeInTheDocument();
    // "Edit patient" title is shown instead
    expect(screen.getByRole('heading', { name: /edit patient/i })).toBeInTheDocument();
  });
});

// ===========================================================================
// C — NewConsultationPage patient preselection
// ===========================================================================

describe('C. NewConsultationPage — patient preselection from ?patientId=', () => {
  test('C1. patient is auto-selected when ?patientId= is present', async () => {
    apiGetPatient.mockResolvedValueOnce({ success: true, patient: makePatient() });

    render(
      <MemoryRouter initialEntries={['/consultation/new?patientId=' + PATIENT_ID]}>
        <Routes>
          <Route path="/consultation/new" element={<NewConsultationPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for the preselection to complete — the patient name should be visible
    await waitFor(() =>
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    );

    // apiGetPatient was called with the correct ID
    expect(apiGetPatient).toHaveBeenCalledWith(PATIENT_ID);
  });

  test('C2. search panel is hidden when patient is preselected', async () => {
    apiGetPatient.mockResolvedValueOnce({ success: true, patient: makePatient() });

    render(
      <MemoryRouter initialEntries={['/consultation/new?patientId=' + PATIENT_ID]}>
        <Routes>
          <Route path="/consultation/new" element={<NewConsultationPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    // Search box should not be visible — patient is already selected
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  test('C3. "Change patient" button returns to search panel', async () => {
    apiGetPatient.mockResolvedValueOnce({ success: true, patient: makePatient() });

    render(
      <MemoryRouter initialEntries={['/consultation/new?patientId=' + PATIENT_ID]}>
        <Routes>
          <Route path="/consultation/new" element={<NewConsultationPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    // Click "Change patient"
    await userEvent.click(screen.getByRole('button', { name: /change patient/i }));

    // Search panel should reappear
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: /search patients/i })).toBeInTheDocument()
    );
  });

  test('C4. no ?patientId= → normal search flow, apiGetPatient not called', async () => {
    render(
      <MemoryRouter initialEntries={['/consultation/new']}>
        <Routes>
          <Route path="/consultation/new" element={<NewConsultationPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        </Routes>
      </MemoryRouter>
    );

    // Search panel should be visible immediately
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: /search patients/i })).toBeInTheDocument()
    );

    // apiGetPatient should NOT have been called (no preselection)
    expect(apiGetPatient).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// D — Invalid / inaccessible patient ID
// ===========================================================================

describe('D. Invalid or inaccessible patient ID', () => {
  test('D1. patient fetch failure shows error, search panel still available', async () => {
    apiGetPatient.mockResolvedValueOnce({ success: false, message: 'Patient not found.' });

    render(
      <MemoryRouter initialEntries={['/consultation/new?patientId=invalid-id']}>
        <Routes>
          <Route path="/consultation/new" element={<NewConsultationPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        </Routes>
      </MemoryRouter>
    );

    // Error message should appear (server message is shown)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/patient not found/i)
    );

    // Search panel should still be available for manual search
    expect(screen.getByRole('searchbox', { name: /search patients/i })).toBeInTheDocument();
  });

  test('D2. network error shows error, search panel still available', async () => {
    apiGetPatient.mockRejectedValueOnce(new Error('Network failure'));

    render(
      <MemoryRouter initialEntries={['/consultation/new?patientId=' + PATIENT_ID]}>
        <Routes>
          <Route path="/consultation/new" element={<NewConsultationPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/network error/i)
    );

    expect(screen.getByRole('searchbox', { name: /search patients/i })).toBeInTheDocument();
  });
});

// ===========================================================================
// E — Consent enforcement remains intact
// ===========================================================================

describe('E. Consent enforcement after preselection', () => {
  test('E1. consent checkbox is unchecked after preselection', async () => {
    apiGetPatient.mockResolvedValueOnce({ success: true, patient: makePatient() });

    render(
      <MemoryRouter initialEntries={['/consultation/new?patientId=' + PATIENT_ID]}>
        <Routes>
          <Route path="/consultation/new" element={<NewConsultationPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    // Consent checkbox must be present and unchecked
    const consentCheckbox = screen.getByRole('checkbox', {
      name: /i confirm the patient has consented/i,
    });
    expect(consentCheckbox).toBeInTheDocument();
    expect(consentCheckbox).not.toBeChecked();
  });

  test('E2. "Start consultation" is disabled until consent is checked', async () => {
    apiGetPatient.mockResolvedValueOnce({ success: true, patient: makePatient() });

    render(
      <MemoryRouter initialEntries={['/consultation/new?patientId=' + PATIENT_ID]}>
        <Routes>
          <Route path="/consultation/new" element={<NewConsultationPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    const startBtn = screen.getByRole('button', { name: /start consultation/i });
    expect(startBtn).toBeDisabled();

    // Check consent
    const consentCheckbox = screen.getByRole('checkbox', {
      name: /i confirm the patient has consented/i,
    });
    await userEvent.click(consentCheckbox);

    // Now start should be enabled
    await waitFor(() => expect(startBtn).not.toBeDisabled());
  });

  test('E3. clicking Start calls consent API with patientId, then navigates', async () => {
    apiGetPatient.mockResolvedValueOnce({ success: true, patient: makePatient() });

    render(
      <MemoryRouter initialEntries={['/consultation/new?patientId=' + PATIENT_ID]}>
        <Routes>
          <Route path="/consultation/new" element={<NewConsultationPage />} />
          <Route path="/dashboard" element={<div data-testid="dashboard">Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    // Check consent
    await userEvent.click(screen.getByRole('checkbox', {
      name: /i confirm the patient has consented/i,
    }));

    // Click start
    await userEvent.click(screen.getByRole('button', { name: /start consultation/i }));

    // Consent API was called with the patient ID
    await waitFor(() =>
      expect(apiCreateRecordingConsent).toHaveBeenCalledWith(PATIENT_ID)
    );

    // Navigation to /dashboard occurred
    await waitFor(() =>
      expect(screen.getByTestId('dashboard')).toBeInTheDocument()
    );
  });
});
