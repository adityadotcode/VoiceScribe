/**
 * Phase 3B.2B — patientId wiring tests
 *
 * Tests for threading patientId from NewConsultationPage through the
 * ClinicalNoteReview save flow.
 *
 * Scenarios (5):
 *   1. patientId prop passed to ClinicalNoteReview shows patient name banner
 *   2. POST /api/consultations body includes patientId when saving a draft
 *   3. POST /api/consultations body includes patientId when approving
 *   4. Missing patientId (new consultation) prevents save with clear error
 *   5. Existing consultation (PUT) still works without patientId prop
 *
 * Strategy:
 *   - Mock the api.js module so apiFetch is fully controlled.
 *   - Render ClinicalNoteReview directly with controlled props.
 *   - Inspect the body passed to the mock to verify patientId inclusion.
 *   - Use userEvent for button clicks.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock api.js so apiFetch is interceptable
// ---------------------------------------------------------------------------
vi.mock('../api.js', () => ({
  apiFetch:      vi.fn(),
  apiUrl:        (p) => p,
  setAuthToken:  vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken:  vi.fn(),
}));

import { apiFetch } from '../api.js';

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------
import ClinicalNoteReview from '../ClinicalNoteReview.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PATIENT_ID   = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PATIENT_NAME = 'Alice Smith';
const CONSULT_ID   = 'cccccccccccccccccccccccc';

/** Minimal note fixture with all required fields. */
function makeNote(overrides = {}) {
  return {
    patient:               { name: '', age: null, sex: '' },
    chief_complaint:       'Persistent cough',
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

/** Successful save response for a new consultation. */
function mockSaveOk(id = CONSULT_ID) {
  return new Response(
    JSON.stringify({ success: true, consultation: { _id: id } }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );
}

/** Successful update response for an existing consultation. */
function mockUpdateOk(id = CONSULT_ID) {
  return new Response(
    JSON.stringify({ success: true, consultation: { _id: id } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/** Render ClinicalNoteReview wrapped in MemoryRouter (needed for any Link). */
function renderReview(props = {}) {
  const defaults = {
    note:       makeNote(),
    transcript: 'Patient reports cough.',
    patientId:  PATIENT_ID,
    patientName: PATIENT_NAME,
    onBack:     vi.fn(),
    onSaved:    vi.fn(),
  };
  return render(
    <MemoryRouter>
      <ClinicalNoteReview {...defaults} {...props} />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Clear localStorage between tests so no stale draft is restored
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// 1 — Patient name banner is shown when patientName prop is provided
// ---------------------------------------------------------------------------
describe('1. patient name banner', () => {
  test('displays patient name when patientName prop is set', () => {
    renderReview({ patientName: 'Alice Smith' });
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    // The banner role is "status"
    expect(screen.getByRole('status', { name: /selected patient/i })).toBeInTheDocument();
  });

  test('no banner when patientName is null', () => {
    renderReview({ patientName: null });
    expect(screen.queryByRole('status', { name: /selected patient/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2 — POST contains patientId when saving a draft (new consultation)
// ---------------------------------------------------------------------------
describe('2. POST /api/consultations includes patientId (save draft)', () => {
  test('patientId is in the fetch body when saving a new draft', async () => {
    apiFetch.mockResolvedValueOnce(mockSaveOk());

    renderReview({ patientId: PATIENT_ID, patientName: PATIENT_NAME });

    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledOnce();
    });

    const [path, opts] = apiFetch.mock.calls[0];
    expect(path).toBe('/api/consultations');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.patientId).toBe(PATIENT_ID);
    // userId must never come from the frontend
    expect(body.userId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3 — POST contains patientId when approving (new consultation)
// ---------------------------------------------------------------------------
describe('3. POST /api/consultations includes patientId (approve)', () => {
  test('patientId is in the fetch body when approving a new consultation', async () => {
    apiFetch.mockResolvedValueOnce(mockSaveOk());

    renderReview({ patientId: PATIENT_ID, patientName: PATIENT_NAME });

    // Check all three checklist items so the Approve button is enabled
    const checkboxes = screen.getAllByRole('checkbox');
    for (const cb of checkboxes) {
      await userEvent.click(cb);
    }

    await userEvent.click(screen.getByRole('button', { name: /approve & finalize/i }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledOnce();
    });

    const [path, opts] = apiFetch.mock.calls[0];
    expect(path).toBe('/api/consultations');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.patientId).toBe(PATIENT_ID);
    expect(body.userId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4 — Missing patientId prevents save with a clear error message
// ---------------------------------------------------------------------------
describe('4. missing patientId prevents save', () => {
  test('save draft shows validation error when patientId is null', async () => {
    // No patientId, no existing consultationId → new consultation without patient
    renderReview({ patientId: null, patientName: null });

    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // apiFetch must NOT have been called
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/no patient selected/i);
  });

  test('approve shows validation error when patientId is null', async () => {
    renderReview({ patientId: null, patientName: null });

    const checkboxes = screen.getAllByRole('checkbox');
    for (const cb of checkboxes) {
      await userEvent.click(cb);
    }

    await userEvent.click(screen.getByRole('button', { name: /approve & finalize/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/no patient selected/i);
  });
});

// ---------------------------------------------------------------------------
// 5 — Existing consultation (PUT) works without patientId prop
// ---------------------------------------------------------------------------
describe('5. existing consultation PUT still works', () => {
  test('PUT request succeeds when initialConsultationId is set and patientId is null', async () => {
    // Opening a saved consultation from history — no patientId needed on the client
    apiFetch.mockResolvedValueOnce(mockUpdateOk(CONSULT_ID));

    renderReview({
      patientId:            null,
      patientName:          null,
      initialConsultationId: CONSULT_ID,
    });

    await userEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledOnce();
    });

    const [path, opts] = apiFetch.mock.calls[0];
    // Must be a PUT to the specific consultation ID
    expect(path).toBe(`/api/consultations/${CONSULT_ID}`);
    expect(opts.method).toBe('PUT');

    // patientId not in the PUT body (backend ignores it anyway)
    const body = JSON.parse(opts.body);
    expect(body.patientId).toBeUndefined();
  });
});
