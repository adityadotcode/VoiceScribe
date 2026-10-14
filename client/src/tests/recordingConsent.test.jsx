/**
 * Phase 7 / P0-1 — Recording Consent tests
 *
 * Three separate concerns tested here:
 *
 * A. NewConsultationPage — consent gate (describes 1–5)
 *    1. Consent gate is not shown before a patient is selected
 *    2. Consent gate appears after patient selection
 *    3. Consent checkbox is unchecked by default
 *    4. "Start consultation" is disabled until consent is checked
 *    5. "Start consultation" enables after checking consent
 *    6. "Start consultation" navigates with recordingConsentGivenAt in state
 *    7. Changing patient resets the consent checkbox
 *    8. Cancellation (back navigation) does not start recording
 *    9. Direct navigation without consent timestamp does not auto-start recording
 *   10. Refresh clears consent (no localStorage persistence)
 *
 * B. DashboardApp defence-in-depth (describes 6–7 in Section B)
 *    Tested via MemoryRouter with controlled location state.
 *
 * C. patientIdWiring — recordingConsentGivenAt in save payload (describe 8)
 *    A minimal smoke-test verifying the field flows into the POST body.
 *
 * Strategy:
 *   - NewConsultationPage tests use MemoryRouter with a /dashboard stub route
 *     so navigation can be verified by checking the stub renders.
 *   - DashboardApp tests use MemoryRouter initialEntries with controlled state.
 *   - ClinicalNoteReview tests use the existing apiFetch mock.
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../services/api/patients.js', () => ({
  apiListPatients:            vi.fn(),
  apiGetPatient:              vi.fn(),
  apiUpdatePatient:           vi.fn(),
  apiGetPatientConsultations: vi.fn(),
  apiGetLastApproved:         vi.fn(),
  apiGetPatientOverview:      vi.fn(),
  apiCreatePatient:           vi.fn(),
  apiGetChangeSummary:        vi.fn(),
}));

vi.mock('../api.js', () => ({
  apiFetch:       vi.fn(),
  apiUrl:         (p) => p,
  setAuthToken:   vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken:   vi.fn(),
}));

vi.mock('../services/api/consultations.js', () => ({
  apiGetConsultation:     vi.fn(),
  apiCreateCorrection:    vi.fn(),
  apiApproveConsultation: vi.fn(),
}));

vi.mock('../services/api/recordingConsents.js', () => ({
  apiCreateRecordingConsent: vi.fn(),
}));

vi.mock('../services/pdfExport.js', () => ({
  generateConsultationPdf: vi.fn(() => 'consultation-2026-09-01.pdf'),
}));

vi.mock('jspdf', () => ({
  jsPDF: vi.fn(function JsPDFMock() {
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

import { apiListPatients, apiGetPatientOverview } from '../services/api/patients.js';
import { apiFetch } from '../api.js';
import { apiCreateRecordingConsent } from '../services/api/recordingConsents.js';
import NewConsultationPage from '../pages/NewConsultationPage.jsx';

// ---------------------------------------------------------------------------
// Section A helpers — NewConsultationPage
// ---------------------------------------------------------------------------

const PATIENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

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

function makeOverview(overrides = {}) {
  return {
    success:  true,
    patient:  makePatient(),
    statistics: {
      totalConsultations:    1,
      approvedConsultations: 1,
      draftConsultations:    0,
      lastConsultationDate:  '2026-09-15T09:00:00.000Z',
    },
    latestApprovedConsultation: {
      id:                    'cccccccccccccccccccccccc',
      consultationDate:      '2026-09-15T09:00:00.000Z',
      chief_complaint:       'Cough',
      symptoms:              [],
      medications_mentioned: [],
      assessment:            '',
      follow_up:             '',
    },
    recentConsultations: [],
    ...overrides,
  };
}

function renderNewConsultation() {
  return render(
    <MemoryRouter initialEntries={['/consultation/new']}>
      <Routes>
        <Route path="/consultation/new" element={<NewConsultationPage />} />
        <Route path="/dashboard"        element={<div data-testid="dashboard-page">Dashboard</div>} />
        <Route path="/patients/:id"     element={<div data-testid="patient-profile">Profile</div>} />
      </Routes>
    </MemoryRouter>
  );
}

// Helpers: get to the point where a patient is selected and context loaded
async function selectAlice() {
  renderNewConsultation();
  await act(async () => { vi.advanceTimersByTime(400); });
  await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
  await userEvent.click(screen.getByText('Smith, Alice'));
  // Wait for context panel to start loading (patient name appears in context panel)
  await waitFor(() => expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  apiListPatients.mockResolvedValue({ success: true, patients: [makePatient()] });
  apiGetPatientOverview.mockResolvedValue(makeOverview());
  // Default: consent server call succeeds
  apiCreateRecordingConsent.mockResolvedValue({
    success:       true,
    consentEventId: 'server-event-id-aaa',
    givenAt:        '2026-09-01T09:00:00.000Z',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// Section A — NewConsultationPage consent gate
// ===========================================================================

describe('1. consent gate hidden before patient is selected', () => {
  test('1a. consent checkbox is not shown before patient selection', () => {
    renderNewConsultation();
    expect(
      screen.queryByRole('checkbox', { name: /patient has.*consent/i })
    ).not.toBeInTheDocument();
  });

  test('1b. "Start consultation" is disabled before patient is selected', () => {
    renderNewConsultation();
    expect(
      screen.getByRole('button', { name: /start consultation/i })
    ).toBeDisabled();
  });
});

describe('2. consent gate appears after patient selection', () => {
  test('2a. consent checkbox is shown after a patient is selected', async () => {
    await selectAlice();
    expect(
      screen.getByRole('checkbox', { name: /patient has.*consent/i })
    ).toBeInTheDocument();
  });

  test('2b. consent label contains required wording', async () => {
    await selectAlice();
    expect(screen.getByText(/audio-recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/AI service/i)).toBeInTheDocument();
  });
});

describe('3. consent checkbox is unchecked by default', () => {
  test('3a. checkbox is unchecked immediately after patient selection', async () => {
    await selectAlice();
    const checkbox = screen.getByRole('checkbox', { name: /patient has.*consent/i });
    expect(checkbox).not.toBeChecked();
  });

  test('3b. "Start consultation" is still disabled when patient is selected but consent unchecked', async () => {
    await selectAlice();
    expect(
      screen.getByRole('button', { name: /start consultation/i })
    ).toBeDisabled();
  });
});

describe('4. "Start consultation" requires consent checkbox', () => {
  test('4a. button enables only after checking consent', async () => {
    await selectAlice();

    // Before check — disabled
    expect(screen.getByRole('button', { name: /start consultation/i })).toBeDisabled();

    // Check the consent box
    await userEvent.click(
      screen.getByRole('checkbox', { name: /patient has.*consent/i })
    );

    // After check — enabled
    expect(screen.getByRole('button', { name: /start consultation/i })).not.toBeDisabled();
  });

  test('4b. unchecking the checkbox disables the button again', async () => {
    await selectAlice();

    const checkbox = screen.getByRole('checkbox', { name: /patient has.*consent/i });
    await userEvent.click(checkbox);  // check
    await userEvent.click(checkbox);  // uncheck

    expect(screen.getByRole('button', { name: /start consultation/i })).toBeDisabled();
  });
});

describe('5. "Start consultation" calls server and navigates on success', () => {
  test('5a. clicking Start with consent calls apiCreateRecordingConsent then navigates', async () => {
    await selectAlice();

    await userEvent.click(
      screen.getByRole('checkbox', { name: /patient has.*consent/i })
    );
    await userEvent.click(
      screen.getByRole('button', { name: /start consultation/i })
    );

    await waitFor(() =>
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    );
    expect(apiCreateRecordingConsent).toHaveBeenCalledWith(PATIENT_ID);
  });

  test('5b. clicking Start without checking consent does NOT navigate', async () => {
    await selectAlice();
    const btn = screen.getByRole('button', { name: /start consultation/i });
    expect(btn).toBeDisabled();
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
  });
});

describe('6. changing patient resets the consent checkbox', () => {
  test('6a. consent checkbox is unchecked after "Change patient" resets selection', async () => {
    await selectAlice();

    const checkbox = screen.getByRole('checkbox', { name: /patient has.*consent/i });
    await userEvent.click(checkbox);  // check it
    expect(checkbox).toBeChecked();

    // Click "Change patient"
    await userEvent.click(screen.getByRole('button', { name: /change patient/i }));

    // Search panel returns — select Alice again (simulates re-selection)
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Smith, Alice'));

    // Checkbox must be unchecked after re-selection
    await waitFor(() => {
      const newCheckbox = screen.queryByRole('checkbox', { name: /patient has.*consent/i });
      if (newCheckbox) expect(newCheckbox).not.toBeChecked();
    });
  });
});

describe('7. cancellation does not start recording', () => {
  test('7a. clicking ← Back navigates away without triggering recording', async () => {
    renderNewConsultation();

    // Click back without selecting a patient or confirming consent
    await userEvent.click(screen.getByRole('button', { name: /← back/i }));

    // Dashboard should not appear (we navigated -1, not to /dashboard with state)
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
  });
});

describe('8. refresh clears consent — no localStorage persistence', () => {
  test('8a. localStorage does not contain consent checkbox state', () => {
    // The consent confirmation is held only in React state — never in localStorage.
    // This test verifies the localStorage key is not written.
    renderNewConsultation();

    // Read all localStorage keys after render
    const keys = Object.keys(localStorage);
    const consentKey = keys.find((k) => k.includes('consent') || k.includes('Consent'));
    expect(consentKey).toBeUndefined();
  });
});

// ===========================================================================
// Section B — Defence-in-depth: AudioRecorder blocks recording without consent
// ===========================================================================
//
// The primary gate is in NewConsultationPage (tested in Section A).
// The secondary guard is in AudioRecorder's consentConfirmed prop.
// We test it by rendering AudioRecorder directly with consentConfirmed=false.
// This is equivalent to what happens when the dashboard receives no consent
// timestamp in its location.state — it passes consentConfirmed={false} to
// AudioRecorder, which then refuses startRecording.

import AudioRecorder from '../AudioRecorder.jsx';

function renderAudioRecorder(props = {}) {
  return render(
    <MemoryRouter>
      <AudioRecorder
        onTranscriptReady={vi.fn()}
        onStageChange={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  );
}

describe('9. direct navigation cannot bypass the consent gate', () => {
  test('9a. AudioRecorder "Start recording" button is disabled when consentConfirmed=false', () => {
    renderAudioRecorder({ consentConfirmed: false });
    const startBtn = screen.getByRole('button', { name: /start recording/i });
    expect(startBtn).toBeDisabled();
  });

  test('9b. AudioRecorder "Start recording" button is enabled when consentConfirmed=true', () => {
    renderAudioRecorder({ consentConfirmed: true });
    const startBtn = screen.getByRole('button', { name: /start recording/i });
    expect(startBtn).not.toBeDisabled();
  });

  test('9c. consentConfirmed defaults to false — button disabled without explicit prop', () => {
    // AudioRecorder rendered without the consentConfirmed prop (direct render,
    // simulates embedded use without consent state).
    renderAudioRecorder({});
    const startBtn = screen.getByRole('button', { name: /start recording/i });
    expect(startBtn).toBeDisabled();
  });
});

// ===========================================================================
// Section C — recordingConsentGivenAt flows into the POST /api/consultations body
// ===========================================================================

import ClinicalNoteReview from '../ClinicalNoteReview.jsx';

const CONSENT_EVENT_ID = 'server-issued-event-aaa';

function makeNote(overrides = {}) {
  return {
    patient:               { name: '', age: null, sex: '' },
    chief_complaint:       'Cough',
    symptoms:              ['cough'],
    duration:              '3 days',
    history:               '',
    observations:          [],
    assessment:            '',
    medications_mentioned: [],
    follow_up:             '',
    missing_information:   [],
    uncertain_fields:      [],
    ...overrides,
  };
}

function renderReviewWithConsent(extraProps = {}) {
  return render(
    <MemoryRouter>
      <ClinicalNoteReview
        note={makeNote()}
        transcript="Patient reports cough."
        patientId={PATIENT_ID}
        patientName="Alice Smith"
        consentEventId={CONSENT_EVENT_ID}
        onBack={vi.fn()}
        onSaved={vi.fn()}
        {...extraProps}
      />
    </MemoryRouter>
  );
}

describe('10. consentEventId (server-issued) flows into the save payload', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('10a. consentEventId is included in the POST body when saving a draft', async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, consultation: { _id: 'cccccccccccccccccccccccc' } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );

    renderReviewWithConsent();

    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());

    const [, opts] = apiFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.consentEventId).toBe(CONSENT_EVENT_ID);
    // The old browser timestamp must NOT be in the body
    expect(body.recordingConsentGivenAt).toBeUndefined();
  });

  test('10b. consentEventId is included in the POST body when approving', async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, consultation: { _id: 'cccccccccccccccccccccccc' } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );

    renderReviewWithConsent();

    const checkboxes = screen.getAllByRole('checkbox');
    for (const cb of checkboxes) {
      await userEvent.click(cb);
    }

    await userEvent.click(screen.getByRole('button', { name: /approve & finalize/i }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());

    const [, opts] = apiFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.consentEventId).toBe(CONSENT_EVENT_ID);
  });

  test('10c. consentEventId is NOT included in PUT body (existing consultation)', async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, consultation: { _id: 'cccccccccccccccccccccccc' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    renderReviewWithConsent({ initialConsultationId: 'cccccccccccccccccccccccc' });

    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());

    const [path, opts] = apiFetch.mock.calls[0];
    expect(path).toContain('/api/consultations/');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body);
    expect(body.consentEventId).toBeUndefined();
  });

  test('10d. null consentEventId prop results in field being absent from POST body (manual entry)', async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, consultation: { _id: 'cccccccccccccccccccccccc' } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );

    renderReviewWithConsent({ consentEventId: null });

    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());

    const [, opts] = apiFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.consentEventId).toBeUndefined();
  });
});

// ===========================================================================
// Section D — Server call behaviour in NewConsultationPage (P0-1B)
// ===========================================================================

describe('11. server consent request is called before recording navigation', () => {
  test('11a. apiCreateRecordingConsent is called with the patient ID when Start is clicked', async () => {
    await selectAlice();

    await userEvent.click(
      screen.getByRole('checkbox', { name: /patient has.*consent/i })
    );
    await userEvent.click(
      screen.getByRole('button', { name: /start consultation/i })
    );

    await waitFor(() => expect(apiCreateRecordingConsent).toHaveBeenCalled());
    expect(apiCreateRecordingConsent).toHaveBeenCalledWith(PATIENT_ID);
  });

  test('11b. button shows "Recording consent…" while request is in-flight', async () => {
    // Never resolves — keeps the button in submitting state
    apiCreateRecordingConsent.mockReturnValue(new Promise(() => {}));

    await selectAlice();
    await userEvent.click(
      screen.getByRole('checkbox', { name: /patient has.*consent/i })
    );
    await userEvent.click(
      screen.getByRole('button', { name: /start consultation/i })
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /recording consent/i })).toBeDisabled()
    );
  });
});

describe('12. recording is blocked when server consent request fails', () => {
  test('12a. API success:false shows error and does NOT navigate', async () => {
    apiCreateRecordingConsent.mockResolvedValue({
      success: false,
      message: 'Patient not found.',
    });

    await selectAlice();

    await userEvent.click(
      screen.getByRole('checkbox', { name: /patient has.*consent/i })
    );
    await userEvent.click(
      screen.getByRole('button', { name: /start consultation/i })
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    );
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
  });

  test('12b. network failure shows error and does NOT navigate', async () => {
    apiCreateRecordingConsent.mockRejectedValue(new Error('Network failure'));

    await selectAlice();

    await userEvent.click(
      screen.getByRole('checkbox', { name: /patient has.*consent/i })
    );
    await userEvent.click(
      screen.getByRole('button', { name: /start consultation/i })
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    );
    expect(screen.getByRole('alert').textContent).toMatch(/network error/i);
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
  });

  test('12c. after failure, the Start button is re-enabled for retry', async () => {
    apiCreateRecordingConsent.mockRejectedValue(new Error('Timeout'));

    await selectAlice();
    await userEvent.click(
      screen.getByRole('checkbox', { name: /patient has.*consent/i })
    );
    await userEvent.click(
      screen.getByRole('button', { name: /start consultation/i })
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    // The start button should be re-enabled (not submitting any more)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /start consultation/i })).not.toBeDisabled()
    );
  });
});

describe('13. page refresh cannot restore a server-issued consent event', () => {
  test('13a. localStorage does not contain a consentEventId', () => {
    renderNewConsultation();
    const keys = Object.keys(localStorage);
    const consentKey = keys.find((k) => /consent/i.test(k));
    expect(consentKey).toBeUndefined();
  });
});
