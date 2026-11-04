/**
 * PatientPortalAuthContext
 *
 * Mirrors the structure of AuthContext but for patient accounts.
 * The access token is kept in memory only — never localStorage.
 * The refresh cookie is HTTP-only, managed by the backend.
 *
 * Deliberately separate from AuthContext so doctor and patient identities
 * can never be confused in the same context value.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  apiPatientLogin,
  apiPatientRefresh,
  apiPatientLogout,
  apiPatientRegister,
} from '../services/api/patientPortal.js';

const PatientPortalAuthContext = createContext(null);

export function PatientPortalAuthProvider({ children }) {
  const [account,     setAccount]     = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [isLoading,   setIsLoading]   = useState(true);

  const isAuthenticated = Boolean(accessToken && account);

  // Attempt silent refresh on mount
  useEffect(() => {
    apiPatientRefresh()
      .then((data) => {
        if (data?.success) {
          setAccessToken(data.accessToken);
          setAccount(data.account);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await apiPatientLogin(credentials);
    if (data?.success) {
      setAccessToken(data.accessToken);
      setAccount(data.account);
    }
    return data;
  }, []);

  const register = useCallback(async (fields) => {
    const data = await apiPatientRegister(fields);
    if (data?.success) {
      setAccessToken(data.accessToken);
      setAccount(data.account);
    }
    return data;
  }, []);

  const logout = useCallback(async () => {
    try { await apiPatientLogout(accessToken); } catch { /* ignore */ }
    setAccessToken(null);
    setAccount(null);
  }, [accessToken]);

  return (
    <PatientPortalAuthContext.Provider
      value={{ account, accessToken, isAuthenticated, isLoading, login, register, logout }}
    >
      {children}
    </PatientPortalAuthContext.Provider>
  );
}

export function usePatientAuth() {
  const ctx = useContext(PatientPortalAuthContext);
  if (!ctx) throw new Error('usePatientAuth must be used inside PatientPortalAuthProvider');
  return ctx;
}
