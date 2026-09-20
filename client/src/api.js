/**
 * Central API base-URL helper.
 *
 * In development:  VITE_API_BASE_URL is not set, so apiBase is '' (empty).
 *   All fetch('/api/...') calls go to the Vite dev-proxy → localhost:5000.
 *
 * In production:   Set VITE_API_BASE_URL to the deployed backend URL, e.g.
 *   VITE_API_BASE_URL=https://api.voicescribe.example.com
 *   All fetch calls then go to https://api.voicescribe.example.com/api/...
 *
 * Usage:
 *   import { apiUrl } from './api.js'
 *   fetch(apiUrl('/api/health'))
 */
export const apiBase = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Build a full API URL from a path that starts with '/api/'.
 * @param {string} path  e.g. '/api/health' or '/api/consultations/123'
 * @returns {string}
 */
export function apiUrl(path) {
  return `${apiBase}${path}`;
}
