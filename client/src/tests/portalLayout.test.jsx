/**
 * Milestone 1 — PatientPortalLayout tests  (portalLayout.test.jsx)
 *
 * Tests the shared portal layout component:
 *   A. Auth guard behaviour (redirect, spinner)
 *   B. Header content (branding, nav, patient name, logout)
 *   C. Logout flow — calls logout(), navigates to /portal/login
 *   D. Session restore spinner visible while isLoading
 *   E. Layout renders Outlet children correctly
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

import {
  apiPatientRefresh,
  apiPatientLogout,
  apiGetOwnPatient,
  apiListPatientConsultations,
} from '../services/api/patientPortal.js';

import PatientPortalLayout     from '../components/layout/PatientPortalLayout.jsx';
import PatientLoginPage        from '../pages/portal/PatientLoginPage.jsx';
import PatientHistoryPage      from '../pages/portal/PatientHistoryPage.jsx';
import { PatientPortalAuthProvider } from '../contexts/PatientPortalAuthContext.jsx';

// ---------------------------------------------------------------------------
// Fixtures
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
  firstName:   'Alice',
  lastName:    'Smith',
  dateOfBirth: '1990-01-01T00:00:00.000Z',
};

function renderLayout(initialPath = '/portal/history') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PatientPortalAuthProvider>
        <Routes>
          <Route path="/portal/login" element={<PatientLoginPage />} />
          <Route element={<PatientPortalLayout />}>
            <Route
              path="/portal/history"
              element={<PatientHistoryPage />}
            />
            <Route
              path="/portal/protected"
              element={<div data-testid="protected-content">Protected page</div>}
            />
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
// A — Auth guard
// ===========================================================================

describe('A. Auth guard', () => {
  test('A1. unauthenticated access redirects to /portal/login', async () => {
    apiPatientRefresh.mockResolvedValueOnce(null);
    renderLayout('/portal/history');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /sign in to your records/i }))
        .toBeInTheDocument()
    );
    // No portal nav rendered — user is on the login page
    expect(screen.queryByRole('navigation', { name: /portal navigation/i }))
      .not.toBeInTheDocument();
  });

  test('A2. authenticated access renders portal layout', async () => {
    apiPatientRefresh.mockResolvedValueOnce({ success: true, accessToken: 'tok', account: ACCOUNT });
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });

    renderLayout('/portal/history');

    await waitFor(() =>
      expect(screen.getByRole('banner')).toBeInTheDocument()
    );
    // Child route renders
    await waitFor(() =>
      expect(screen.getByText(/your approved consultations/i)).toBeInTheDocument()
    );
  });
});

// ===========================================================================
// B — Header content
// ===========================================================================

describe('B. Header content', () => {
  beforeEach(() => {
    apiPatientRefresh.mockResolvedValue({ success: true, accessToken: 'tok', account: ACCOUNT });
    apiGetOwnPatient.mockResolvedValue({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValue({ success: true, consultations: [] });
  });

  test('B1. VoiceScribe branding visible in header', async () => {
    renderLayout('/portal/history');
    await waitFor(() => screen.getByRole('banner'));

    const header = screen.getByRole('banner');
    expect(header).toHaveTextContent('VoiceScribe');
  });

  test('B2. "My records" navigation link present', async () => {
    renderLayout('/portal/history');
    await waitFor(() => screen.getByRole('banner'));

    expect(
      screen.getByRole('link', { name: /my records/i })
    ).toBeInTheDocument();
  });

  test('B3. patient display name shown in header', async () => {
    renderLayout('/portal/history');
    await waitFor(() => screen.getByRole('banner'));

    // Account displayName from context
    const header = screen.getByRole('banner');
    expect(header).toHaveTextContent('Alice Smith');
  });

  test('B4. Sign out button present in header', async () => {
    renderLayout('/portal/history');
    await waitFor(() => screen.getByRole('banner'));

    expect(
      screen.getByRole('button', { name: /sign out/i })
    ).toBeInTheDocument();
  });
});

// ===========================================================================
// C — Logout flow
// ===========================================================================

describe('C. Logout flow', () => {
  test('C1. clicking Sign out calls logout and navigates to /portal/login', async () => {
    apiPatientRefresh.mockResolvedValueOnce({ success: true, accessToken: 'tok', account: ACCOUNT });
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });
    apiPatientLogout.mockResolvedValueOnce(undefined);

    renderLayout('/portal/history');
    await waitFor(() => screen.getByRole('button', { name: /sign out/i }));

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    // After logout, user lands on the login page
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /sign in to your records/i }))
        .toBeInTheDocument()
    );
    expect(apiPatientLogout).toHaveBeenCalled();
  });

  test('C2. logout clears authentication — protected page no longer accessible', async () => {
    apiPatientRefresh.mockResolvedValueOnce({ success: true, accessToken: 'tok', account: ACCOUNT });
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });
    apiPatientLogout.mockResolvedValueOnce(undefined);
    // After logout, next refresh attempt fails
    apiPatientRefresh.mockResolvedValue(null);

    renderLayout('/portal/history');
    await waitFor(() => screen.getByRole('button', { name: /sign out/i }));
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() =>
      expect(screen.queryByText(/your approved consultations/i)).not.toBeInTheDocument()
    );
  });
});

// ===========================================================================
// D — Session restore spinner
// ===========================================================================

describe('D. Session restore spinner', () => {
  test('D1. spinner shown while refresh is in-flight', async () => {
    // Never resolves — holds isLoading=true indefinitely
    apiPatientRefresh.mockReturnValueOnce(new Promise(() => {}));

    renderLayout('/portal/history');

    // The layout should show a loading/spinner indicator before redirect
    await waitFor(() =>
      expect(screen.getByRole('status', { name: /restoring session/i }))
        .toBeInTheDocument()
    );
  });
});

// ===========================================================================
// E — Outlet / child rendering
// ===========================================================================

describe('E. Outlet renders child routes', () => {
  test('E1. child route content is rendered inside layout', async () => {
    apiPatientRefresh.mockResolvedValueOnce({ success: true, accessToken: 'tok', account: ACCOUNT });

    renderLayout('/portal/protected');

    await waitFor(() =>
      expect(screen.getByTestId('protected-content')).toBeInTheDocument()
    );
    // Layout header still rendered alongside child
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});
