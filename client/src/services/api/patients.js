/**
 * Patient API service — thin wrappers around /api/patients endpoints.
 * All calls use apiFetch so the access token is injected automatically
 * and 401 → refresh → retry is handled centrally.
 */
import { apiFetch } from '../../api.js';

/** List the authenticated user's patients. */
export async function apiListPatients({ search = '', archived = false } = {}) {
  const params = new URLSearchParams();
  if (search)   params.set('search', search);
  if (archived) params.set('archived', 'true');

  const qs  = params.toString();
  const res = await apiFetch(`/api/patients${qs ? `?${qs}` : ''}`);
  return res.json();
}

/** Get a single patient by ID. */
export async function apiGetPatient(id) {
  const res = await apiFetch(`/api/patients/${id}`);
  return res.json();
}

/** Create a new patient. */
export async function apiCreatePatient(body) {
  const res = await apiFetch('/api/patients', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

/** Update an existing patient. */
export async function apiUpdatePatient(id, body) {
  const res = await apiFetch(`/api/patients/${id}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

/**
 * Get the consultation history for a specific patient.
 * Returns { success, consultations } — newest first.
 * Requires the patient to belong to the authenticated user.
 */
export async function apiGetPatientConsultations(patientId) {
  const res = await apiFetch(`/api/patients/${patientId}/consultations`);
  return res.json();
}
