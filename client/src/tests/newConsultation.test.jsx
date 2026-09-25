/**
 * Phase 3B.2A — NewConsultationPage tests
 *
 * Scenarios (6):
 *   1. Patient search — results appear after API call
 *   2. Patient selection — clicking a result shows SelectedPatientPanel
 *   3. Selected patient display — name, DOB, sex, MR shown; Change patient present
 *   4. Last-approved context displayed — fields rendered after patient selected
 *   5. No previous consultation state — correct empty message shown
 *   6. Start button disabled before selection, enabled after selection
 *
 * Strategy:
 *   - vi.mock the patients API service module; no real network calls.
 *   - Render NewConsultationPage inside MemoryRouter at /consultation/new.
 *   - Use userEvent for interactions.
 *   - vi.useFakeTimers to control the 300 ms search debounce where needed.
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the patients API service
// ---------------------------------------------------------------------------
vi.mock('../services/api/patients.js', () => ({
  apiListPatients:             vi.fn(),
  apiGetPatient:               vi.fn(),
  apiUpdatePatient:            vi.fn(),
  apiGetPatientConsultations:  vi.fn(),
  apiGetLastApproved:          vi.fn(),
  apiCreatePatient:            vi.fn(),
}));

import {
  apiListPatients,
  apiGetLastApproved,
} from '../services/api/patients.js';

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------
import NewConsultationPage from '../pages/NewConsultationPage.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/consultation/new']}>
      <Routes>
        <Route path="/consultation/new" element={<NewConsultationPage />} />
        {/* Destination after Start is clicked */}
        <Route path="/dashboard" element={<div data-testid="dashboard-page">Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function makePatient(overrides = {}) {
  return {
    _id:             'aaaaaaaaaaaaaaaaaaaaaaaa',
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

function makeLastApproved(overrides = {}) {
  return {
    _id:              'cccccccccccccccccccccccc',
    status:           'approved',
    consultationDate: '2026-08-20T09:00:00.000Z',
    note: {
      chief_complaint:       'Persistent cough',
      symptoms:              ['cough', 'fatigue'],
      medications_mentioned: ['paracetamol'],
      assessment:            'Likely viral URTI',
      follow_up:             'Return in 1 week if not improved',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  // Default: search returns one patient; last-approved returns a consultation
  apiListPatients.mockResolvedValue({ success: true, patients: [makePatient()] });
  apiGetLastApproved.mockResolvedValue({ success: true, consultation: makeLastApproved() });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1 — Patient search: results appear
// ---------------------------------------------------------------------------
describe('1. patient search', () => {
  test('initial load fetches patients and renders result rows', async () => {
    renderPage();

    // Advance the 300 ms debounce timer for the initial empty-query search
    await act(async () => { vi.advanceTimersByTime(400); });

    await waitFor(() => {
      expect(screen.getByText('Smith, Alice')).toBeInTheDocument();
    });

    expect(apiListPatients).toHaveBeenCalledWith({ search: '' });
  });

  test('typing in the search box triggers a new API call', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    renderPage();

    // Flush initial load
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

    // Search box gone, selected name visible in the panel heading
    await waitFor(() => {
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
  }

  test('shows patient name', async () => {
    await selectAlice();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  test('shows "Change patient" button', async () => {
    await selectAlice();
    expect(screen.getByRole('button', { name: /change patient/i })).toBeInTheDocument();
  });

  test('shows medical record ID when present', async () => {
    await selectAlice();
    expect(screen.getByText('MR001')).toBeInTheDocument();
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
// 4 — Last-approved context displayed
// ---------------------------------------------------------------------------
describe('4. last-approved context displayed', () => {
  async function selectAndWaitForContext() {
    renderPage();
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(screen.getByText('Smith, Alice')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Smith, Alice'));
    // Wait for LastApprovedPanel to finish loading
    await waitFor(() => expect(screen.getByText('Persistent cough')).toBeInTheDocument());
  }

  test('chief complaint is shown', async () => {
    await selectAndWaitForContext();
    expect(screen.getByText('Persistent cough')).toBeInTheDocument();
  });

  test('assessment is shown', async () => {
    await selectAndWaitForContext();
    expect(screen.getByText('Likely viral URTI')).toBeInTheDocument();
  });

  test('follow-up is shown', async () => {
    await selectAndWaitForContext();
    expect(screen.getByText('Return in 1 week if not improved')).toBeInTheDocument();
  });

  test('calls apiGetLastApproved with the correct patient ID', async () => {
    await selectAndWaitForContext();
    expect(apiGetLastApproved).toHaveBeenCalledWith('aaaaaaaaaaaaaaaaaaaaaaaa');
  });
});

// ---------------------------------------------------------------------------
// 5 — No previous consultation state
// ---------------------------------------------------------------------------
describe('5. no previous consultation state', () => {
  test('shows "No previous approved consultation." when API returns 404/false', async () => {
    apiGetLastApproved.mockResolvedValue({ success: false, message: 'No approved consultation found.' });

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
