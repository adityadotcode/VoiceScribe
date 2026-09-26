/**
 * Consultation API service — thin wrappers around /api/consultations endpoints.
 * All calls use apiFetch so the access token is injected automatically
 * and 401 → refresh → retry is handled centrally.
 */
import { apiFetch } from '../../api.js';

/**
 * Fetch a single consultation by ID.
 * Returns { success: true, consultation } or { success: false, message }.
 * 404 is returned as { success: false } — the backend never reveals
 * whether the document exists but belongs to another user.
 */
export async function apiGetConsultation(id) {
  const res = await apiFetch(`/api/consultations/${id}`);
  return res.json();
}
