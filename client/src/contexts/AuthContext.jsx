import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { setAuthToken, clearAuthToken, getAuthToken } from '../api.js';
import { apiRegister, apiLogin, apiRefresh, apiLogout } from '../services/api/auth.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * AuthProvider
 *
 * TOKEN STORAGE CONTRACT:
 *   - Access token: React state (_accessToken ref + context value) only.
 *     Never written to localStorage, sessionStorage, IndexedDB, or cookies.
 *   - Refresh token: HTTP-only cookie managed entirely by the backend.
 *     This component never reads or writes the refresh token directly.
 *
 * LIFECYCLE:
 *   1. On mount → attempt silent refresh via POST /api/auth/refresh.
 *      Success: store access token + user in memory, isLoading → false.
 *      Failure: isLoading → false, unauthenticated.
 *   2. login() / register() → update memory state after API success.
 *   3. logout() → call backend, clear memory regardless of API result.
 */
export function AuthProvider({ children }) {
  const [user,        setUser]        = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [isLoading,   setIsLoading]   = useState(true);

  // Keep the api.js module-level token in sync with React state.
  // This allows apiFetch() to read the token without a context subscription.
  const syncToken = useCallback((token) => {
    setAccessToken(token);
    if (token) setAuthToken(token);
    else       clearAuthToken();
  }, []);

  // ── Initial session restoration ──────────────────────────────────────────
  // Called once on mount. Tries to silently restore a session via the
  // refresh cookie. A failure is treated as "not logged in", not an error.
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    (async () => {
      try {
        const data = await apiRefresh();
        if (data?.accessToken) {
          syncToken(data.accessToken);
          setUser(data.user ?? null);
        }
      } catch {
        // Refresh failure is expected when there is no active session.
      } finally {
        setIsLoading(false);
      }
    })();
  }, [syncToken]);

  // ── login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async ({ email, password }) => {
    const data = await apiLogin({ email, password });
    if (!data.success) {
      return { success: false, message: data.message || 'Login failed.' };
    }
    syncToken(data.accessToken);
    setUser(data.user);
    return { success: true };
  }, [syncToken]);

  // ── register ──────────────────────────────────────────────────────────────
  const register = useCallback(async ({ email, password, displayName }) => {
    const data = await apiRegister({ email, password, displayName });
    if (!data.success) {
      return { success: false, message: data.message || 'Registration failed.' };
    }
    syncToken(data.accessToken);
    setUser(data.user);
    return { success: true };
  }, [syncToken]);

  // ── logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    const token = getAuthToken();
    // Clear local state first so the UI responds immediately.
    syncToken(null);
    setUser(null);
    // Notify the backend (clears the refresh cookie + DB hash).
    try { await apiLogout(token); } catch { /* ignore — local state already cleared */ }
  }, [syncToken]);

  // ── refreshAccessToken ────────────────────────────────────────────────────
  // Called by apiFetch() on 401 via the internal _doRefresh helper.
  // Also exposed on context for components that need to trigger it explicitly.
  const refreshAccessToken = useCallback(async () => {
    const data = await apiRefresh();
    if (data?.accessToken) {
      syncToken(data.accessToken);
      if (data.user) setUser(data.user);
      return data.accessToken;
    }
    // Refresh failed — clear auth state so PrivateRoute redirects to login.
    syncToken(null);
    setUser(null);
    return null;
  }, [syncToken]);

  const value = {
    user,
    accessToken,
    isLoading,
    isAuthenticated: Boolean(accessToken),
    login,
    register,
    logout,
    refreshAccessToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
