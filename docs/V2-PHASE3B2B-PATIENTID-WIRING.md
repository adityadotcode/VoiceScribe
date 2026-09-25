# VoiceScribe V2 — Phase 3B.2B: patientId Wiring

**Status:** Complete  
**Date:** 2026-09-24  
**Scope:** Frontend only — no backend changes, no AWS changes  
**Tests:** 45 passing (7 new) across 4 suites  
**Build:** Clean — 0 errors, 0 warnings

---

## Overview

Phase 3B.2B closes the final gap between the patient-selection screen (`/consultation/new`) and the consultation save call. After this phase, when a doctor selects a patient in `NewConsultationPage` and clicks **Start consultation**, the `patientId` is preserved all the way into the `POST /api/consultations` body so the backend can create the consultation under the correct patient record.

AudioRecorder, the transcription pipeline, and Bedrock extraction are unchanged. The change is minimal: two component edits and one new test file.

---

## How patientId flows through the frontend

```
/consultation/new  (NewConsultationPage)
  └── Doctor selects patient
  └── clicks "Start consultation"
        navigate('/dashboard', {
          state: { startRecording: true, patientId, patientName }
        })

/dashboard  (DashboardApp — App.jsx)
  └── useEffect on mount reads location.state
        setActivePatientId(state.patientId)
        setActivePatientName(state.patientName)
        if state.startRecording → setStage(STAGE.RECORDING)
  └── Doctor records → Transcribe → Bedrock → STAGE.REVIEW
  └── renders ClinicalNoteReview with:
        patientId={activePatientId}
        patientName={activePatientName}
  └── handleBack() clears both to null

ClinicalNoteReview.jsx
  └── saveDraft()  / approveNote()
        if (!consultationId && !patientId) → validation error, no fetch
        payload = { ..., patientId }   ← only on POST (new doc)
        apiSave(consultationId, payload)
          consultationId null  → POST /api/consultations  (includes patientId)
          consultationId set   → PUT  /api/consultations/:id (patientId omitted)
```

---

## Where `POST /api/consultations` is performed

**File:** `client/src/ClinicalNoteReview.jsx`  
**Function:** `apiSave(consultationId, payload)` — a module-local async helper that calls `apiFetch`.

```js
// New consultation (POST):
const res = await apiFetch('/api/consultations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),  // payload includes patientId
})

// Existing consultation (PUT) — patientId NOT in body, backend ignores it anyway:
const res = await apiFetch(`/api/consultations/${consultationId}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
```

`userId` is never included in either payload — ownership is always derived from the Bearer token on the backend.

---

## Validation

`ClinicalNoteReview` enforces the patientId requirement at the **save layer**:

| Condition | What happens |
|---|---|
| New consultation (`consultationId === null`) + `patientId` present | `patientId` included in POST body → proceeds normally |
| New consultation + `patientId` missing | Validation error shown; `apiFetch` is NOT called |
| Existing consultation (`consultationId` set) | PUT proceeds regardless of `patientId` prop (already stored on backend) |

Error message: `"No patient selected. Go back and select a patient before saving."`

---

## Patient name banner

When `patientName` is supplied as a prop, a blue banner is displayed at the top of the review screen:

```
👤  Patient: Alice Smith
```

`role="status"`, `aria-label="Selected patient"`. Hidden when `patientName` is `null` (e.g. consultations opened from the V1 history list where no patient was selected).

---

## Files changed

| File | Change |
|---|---|
| `client/src/App.jsx` | Added `useLocation`; `DashboardApp` reads `location.state` on mount, holds `activePatientId`/`activePatientName`, clears on `handleBack`, passes both to `ClinicalNoteReview` |
| `client/src/ClinicalNoteReview.jsx` | Added `patientId`/`patientName` props; `saveDraft` and `approveNote` guard + include `patientId` in POST; patient name banner rendered |
| `client/src/App.css` | Added `.cnr-patient-banner` styles |
| `client/src/tests/patientIdWiring.test.jsx` | New — 7 tests |
| `client/src/tests/patientHistory.test.jsx` | Added defensive `api.js` mock to prevent cross-test contamination |
| `client/src/tests/newConsultation.test.jsx` | Added defensive `api.js` mock to prevent cross-test contamination |

---

## Tests

**File:** `client/src/tests/patientIdWiring.test.jsx`  
**Runner:** Vitest + jsdom + @testing-library/react  
**New tests:** 7 | **Total frontend tests:** 45 (all passing)

| # | Describe | Test | Result |
|---|---|---|---|
| 1a | Patient name banner | Banner shown when `patientName` prop is set | ✓ |
| 1b | Patient name banner | No banner when `patientName` is null | ✓ |
| 2 | POST includes patientId (draft) | `patientId` present in fetch body on save draft | ✓ |
| 3 | POST includes patientId (approve) | `patientId` present in fetch body on approve | ✓ |
| 4a | Missing patientId prevents save | Save draft shows alert, `apiFetch` not called | ✓ |
| 4b | Missing patientId prevents save | Approve shows alert, `apiFetch` not called | ✓ |
| 5 | Existing consultation PUT | PUT to `/api/consultations/:id` succeeds without `patientId` prop | ✓ |

Mock strategy: `vi.mock('../api.js')` intercepts `apiFetch` at the module level. `ClinicalNoteReview` is rendered directly via `MemoryRouter`. Cross-test contamination fixed by adding a matching `api.js` mock to `patientHistory.test.jsx` and `newConsultation.test.jsx`.

---

## Build result

```
vite v8.3.0 — production build

dist/index.html                   0.46 kB │ gzip:  0.30 kB
dist/assets/index-aYCK_0qD.css   52.76 kB │ gzip:  8.42 kB
dist/assets/index-BAZ-4uVB.js   335.49 kB │ gzip: 99.47 kB

✓ 39 modules transformed — built in 227ms
0 errors · 0 warnings
```

---

## Remaining work

Phase 3B.2B completes the patient selection → record → save pipeline. Nothing structural is deferred from this phase.

Items that remain for future phases:

| Item | Notes |
|---|---|
| `/consultation/:id` detail page | Open button in patient history is still disabled |
| Correction / amendment UI | `correctionOf` / `supersededBy` write endpoints not yet exposed in the frontend |
| Pre-fill new note fields from last-approved context | Last-approved data is displayed as read-only context; it is not yet copied into the new note's fields |
| Change summary / diff view | Architectural work deferred post-3B |
| Dashboard "New consultation" button wiring | The `+ New consultation` button inside `Dashboard.jsx` still starts a recording directly without patient selection — it should route to `/consultation/new` to enforce the V2 flow |
