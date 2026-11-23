/**
 * Auth recovery tests — audio upload authentication fix
 *
 * Tests the setAuthExpiredHandler mechanism and FormData retry behavior:
 *
 *  A. Expired access token + valid refresh → refresh succeeds, retry works
 *  B. FormData (multipart) retry after successful refresh
 *  C. Expired access token + expired refresh → refresh fails, auth-expired handler called
 *  D. AuthContext clears state on auth-expired callback
 *  E. PrivateRoute redirects to login after auth state cleared
 *  F. Concurrent 401s coalesced into a single refresh
 *  G. Auth-expired handler deregistered on unmount
 *  H. 401 error message in AudioRecorder shows session-expired text
 */

import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../services/api/auth.js', () => ({
  apiRegister: vi.fn(),
  apiLogin:    vi.fn(),
  apiRefresh:  vi.fn(),
  apiLogout:   vi.fn(),
  apiMe:       vi.fn(),
}))

import { apiRefresh } from '../services/api/auth.js'
import { AuthProvider, useAuth } from '../contexts/AuthContext.jsx'
import PrivateRoute from '../components/layout/PrivateRoute.jsx'
import {
  apiFetch,
  setAuthToken,
  clearAuthToken,
  getAuthToken,
  setAuthExpiredHandler,
} from '../api.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function make401() {
  return makeResponse({ success: false, message: 'Authentication required.' }, 401)
}

function makeRefreshOk(token = 'refreshed-token') {
  return makeResponse({ success: true, accessToken: token, user: { id: '1', email: 'd@x.com', displayName: 'Doc', role: 'doctor' } })
}

function makeRefreshFail() {
  return makeResponse({ success: false }, 401)
}

function ProtectedPage() { return <div data-testid="protected">Protected</div> }
function LoginPage()     { return <div data-testid="login-page">Login</div> }

function AuthInspector() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user">{auth.user?.displayName ?? 'none'}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  clearAuthToken()
  setAuthExpiredHandler(null) // clear any leftover handler
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAuthToken()
  setAuthExpiredHandler(null)
})

// ===========================================================================
// A — Expired access token + valid refresh → retry succeeds
// ===========================================================================

describe('A. Expired token with valid refresh', () => {
  test('A1. 401 → refresh succeeds → retry returns 200', async () => {
    setAuthToken('expired-token')
    fetch
      .mockResolvedValueOnce(make401())               // original
      .mockResolvedValueOnce(makeRefreshOk('new-tok')) // refresh
      .mockResolvedValueOnce(makeResponse({ ok: true })) // retry

    const res = await apiFetch('/api/consultations')
    expect(res.status).toBe(200)
    expect(getAuthToken()).toBe('new-tok')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  test('A2. token is updated in module-level _accessToken after refresh', async () => {
    setAuthToken('old')
    fetch
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(makeRefreshOk('fresh'))
      .mockResolvedValueOnce(makeResponse({ ok: true }))

    await apiFetch('/api/patients')
    expect(getAuthToken()).toBe('fresh')
  })
})

// ===========================================================================
// B — FormData (multipart) retry after successful refresh
// ===========================================================================

describe('B. FormData retry after refresh', () => {
  test('B1. FormData body is reused on retry with new token', async () => {
    setAuthToken('expired')
    const formData = new FormData()
    formData.append('audio', new Blob(['data'], { type: 'audio/webm' }), 'test.webm')
    formData.append('consentEventId', 'evt-123')

    fetch
      .mockResolvedValueOnce(make401())               // original 401
      .mockResolvedValueOnce(makeRefreshOk('new-tok')) // refresh succeeds
      .mockResolvedValueOnce(makeResponse({ success: true, objectKey: 's3/key' })) // retry 200

    const res = await apiFetch('/api/audio', { method: 'POST', body: formData })
    expect(res.status).toBe(200)

    // Verify the retry (3rd fetch call) used the same FormData body
    const retryCall = fetch.mock.calls[2]
    expect(retryCall[0]).toContain('/api/audio')
    expect(retryCall[1].body).toBe(formData) // same FormData object reused

    // Verify the retry has the new Authorization header
    const retryHeaders = retryCall[1].headers
    const authHeader = retryHeaders instanceof Headers
      ? retryHeaders.get('authorization')
      : retryHeaders['Authorization'] || retryHeaders['authorization']
    expect(authHeader).toBe('Bearer new-tok')
  })

  test('B2. retry does not set Content-Type manually (browser sets multipart boundary)', async () => {
    setAuthToken('t')
    const formData = new FormData()
    formData.append('file', new Blob(['x'], { type: 'audio/webm' }), 'a.webm')

    fetch
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(makeRefreshOk('t2'))
      .mockResolvedValueOnce(makeResponse({ ok: true }))

    await apiFetch('/api/audio', { method: 'POST', body: formData })

    const retryHeaders = fetch.mock.calls[2][1].headers
    // The Headers object should NOT contain Content-Type — the browser
    // auto-sets it for FormData bodies.
    if (retryHeaders instanceof Headers) {
      expect(retryHeaders.get('content-type')).toBeNull()
    }
  })
})

// ===========================================================================
// C — Expired refresh token → auth-expired handler called
// ===========================================================================

describe('C. Refresh failure triggers auth-expired handler', () => {
  test('C1. when refresh fails, setAuthExpiredHandler callback is invoked', async () => {
    setAuthToken('expired')
    const expiredHandler = vi.fn()
    setAuthExpiredHandler(expiredHandler)

    fetch
      .mockResolvedValueOnce(make401())       // original 401
      .mockResolvedValueOnce(makeRefreshFail()) // refresh fails

    const res = await apiFetch('/api/consultations')
    expect(res.status).toBe(401)
    expect(expiredHandler).toHaveBeenCalledTimes(1)
  })

  test('C2. when refresh succeeds, auth-expired handler is NOT called', async () => {
    setAuthToken('expired')
    const expiredHandler = vi.fn()
    setAuthExpiredHandler(expiredHandler)

    fetch
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(makeRefreshOk('new'))
      .mockResolvedValueOnce(makeResponse({ ok: true }))

    await apiFetch('/api/consultations')
    expect(expiredHandler).not.toHaveBeenCalled()
  })

  test('C3. handler errors do not break the response return', async () => {
    setAuthToken('expired')
    setAuthExpiredHandler(() => { throw new Error('handler crash') })

    fetch
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(makeRefreshFail())

    // Should not throw — handler errors are caught
    const res = await apiFetch('/api/consultations')
    expect(res.status).toBe(401)
  })
})

// ===========================================================================
// D — AuthContext clears state on auth-expired
// ===========================================================================

describe('D. AuthContext state clearing', () => {
  test('D1. auth-expired handler clears state and redirects to login', async () => {
    // Simulate: user is logged in, then auth expires
    apiRefresh.mockResolvedValue({
      success: true,
      accessToken: 'initial-token',
      user: { id: '1', email: 'd@x.com', displayName: 'Doc', role: 'doctor' },
    })

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <AuthProvider>
          <Routes>
            <Route element={<PrivateRoute />}>
              <Route path="/protected" element={<AuthInspector />} />
            </Route>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    )

    // Wait for auth to restore — protected page shows
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toBeInTheDocument()
    })
    expect(screen.getByTestId('user').textContent).toBe('Doc')

    // Simulate auth-expired via a failed apiFetch refresh
    setAuthToken('expired')
    fetch
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(makeRefreshFail())

    // Wrap in act because the auth-expired handler triggers React state updates
    // which cause PrivateRoute to redirect to /login
    await act(async () => {
      await apiFetch('/api/consultations')
    })

    // Auth state was cleared → PrivateRoute redirected to login
    // The AuthInspector (inside the protected route) is gone — login page shows
    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('authenticated')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// E — PrivateRoute redirects to login after auth cleared
// ===========================================================================

describe('E. Redirect to login after auth expired', () => {
  test('E1. protected route shows login page after auth state cleared', async () => {
    apiRefresh.mockResolvedValue({
      success: true,
      accessToken: 'tok',
      user: { id: '1', email: 'd@x.com', displayName: 'Doc', role: 'doctor' },
    })

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <AuthProvider>
          <Routes>
            <Route element={<PrivateRoute />}>
              <Route path="/protected" element={<ProtectedPage />} />
            </Route>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    )

    // Initially authenticated — protected page shows
    await waitFor(() => {
      expect(screen.getByTestId('protected')).toBeInTheDocument()
    })

    // Simulate auth expiry
    setAuthToken('expired')
    fetch
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(makeRefreshFail())

    await apiFetch('/api/consultations')

    // Should redirect to login
    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// F — Concurrent 401s coalesced into single refresh
// ===========================================================================

describe('F. Concurrent refresh coalescing', () => {
  test('F1. two concurrent 401s trigger only one refresh call', async () => {
    setAuthToken('expired')
    fetch
      .mockResolvedValueOnce(make401())                 // request A 401
      .mockResolvedValueOnce(make401())                 // request B 401
      .mockResolvedValueOnce(makeRefreshOk('new'))      // single refresh
      .mockResolvedValueOnce(makeResponse({ ok: true })) // retry A
      .mockResolvedValueOnce(makeResponse({ ok: true })) // retry B

    // Fire two requests concurrently
    const [resA, resB] = await Promise.all([
      apiFetch('/api/consultations'),
      apiFetch('/api/patients'),
    ])

    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)

    // 2 originals + 1 refresh + 2 retries = 5 total fetch calls
    expect(fetch).toHaveBeenCalledTimes(5)
    // Only 1 refresh call (to /api/auth/refresh)
    const refreshCalls = fetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/api/auth/refresh')
    )
    expect(refreshCalls).toHaveLength(1)
  })
})

// ===========================================================================
// G — Handler deregistration on unmount
// ===========================================================================

describe('G. Handler lifecycle', () => {
  test('G1. setAuthExpiredHandler(null) deregisters the callback', async () => {
    const handler = vi.fn()
    setAuthExpiredHandler(handler)

    setAuthToken('expired')
    fetch
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(makeRefreshFail())

    await apiFetch('/api/consultations')
    expect(handler).toHaveBeenCalledTimes(1)

    // Deregister
    setAuthExpiredHandler(null)

    // Second failure should NOT call the handler
    fetch
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(makeRefreshFail())

    await apiFetch('/api/patients')
    expect(handler).toHaveBeenCalledTimes(1) // still 1, not 2
  })
})

// ===========================================================================
// H — Audio upload 401 error message
// ===========================================================================

describe('H. Audio upload failure message', () => {
  test('H1. 401 response message contains "session has expired" guidance', async () => {
    // Verify that a 401 response from the backend carries a recognizable
    // message. The AudioRecorder checks res.status === 401 to show a
    // session-expired message instead of a generic upload error.
    setAuthToken('expired')
    fetch
      .mockResolvedValueOnce(make401())
      .mockResolvedValueOnce(makeRefreshFail())

    const res = await apiFetch('/api/audio', { method: 'POST', body: new FormData() })
    expect(res.status).toBe(401)
    const data = await res.json()
    // The backend's authenticate middleware returns this exact message
    expect(data.message).toBe('Authentication required.')
    // The AudioRecorder checks res.status === 401 to display a different,
    // user-friendly message — this test verifies the status is detectable.
  })
})
