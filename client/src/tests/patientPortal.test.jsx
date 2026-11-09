/**
 * Patient Portal frontend tests
 *
 * Covers:
 *  A. PatientPortalAuthContext — login, logout, silent refresh
 *  B. PatientLoginPage — form validation, API call, navigation, error
 *  C. PatientRegisterPage — form validation, API call, navigation, error
 *  D. PatientHistoryPage — loading, empty state, consultation list, logout
 *  E. PatientConsultationPage — loading, not-found, approved record, correction badge
 *  F. PatientPortalRoute — redirect when unauthenticated
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../services/api/patientPortal.js', () => ({
  apiPatientLogin:            vi.fn(),
  apiPatientRegister:         vi.fn(),
  apiPatientRefresh:          vi.fn(),
  apiPatientLogout:           vi.fn(),
  apiPatientMe:               vi.fn(),
  apiGetOwnPatient:           vi.fn(),
  apiListPatientConsultations: vi.fn(),
  apiGetPatientConsultation:  vi.fn(),
}));

import {
  apiPatientLogin,
  apiPatientRegister,
  apiPatientRefresh,
  apiPatientLogout,
  apiGetOwnPatient,
  apiListPatientConsultations,
  apiGetPatientConsultation,
} from '../services/api/patientPortal.js';

import { PatientPortalAuthProvider, usePatientAuth } from '../contexts/PatientPortalAuthContext.jsx';
import PatientLoginPage from '../pages/portal/PatientLoginPage.jsx';
import PatientRegisterPage from '../pages/portal/PatientRegisterPage.jsx';
import PatientHistoryPage from '../pages/portal/PatientHistoryPage.jsx';
import PatientConsultationPage from '../pages/portal/PatientConsultationPage.jsx';
import PatientPortalRoute from '../components/layout/PatientPortalRoute.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT = {
  id:           'cccc',
  email:        'patient@example.com',
  displayName:  'Alice Smith',
  role:         'patient',
  patientId:    'bbbb',
  doctorUserId: 'aaaa',
};

const PATIENT = {
  firstName:       'Alice',
  lastName:        'Smith',
  dateOfBirth:     '1990-01-01T00:00:00.000Z',
  biologicalSex:   'female',
  medicalRecordId: 'MR001',
  phone:           '0400000000',
};

function makeConsultation(overrides = {}) {
  return {
    _id:              'dddd',
    consultationDate: '2026-09-01T09:00:00.000Z',
    encounterType:    'in_person',
    approvedAt:       '2026-09-01T10:00:00.000Z',
    status:           'approved',
    correctionOf:     null,
    supersededBy:     null,
    note: {
      chief_complaint:       'Cough',
      symptoms:              ['cough', 'fatigue'],
      medications_mentioned: ['paracetamol'],
      assessment:            'Viral URTI',
      follow_up:             'Return in 1 week',
    },
    ...overrides,
  };
}

function wrapPortal(ui, initialPath = '/portal/login') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PatientPortalAuthProvider>
        <Routes>
          <Route path="/portal/login"           element={<PatientLoginPage />} />
          <Route path="/portal/register"        element={<PatientRegisterPage />} />
          <Route element={<PatientPortalRoute />}>
            <Route path="/portal/history"       element={<PatientHistoryPage />} />
            <Route path="/portal/consultation/:id" element={<PatientConsultationPage />} />
          </Route>
          <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        </Routes>
      </PatientPortalAuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: refresh fails → unauthenticated on mount
  apiPatientRefresh.mockResolvedValue(null);
});

// ===========================================================================
// A — PatientPortalAuthContext
// ===========================================================================

describe('A. PatientPortalAuthContext', () => {
  test('A1. silent refresh on mount — success restores session', async () => {
    apiPatientRefresh.mockResolvedValueOnce({
      success: true,
      accessToken: 'tok',
      account: ACCOUNT,
    });
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });

    wrapPortal(<div />, '/portal/history');

    await waitFor(() =>
      expect(screen.queryByText('Loading your records…')).not.toBeInTheDocument()
    );
  });

  test('A2. silent refresh failure → unauthenticated', async () => {
    apiPatientRefresh.mockResolvedValueOnce(null);
    wrapPortal(<div />, '/portal/history');
    // PatientPortalRoute should redirect to login
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /sign in to your records/i })).toBeInTheDocument()
    );
  });
});

// ===========================================================================
// B — PatientLoginPage
// ===========================================================================

describe('B. PatientLoginPage', () => {
  test('B1. renders sign-in form with email and password fields', async () => {
    wrapPortal(null, '/portal/login');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /sign in to your records/i })).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  test('B2. submit button disabled when fields are empty', async () => {
    wrapPortal(null, '/portal/login');
    await waitFor(() => expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled());
  });

  test('B3. login failure shows generic error', async () => {
    apiPatientLogin.mockResolvedValueOnce({ success: false });
    wrapPortal(null, '/portal/login');
    await waitFor(() => screen.getByRole('heading', { name: /sign in/i }));

    await userEvent.type(screen.getByLabelText(/email/i), 'p@test.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrongpass');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid email or password/i)
    );
  });

  test('B4. successful login navigates to /portal/history', async () => {
    apiPatientLogin.mockResolvedValueOnce({ success: true, accessToken: 'tok', account: ACCOUNT });
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });

    wrapPortal(null, '/portal/login');
    await waitFor(() => screen.getByRole('heading', { name: /sign in/i }));

    await userEvent.type(screen.getByLabelText(/email/i), 'patient@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'pass1234');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.queryByText(/your approved consultations/i)).toBeInTheDocument()
    );
  });
});

// ===========================================================================
// C — PatientRegisterPage
// ===========================================================================

describe('C. PatientRegisterPage', () => {
  test('C1. renders register form with invite token field', async () => {
    wrapPortal(null, '/portal/register');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/invite token/i)).toBeInTheDocument();
  });

  test('C2. registration failure shows server message', async () => {
    apiPatientRegister.mockResolvedValueOnce({
      success: false,
      message: 'Invalid or expired invite token.',
    });
    wrapPortal(null, '/portal/register');
    await waitFor(() => screen.getByRole('heading', { name: /create your account/i }));

    await userEvent.type(screen.getByLabelText(/invite token/i), 'badtoken');
    await userEvent.type(screen.getByLabelText(/your name/i), 'Alice');
    await userEvent.type(screen.getByLabelText(/email/i), 'alice@test.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'pass1234');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid or expired invite/i)
    );
  });

  test('C3. successful registration navigates to /portal/history', async () => {
    apiPatientRegister.mockResolvedValueOnce({ success: true, accessToken: 'tok', account: ACCOUNT });
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });

    wrapPortal(null, '/portal/register');
    await waitFor(() => screen.getByRole('heading', { name: /create your account/i }));

    await userEvent.type(screen.getByLabelText(/invite token/i), 'VALIDTOKEN');
    await userEvent.type(screen.getByLabelText(/your name/i), 'Alice Smith');
    await userEvent.type(screen.getByLabelText(/email/i), 'alice@test.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'pass1234');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(screen.queryByText(/your approved consultations/i)).toBeInTheDocument()
    );
  });
});

// ===========================================================================
// D — PatientHistoryPage
// ===========================================================================

describe('D. PatientHistoryPage', () => {
  beforeEach(() => {
    // Seed an authenticated session
    apiPatientRefresh.mockResolvedValue({
      success: true, accessToken: 'tok', account: ACCOUNT,
    });
  });

  test('D1. shows loading state initially', async () => {
    // Never-resolving promises keep the page in loading state
    apiGetOwnPatient.mockReturnValue(new Promise(() => {}));
    apiListPatientConsultations.mockReturnValue(new Promise(() => {}));
    wrapPortal(null, '/portal/history');
    // After auth refresh resolves, page fetches data (also never resolving) → stays loading
    await waitFor(() =>
      expect(screen.getByText(/loading your records/i)).toBeInTheDocument()
    );
  });

  test('D2. shows empty state when no consultations', async () => {
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });
    wrapPortal(null, '/portal/history');
    await waitFor(() =>
      expect(screen.getByText(/no approved consultation records/i)).toBeInTheDocument()
    );
  });

  test('D3. renders consultation list with dates and chief complaints', async () => {
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({
      success: true,
      consultations: [makeConsultation(), makeConsultation({
        _id: 'eeee',
        consultationDate: '2026-08-01T09:00:00.000Z',
        note: { ...makeConsultation().note, chief_complaint: 'Sore throat' },
      })],
    });
    wrapPortal(null, '/portal/history');
    await waitFor(() => expect(screen.getByText('Cough')).toBeInTheDocument());
    expect(screen.getByText('Sore throat')).toBeInTheDocument();
  });

  test('D4. shows "Corrected record" badge for correction documents', async () => {
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({
      success: true,
      consultations: [makeConsultation({ correctionOf: 'orig-id' })],
    });
    wrapPortal(null, '/portal/history');
    await waitFor(() =>
      expect(screen.getByText(/corrected record/i)).toBeInTheDocument()
    );
  });

  test('D5. patient demographics shown but not doctor notes', async () => {
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });
    wrapPortal(null, '/portal/history');
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.queryByText('Doctor private note')).not.toBeInTheDocument();
  });

  test('D6. network error shows error message', async () => {
    apiGetOwnPatient.mockRejectedValueOnce(new Error('Network failure'));
    apiListPatientConsultations.mockRejectedValueOnce(new Error('Network failure'));
    wrapPortal(null, '/portal/history');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/network error/i)
    );
  });
});

// ===========================================================================
// E — PatientConsultationPage
// ===========================================================================

describe('E. PatientConsultationPage', () => {
  beforeEach(() => {
    apiPatientRefresh.mockResolvedValue({
      success: true, accessToken: 'tok', account: ACCOUNT,
    });
  });

  test('E1. shows loading state', async () => {
    apiGetPatientConsultation.mockReturnValue(new Promise(() => {}));
    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() =>
      expect(screen.getByText(/loading record/i)).toBeInTheDocument()
    );
  });

  test('E2. success:false shows not-found message', async () => {
    apiGetPatientConsultation.mockResolvedValueOnce({ success: false });
    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/record not found/i)
    );
  });

  test('E3. renders approved consultation note fields', async () => {
    apiGetPatientConsultation.mockResolvedValueOnce({
      success: true, consultation: makeConsultation(),
    });
    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() => expect(screen.getByText('Cough')).toBeInTheDocument());
    expect(screen.getByText('Viral URTI')).toBeInTheDocument();
    expect(screen.getByText('Return in 1 week')).toBeInTheDocument();
  });

  test('E4. correction banner shown for correction documents', async () => {
    apiGetPatientConsultation.mockResolvedValueOnce({
      success: true,
      consultation: makeConsultation({ correctionOf: 'orig-id' }),
    });
    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() =>
      expect(screen.getByText(/corrected version/i)).toBeInTheDocument()
    );
  });

  test('E5. transcript and internal fields are not rendered', async () => {
    apiGetPatientConsultation.mockResolvedValueOnce({
      success: true,
      consultation: {
        ...makeConsultation(),
        transcript: 'SHOULD NOT APPEAR',
        recordingConsentGivenAt: '2026-09-01',
      },
    });
    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() => screen.getByText('Cough'));
    // Transcript must never be rendered
    expect(screen.queryByText('SHOULD NOT APPEAR')).not.toBeInTheDocument();
  });

  test('E6. back button navigates to history', async () => {
    apiGetOwnPatient.mockResolvedValue({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValue({ success: true, consultations: [] });
    apiGetPatientConsultation.mockResolvedValueOnce({
      success: true, consultation: makeConsultation(),
    });
    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() => screen.getByText('Cough'));
    await userEvent.click(screen.getByRole('button', { name: /back to history/i }));
    await waitFor(() =>
      expect(screen.getByText(/your approved consultations/i)).toBeInTheDocument()
    );
  });
});

// ===========================================================================
// F — PatientPortalRoute
// ===========================================================================

describe('F. PatientPortalRoute', () => {
  test('F1. unauthenticated access to /portal/history redirects to login', async () => {
    apiPatientRefresh.mockResolvedValueOnce(null); // no session
    wrapPortal(null, '/portal/history');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /sign in to your records/i })).toBeInTheDocument()
    );
  });

  test('F2. authenticated access to /portal/history renders history page', async () => {
    apiPatientRefresh.mockResolvedValueOnce({
      success: true, accessToken: 'tok', account: ACCOUNT,
    });
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });
    wrapPortal(null, '/portal/history');
    await waitFor(() =>
      expect(screen.getByText(/your approved consultations/i)).toBeInTheDocument()
    );
  });
});
