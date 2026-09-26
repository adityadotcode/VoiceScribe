# VoiceScribe V2 — Phase 3C.1: Consultation Detail Page

**Status:** Complete  
**Date:** 2026-09-24  
**Scope:** Frontend only — no backend changes, no AWS changes  
**Tests:** 58 passing (13 new) across 5 suites  
**Build:** Clean — 0 errors, 0 warnings

---

## Overview

Phase 3C.1 makes consultations in a patient's history actually openable. It adds a read-only `ConsultationDetailPage` at `/consultation/:id`, wires the Open action in the patient history list to navigate to that page, and exposes all clinical note fields including correction chain indicators.

---

## Route added

| Path | Component | Guard |
|---|---|---|
| `/consultation/:id` | `ConsultationDetailPage` | `PrivateRoute` |

The route is registered inside the existing `PrivateRoute` block in `App.jsx`, between `/consultation/new` and `/patients`.

---

## API used

| Method | Path | Service function | Location |
|---|---|---|---|
| `GET` | `/api/consultations/:id` | `apiGetConsultation(id)` | `client/src/services/api/consultations.js` (new file) |

`consultations.js` follows the same pattern as `patients.js` — a thin wrapper around `apiFetch` so the Bearer token is injected automatically and 401 → refresh → retry is handled centrally.

The backend endpoint (`getConsultation`) enforces ownership at the query level: it filters by both `_id` and `req.user.id`, returning `null` → 404 for documents that don't belong to the requesting user. The frontend never tries to determine ownership itself.

---

## Displayed fields

### Metadata card

| Field | Source |
|---|---|
| Consultation date | `consultation.consultationDate` (falls back to `createdAt`) |
| Encounter type | `consultation.encounterType` (mapped: `in_person` → "In person") |
| Status | `consultation.status` |
| Created | `consultation.createdAt` |
| Approved at | `consultation.approvedAt` (shown only when approved) |

### Clinical note

All fields from the `note` sub-document:

| Field | Type | Rendered as |
|---|---|---|
| Chief complaint | String | Plain text |
| Duration / onset | String | Plain text |
| History | String | Plain text (pre-wrap) |
| Assessment | String | Plain text |
| Follow-up | String | Plain text |
| Symptoms | String[] | Pill tags |
| Observations | String[] | Pill tags |
| Medications mentioned | String[] | Pill tags |
| Missing information | String[] | Pill tags |
| Uncertain fields | String[] | Pill tags |
| Legacy patient info (V1) | `note.patient.{name,age,sex}` | Separate section, shown only when present |

### Conversation / transcript

- **Detected languages** — rendered as labelled chips with approximate spoken duration.
- **Speaker utterances** — ordered list with speaker label, optional role badge (if assigned during original review), and timestamp.
- **Raw transcript** — scrollable pre-wrap box, always shown when present.

---

## Navigation behavior

- **From patient history (normal path):** Patient Profile → Open link → `/consultation/:id`. Back button reads `consultation.patientId` and navigates to `/patients/:patientId` when present.
- **Without patientId (V1 consultations):** Back button calls `navigate(-1)` (browser history).
- **Correction chain:** Banners include `<Link>` elements to jump directly to the related original or correcting consultation.

---

## Correction indicators

| Condition | Banner shown |
|---|---|
| `correctionOf` is set | Amber — "This note corrects an earlier consultation." + "View original" link |
| `supersededBy` is set | Grey — "This note has been superseded by a correction." + "View correction" link |
| Neither | No banner |

Both conditions can be true simultaneously only in an inconsistent data state; the UI handles it gracefully by showing both banners.

---

## Patient Profile changes

`PatientProfilePage.jsx` (`ConsultationRow`):
- `Link` imported from `react-router-dom`.
- Disabled `<button>` replaced with active `<Link to="/consultation/:id">` (class `ph-open-btn ph-open-btn--active`).
- `aria-label` updated to include the consultation date for screen reader context.

---

## Files changed

| File | Change |
|---|---|
| `client/src/services/api/consultations.js` | New — `apiGetConsultation(id)` |
| `client/src/pages/ConsultationDetailPage.jsx` | New — full read-only detail page |
| `client/src/App.jsx` | Imported `ConsultationDetailPage`; added `Route path="/consultation/:id"` |
| `client/src/pages/PatientProfilePage.jsx` | Imported `Link`; replaced disabled Open button with active Link |
| `client/src/App.css` | Appended `cd-` CSS block + `.ph-open-btn--active` |
| `client/src/tests/consultationDetail.test.jsx` | New — 13 tests |
| `client/src/tests/patientHistory.test.jsx` | Updated Open-button test to expect active Link; added route stub |

---

## Tests

**File:** `client/src/tests/consultationDetail.test.jsx`  
**Runner:** Vitest + jsdom + @testing-library/react  
**New tests:** 13 | **Total frontend tests:** 58 (all passing)

| # | Describe | Tests | Result |
|---|---|---|---|
| 1 | Consultation loads successfully | Chief complaint shown; correct ID passed to API | ✓ × 2 |
| 2 | Loading state | "Loading consultation…" shown during fetch | ✓ × 1 |
| 3 | 404 / not-found | "Consultation not found." shown on `success: false` | ✓ × 1 |
| 4 | Error state | Network error message on fetch rejection | ✓ × 1 |
| 5 | Fields display | Assessment, follow-up, symptom pill, transcript, detected language | ✓ × 5 |
| 6 | Open action navigation | Link from Patient Profile has correct `/consultation/:id` href | ✓ × 1 |
| 7 | Correction indicators | Correction banner; superseded banner | ✓ × 2 |

**Updated:** `patientHistory.test.jsx` — test "Open button is disabled (deferred to Phase 3B.2)" replaced with "Open link is active and navigates to /consultation/:id (Phase 3C.1)".

---

## Build result

```
vite v8.3.0 — production build

dist/index.html                   0.46 kB │ gzip:   0.29 kB
dist/assets/index-BH0Uidu_.css   56.97 kB │ gzip:   8.91 kB
dist/assets/index-BlKxLWHS.js   342.73 kB │ gzip: 101.02 kB

✓ 41 modules transformed — built in 1.62 s
0 errors · 0 warnings
```

---

## Remaining work

| Item | Notes |
|---|---|
| Consultation editing / re-approval | The detail page is read-only. Editing requires redesigning `ClinicalNoteReview` to accept a pre-loaded consultation — out of scope for 3C.1 |
| Correction creation UI | Writing a `correctionOf` link on a new consultation — depends on consultation editing |
| Dashboard "New consultation" button | Still bypasses `/consultation/new` — should route there to enforce the V2 patient-first flow |
| Pre-fill new note from last-approved | Last-approved data shown as context only; not yet copied into new note fields |
| Change summary / diff view | Post-3C architecture work |
