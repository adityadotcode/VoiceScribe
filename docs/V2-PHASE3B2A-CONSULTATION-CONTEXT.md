# VoiceScribe V2 — Phase 3B.2A: New Consultation — Patient Selection & Context

**Status:** Complete  
**Date:** 2026-09-24  
**Scope:** Frontend only — no backend changes, no AWS changes  
**Tests:** 38 passing (14 new) across 3 suites  
**Build:** Clean — 0 errors, 0 warnings

---

## Overview

Phase 3B.2A introduces the `/consultation/new` page — the entry point for every new clinical encounter in V2. Before recording starts the doctor selects an existing patient, reviews the patient's last approved consultation as context, then clicks **Start consultation**.

The audio/transcription pipeline (`AudioRecorder`, `DashboardApp`) is not modified in this phase. The patientId handoff into the save flow is deferred to Phase 3B.2B (see below).

---

## Route added

| Path | Component | Guard |
|---|---|---|
| `/consultation/new` | `NewConsultationPage` | `PrivateRoute` |

The route is registered inside the existing `PrivateRoute` wrapper in `App.jsx`. A **"New consultation"** link was added to the `TopBar` navigation between "Consultations" and "Patients".

---

## Patient selection flow

```
/consultation/new
  ├── No patient selected
  │     PatientSearchPanel
  │       • debounced search (300 ms) via GET /api/patients?search=…
  │       • pre-populated on mount (empty query → all patients)
  │       • result rows: Last, First · DOB · MR when present
  │       • click a row → patient selected
  │
  └── Patient selected
        SelectedPatientPanel
          • name, DOB, biological sex, medical record ID
          • "Change patient" button → resets to search
        LastApprovedPanel
          • loads GET /api/patients/:id/last-approved
          • shows: consultation date, chief complaint, symptoms,
            medications mentioned, assessment, follow-up
          • empty state: "No previous approved consultation."
          • error state: error message inline

Start consultation button
  • disabled while no patient is selected
  • enabled after selection
  • navigates to /dashboard with router state
    { startRecording: true, patientId, patientName }
    ← see TODO below
```

---

## API calls

| Method | Path | Service function | When |
|---|---|---|---|
| `GET` | `/api/patients?search=…` | `apiListPatients({ search })` | On mount + after 300 ms debounce |
| `GET` | `/api/patients/:id/last-approved` | `apiGetLastApproved(patientId)` | Immediately after patient selected |

Both use `apiFetch` (the existing authenticated helper). No new fetch mechanism was introduced.

### `apiGetLastApproved` behaviour

The backend (`GET /api/patients/:id/last-approved`) returns:
- `{ success: true, consultation: { ... } }` — most recent approved note where `supersededBy: null` and `correctionOf: null` (correction-aware).
- `{ success: false }` with HTTP 404 — no qualifying approved consultation exists.

The `LastApprovedPanel` maps the 404/false case to the empty state: **"No previous approved consultation."**

---

## Components

### `NewConsultationPage` (default export)
Top-level page. Owns `selectedPatient` state. Renders left/right two-column layout.

### `PatientSearchPanel`
- Controlled search input with 300 ms debounce.
- Initial load fires on mount with an empty query.
- Renders a scrollable `role="listbox"` result list.
- Each result is a `<button>` — no auto-selection.

### `SelectedPatientPanel`
- Displays patient name (heading), DOB, biological sex, medical record ID.
- "Change patient" button clears `selectedPatient` → returns to search.

### `LastApprovedPanel`
- Mounted only when a patient is selected; re-fetches when `patientId` changes.
- Cancels in-flight requests on unmount (via `cancelled` flag).
- Displays six note fields: consultation date, chief complaint, symptoms, medications mentioned, assessment, follow-up.
- Handles loading / error / empty states independently.

---

## CSS

Appended `nc-` block to `App.css` (~200 lines). Reuses existing design tokens from `index.css`. No UI library introduced.

Key classes:

| Class | Purpose |
|---|---|
| `.nc-layout` | Two-column grid (collapses to 1 column below 680 px) |
| `.nc-result-btn` | Hoverable patient result row |
| `.nc-selected-patient` | Blue-tinted selected-patient card |
| `.nc-last-approved` | Right-column context card |
| `.nc-start-btn` | Primary CTA; `:disabled` opacity 0.45 |

---

## Tests

**File:** `client/src/tests/newConsultation.test.jsx`  
**Runner:** Vitest + jsdom + @testing-library/react  
**New tests:** 14 | **Total frontend tests:** 38 (all passing)

| # | Describe | Tests | Result |
|---|---|---|---|
| 1 | Patient search | Initial load shows results; typing triggers new API call | ✓ × 2 |
| 2 | Patient selection | Clicking result hides search, shows selected panel | ✓ × 1 |
| 3 | Selected patient display | Name shown; Change patient button; MR shown; Change resets to search | ✓ × 4 |
| 4 | Last-approved context | Chief complaint, assessment, follow-up shown; correct patient ID used | ✓ × 4 |
| 5 | No previous consultation | Empty message shown when API returns `success: false` | ✓ × 1 |
| 6 | Start button state | Disabled before selection; enabled after selection | ✓ × 2 |

Mock strategy: `vi.mock('../services/api/patients.js')` — `apiListPatients` and `apiGetLastApproved` both mocked. `vi.useFakeTimers` controls the 300 ms search debounce. `userEvent` drives clicks and typing.

---

## Build result

```
vite v8.3.0 — production build

dist/index.html                   0.46 kB │ gzip:  0.30 kB
dist/assets/index-KRHr0YzZ.css   52.47 kB │ gzip:  8.38 kB
dist/assets/index-BN9RJVKI.js   334.66 kB │ gzip: 99.24 kB

✓ 39 modules transformed — built in 249ms
0 errors · 0 warnings
```

---

## Remaining Phase 3B.2 integration work

### Phase 3B.2B — patientId handoff into the recording pipeline

**What is missing:**  
`NewConsultationPage` navigates to `/dashboard` with:
```js
navigate('/dashboard', {
  state: { startRecording: true, patientId, patientName }
})
```
`DashboardApp` currently holds all pipeline state internally and does **not** read `location.state`. The `Consultation.create` call in `consultationController` now requires a `patientId`, so any consultation saved from the current `/dashboard` flow without reading this state will receive a 400 error.

**Required changes for Phase 3B.2B:**
1. `DashboardApp` reads `useLocation().state` on mount; if `startRecording: true` + `patientId` are present, transitions immediately to `STAGE.RECORDING` and stores `patientId` in local state.
2. The Bedrock extraction step (or the interim `POST /api/consultations` save) must include `patientId` in the request body.
3. `ClinicalNoteReview` / the save handler must pass `patientId` when creating or updating the consultation document.

### Other deferred items

| Feature | Phase |
|---|---|
| `/consultation/:id` detail page (Open button in history) | 3B.2 or later |
| Correction/amendment workflow | Future |
| Change summary / diff vs last-approved | Future |
| Pre-fill new note fields from last-approved context | Future |
