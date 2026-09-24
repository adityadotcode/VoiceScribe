/**
 * Auth API service — thin wrappers around the Phase 1A auth endpoints.
 * All calls use fetch() directly (not apiFetch) because auth routes are public
 * and do not need an Authorization header or 401-retry logic.
 * credentials: 'include' is always set so the refresh cookie travels correctly.
 */
import { apiUrl } from '../../api.js';

export async function apiRegister({ email, password, displayName }) {
  const res = await fetch(apiUrl('/api/auth/register'), {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json' },
    credentials: 'include',
    body:        JSON.stringify({ email, password, displayName }),
  });
  return res.json();
}

export async function apiLogin({ email, password }) {
  const res = await fetch(apiUrl('/api/auth/login'), {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json' },
    credentials: 'include',
    body:        JSON.stringify({ email, password }),
  });
  return res.json();
}

export async function apiRefresh() {
  const res = await fetch(apiUrl('/api/auth/refresh'), {
    method:      'POST',
    credentials: 'include',
  });
  if (!res.ok) return null;
  return res.json();
}

export async function apiLogout(accessToken) {
  await fetch(apiUrl('/api/auth/logout'), {
    method:      'POST',
    credentials: 'include',
    headers:     accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}

export async function apiMe(accessToken) {
  const res = await fetch(apiUrl('/api/auth/me'), {
    credentials: 'include',
    headers:     { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}
