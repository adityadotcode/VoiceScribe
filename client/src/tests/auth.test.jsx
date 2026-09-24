/**
 * Phase 1B — Frontend authentication tests
 *
 * Tests cover: AuthContext lifecycle, PrivateRoute, apiFetch 401 retry,
 * and token storage guarantees.
 *
 * All network calls are intercepted via global fetch mock.
 * No real backend connection is made.
 */

import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { AuthProvider, useAuth } from '../contexts/AuthContext.jsx'
import PrivateRoute from '../components/layout/PrivateRoute.jsx'
import { apiFetch, setAuthToken, clearAuthToken, getAuthToken } from '../api.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRefreshOk(token = 'access-token-restored') {
  return Promise.resolve(
    new Response(JSON.stringify({ success: true, accessToken: token, user: { id: '1', email: 'doc@x.com', displayName: 'Doc', role: 'doctor' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  )
}

function makeRefreshFail() {
  return Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 401 }))
}

function makeLoginOk(token = 'access-token-login') {
  return Promise.resolve(
    new Response(JSON.stringify({ success: true, accessToken: token, user: { id: '1', email: 'doc@x.com', displayName: 'Doc', role: 'doctor' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  )
}

function makeLoginFail() {
  return Promise.resolve(
    new Response(JSON.stringify({ success: false, message: 'Invalid credentials.' }), { status: 401 })
  )
}

// Simple component that exposes auth context values for inspection
function AuthInspector() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user">{auth.user?.displayName ?? 'none'}</span>
      <button onClick={() => auth.logout()}>Logout</button>
    </div>
  )
}

function Protected() { return <div data-testid="protected">Protected content</div> }
function Login() { return <div data-testid="login-page">Login</div> }

// Wrap with Router so PrivateRoute can use navigate
function renderWithRouter(ui, { initialPath = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      {ui}
    </MemoryRouter>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  clearAuthToken()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAuthToken()
})

// ── 1. Initial refresh succeeds → authenticated state restored ────────────
test('1. initial refresh succeeds → authenticated state restored', async () => {
  fetch.mockImplementationOnce(() => makeRefreshOk('restored-token'))

  renderWithRouter(
    <AuthProvider><AuthInspector /></AuthProvider>
  )

  // Initially loading
  expect(screen.getByTestId('loading').textContent).toBe('true')

  await waitFor(() => {
    expect(screen.getByTestId('loading').textContent).toBe('false')
    expect(screen.getByTestId('authenticated').textContent).toBe('true')
    expect(screen.getByTestId('user').textContent).toBe('Doc')
  })
})

// ── 2. Initial refresh fails → unauthenticated ────────────────────────────
test('2. initial refresh fails → unauthenticated state', async () => {
  fetch.mockImplementationOnce(() => makeRefreshFail())

  renderWithRouter(
    <AuthProvider><AuthInspector /></AuthProvider>
  )

  await waitFor(() => {
    expect(screen.getByTestId('loading').textContent).toBe('false')
    expect(screen.getByTestId('authenticated').textContent).toBe('false')
    expect(screen.getByTestId('user').textContent).toBe('none')
  })
})

// ── 3. Login success → access token + user stored in memory ──────────────
test('3. login success → access token and user stored', async () => {
  // First call: initial refresh fails
  fetch.mockImplementationOnce(() => makeRefreshFail())
  // Second call: login succeeds
  fetch.mockImplementationOnce(() => makeLoginOk('login-token'))

  let authRef
  function Capture() {
    authRef = useAuth()
    return <div data-testid="auth-ok">{authRef.isAuthenticated ? 'yes' : 'no'}</div>
  }

  renderWithRouter(<AuthProvider><Capture /></AuthProvider>)
  await waitFor(() => expect(screen.getByTestId('auth-ok').textContent).toBe('no'))

  await act(async () => {
    const result = await authRef.login({ email: 'doc@x.com', password: 'pass' })
    expect(result.success).toBe(true)
  })

  expect(authRef.isAuthenticated).toBe(true)
  expect(authRef.user.displayName).toBe('Doc')
  // Token in memory
  expect(getAuthToken()).toBe('login-token')
})

// ── 4. Login failure → success: false returned ────────────────────────────
test('4. login failure → error message returned', async () => {
  fetch.mockImplementationOnce(() => makeRefreshFail())
  fetch.mockImplementationOnce(() => makeLoginFail())

  let authRef
  function Capture() { authRef = useAuth(); return null }
  renderWithRouter(<AuthProvider><Capture /></AuthProvider>)
  await waitFor(() => expect(authRef.isLoading).toBe(false))

  let result
  await act(async () => {
    result = await authRef.login({ email: 'x@x.com', password: 'bad' })
  })

  expect(result.success).toBe(false)
  expect(authRef.isAuthenticated).toBe(false)
})

// ── 5. Logout → auth state cleared ────────────────────────────────────────
test('5. logout clears auth state', async () => {
  // restore → logged in
  fetch.mockImplementationOnce(() => makeRefreshOk())
  // logout call
  fetch.mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 200 })))

  let authRef
  function Capture() { authRef = useAuth(); return <span data-testid="auth">{String(authRef.isAuthenticated)}</span> }
  renderWithRouter(<AuthProvider><Capture /></AuthProvider>)
  await waitFor(() => expect(screen.getByTestId('auth').textContent).toBe('true'))

  await act(async () => { await authRef.logout() })

  expect(authRef.isAuthenticated).toBe(false)
  expect(authRef.user).toBeNull()
  expect(getAuthToken()).toBeNull()
})

// ── 6. Tokens never written to localStorage/sessionStorage ────────────────
test('6. access token is never written to localStorage or sessionStorage', async () => {
  fetch.mockImplementationOnce(() => makeRefreshOk('mem-token'))

  const lsSpy  = vi.spyOn(Storage.prototype, 'setItem')
  renderWithRouter(<AuthProvider><AuthInspector /></AuthProvider>)
  await waitFor(() => expect(screen.getByTestId('authenticated').textContent).toBe('true'))

  expect(lsSpy).not.toHaveBeenCalledWith(expect.stringContaining('token'), expect.anything())
  expect(lsSpy).not.toHaveBeenCalledWith(expect.stringContaining('access'), expect.anything())
  lsSpy.mockRestore()
})

// ── 7. PrivateRoute loading state ─────────────────────────────────────────
test('7. PrivateRoute shows loading while auth is initialising', async () => {
  // Never resolves during this test
  fetch.mockImplementation(() => new Promise(() => {}))

  renderWithRouter(
    <AuthProvider>
      <Routes>
        <Route element={<PrivateRoute />}>
          <Route path="/" element={<Protected />} />
        </Route>
      </Routes>
    </AuthProvider>
  )

  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(screen.queryByTestId('protected')).not.toBeInTheDocument()
})

// ── 8. PrivateRoute unauthenticated → redirect to /login ──────────────────
test('8. unauthenticated user is redirected to /login', async () => {
  fetch.mockImplementationOnce(() => makeRefreshFail())

  renderWithRouter(
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<PrivateRoute />}>
          <Route path="/" element={<Protected />} />
        </Route>
      </Routes>
    </AuthProvider>
  )

  await waitFor(() => {
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument()
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
  })
})

// ── 9. PrivateRoute authenticated → renders child ─────────────────────────
test('9. authenticated user can access protected route', async () => {
  fetch.mockImplementationOnce(() => makeRefreshOk())

  renderWithRouter(
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<PrivateRoute />}>
          <Route path="/" element={<Protected />} />
        </Route>
      </Routes>
    </AuthProvider>
  )

  await waitFor(() => {
    expect(screen.getByTestId('protected')).toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
  })
})

// ── 10. apiFetch injects Authorization header ─────────────────────────────
test('10. apiFetch injects Authorization: Bearer header', async () => {
  setAuthToken('my-token')
  fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))

  await apiFetch('/api/consultations')

  const call = fetch.mock.calls[0]
  const headers = call[1].headers
  const authHeader = headers instanceof Headers
    ? headers.get('authorization')
    : headers['Authorization'] || headers['authorization']
  expect(authHeader).toBe('Bearer my-token')
})

// ── 11. 401 triggers refresh ──────────────────────────────────────────────
test('11. 401 response triggers a token refresh', async () => {
  setAuthToken('old-token')

  // First call: 401
  fetch.mockResolvedValueOnce(new Response('{"success":false}', { status: 401 }))
  // Refresh call
  fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ accessToken: 'new-token' }), { status: 200 })
  )
  // Retry: 200
  fetch.mockResolvedValueOnce(new Response('{"data":"ok"}', { status: 200 }))

  const res = await apiFetch('/api/consultations')
  expect(res.status).toBe(200)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(getAuthToken()).toBe('new-token')
})

// ── 12. Original request retried once after refresh ───────────────────────
test('12. original request is retried exactly once after refresh', async () => {
  setAuthToken('t')
  fetch.mockResolvedValueOnce(new Response('{}', { status: 401 })) // original → 401
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'new' }), { status: 200 })) // refresh
  fetch.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 })) // retry

  await apiFetch('/api/consultations')
  expect(fetch).toHaveBeenCalledTimes(3)
})

// ── 13. Failed refresh clears auth ────────────────────────────────────────
test('13. failed refresh after 401 does not retry indefinitely', async () => {
  setAuthToken('t')
  fetch.mockResolvedValueOnce(new Response('{}', { status: 401 })) // original → 401
  fetch.mockResolvedValueOnce(new Response('{}', { status: 401 })) // refresh fails

  const res = await apiFetch('/api/consultations')
  // Returns the original 401 response — does not loop
  expect(res.status).toBe(401)
  expect(fetch).toHaveBeenCalledTimes(2)
})

// ── 14. Refresh endpoint does not recursively trigger refresh ─────────────
test('14. refresh endpoint 401 does not trigger recursive refresh', async () => {
  setAuthToken('t')
  fetch.mockResolvedValueOnce(new Response('{}', { status: 401 }))

  const res = await apiFetch('/api/auth/refresh')
  expect(res.status).toBe(401)
  // Only 1 call — no recursive refresh
  expect(fetch).toHaveBeenCalledTimes(1)
})

// ── 15. No infinite retry ─────────────────────────────────────────────────
test('15. a request is never retried more than once', async () => {
  setAuthToken('t')
  // All calls return 401
  fetch.mockResolvedValue(new Response('{}', { status: 401 }))

  const res = await apiFetch('/api/consultations')
  expect(res.status).toBe(401)
  // original + refresh = 2 calls maximum
  expect(fetch.mock.calls.length).toBeLessThanOrEqual(2)
})
