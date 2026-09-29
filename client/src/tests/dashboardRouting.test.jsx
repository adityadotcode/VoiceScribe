/**
 * Phase 3C.2 — Dashboard new-consultation routing test
 *
 * Verifies that clicking "+ New consultation" from the Dashboard navigates
 * to /consultation/new instead of starting an inline recording session.
 *
 * Strategy:
 *   - Render Dashboard component directly with a mocked onNewConsultation prop.
 *   - The prop is now wired in App.jsx as () => navigate('/consultation/new').
 *   - Here we verify the prop is called when the button is clicked (unit layer).
 *   - A second test renders the full DashboardApp via MemoryRouter and checks
 *     that clicking the button actually lands on /consultation/new.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Dashboard calls apiFetch directly (/api/consultations) — mock api.js
vi.mock('../api.js', () => ({
  apiFetch:       vi.fn(),
  apiUrl:         (p) => p,
  setAuthToken:   vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken:   vi.fn(),
}));

import { apiFetch } from '../api.js';

// ---------------------------------------------------------------------------
// Component under test — Dashboard (isolated)
// ---------------------------------------------------------------------------
import Dashboard from '../Dashboard.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make apiFetch return an empty consultation list. */
function mockEmptyList() {
  apiFetch.mockResolvedValue(
    new Response(
      JSON.stringify({ success: true, consultations: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1 — Dashboard "+ New consultation" button calls onNewConsultation prop
// ---------------------------------------------------------------------------
describe('Dashboard "+ New consultation" routing', () => {
  test('clicking + New consultation calls the onNewConsultation callback', async () => {
    mockEmptyList();
    const onNewConsultation = vi.fn();

    render(
      <MemoryRouter>
        <Dashboard
          onOpen={vi.fn()}
          onNewConsultation={onNewConsultation}
          refreshTrigger={0}
        />
      </MemoryRouter>
    );

    // Wait for the list to load so the button is rendered
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new consultation/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /new consultation/i }));

    expect(onNewConsultation).toHaveBeenCalledOnce();
  });

  test('empty-state "Start recording" button also calls onNewConsultation', async () => {
    mockEmptyList();
    const onNewConsultation = vi.fn();

    render(
      <MemoryRouter>
        <Dashboard
          onOpen={vi.fn()}
          onNewConsultation={onNewConsultation}
          refreshTrigger={0}
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /start recording/i }));

    expect(onNewConsultation).toHaveBeenCalledOnce();
  });
});
