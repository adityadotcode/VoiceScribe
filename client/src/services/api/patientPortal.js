/**
 * Patient Portal API service
 *
 * All calls use fetch() directly (no apiFetch / doctor auth interceptor).
 * Patient tokens are stored in PatientPortalAuthContext — separate from the
 * doctor AuthContext — so the two identities never mix.
 *
 * credentials: 'include' is always set so the refresh cookie travels.
 */
import { apiUrl } from '../../api.js';

// ── helpers ──────────────────────────────────────────────────────────────

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ── Doctor-side portal management (uses apiFetch — doctor auth) ──────────

import { apiFetch } from '../../api.js';

/**
 * Issue a portal invite for a patient.
 * Requires doctor authentication (Bearer token via apiFetch).
 * POST /api/patient-portal/auth/invite
 * Returns { success, inviteToken, expiresAt } on 201.
 * Returns { success: false, message } on 409 (already exists) or 404.
 */
export async function apiIssueInvite(patientId) {
  const res = await apiFetch('/api/patient-portal/auth/invite', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ patientId }),
  });
  return res.json();
}

// ── Auth ─────────────────────────────────────────────────────────────────

export async function apiPatientRegister({ inviteToken, email, password, displayName }) {
  const res = await fetch(apiUrl('/api/patient-portal/auth/register'), {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json' },
    credentials: 'include',
    body:        JSON.stringify({ inviteToken, email, password, displayName }),
  });
  return res.json();
}

export async function apiPatientLogin({ email, password }) {
  const res = await fetch(apiUrl('/api/patient-portal/auth/login'), {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json' },
    credentials: 'include',
    body:        JSON.stringify({ email, password }),
  });
  return res.json();
}

export async function apiPatientRefresh() {
  const res = await fetch(apiUrl('/api/patient-portal/auth/refresh'), {
    method:      'POST',
    credentials: 'include',
  });
  if (!res.ok) return null;
  return res.json();
}

export async function apiPatientLogout(token) {
  await fetch(apiUrl('/api/patient-portal/auth/logout'), {
    method:      'POST',
    headers:     authHeaders(token),
    credentials: 'include',
  });
}

export async function apiPatientMe(token) {
  const res = await fetch(apiUrl('/api/patient-portal/auth/me'), {
    headers:     authHeaders(token),
    credentials: 'include',
  });
  return res.json();
}

// ── Records ───────────────────────────────────────────────────────────────

export async function apiGetOwnPatient(token) {
  const res = await fetch(apiUrl('/api/patient-portal/records/patient'), {
    headers:     authHeaders(token),
    credentials: 'include',
  });
  return res.json();
}

export async function apiListPatientConsultations(token) {
  const res = await fetch(apiUrl('/api/patient-portal/records/consultations'), {
    headers:     authHeaders(token),
    credentials: 'include',
  });
  return res.json();
}

export async function apiGetPatientConsultation(token, id) {
  const res = await fetch(apiUrl(`/api/patient-portal/records/consultations/${id}`), {
    headers:     authHeaders(token),
    credentials: 'include',
  });
  return res.json();
}
