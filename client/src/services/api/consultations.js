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

/**
 * Create a correction to an approved consultation.
 *
 * POST /api/consultations/:id/correct
 *
 * @param {string} id            The source (approved) consultation _id.
 * @param {object} [noteOverride] Optional note object with doctor edits.
 *                                If omitted the server copies the source note.
 *
 * On success returns { success: true, consultation: <new draft doc> } HTTP 201.
 * The source consultation's supersededBy field is updated server-side.
 */
export async function apiCreateCorrection(id, noteOverride) {
  const body = noteOverride !== undefined ? { note: noteOverride } : {};
  const res  = await apiFetch(`/api/consultations/${id}/correct`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

/**
 * Approve a consultation draft (including correction drafts).
 *
 * Uses the existing PUT /api/consultations/:id endpoint — the same one
 * the V1 review screen uses — by sending { status: 'approved', note }.
 * The note is required so the backend validates chief_complaint.
 *
 * Phase 5E: used on the ConsultationDetailPage to approve correction drafts
 * directly from the detail view, without going through the V1 recording pipeline.
 *
 * @param {string} id   The consultation _id to approve.
 * @param {object} note The full note object from the consultation (must include
 *                      chief_complaint — the backend requires it for approval).
 *
 * Returns { success: true, consultation } or { success: false, message }.
 * 409 = already approved. 400 = validation error (missing chief_complaint).
 */
export async function apiApproveConsultation(id, note) {
  const res = await apiFetch(`/api/consultations/${id}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ status: 'approved', note }),
  });
  return res.json();
}
