/**
 * Recording consent API service — Phase 7 / P0-1B
 *
 * Wraps the server-side consent-event endpoint.
 * The server generates an authoritative timestamp and returns a
 * server-issued consentEventId that is threaded through the recording
 * workflow and validated at consultation creation time.
 */
import { apiFetch } from '../../api.js';

/**
 * Create a server-authoritative recording-consent event.
 *
 * POST /api/recording-consents
 *
 * @param {string} patientId  MongoDB ObjectId of the patient for whom
 *                            the doctor is confirming consent.
 *
 * On success returns:
 *   { success: true, consentEventId: string, givenAt: string (ISO) }
 *
 * On failure returns:
 *   { success: false, message: string }
 */
export async function apiCreateRecordingConsent(patientId) {
  const res = await apiFetch('/api/recording-consents', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ patientId }),
  });
  return res.json();
}
