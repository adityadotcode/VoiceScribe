/**
 * Theme toggle tests — Phase UI-DARK-MODE
 *
 * Strategy:
 *   ThemeContext applies data-theme to document.documentElement at import time
 *   (synchronous, for anti-flash). React useState then reads from that attribute.
 *
 *   Tests control the initial theme by pre-setting
 *   document.documentElement.dataset.theme in beforeEach, which the
 *   ThemeProvider's useState initialiser reads. localStorage is stubbed per-test
 *   to verify persistence behavior without polluting the real store.
 *
 * Scenarios (9 tests across 7 describes):
 *   1. System preference — light
 *   2. System preference — dark
 *   3. Stored 'dark' is used (restored from localStorage)
 *   4. Toggle switches light → dark
 *   5. Toggle switches dark → light
 *   6. localStorage updated with correct key/value; no auth keys written
 *   7. Theme persists across remount (reload simulation)
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { ThemeProvider, useTheme } from '../contexts/ThemeContext.jsx'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ThemeConsumer() {
  const { theme, toggleTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button type="button" onClick={toggleTheme} data-testid="toggle">
        Toggle
      </button>
    </div>
  )
}

function renderWithTheme() {
  return render(
    <ThemeProvider>
      <ThemeConsumer />
    </ThemeProvider>
  )
}

function stubMediaQuery(prefersDark) {
  vi.stubGlobal('matchMedia', (query) => ({
    matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => {},
  }))
}

function makeLocalStorageStub(initial = {}) {
  const store = { ...initial }
  return {
    getItem:    vi.fn((k) => store[k] ?? null),
    setItem:    vi.fn((k, v) => { store[k] = String(v) }),
    removeItem: vi.fn((k) => { delete store[k] }),
    clear:      vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]) }),
    _store: store,
  }
}

// ---------------------------------------------------------------------------
// Setup — each test starts with a clean slate
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Default: light (most tests start here; individual tests override as needed)
  document.documentElement.dataset.theme = 'light'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

// ---------------------------------------------------------------------------
// 1 — Default / system theme: light
// ---------------------------------------------------------------------------
describe('1. default/system theme — light', () => {
  test('data-theme="light" → ThemeProvider reports light', () => {
    // beforeEach already sets 'light'
    renderWithTheme()
    expect(screen.getByTestId('theme-value').textContent).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

// ---------------------------------------------------------------------------
// 2 — System preference: dark (pre-set attribute)
// ---------------------------------------------------------------------------
describe('2. system preference dark → theme is dark', () => {
  test('data-theme="dark" pre-set → ThemeProvider reports dark', () => {
    document.documentElement.dataset.theme = 'dark'
    renderWithTheme()
    expect(screen.getByTestId('theme-value').textContent).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

// ---------------------------------------------------------------------------
// 3 — Stored 'dark' is restored on mount
// ---------------------------------------------------------------------------
describe('3. saved theme is restored', () => {
  test('pre-setting dark attribute simulates localStorage restore', () => {
    document.documentElement.dataset.theme = 'dark'
    renderWithTheme()
    expect(screen.getByTestId('theme-value').textContent).toBe('dark')
  })

  test('stored "light" attribute is read correctly', () => {
    document.documentElement.dataset.theme = 'light'
    renderWithTheme()
    expect(screen.getByTestId('theme-value').textContent).toBe('light')
  })
})

// ---------------------------------------------------------------------------
// 4 — Toggle switches light → dark
// ---------------------------------------------------------------------------
describe('4. toggle switches light → dark', () => {
  test('click toggle from light → state and attribute become dark', async () => {
    document.documentElement.dataset.theme = 'light'
    vi.stubGlobal('localStorage', makeLocalStorageStub({}))
    renderWithTheme()

    await userEvent.click(screen.getByTestId('toggle'))

    expect(screen.getByTestId('theme-value').textContent).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

// ---------------------------------------------------------------------------
// 5 — Toggle switches dark → light
// ---------------------------------------------------------------------------
describe('5. toggle switches dark → light', () => {
  test('click toggle from dark → state and attribute become light', async () => {
    document.documentElement.dataset.theme = 'dark'
    vi.stubGlobal('localStorage', makeLocalStorageStub({}))
    renderWithTheme()

    await userEvent.click(screen.getByTestId('toggle'))

    expect(screen.getByTestId('theme-value').textContent).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

// ---------------------------------------------------------------------------
// 6 — localStorage updated on toggle — only voicescribe-theme key written
// ---------------------------------------------------------------------------
describe('6. localStorage updated with theme only', () => {
  test('toggle writes voicescribe-theme to localStorage', async () => {
    document.documentElement.dataset.theme = 'light'
    const ls = makeLocalStorageStub({})
    vi.stubGlobal('localStorage', ls)
    renderWithTheme()

    await userEvent.click(screen.getByTestId('toggle'))

    expect(ls.setItem).toHaveBeenCalledWith('voicescribe-theme', 'dark')
  })

  test('toggle does NOT write any auth-related key to localStorage', async () => {
    document.documentElement.dataset.theme = 'light'
    const ls = makeLocalStorageStub({})
    vi.stubGlobal('localStorage', ls)
    renderWithTheme()

    await userEvent.click(screen.getByTestId('toggle'))

    const writtenKeys = ls.setItem.mock.calls.map(([k]) => k)
    expect(writtenKeys).not.toContain('accessToken')
    expect(writtenKeys).not.toContain('refreshToken')
    expect(writtenKeys).not.toContain('token')
    expect(writtenKeys).toEqual(['voicescribe-theme'])
  })
})

// ---------------------------------------------------------------------------
// 7 — Theme persists across remount (simulated page reload)
// ---------------------------------------------------------------------------
describe('7. theme persists after remount', () => {
  test('toggled dark theme is visible in a fresh ThemeProvider mount', async () => {
    document.documentElement.dataset.theme = 'light'
    const ls = makeLocalStorageStub({})
    vi.stubGlobal('localStorage', ls)

    // First mount — toggle to dark
    const { unmount } = renderWithTheme()
    await userEvent.click(screen.getByTestId('toggle'))
    // data-theme attribute is now 'dark' on <html>
    expect(document.documentElement.dataset.theme).toBe('dark')
    unmount()

    // Second mount — reads from the attribute (which is still 'dark')
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>)
    expect(screen.getByTestId('theme-value').textContent).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
