/**
 * Phase 5A — NewConsultationPage tests (rich pre-consultation context)
 *
 * The page now calls GET /api/patients/:id/overview (apiGetPatientOverview)
 * instead of the old apiGetLastApproved call. All existing scenarios are
 * preserved and new Phase 5A scenarios are added.
 *
 * Scenarios (14):
 *   1a. Patient search — initial load
 *   1b. Patient search — typing triggers new call
 *   2.  Patient selection
 *   3a-d. Selected patient display (name, change btn, MR, reset)
 *   4a-d. Patient context loads — clinical fields rendered
 *   5.  No previous approved consultation empty state
 *   6a-b. Start button disabled/enabled
 *   [NEW] 7a. Patient context loading state
 *   [NEW] 7b. Patient context error state
 *   [NEW] 7c. Statistics rendered
 *   [NEW] 7d. "View full patient profile" link present
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../services/api/patients.js', () => ({
  apiListPatients:             vi.fn(),
  apiGetPatient:               vi.fn(),
  apiUpdatePatient:            vi.fn(),
  apiGetPatientConsultations:  vi.fn(),
  apiGetLastApproved:          vi.fn(),   // kept for mock completeness
  apiGetPatientOverview:       vi.fn(),   // Phase 5A
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

import {
  apiListPatients,
  apiGetPatientOverview,
  apiGetChangeSummary,
} from '../services/api/patients.js';

import NewConsultationPage from '../pages/NewConsultationPage.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PATIENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function renderPage() {
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
    success: true,
    patient: makePatient(),
    statistics: {
      totalConsultations:    3,
      approvedConsultations: 2,
      draftConsultations:    1,
      lastConsultationDate:  '2026-09-15T09:00:00.000Z',
    },
    latestApprovedConsultation: {
      id:                    'cccccccccccccccccccccccc',
      consultationDate:      '2026-08-20T09:00:00.000Z',
      chief_complaint:       'Persistent cough',
      symptoms:              ['cough', 'fatigue'],
      medications_mentioned: ['paracetamol'],
      assessment:            'Likely viral URTI',
      follow_up:             'Return in 1 week if not improved',
    },
    recentConsultations: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  apiListPatients.mockResolvedValue({ success: true, patients: [makePatient()] });
  apiGetPatientOverview.mockResolvedValue(makeOverview());
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helper: get to selected-patient + context-loaded state
// ---------------------------------------------------------------------------
async function selectAliceAndWaitForContext() {
  renderPage();
  await act(async () => { vi.advanceTimersByTime(400); });
  await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
  await userEvent.click(screen.getByText('Smith, Alice'));
  await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());
}

// ---------------------------------------------------------------------------
// 1 — Patient search
// ---------------------------------------------------------------------------
describe('1. patient search', () => {
  test('initial load fetches patients and renders result rows', async () => {
    renderPage();
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => {
      expect(screen.getByText('Smith, Alice')).toBeInTheDocument();
    });
    expect(apiListPatients).toHaveBeenCalledWith({ search: '' });
  });

  test('typing in the search box triggers a new API call', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    renderPage();
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());

    const input = screen.getByRole('searchbox', { name: /search patients/i });
    await user.clear(input);
    await user.type(input, 'ali');
    await act(async () => { vi.advanceTimersByTime(400); });

    await waitFor(() => {
      expect(apiListPatients).toHaveBeenCalledWith({ search: 'ali' });
    });
  });
});

// ---------------------------------------------------------------------------
// 2 — Patient selection
// ---------------------------------------------------------------------------
describe('2. patient selection', () => {
  test('clicking a result row selects the patient and hides the search panel', async () => {
    renderPage();
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Smith, Alice'));

    await waitFor(() => {
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
      expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 3 — Selected patient display
// ---------------------------------------------------------------------------
describe('3. selected patient display', () => {
  async function selectAlice() {
    renderPage();
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Smith, Alice'));
    await waitFor(() => expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0));
  }

  test('shows patient name', async () => {
    await selectAlice();
    expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0);
  });

  test('shows "Change patient" button', async () => {
    await selectAlice();
    expect(screen.getByRole('button', { name: /change patient/i })).toBeInTheDocument();
  });

  test('shows medical record ID in context panel', async () => {
    await selectAlice();
    await waitFor(() => {
      expect(screen.getByText(/MR001/)).toBeInTheDocument();
    });
  });

  test('"Change patient" resets to search panel', async () => {
    await selectAlice();
    await userEvent.click(screen.getByRole('button', { name: /change patient/i }));
    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: /search patients/i })).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 4 — Patient context loaded — clinical fields rendered
// ---------------------------------------------------------------------------
describe('4. last-approved context displayed', () => {
  test('chief complaint is shown', async () => {
    await selectAliceAndWaitForContext();
    expect(screen.getByText('Persistent cough')).toBeInTheDocument();
  });

  test('assessment is shown', async () => {
    await selectAliceAndWaitForContext();
    expect(screen.getByText('Likely viral URTI')).toBeInTheDocument();
  });

  test('follow-up is shown', async () => {
    await selectAliceAndWaitForContext();
    expect(screen.getByText('Return in 1 week if not improved')).toBeInTheDocument();
  });

  test('calls apiGetPatientOverview with the correct patient ID', async () => {
    await selectAliceAndWaitForContext();
    expect(apiGetPatientOverview).toHaveBeenCalledWith(PATIENT_ID);
  });
});

// ---------------------------------------------------------------------------
// 5 — No previous approved consultation
// ---------------------------------------------------------------------------
describe('5. no previous consultation state', () => {
  test('shows "No previous approved consultation." when null', async () => {
    apiGetPatientOverview.mockResolvedValue(
      makeOverview({ latestApprovedConsultation: null })
    );

    renderPage();
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Smith, Alice'));

    await waitFor(() => {
      expect(screen.getByText('No previous approved consultation.')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 6 — Start button state
// ---------------------------------------------------------------------------
describe('6. Start button disabled before selection, enabled after', () => {
  test('Start button is disabled when no patient is selected', async () => {
    renderPage();
    await act(async () => { vi.advanceTimersByTime(400); });
    const btn = screen.getByRole('button', { name: /start consultation/i });
    expect(btn).toBeDisabled();
  });

  test('Start button is enabled after a patient is selected', async () => {
    renderPage();
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Smith, Alice'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start consultation/i })).not.toBeDisabled();
    });
  });
});

// ---------------------------------------------------------------------------
// 7 — Phase 5A new scenarios
// ---------------------------------------------------------------------------
describe('7. Phase 5A rich context panel', () => {
  test('7a. context loading state shown while overview is in-flight', async () => {
    apiGetPatientOverview.mockReturnValue(new Promise(() => {}));

    renderPage();
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Smith, Alice'));

    await waitFor(() => {
      expect(screen.getByText('Loading patient context…')).toBeInTheDocument();
    });
  });

  test('7b. context error state shown when overview fails', async () => {
    apiGetPatientOverview.mockRejectedValue(new Error('Network failure'));

    renderPage();
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Smith, Alice'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  test('7c. statistics are rendered (total, approved, draft, last visit)', async () => {
    await selectAliceAndWaitForContext();
    expect(screen.getByText('3')).toBeInTheDocument();   // total
    expect(screen.getByText('2')).toBeInTheDocument();   // approved
    expect(screen.getByText('1')).toBeInTheDocument();   // draft
    expect(screen.getByText('Total visits')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Last visit')).toBeInTheDocument();
  });

  test('7d. "View full patient profile" link is present and points to /patients/:id', async () => {
    await selectAliceAndWaitForContext();
    const link = screen.getByRole('link', { name: /view full patient profile/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', `/patients/${PATIENT_ID}`);
  });
});

// ===========================================================================
// Phase 6A — What Changed Since Last Visit?  (newConsultation.test.jsx)
// ===========================================================================
//
// Tests that the "What changed since last visit?" feature is exposed in the
// pre-consultation context panel (PatientContextPanel inside NewConsultationPage).
//
// Strategy:
//   - Uses selectAliceAndWaitForContext() from above to reach the loaded state.
//   - apiGetChangeSummary is mocked per test; the panel itself is validated
//     via the existing ChangeSummaryPanel selectors.
//
// ---------------------------------------------------------------------------

const CONSULT_ID = 'cccccccccccccccccccccccc'; // matches makeOverview latestApprovedConsultation.id

const noPreviousChangeSummary = {
  success: true,
  hasPreviousConsultation: false,
  previousConsultation: null,
  structuredDiff: null,
};

function makeChangeSummary(diffOverrides = {}) {
  return {
    success: true,
    hasPreviousConsultation: true,
    previousConsultation: {
      id:               'bbbbbbbbbbbbbbbbbbbbbbbb',
      consultationDate: '2026-07-01T09:00:00.000Z',
    },
    structuredDiff: {
      newSymptoms:                 [],
      resolvedSymptoms:            [],
      persistingSymptoms:          [],
      newMedicationsMentioned:     [],
      stoppedMedicationsMentioned: [],
      newObservations:             [],
      resolvedObservations:        [],
      assessmentChanged:           false,
      chiefComplaintChanged:       false,
      followUpChanged:             false,
      historyChanged:              false,
      ...diffOverrides,
    },
  };
}

// ---------------------------------------------------------------------------
// 8 — "What changed since last visit?" section in pre-consultation context
// ---------------------------------------------------------------------------
describe('8. Phase 6A — change summary in pre-consultation context', () => {
  test('8a. "What changed since last visit?" heading is shown in the context panel', async () => {
    await selectAliceAndWaitForContext();

    expect(
      screen.getByRole('heading', { name: /what changed since last visit/i })
    ).toBeInTheDocument();
  });

  test('8b. "Compare with previous visit" trigger button is shown inside the context panel', async () => {
    await selectAliceAndWaitForContext();

    expect(
      screen.getByRole('button', { name: /compare with previous visit/i })
    ).toBeInTheDocument();
  });

  test('8c. apiGetChangeSummary is NOT called automatically on patient selection', async () => {
    await selectAliceAndWaitForContext();

    expect(apiGetChangeSummary).not.toHaveBeenCalled();
  });

  test('8d. "Compare with previous visit" calls apiGetChangeSummary with correct IDs', async () => {
    apiGetChangeSummary.mockResolvedValue(noPreviousChangeSummary);
    await selectAliceAndWaitForContext();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() =>
      expect(apiGetChangeSummary).toHaveBeenCalledWith(PATIENT_ID, CONSULT_ID, false)
    );
  });

  test('8e. comparison section is NOT shown when latestApprovedConsultation is null', async () => {
    apiGetPatientOverview.mockResolvedValue(
      makeOverview({ latestApprovedConsultation: null })
    );

    renderPage();
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Smith, Alice'));

    await waitFor(() =>
      expect(screen.getByText('No previous approved consultation.')).toBeInTheDocument()
    );

    expect(
      screen.queryByRole('button', { name: /compare with previous visit/i })
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 9 — Pre-consultation context integration: comparison renders correctly
// ---------------------------------------------------------------------------
describe('9. Phase 6A — comparison renders in pre-consultation context', () => {
  test('9a. structured changes are shown after trigger is clicked', async () => {
    apiGetChangeSummary.mockResolvedValue(
      makeChangeSummary({ newSymptoms: ['headache'] })
    );
    await selectAliceAndWaitForContext();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() =>
      expect(screen.getByText('headache')).toBeInTheDocument()
    );
  });

  test('9b. insufficient history — shows "no previous approved consultation" message', async () => {
    apiGetChangeSummary.mockResolvedValue(noPreviousChangeSummary);
    await selectAliceAndWaitForContext();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() =>
      expect(
        screen.getByText(/no previous approved consultation available for comparison/i)
      ).toBeInTheDocument()
    );
  });

  test('9c. API error shows alert without breaking the context panel', async () => {
    apiGetChangeSummary.mockRejectedValue(new Error('Network failure'));
    await selectAliceAndWaitForContext();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    );

    // Patient context fields still visible after error
    expect(screen.getByText('Persistent cough')).toBeInTheDocument();
  });

  test('9d. AI narrative is NOT requested automatically', async () => {
    apiGetChangeSummary.mockResolvedValue(makeChangeSummary());
    await selectAliceAndWaitForContext();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => expect(apiGetChangeSummary).toHaveBeenCalled());

    // Only one call, with generateNarrative=false
    expect(apiGetChangeSummary).toHaveBeenCalledTimes(1);
    expect(apiGetChangeSummary).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), true
    );
  });

  test('9e. "Generate clinical summary" explicit action calls the AI endpoint', async () => {
    apiGetChangeSummary
      .mockResolvedValueOnce(makeChangeSummary())    // first call: diff
      .mockResolvedValueOnce({                        // second call: narrative
        ...makeChangeSummary(),
        clinicalSummary: 'Patient presents with headache. No prescription changes.',
        generatedAt:     '2026-10-01T10:00:00.000Z',
      });

    await selectAliceAndWaitForContext();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generate clinical summary/i })).toBeInTheDocument()
    );

    await userEvent.click(
      screen.getByRole('button', { name: /generate clinical summary/i })
    );

    await waitFor(() =>
      expect(apiGetChangeSummary).toHaveBeenCalledWith(PATIENT_ID, CONSULT_ID, true)
    );
  });

  test('9f. AI failure does not hide the deterministic diff', async () => {
    apiGetChangeSummary
      .mockResolvedValueOnce(makeChangeSummary({ newSymptoms: ['nausea'] }))
      .mockResolvedValueOnce({ success: false, message: 'Bedrock unavailable' });

    await selectAliceAndWaitForContext();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );
    await waitFor(() => expect(screen.getByText('nausea')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generate clinical summary/i })).toBeInTheDocument()
    );

    await userEvent.click(
      screen.getByRole('button', { name: /generate clinical summary/i })
    );

    // AI error appears
    await waitFor(() =>
      expect(
        screen.getByText(/clinical summary could not be generated/i)
      ).toBeInTheDocument()
    );

    // Deterministic diff still visible
    expect(screen.getByText('nausea')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 10 — Existing consultation workflow is unaffected
// ---------------------------------------------------------------------------
describe('10. Phase 6A — existing new-consultation flow is unaffected', () => {
  test('Start consultation button still navigates to /dashboard with patientId', async () => {
    await selectAliceAndWaitForContext();

    await userEvent.click(
      screen.getByRole('button', { name: /start consultation/i })
    );

    await waitFor(() =>
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
    );
  });

  test('"Change patient" resets context panel including change summary trigger', async () => {
    await selectAliceAndWaitForContext();

    // The change summary trigger is visible
    expect(
      screen.getByRole('button', { name: /compare with previous visit/i })
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /change patient/i }));

    // After reset, back to search — no change summary trigger visible
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: /search patients/i })).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('button', { name: /compare with previous visit/i })
    ).not.toBeInTheDocument();
  });
});
