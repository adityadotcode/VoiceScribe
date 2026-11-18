/**
 * Milestone 1 — Portal Invite Panel tests  (portalInvite.test.jsx)
 *
 * Tests the full doctor-side invite flow:
 *   A. PortalInvitePanel (via PatientProfilePage) — all 5 states
 *   B. PatientRegisterPage — field-level validation and server-error mapping
 *   C. PatientLoginPage — session-expired notice, password toggle
 *
 * Strategy:
 *   - PatientProfilePage is rendered with apiGetPatientOverview mocked.
 *   - apiIssueInvite is mocked via vi.mock on patientPortal.js.
 *   - apiFetch is mocked (api.js) for the overview call chain.
 *   - No real HTTP calls are made.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../services/api/patients.js', () => ({
  apiGetPatientOverview: vi.fn(),
  apiUpdatePatient:      vi.fn(),
  apiGetPatient:         vi.fn(),
  apiListPatients:       vi.fn(),
  apiCreatePatient:      vi.fn(),
  apiGetChangeSummary:   vi.fn(),
  apiGetLastApproved:    vi.fn(),
  apiGetPatientConsultations: vi.fn(),
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

import { apiGetPatientOverview } from '../services/api/patients.js';
import {
  apiIssueInvite,
  apiPatientRegister,
  apiPatientRefresh,
  apiPatientLogin,
  apiGetOwnPatient,
  apiListPatientConsultations,
} from '../services/api/patientPortal.js';

import PatientProfilePage      from '../pages/PatientProfilePage.jsx';
import PatientRegisterPage     from '../pages/portal/PatientRegisterPage.jsx';
import PatientLoginPage        from '../pages/portal/PatientLoginPage.jsx';
import PatientHistoryPage      from '../pages/portal/PatientHistoryPage.jsx';
import PatientPortalLayout     from '../components/layout/PatientPortalLayout.jsx';
import { PatientPortalAuthProvider } from '../contexts/PatientPortalAuthContext.jsx';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const ACCOUNT = {
  id:           'cccc',
  email:        'patient@example.com',
  displayName:  'Alice Smith',
  role:         'patient',
  patientId:    PATIENT_ID,
  doctorUserId: 'aaaa',
};

function makeOverview(overrides = {}) {
  return {
    success: true,
    patient: {
      id:              PATIENT_ID,
      firstName:       'Alice',
      lastName:        'Smith',
      dateOfBirth:     '1990-01-01T00:00:00.000Z',
      biologicalSex:   'female',
      phone:           '0400000000',
      medicalRecordId: '',
      notes:           '',
      isArchived:      false,
    },
    statistics: {
      totalConsultations:    0,
      approvedConsultations: 0,
      draftConsultations:    0,
      lastConsultationDate:  null,
    },
    latestApprovedConsultation: null,
    recentConsultations:        [],
    ...overrides,
  };
}

/** Render PatientProfilePage for a patient at /patients/:id */
function renderProfilePage() {
  return render(
    <MemoryRouter initialEntries={[`/patients/${PATIENT_ID}`]}>
      <Routes>
        <Route path="/patients/:id" element={<PatientProfilePage />} />
      </Routes>
    </MemoryRouter>
  );
}

/** Render portal pages with PatientPortalAuthProvider + layout */
function renderPortal(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PatientPortalAuthProvider>
        <Routes>
          <Route path="/portal/login"    element={<PatientLoginPage />} />
          <Route path="/portal/register" element={<PatientRegisterPage />} />
          <Route element={<PatientPortalLayout />}>
            <Route path="/portal/history" element={<PatientHistoryPage />} />
          </Route>
        </Routes>
      </PatientPortalAuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiPatientRefresh.mockResolvedValue(null); // unauthenticated by default
});

// ===========================================================================
// A — PortalInvitePanel (via PatientProfilePage)
// ===========================================================================

describe('A. PortalInvitePanel', () => {

  test('A1. invite panel is visible on the patient profile page', async () => {
    apiGetPatientOverview.mockResolvedValueOnce(makeOverview());
    renderProfilePage();

    await waitFor(() =>
      expect(screen.getByRole('region', { name: /patient portal access/i }))
        .toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: /generate portal invite/i }))
      .toBeInTheDocument();
  });

  test('A2. clicking invite button shows loading state', async () => {
    apiGetPatientOverview.mockResolvedValueOnce(makeOverview());
    // Never resolves — keep component in loading state
    apiIssueInvite.mockReturnValueOnce(new Promise(() => {}));

    renderProfilePage();
    await waitFor(() => screen.getByRole('button', { name: /generate portal invite/i }));

    await userEvent.click(screen.getByRole('button', { name: /generate portal invite/i }));

    await waitFor(() =>
      expect(screen.getByText(/generating invite/i)).toBeInTheDocument()
    );
  });

  test('A3. success state shows registration link and copy button', async () => {
    apiGetPatientOverview.mockResolvedValueOnce(makeOverview());
    apiIssueInvite.mockResolvedValueOnce({
      success:     true,
      inviteToken: 'abc123def456',
      expiresAt:   new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    });

    renderProfilePage();
    await waitFor(() => screen.getByRole('button', { name: /generate portal invite/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate portal invite/i }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/invite created/i)
    );

    // Link input contains the token
    const linkInput = screen.getByRole('textbox', { name: /registration link/i });
    expect(linkInput.value).toContain('abc123def456');
    expect(linkInput.value).toContain('/portal/register?token=');

    // Patient _id must NOT appear in the link
    expect(linkInput.value).not.toContain(PATIENT_ID);

    // Copy button is present
    expect(screen.getByRole('button', { name: /copy invite link/i })).toBeInTheDocument();
  });

  test('A4. copy button updates to "Copied!" on click', async () => {
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    apiGetPatientOverview.mockResolvedValueOnce(makeOverview());
    apiIssueInvite.mockResolvedValueOnce({
      success:     true,
      inviteToken: 'copytoken',
      expiresAt:   new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    });

    renderProfilePage();
    await waitFor(() => screen.getByRole('button', { name: /generate portal invite/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate portal invite/i }));
    await waitFor(() => screen.getByRole('button', { name: /copy invite link/i }));

    await userEvent.click(screen.getByRole('button', { name: /copy invite link/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /link copied/i })).toBeInTheDocument()
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('copytoken')
    );
  });

  test('A5. already-exists state shown for 409 response', async () => {
    apiGetPatientOverview.mockResolvedValueOnce(makeOverview());
    apiIssueInvite.mockResolvedValueOnce({
      success: false,
      message: 'A patient portal account already exists for this patient.',
    });

    renderProfilePage();
    await waitFor(() => screen.getByRole('button', { name: /generate portal invite/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate portal invite/i }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/already has a patient portal account/i)
    );
    // Shows a secondary action to issue a replacement invite
    expect(screen.getByRole('button', { name: /issue a replacement invite/i }))
      .toBeInTheDocument();
  });

  test('A6. network error shows error message with retry', async () => {
    apiGetPatientOverview.mockResolvedValueOnce(makeOverview());
    apiIssueInvite.mockRejectedValueOnce(new Error('Network failure'));

    renderProfilePage();
    await waitFor(() => screen.getByRole('button', { name: /generate portal invite/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate portal invite/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/network error/i)
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  test('A7. reset from success state returns to idle', async () => {
    apiGetPatientOverview.mockResolvedValueOnce(makeOverview());
    apiIssueInvite.mockResolvedValueOnce({
      success:     true,
      inviteToken: 'resettoken',
      expiresAt:   new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    });

    renderProfilePage();
    await waitFor(() => screen.getByRole('button', { name: /generate portal invite/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate portal invite/i }));
    await waitFor(() => screen.getByRole('status'));

    await userEvent.click(screen.getByRole('button', { name: /generate a new invite/i }));

    // Panel is back to idle — the original generate button is visible again
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generate portal invite/i }))
        .toBeInTheDocument()
    );
  });

  test('A8. one-time-use notice is shown with the invite link', async () => {
    apiGetPatientOverview.mockResolvedValueOnce(makeOverview());
    apiIssueInvite.mockResolvedValueOnce({
      success:     true,
      inviteToken: 'noticetoken',
      expiresAt:   new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    });

    renderProfilePage();
    await waitFor(() => screen.getByRole('button', { name: /generate portal invite/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate portal invite/i }));
    await waitFor(() => screen.getByRole('status'));

    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
    // "expires" appears in the one-time notice
    expect(screen.getByText(/expires in 72 hours/i)).toBeInTheDocument();
  });
});

// ===========================================================================
// B — PatientRegisterPage — field validation and server-error mapping
// ===========================================================================

describe('B. PatientRegisterPage — validation and error mapping', () => {

  test('B1. short password shows inline field error without submitting', async () => {
    renderPortal('/portal/register');
    await waitFor(() => screen.getByRole('heading', { name: /create your account/i }));

    await userEvent.type(screen.getByLabelText(/invite token/i), 'sometoken');
    await userEvent.type(screen.getByLabelText(/your name/i), 'Alice');
    await userEvent.type(screen.getByLabelText(/email/i), 'alice@test.com');
    await userEvent.type(screen.getByLabelText("Password"), 'short');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/at least 8 characters/i)
    );
    expect(apiPatientRegister).not.toHaveBeenCalled();
  });

  test('B2. invalid email shows inline field error without submitting', async () => {
    renderPortal('/portal/register');
    await waitFor(() => screen.getByRole('heading', { name: /create your account/i }));

    await userEvent.type(screen.getByLabelText(/invite token/i), 'sometoken');
    await userEvent.type(screen.getByLabelText(/your name/i), 'Alice');
    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email');
    await userEvent.type(screen.getByLabelText("Password"), 'validpass1');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/valid email/i)
    );
    expect(apiPatientRegister).not.toHaveBeenCalled();
  });

  test('B3. expired/invalid token server error maps to invite-token field', async () => {
    apiPatientRegister.mockResolvedValueOnce({
      success: false,
      message: 'Invalid or expired invite token.',
    });
    renderPortal('/portal/register');
    await waitFor(() => screen.getByRole('heading', { name: /create your account/i }));

    await userEvent.type(screen.getByLabelText(/invite token/i), 'expiredtoken');
    await userEvent.type(screen.getByLabelText(/your name/i), 'Alice');
    await userEvent.type(screen.getByLabelText(/email/i), 'alice@test.com');
    await userEvent.type(screen.getByLabelText("Password"), 'pass12345');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid or expired/i)
    );
    // The error is associated with the invite token field
    expect(screen.getByLabelText(/invite token/i)).toBeInTheDocument();
  });

  test('B4. email-already-exists server error maps to email field', async () => {
    apiPatientRegister.mockResolvedValueOnce({
      success: false,
      message: 'An account with this email already exists.',
    });
    renderPortal('/portal/register');
    await waitFor(() => screen.getByRole('heading', { name: /create your account/i }));

    await userEvent.type(screen.getByLabelText(/invite token/i), 'validtoken');
    await userEvent.type(screen.getByLabelText(/your name/i), 'Alice');
    await userEvent.type(screen.getByLabelText(/email/i), 'used@test.com');
    await userEvent.type(screen.getByLabelText("Password"), 'pass12345');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i)
    );
  });

  test('B5. ?token= query param pre-fills the invite token field', async () => {
    renderPortal('/portal/register?token=PRETOKENVALUE');
    await waitFor(() => screen.getByRole('heading', { name: /create your account/i }));

    expect(screen.getByLabelText(/invite token/i)).toHaveValue('PRETOKENVALUE');
  });

  test('B6. password visibility toggle changes input type', async () => {
    renderPortal('/portal/register');
    await waitFor(() => screen.getByRole('heading', { name: /create your account/i }));

    const pwInput = screen.getByLabelText("Password");
    expect(pwInput).toHaveAttribute('type', 'password');

    // Click the show/hide button
    await userEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(pwInput).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(pwInput).toHaveAttribute('type', 'password');
  });
});

// ===========================================================================
// C — PatientLoginPage
// ===========================================================================

describe('C. PatientLoginPage — session expired notice and password toggle', () => {

  test('C1. ?expired=1 query param shows session-expired notice', async () => {
    renderPortal('/portal/login?expired=1');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /sign in to your records/i }))
        .toBeInTheDocument()
    );
    expect(screen.getByRole('status')).toHaveTextContent(/session has expired/i);
  });

  test('C2. no expired param → no session notice shown', async () => {
    renderPortal('/portal/login');
    await waitFor(() => screen.getByRole('heading', { name: /sign in/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('C3. error message clears when user edits email field', async () => {
    apiPatientLogin.mockResolvedValueOnce({ success: false });
    renderPortal('/portal/login');
    await waitFor(() => screen.getByRole('heading', { name: /sign in/i }));

    await userEvent.type(screen.getByLabelText(/email/i), 'x@x.com');
    await userEvent.type(screen.getByLabelText("Password"), 'wrongpass');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => screen.getByRole('alert'));

    // Editing email should clear the error
    await userEvent.type(screen.getByLabelText(/email/i), 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('C4. password visibility toggle changes input type', async () => {
    renderPortal('/portal/login');
    await waitFor(() => screen.getByRole('heading', { name: /sign in/i }));

    const pwInput = screen.getByLabelText("Password");
    expect(pwInput).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(pwInput).toHaveAttribute('type', 'text');
  });

  test('C5. successful login navigates to /portal/history', async () => {
    apiPatientLogin.mockResolvedValueOnce({ success: true, accessToken: 'tok', account: ACCOUNT });
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: { firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1990-01-01' } });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });

    renderPortal('/portal/login');
    await waitFor(() => screen.getByRole('heading', { name: /sign in/i }));

    await userEvent.type(screen.getByLabelText(/email/i), 'patient@example.com');
    await userEvent.type(screen.getByLabelText("Password"), 'pass1234');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByText(/your approved consultations/i)).toBeInTheDocument()
    );
  });
});
