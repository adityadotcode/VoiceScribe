/**
 * Central API utility — VoiceScribe
 *
 * Provides:
 *   apiUrl(path)         — build a full URL from a relative /api/... path
 *   apiFetch(path, opts) — authenticated fetch with automatic 401→refresh→retry
 *   setAuthToken(t)      — called by AuthContext when a new access token is issued
 *   clearAuthToken()     — called by AuthContext on logout
 *
 * TOKEN STORAGE RULE:
 *   The access token is kept only in the module-level variable `_accessToken`.
 *   It is never written to localStorage, sessionStorage, IndexedDB, or any cookie.
 *   The refresh token is an HTTP-only cookie managed entirely by the backend.
 */

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

export const apiBase = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Build a full URL from a path that starts with '/api/'.
 * In production VITE_API_BASE_URL is set; in dev the Vite proxy handles /api/*.
 */
export function apiUrl(path) {
  return `${apiBase}${path}`;
}

// ---------------------------------------------------------------------------
// In-memory access token
// ---------------------------------------------------------------------------

let _accessToken = null;
/** True while a token refresh is already in-flight (prevents concurrent races). */
let _refreshInFlight = null;

export function setAuthToken(token) {
  _accessToken = token;
}

export function clearAuthToken() {
  _accessToken = null;
}

export function getAuthToken() {
  return _accessToken;
}

// ---------------------------------------------------------------------------
// Authenticated fetch
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for fetch() that:
 *   1. Injects Authorization: Bearer <accessToken> when a token exists.
 *   2. Always sends credentials: 'include' so the refresh cookie travels.
 *   3. On a 401: attempts one token refresh, then retries the original request.
 *   4. If refresh fails: clears auth state and lets the caller handle it.
 *
 * `opts` accepts the standard RequestInit fields.
 * For FormData bodies do NOT set Content-Type — the browser sets the boundary.
 *
 * @param {string}  path    — relative path starting with '/api/'
 * @param {object}  [opts]  — fetch options (method, body, headers, …)
 * @param {object}  [ctx]   — internal context; do not pass from calling code
 * @returns {Response}
 */
export async function apiFetch(path, opts = {}, ctx = {}) {
  const url = apiUrl(path);

  // Build headers — inject Bearer token if we have one.
  // Never clobber Content-Type for FormData (let the browser set the boundary).
  const headers = new Headers(opts.headers);
  if (_accessToken) {
    headers.set('Authorization', `Bearer ${_accessToken}`);
  }

  const response = await fetch(url, {
    ...opts,
    headers,
    credentials: 'include', // required to send/receive the refresh cookie
  });

  // Not a 401, or this is a recursive retry — return as-is.
  if (response.status !== 401 || ctx._isRetry) {
    return response;
  }

  // ------------------------------------------------------------------
  // 401 path: attempt token refresh, then retry the original request once.
  // ------------------------------------------------------------------

  // Do not attempt to refresh if the failing request IS the refresh endpoint
  // (prevents infinite loop).
  if (path === '/api/auth/refresh' || path === '/api/auth/login') {
    return response;
  }

  // Coalesce concurrent 401s into a single refresh call.
  if (!_refreshInFlight) {
    _refreshInFlight = _doRefresh();
  }

  let refreshed = false;
  try {
    refreshed = await _refreshInFlight;
  } finally {
    _refreshInFlight = null;
  }

  if (!refreshed) {
    // Refresh failed — caller should handle 401 (AuthContext will log out).
    return response;
  }

  // Retry original request once with the new token.
  return apiFetch(path, opts, { _isRetry: true });
}

/**
 * Perform a token refresh.
 * Returns true if a new token was obtained, false otherwise.
 * Updates _accessToken on success.
 */
async function _doRefresh() {
  try {
    const res = await fetch(apiUrl('/api/auth/refresh'), {
      method:      'POST',
      credentials: 'include',
    });

    if (!res.ok) return false;

    const data = await res.json();
    if (data.accessToken) {
      _accessToken = data.accessToken;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
