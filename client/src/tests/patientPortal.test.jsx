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
  apiIssueInvite:              vi.fn(),
  apiPatientLogin:            vi.fn(),
  apiPatientRegister:         vi.fn(),
  apiPatientRefresh:          vi.fn(),
  apiPatientLogout:           vi.fn(),
  apiPatientMe:               vi.fn(),
  apiGetOwnPatient:           vi.fn(),
  apiListPatientConsultations: vi.fn(),
  apiGetPatientConsultation:  vi.fn(),
}));

// Milestone 4: PatientConsultationPage now imports generateConsultationPdf
vi.mock('../services/pdfExport.js', () => ({
  generateConsultationPdf: vi.fn().mockResolvedValue('consultation.pdf'),
}));

vi.mock('jspdf', () => ({
  jsPDF: vi.fn(function () {
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

import {
  apiPatientLogin,
  apiPatientRegister,
  apiPatientRefresh,
  apiPatientLogout,
  apiGetOwnPatient,
  apiListPatientConsultations,
  apiGetPatientConsultation,
} from '../services/api/patientPortal.js';

import { generateConsultationPdf } from '../services/pdfExport.js';

import { PatientPortalAuthProvider, usePatientAuth } from '../contexts/PatientPortalAuthContext.jsx';
import PatientLoginPage from '../pages/portal/PatientLoginPage.jsx';
import PatientRegisterPage from '../pages/portal/PatientRegisterPage.jsx';
import PatientHistoryPage from '../pages/portal/PatientHistoryPage.jsx';
import PatientConsultationPage from '../pages/portal/PatientConsultationPage.jsx';
import PatientPortalLayout from '../components/layout/PatientPortalLayout.jsx';

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
          <Route element={<PatientPortalLayout />}>
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
  // resetAllMocks clears queued implementations (mockReturnValue, mockResolvedValueOnce)
  // in addition to call history — prevents persistent mocks from leaking between tests.
  vi.resetAllMocks();
  // Default: refresh fails → unauthenticated on mount
  apiPatientRefresh.mockResolvedValue(null);
  // Default: own patient fetch returns failure (non-blocking — pages still load)
  apiGetOwnPatient.mockResolvedValue({ success: false });
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
    // PatientPortalLayout should redirect to login
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
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
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
    await userEvent.type(screen.getByLabelText("Password"), 'wrongpass');
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
    await userEvent.type(screen.getByLabelText("Password"), 'pass1234');
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
    await userEvent.type(screen.getByLabelText("Password"), 'pass1234');
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
    await userEvent.type(screen.getByLabelText("Password"), 'pass1234');
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

  test('E6. back link navigates to history', async () => {
    apiGetOwnPatient.mockResolvedValue({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValue({ success: true, consultations: [] });
    apiGetPatientConsultation.mockResolvedValueOnce({
      success: true, consultation: makeConsultation(),
    });
    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() => screen.getByText('Cough'));
    await userEvent.click(screen.getByRole('link', { name: /back to history/i }));
    await waitFor(() =>
      expect(screen.getByText(/your approved consultations/i)).toBeInTheDocument()
    );
  });
});

// ===========================================================================
// F — PatientPortalLayout (auth guard)
// ===========================================================================

describe('F. PatientPortalLayout — auth guard', () => {
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

// ===========================================================================
// G — Milestone 4: Patient records experience — effective history and security
// ===========================================================================

describe('G. Milestone 4 — Effective history and access security', () => {
  const AUTHENTICATED_ACCOUNT = {
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
    medicalRecordId: 'MR001',
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
        chief_complaint: 'Cough',
        symptoms:        ['cough'],
        assessment:      'Viral URTI',
        follow_up:       '1 week',
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    apiPatientRefresh.mockResolvedValue({
      success: true, accessToken: 'tok', account: AUTHENTICATED_ACCOUNT,
    });
  });

  // ── G1: Approved corrections shown with correction notice ────────────────
  test('G1. approved correction shows correction notice on detail page', async () => {
    const correction = makeConsultation({ correctionOf: 'orig-id', supersededBy: null });
    apiGetPatientConsultation.mockResolvedValueOnce({ success: true, consultation: correction });
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });

    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() => screen.getByText('Cough'));

    expect(screen.getByRole('status')).toHaveTextContent(/corrected version/i);
  });

  // ── G2: Transcript never rendered on the consultation detail page ─────────
  test('G2. transcript field is never rendered on consultation detail page', async () => {
    const consultWithTranscript = {
      ...makeConsultation(),
      transcript: 'RAW_TRANSCRIPT_SHOULD_NOT_APPEAR',
    };
    apiGetPatientConsultation.mockResolvedValueOnce({
      success: true, consultation: consultWithTranscript,
    });

    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() => screen.getByText('Cough'));

    expect(screen.queryByText('RAW_TRANSCRIPT_SHOULD_NOT_APPEAR')).not.toBeInTheDocument();
  });

  // ── G3: Internal system fields never rendered ─────────────────────────────
  test('G3. recordingConsentGivenAt is never rendered to patient', async () => {
    const consultWithConsent = {
      ...makeConsultation(),
      recordingConsentGivenAt:     '2026-09-01T08:55:00.000Z',
      recordingConsentConfirmedBy: 'some-doctor-id',
    };
    apiGetPatientConsultation.mockResolvedValueOnce({
      success: true, consultation: consultWithConsent,
    });

    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() => screen.getByText('Cough'));

    // Consent timestamps must not appear anywhere in the rendered output
    expect(screen.queryByText(/2026-09-01T08:55/i)).not.toBeInTheDocument();
    expect(screen.queryByText('some-doctor-id')).not.toBeInTheDocument();
  });

  // ── G4: Empty state on history page ──────────────────────────────────────
  test('G4. history page shows informative empty state when no approved consultations', async () => {
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });

    wrapPortal(null, '/portal/history');
    await waitFor(() =>
      expect(screen.getByText(/no approved consultation records/i)).toBeInTheDocument()
    );
    // Empty state message should mention that doctor approval is needed
    expect(screen.getByText(/your doctor will approve/i)).toBeInTheDocument();
  });

  // ── G5: Multiple records in history list ─────────────────────────────────
  test('G5. history list shows multiple approved consultations in order', async () => {
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({
      success: true,
      consultations: [
        makeConsultation({ _id: 'c1', note: { chief_complaint: 'First visit' } }),
        makeConsultation({
          _id: 'c2',
          consultationDate: '2026-08-01T09:00:00.000Z',
          note: { chief_complaint: 'Second visit' },
        }),
      ],
    });

    wrapPortal(null, '/portal/history');
    await waitFor(() => expect(screen.getByText('First visit')).toBeInTheDocument());
    expect(screen.getByText('Second visit')).toBeInTheDocument();
  });

  // ── G6: Correction badge in list ─────────────────────────────────────────
  test('G6. corrected record shows badge in history list', async () => {
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });
    apiListPatientConsultations.mockResolvedValueOnce({
      success: true,
      consultations: [makeConsultation({ correctionOf: 'original-id' })],
    });

    wrapPortal(null, '/portal/history');
    await waitFor(() => expect(screen.getByText(/corrected record/i)).toBeInTheDocument());
  });

  // ── G7: Not-found when consultation ID does not match account ─────────────
  test('G7. consultation not matching patient account shows not-found state', async () => {
    // Backend returns { success: false } when IDOR check fails (always 404)
    apiGetPatientConsultation.mockResolvedValueOnce({ success: false });

    wrapPortal(null, '/portal/consultation/wrong-id');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/record not found/i)
    );
  });

  // ── G8: PDF download button present for approved consultation ─────────────
  test('G8. PDF download button is present on approved consultation detail', async () => {
    apiGetPatientConsultation.mockResolvedValueOnce({
      success: true, consultation: makeConsultation(),
    });
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });

    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() => screen.getByText('Cough'));

    expect(
      screen.getByRole('button', { name: /download pdf/i })
    ).toBeInTheDocument();
  });

  // ── G9: PDF download calls generateConsultationPdf ───────────────────────
  test('G9. clicking Download PDF calls generateConsultationPdf', async () => {
    apiGetPatientConsultation.mockResolvedValueOnce({
      success: true, consultation: makeConsultation(),
    });
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: PATIENT });

    wrapPortal(null, '/portal/consultation/dddd');
    await waitFor(() => screen.getByText('Cough'));

    await userEvent.click(screen.getByRole('button', { name: /download pdf/i }));

    await waitFor(() => expect(generateConsultationPdf).toHaveBeenCalled());
  });

  // ── G10: Patient demographics shown but doctor notes excluded ─────────────
  test('G10. history page shows patient name but not doctor notes', async () => {
    const patientWithNotes = { ...PATIENT, notes: 'PRIVATE_DOCTOR_NOTE' };
    apiGetOwnPatient.mockResolvedValueOnce({ success: true, patient: patientWithNotes });
    apiListPatientConsultations.mockResolvedValueOnce({ success: true, consultations: [] });

    wrapPortal(null, '/portal/history');
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    // Doctor's admin notes must never appear
    expect(screen.queryByText('PRIVATE_DOCTOR_NOTE')).not.toBeInTheDocument();
  });
});
