/**
 * Phase 4C — ChangeSummaryPanel tests
 *
 * Scenarios (10):
 *   1. Trigger button renders when panel is idle
 *   2. API is NOT called on initial render
 *   3. Clicking trigger button calls the change-summary API
 *   4. Loading state shown while fetch is in-flight
 *   5. No-previous-consultation state displayed correctly
 *   6. Array changes (new / resolved / persisting items) displayed
 *   7. Boolean flag changes (assessmentChanged etc.) displayed
 *   8. No-changes state displayed when diff is empty
 *   9. API error state displayed
 *  10. Panel renders nothing when patientId or consultationId is missing
 *
 * Strategy:
 *   - vi.mock the patients API service so no real fetch occurs.
 *   - vi.mock api.js defensively.
 *   - Render ChangeSummaryPanel directly with controlled props.
 *   - Use userEvent for button interactions.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../services/api/patients.js', () => ({
  apiListPatients:            vi.fn(),
  apiGetPatient:              vi.fn(),
  apiUpdatePatient:           vi.fn(),
  apiGetPatientConsultations: vi.fn(),
  apiGetLastApproved:         vi.fn(),
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

import { apiGetChangeSummary } from '../services/api/patients.js';

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------
import ChangeSummaryPanel from '../components/consultation/ChangeSummaryPanel.jsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PATIENT_ID      = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CONSULTATION_ID = 'cccccccccccccccccccccccc';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noPreviousResponse = {
  success:                 true,
  hasPreviousConsultation: false,
  previousConsultation:    null,
  structuredDiff:          null,
};

function makeSuccessResponse(diffOverrides = {}) {
  return {
    success:                 true,
    hasPreviousConsultation: true,
    previousConsultation: {
      id:               'bbbbbbbbbbbbbbbbbbbbbbbb',
      consultationDate: '2026-08-01T09:00:00.000Z',
    },
    structuredDiff: {
      newSymptoms:                [],
      resolvedSymptoms:           [],
      persistingSymptoms:         [],
      newMedicationsMentioned:    [],
      stoppedMedicationsMentioned: [],
      newObservations:            [],
      resolvedObservations:       [],
      assessmentChanged:          false,
      chiefComplaintChanged:      false,
      followUpChanged:            false,
      historyChanged:             false,
      ...diffOverrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderPanel(props = {}) {
  const defaults = { patientId: PATIENT_ID, consultationId: CONSULTATION_ID };
  return render(
    <MemoryRouter>
      <ChangeSummaryPanel {...defaults} {...props} />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1 — Trigger button renders
// ---------------------------------------------------------------------------
describe('1. trigger button renders', () => {
  test('shows "Compare with previous visit" button when idle', () => {
    renderPanel();
    expect(
      screen.getByRole('button', { name: /compare with previous visit/i })
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2 — API not called on mount
// ---------------------------------------------------------------------------
describe('2. API not called initially', () => {
  test('apiGetChangeSummary is NOT called on render', () => {
    renderPanel();
    expect(apiGetChangeSummary).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3 — Clicking trigger calls API
// ---------------------------------------------------------------------------
describe('3. clicking button calls the API', () => {
  test('calls apiGetChangeSummary with correct patientId and consultationId', async () => {
    apiGetChangeSummary.mockResolvedValue(noPreviousResponse);
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(apiGetChangeSummary).toHaveBeenCalledWith(PATIENT_ID, CONSULTATION_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// 4 — Loading state
// ---------------------------------------------------------------------------
describe('4. loading state', () => {
  test('shows loading message while fetch is in-flight', async () => {
    apiGetChangeSummary.mockReturnValue(new Promise(() => {})); // never resolves

    renderPanel();
    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    expect(screen.getByText(/comparing with previous visit/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5 — No previous consultation
// ---------------------------------------------------------------------------
describe('5. no previous consultation state', () => {
  test('shows no-previous message when hasPreviousConsultation is false', async () => {
    apiGetChangeSummary.mockResolvedValue(noPreviousResponse);
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(
        screen.getByText(/no previous approved consultation available for comparison/i)
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 6 — Array changes display
// ---------------------------------------------------------------------------
describe('6. array changes display', () => {
  test('new symptoms are displayed', async () => {
    apiGetChangeSummary.mockResolvedValue(
      makeSuccessResponse({ newSymptoms: ['fatigue', 'headache'] })
    );
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(screen.getByText('fatigue')).toBeInTheDocument();
      expect(screen.getByText('headache')).toBeInTheDocument();
    });
  });

  test('resolved symptoms are displayed', async () => {
    apiGetChangeSummary.mockResolvedValue(
      makeSuccessResponse({ resolvedSymptoms: ['fever'] })
    );
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(screen.getByText('fever')).toBeInTheDocument();
    });
  });

  test('medications mentioned are labelled correctly (not "prescriptions")', async () => {
    apiGetChangeSummary.mockResolvedValue(
      makeSuccessResponse({ newMedicationsMentioned: ['paracetamol'] })
    );
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(screen.getByText('paracetamol')).toBeInTheDocument();
      // Label must say "mentioned", never "prescription"
      expect(screen.getByText(/new medications mentioned/i)).toBeInTheDocument();
      expect(screen.queryByText(/prescription/i)).not.toBeInTheDocument();
    });
  });

  test('previous consultation date shown when available', async () => {
    apiGetChangeSummary.mockResolvedValue(
      makeSuccessResponse({ newSymptoms: ['cough'] })
    );
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(screen.getByText(/compared with/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 7 — Boolean flag changes
// ---------------------------------------------------------------------------
describe('7. boolean flag changes display', () => {
  test('assessmentChanged flag shown when true', async () => {
    apiGetChangeSummary.mockResolvedValue(
      makeSuccessResponse({ assessmentChanged: true })
    );
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(screen.getByText(/assessment/i)).toBeInTheDocument();
      expect(screen.getByText(/changed/)).toBeInTheDocument();
    });
  });

  test('chiefComplaintChanged flag shown when true', async () => {
    apiGetChangeSummary.mockResolvedValue(
      makeSuccessResponse({ chiefComplaintChanged: true })
    );
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(screen.getByText(/chief complaint/i)).toBeInTheDocument();
    });
  });

  test('false boolean flags are NOT rendered', async () => {
    apiGetChangeSummary.mockResolvedValue(
      // Only assessment changed; chief complaint did not
      makeSuccessResponse({ assessmentChanged: true, chiefComplaintChanged: false })
    );
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(screen.getByText(/assessment/i)).toBeInTheDocument();
    });

    // Chief complaint should not appear when its flag is false
    expect(screen.queryByText(/chief complaint/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 8 — No changes state
// ---------------------------------------------------------------------------
describe('8. no-changes state', () => {
  test('shows "no changes detected" when diff is empty', async () => {
    // All arrays empty, all booleans false → truly identical notes
    apiGetChangeSummary.mockResolvedValue(makeSuccessResponse());
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(
        screen.getByText(/no changes detected in the compared fields/i)
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 9 — API error state
// ---------------------------------------------------------------------------
describe('9. API error state', () => {
  test('shows error message when API call fails', async () => {
    apiGetChangeSummary.mockRejectedValue(new Error('Network failure'));
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // Does not expose internal error details
    expect(screen.queryByText(/Network failure/)).not.toBeInTheDocument();
  });

  test('shows error when API returns success:false', async () => {
    apiGetChangeSummary.mockResolvedValue({ success: false, message: 'Internal error.' });
    renderPanel();

    await userEvent.click(
      screen.getByRole('button', { name: /compare with previous visit/i })
    );

    await waitFor(() => {
      expect(
        screen.getByText(/could not retrieve change summary/i)
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 10 — Panel renders nothing when IDs missing
// ---------------------------------------------------------------------------
describe('10. missing IDs — panel renders nothing', () => {
  test('renders nothing when patientId is absent', () => {
    const { container } = render(
      <MemoryRouter>
        <ChangeSummaryPanel patientId="" consultationId={CONSULTATION_ID} />
      </MemoryRouter>
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when consultationId is absent', () => {
    const { container } = render(
      <MemoryRouter>
        <ChangeSummaryPanel patientId={PATIENT_ID} consultationId="" />
      </MemoryRouter>
    );
    expect(container.firstChild).toBeNull();
  });
});
