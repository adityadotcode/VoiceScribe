# VoiceScribe V2 — Phase 3B.1: Patient History UI

**Status:** Complete  
**Date:** 2026-09-24  
**Scope:** Frontend only — no backend changes, no AWS changes  
**Tests:** 24 passing (9 new) across 2 suites  
**Build:** Clean — 0 errors, 0 warnings

---

## Overview

Phase 3B.1 adds a consultation history section to the existing Patient Profile page. It consumes the `GET /api/patients/:id/consultations` endpoint built in Phase 3A and renders the results inline, directly below the patient details card.

The new-consultation flow, patient context panel, last-approved pre-fill, and change summary are all deferred to Phase 3B.2.

---

## History API used

| Method | Path | Service function |
|---|---|---|
| `GET` | `/api/patients/:id/consultations` | `apiGetPatientConsultations(patientId)` |

The call is made through `apiFetch` (the existing authenticated fetch helper in `api.js`) so the Bearer token is injected automatically and the 401 → refresh → retry path is handled centrally. No new fetch mechanism was introduced.

The response shape is `{ success: boolean, consultations: Consultation[] }` where consultations are returned newest-first by the backend.

---

## UI added

### Component structure

```
PatientProfilePage
  └── ConsultationHistorySection   (new, in PatientProfilePage.jsx)
        └── ConsultationRow × N   (one per consultation)
```

Both sub-components live in `PatientProfilePage.jsx` rather than separate files, keeping the change small and self-contained.

### ConsultationHistorySection

Manages its own async state independently from the patient-load state above it. Fires `apiGetPatientConsultations(patientId)` on mount and re-fires when the patient ID changes.

States handled:

| State | What is shown |
|---|---|
| Loading | `"Loading history…"` paragraph with `aria-live="polite"` |
| Error (API `success: false`) | Error message with a Retry button |
| Error (network rejection) | `"Network error — could not load consultation history."` |
| Empty | `"No consultations recorded for this patient yet."` |
| Normal | Ordered list of `ConsultationRow` items, newest first |

A Refresh button (↻) appears in the section header once loading completes.

### ConsultationRow

Each row shows:

- **Date** — `consultationDate` (falls back to `createdAt` if absent)
- **Status badge** — `draft` (grey) or `approved` (green)
- **Correction badge** — amber `"correction"` badge when `correctionOf` is set
- **Superseded badge** — grey strikethrough `"superseded"` badge when `supersededBy` is set; the entire row is also reduced to 55% opacity
- **Chief complaint** — primary text; falls back to italic `"No chief complaint recorded"`
- **Encounter type** — secondary label (`in_person` → `"in person"`, `telemedicine`, `upload`)
- **Open button** — disabled with tooltip `"Consultation detail view coming in a future update"` (deferred to Phase 3B.2; `/consultation/:id` route does not yet exist)

---

## Correction display behaviour

The Phase 3A schema stores two correction chain fields on every consultation:

| Field | Meaning |
|---|---|
| `correctionOf` | This note corrects an earlier consultation (this is the amendment) |
| `supersededBy` | This note has been replaced by a newer correction (this is the original) |

**Display rules in Phase 3B.1:**

- A note with `correctionOf` set gets an amber **"correction"** badge — it is the current, active version.
- A note with `supersededBy` set gets a grey strikethrough **"superseded"** badge and its row is visually de-emphasised (opacity 0.55) — it is the old version that was replaced.
- A note with neither field set is a standalone approved or draft note — no extra badge.
- Both badges can appear on a single row only if the data is in an inconsistent state (edge case not expected in normal use).

Correction documents are **not** filtered out of the list — they appear in the timeline in date order so the doctor can see the full amendment history. The visual treatment (badge + opacity) is sufficient to distinguish active from superseded notes without hiding data.

---

## CSS

All new styles use the `ph-` prefix (patient history) and were appended to `App.css`. They reuse the existing design tokens from `index.css`:

| Token | Used for |
|---|---|
| `--surface`, `--border`, `--radius-lg/md` | Section card and row containers |
| `--text-h`, `--text`, `--text-sub` | Text hierarchy |
| `--green`, `--green-bg`, `--green-border` | Approved badge |
| `--amber`, `--amber-bg`, `--amber-border` | Correction badge |
| `--red`, `--red-bg`, `--red-border` | Error state |
| `--brand` | Focus ring (inherited) |

No UI library was introduced.

---

## Files changed

| File | Change |
|---|---|
| `client/src/services/api/patients.js` | Added `apiGetPatientConsultations(patientId)` |
| `client/src/pages/PatientProfilePage.jsx` | Replaced placeholder section with `ConsultationHistorySection` + `ConsultationRow` |
| `client/src/App.css` | Appended `ph-` CSS block (~120 lines) |
| `client/src/tests/patientHistory.test.jsx` | New — 9 tests |

---

## Tests

**File:** `client/src/tests/patientHistory.test.jsx`  
**Runner:** Vitest + jsdom + @testing-library/react  
**New tests:** 9 | **Total frontend tests:** 24 (all passing)

| # | Describe | Test | Result |
|---|---|---|---|
| 1a | History loads and displays | Renders chief complaint and status badge | ✓ |
| 1b | History loads and displays | Calls API with correct patient ID | ✓ |
| 2 | Loading state | Shows loading message while fetch is in-flight | ✓ |
| 3 | Empty state | Shows empty message when no consultations exist | ✓ |
| 4a | Error state | Shows error when API returns `success: false` | ✓ |
| 4b | Error state | Shows network error message on fetch rejection | ✓ |
| 5a | Correction indicators | Renders "correction" badge when `correctionOf` is set | ✓ |
| 5b | Correction indicators | Renders "superseded" badge when `supersededBy` is set | ✓ |
| 5c | Correction indicators | Open button is disabled (deferred) | ✓ |

Mock strategy: `vi.mock('../services/api/patients.js')` intercepts both `apiGetPatient` (patient header) and `apiGetPatientConsultations` (history section). Rendered via `MemoryRouter` at `/patients/:id` — no real network calls.

---

## Build result

```
vite v8.3.0 — production build

dist/index.html                   0.46 kB │ gzip:  0.29 kB
dist/assets/index-CTPfIUn6.css   47.76 kB │ gzip:  7.85 kB
dist/assets/index-CZOpZHbK.js   327.74 kB │ gzip: 97.99 kB

✓ 38 modules transformed — built in 258ms
0 errors · 0 warnings
```

---

## Deferred to Phase 3B.2

| Feature | Why deferred |
|---|---|
| `/consultation/:id` route and ConsultationDetailPage | Requires new page, route, and API call — out of scope for 3B.1 |
| Open button becomes a working link | Depends on the route above |
| New consultation flow from Patient Profile | Separate spec item — requires patient context panel |
| Last-approved pre-fill for new encounters | Depends on new consultation flow |
| Change summary / diff view | Depends on correction UI architecture |
