/**
 * Milestone 3 — Manual Consultation workflow tests  (manualConsultation.test.jsx)
 *
 * Tests:
 *   A. NewConsultationPage — "Enter manually" option
 *      A1. button visible after patient selected
 *      A2. button absent before patient selected
 *      A3. button navigates to /consultation/manual?patientId=:id
 *
 *   B. ManualConsultationPage — patient ownership
 *      B1. patient loads and name shown
 *      B2. loading state shown while patient fetch is in-flight
 *      B3. patient not found (404) shows error, no form
 *      B4. no ?patientId= param shows error, no form
 *      B5. network error shows error, no form
 *
 *   C. ManualConsultationPage — form validation
 *      C1. form renders all key fields
 *      C2. Save draft blocked when chief_complaint is empty
 *      C3. inline error shown for missing chief_complaint
 *      C4. error clears when chief_complaint is typed
 *
 *   D. ManualConsultationPage — save and navigation
 *      D1. successful save navigates to /consultation/:id
 *      D2. apiCreateConsultation called with blank transcript and no consentEventId
 *      D3. apiCreateConsultation called with correct patientId
 *      D4. server error shown on save failure
 *      D5. network error shown on save failure
 *
 *   E. ManualConsultationPage — security
 *      E1. wrong-doctor patient (404) shows error — no form rendered
 *      E2. encounter type selector present (in_person / telemedicine)
 *      E3. patient ID from query param passed to apiGetPatient unchanged
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../services/api/patients.js', () => ({
  apiGetPatient:               vi.fn(),
  apiListPatients:             vi.fn(),
  apiGetPatientOverview:       vi.fn(),
  apiUpdatePatient:            vi.fn(),
  apiGetPatientConsultations:  vi.fn(),
  apiGetLastApproved:          vi.fn(),
  apiCreatePatient:            vi.fn(),
  apiGetChangeSummary:         vi.fn(),
}));

vi.mock('../services/api/consultations.js', () => ({
  apiCreateConsultation:  vi.fn(),
  apiGetConsultation:     vi.fn(),
  apiCreateCorrection:    vi.fn(),
  apiApproveConsultation: vi.fn(),
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

import {
  apiGetPatient,
  apiListPatients,
  apiGetPatientOverview,
} from '../services/api/patients.js';
import {
  apiCreateConsultation,
} from '../services/api/consultations.js';
import { apiCreateRecordingConsent } from '../services/api/recordingConsents.js';

import NewConsultationPage   from '../pages/NewConsultationPage.jsx';
import ManualConsultationPage from '../pages/ManualConsultationPage.jsx';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT_ID    = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CONSULT_ID    = 'cccccccccccccccccccccccc';

function makePatient(overrides = {}) {
  return {
    _id:             PATIENT_ID,
    firstName:       'Alice',
    lastName:        'Smith',
    dateOfBirth:     '1990-05-15T00:00:00.000Z',
    biologicalSex:   'female',
    medicalRecordId: 'MR001',
    phone:           '',
    notes:           '',
    isArchived:      false,
    ...overrides,
  };
}

function makeOverview() {
  return {
    success: true,
    patient: makePatient(),
    statistics: { totalConsultations: 0, approvedConsultations: 0, draftConsultations: 0, lastConsultationDate: null },
    latestApprovedConsultation: null,
    recentConsultations: [],
  };
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/** Render NewConsultationPage with a stub route for /consultation/manual */
function renderNewConsultationPage(initialPath = '/consultation/new') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/consultation/new" element={<NewConsultationPage />} />
        <Route path="/consultation/manual" element={<div data-testid="manual-page">Manual</div>} />
        <Route path="/dashboard"          element={<div data-testid="dashboard" />} />
      </Routes>
    </MemoryRouter>
  );
}

/** Render ManualConsultationPage with stub routes */
function renderManualPage(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/consultation/manual" element={<ManualConsultationPage />} />
        <Route path="/consultation/:id"    element={<div data-testid="detail-page">Detail</div>} />
        <Route path="/patients"            element={<div data-testid="patients-page">Patients</div>} />
        <Route path="/patients/:id"        element={<div data-testid="patient-profile">Profile</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default mocks
  apiGetPatient.mockResolvedValue({ success: true, patient: makePatient() });
  apiListPatients.mockResolvedValue({ success: true, patients: [makePatient()] });
  apiGetPatientOverview.mockResolvedValue(makeOverview());
  apiCreateRecordingConsent.mockResolvedValue({
    success: true,
    consentEventId: 'test-event',
    givenAt: '2026-09-01T09:00:00.000Z',
  });
  apiCreateConsultation.mockResolvedValue({
    success: true,
    consultation: { _id: CONSULT_ID, status: 'draft', patientId: PATIENT_ID },
  });
});

// ===========================================================================
// A — NewConsultationPage: "Enter manually" option
// ===========================================================================

describe('A. NewConsultationPage — "Enter manually" option', () => {

  test('A1. manual entry button visible after patient is selected', async () => {
    renderNewConsultationPage();

    // Wait for search results to load and click the patient
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Smith, Alice'));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /enter consultation manually/i })
      ).toBeInTheDocument()
    );
  });

  test('A2. manual entry button absent before patient is selected', async () => {
    renderNewConsultationPage();
    await waitFor(() => expect(screen.getByRole('searchbox')).toBeInTheDocument());
    expect(
      screen.queryByRole('button', { name: /enter consultation manually/i })
    ).not.toBeInTheDocument();
  });

  test('A3. manual entry button navigates to /consultation/manual?patientId=:id', async () => {
    renderNewConsultationPage();
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Smith, Alice'));

    await waitFor(() =>
      screen.getByRole('button', { name: /enter consultation manually/i })
    );
    await userEvent.click(
      screen.getByRole('button', { name: /enter consultation manually/i })
    );

    await waitFor(() =>
      expect(screen.getByTestId('manual-page')).toBeInTheDocument()
    );
  });
});

// ===========================================================================
// B — ManualConsultationPage: patient ownership
// ===========================================================================

describe('B. ManualConsultationPage — patient ownership', () => {

  test('B1. patient name displayed when load succeeds', async () => {
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);

    await waitFor(() =>
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    );
    expect(apiGetPatient).toHaveBeenCalledWith(PATIENT_ID);
  });

  test('B2. loading state shown while patient fetch is in-flight', async () => {
    apiGetPatient.mockReturnValueOnce(new Promise(() => {})); // never resolves
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);

    expect(screen.getByText(/loading patient/i)).toBeInTheDocument();
  });

  test('B3. patient not found shows error, form is not rendered', async () => {
    apiGetPatient.mockResolvedValueOnce({ success: false, message: 'Patient not found.' });
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/patient not found/i)
    );
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  test('B4. missing ?patientId shows error, form is not rendered', async () => {
    renderManualPage('/consultation/manual');

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/no patient specified/i)
    );
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  test('B5. network error shows error, form is not rendered', async () => {
    apiGetPatient.mockRejectedValueOnce(new Error('Network failure'));
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/network error/i)
    );
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// C — ManualConsultationPage: form validation
// ===========================================================================

describe('C. ManualConsultationPage — form validation', () => {

  test('C1. form renders all key note fields', async () => {
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);
    await waitFor(() => screen.getByText('Alice Smith'));

    expect(screen.getByLabelText(/chief complaint/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/symptoms/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/relevant history/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/clinical observations/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/assessment/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/medications mentioned/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/follow.up/i)).toBeInTheDocument();
  });

  test('C2. Save draft blocked when chief_complaint is empty', async () => {
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);
    await waitFor(() => screen.getByText('Alice Smith'));

    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    // apiCreateConsultation must NOT have been called
    expect(apiCreateConsultation).not.toHaveBeenCalled();
  });

  test('C3. inline error shown for missing chief_complaint', async () => {
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);
    await waitFor(() => screen.getByText('Alice Smith'));

    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/chief complaint is required/i)
    );
  });

  test('C4. validation error clears when chief_complaint is typed', async () => {
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);
    await waitFor(() => screen.getByText('Alice Smith'));

    // Trigger validation error
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => screen.getByRole('alert'));

    // Type into chief complaint
    await userEvent.type(
      screen.getByLabelText(/chief complaint/i),
      'Persistent cough'
    );

    // Error should be gone
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    );
  });
});

// ===========================================================================
// D — ManualConsultationPage: save and navigation
// ===========================================================================

describe('D. ManualConsultationPage — save and navigation', () => {

  async function fillAndSave() {
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);
    await waitFor(() => screen.getByText('Alice Smith'));

    await userEvent.type(
      screen.getByLabelText(/chief complaint/i),
      'Fever for 3 days'
    );
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));
  }

  test('D1. successful save navigates to /consultation/:id', async () => {
    await fillAndSave();

    await waitFor(() =>
      expect(screen.getByTestId('detail-page')).toBeInTheDocument()
    );
  });

  test('D2. apiCreateConsultation called with blank transcript and no consentEventId', async () => {
    await fillAndSave();

    await waitFor(() => expect(apiCreateConsultation).toHaveBeenCalled());

    const body = apiCreateConsultation.mock.calls[0][0];
    expect(body.transcript).toBe('');
    expect(body).not.toHaveProperty('consentEventId');
  });

  test('D3. apiCreateConsultation called with correct patientId', async () => {
    await fillAndSave();

    await waitFor(() => expect(apiCreateConsultation).toHaveBeenCalled());

    const body = apiCreateConsultation.mock.calls[0][0];
    expect(body.patientId).toBe(PATIENT_ID);
  });

  test('D4. server error shown on save failure', async () => {
    apiCreateConsultation.mockResolvedValueOnce({
      success: false,
      message: 'Failed to save consultation.',
    });

    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);
    await waitFor(() => screen.getByText('Alice Smith'));

    await userEvent.type(
      screen.getByLabelText(/chief complaint/i),
      'Chest pain'
    );
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to save/i)
    );
    // Should stay on the form page
    expect(screen.queryByTestId('detail-page')).not.toBeInTheDocument();
  });

  test('D5. network error shown on save failure', async () => {
    apiCreateConsultation.mockRejectedValueOnce(new Error('Network down'));

    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);
    await waitFor(() => screen.getByText('Alice Smith'));

    await userEvent.type(
      screen.getByLabelText(/chief complaint/i),
      'Headache'
    );
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/network error/i)
    );
  });
});

// ===========================================================================
// E — ManualConsultationPage: security and structure
// ===========================================================================

describe('E. ManualConsultationPage — security and structure', () => {

  test('E1. wrong-doctor patient (404) shows error — no form rendered', async () => {
    // The backend returns 404 when the patient belongs to another doctor.
    // Frontend treats { success: false } the same way.
    apiGetPatient.mockResolvedValueOnce({
      success: false,
      message: 'Patient not found.',
    });

    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/patient not found/i)
    );
    // The note form must not be rendered — doctor cannot create a consultation
    // for a patient they don't own
    expect(screen.queryByLabelText(/chief complaint/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument();
  });

  test('E2. encounter type selector present with in_person default', async () => {
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);
    await waitFor(() => screen.getByText('Alice Smith'));

    const encounterSelect = screen.getByLabelText(/encounter type/i);
    expect(encounterSelect).toBeInTheDocument();
    expect(encounterSelect).toHaveValue('in_person');

    // Telemedicine option also available
    expect(
      screen.getByRole('option', { name: /telemedicine/i })
    ).toBeInTheDocument();
  });

  test('E3. patient ID from URL passed to apiGetPatient unchanged', async () => {
    const specificId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    apiGetPatient.mockResolvedValueOnce({
      success: true,
      patient: makePatient({ _id: specificId, firstName: 'Bob' }),
    });

    renderManualPage(`/consultation/manual?patientId=${specificId}`);

    await waitFor(() =>
      expect(apiGetPatient).toHaveBeenCalledWith(specificId)
    );
    // The ID passed to the API must be exactly what came from the URL
    expect(apiGetPatient.mock.calls[0][0]).toBe(specificId);
  });

  test('E4. draft status sent to API — not approved on creation', async () => {
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);
    await waitFor(() => screen.getByText('Alice Smith'));

    await userEvent.type(
      screen.getByLabelText(/chief complaint/i),
      'Routine checkup'
    );
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(apiCreateConsultation).toHaveBeenCalled());

    const body = apiCreateConsultation.mock.calls[0][0];
    expect(body.status).toBe('draft');
  });

  test('E5. manual notice shown on form page', async () => {
    renderManualPage(`/consultation/manual?patientId=${PATIENT_ID}`);
    await waitFor(() => screen.getByText('Alice Smith'));

    expect(screen.getByRole('status')).toHaveTextContent(/manual entry/i);
  });
});
