# VoiceScribe V2 — Phase 4C: Change Summary UI

**Status:** Complete  
**Date:** 2026-09-24  
**Scope:** Frontend only — no backend, no Bedrock, no AWS  
**Tests:** 77 passing (17 new) across 7 suites  
**Build:** Clean — 0 errors, 0 warnings

---

## Component created

`client/src/components/consultation/ChangeSummaryPanel.jsx`

A self-contained React component that lets the doctor explicitly request a deterministic comparison between the current consultation and the previous effective approved consultation for the same patient.

---

## API used

| Method | Path | Service function | When called |
|---|---|---|---|
| `POST` | `/api/patients/:patientId/change-summary` | `apiGetChangeSummary(patientId, consultationId)` | Only when the doctor clicks "Compare with previous visit" — never on mount |

`apiGetChangeSummary` was added to `client/src/services/api/patients.js`. It uses `apiFetch` so the Bearer token is injected automatically.

---

## User-triggered behavior

The panel is added to `ConsultationDetailPage` whenever the consultation has a `patientId`. It starts in an idle state showing only a single button.

```
[Compare with previous visit]     ← idle state
           ↓ click
  Comparing with previous visit…  ← loading state
           ↓ result
  ┌──────────────────────────────────────┐
  │ Comparison with previous visit   [✕] │
  │ Compared with 1 August 2026          │
  │                                      │
  │ New symptoms                         │
  │  ● fatigue  ● headache               │
  │                                      │
  │ Assessment  [changed]                │
  └──────────────────────────────────────┘
```

The `[✕]` button resets to idle so the doctor can dismiss the panel without refreshing the page.

---

## Display rules

### Array fields — only rendered when non-empty

| Label | Diff key |
|---|---|
| New symptoms | `newSymptoms` |
| Resolved symptoms | `resolvedSymptoms` |
| Persisting symptoms | `persistingSymptoms` |
| New medications mentioned | `newMedicationsMentioned` |
| Stopped medications mentioned | `stoppedMedicationsMentioned` |
| New observations | `newObservations` |
| Resolved observations | `resolvedObservations` |

**Medications are always labelled as "mentioned" — never as prescriptions or confirmed medication changes.**

### Boolean flags — only rendered when `true`

| Label | Diff key |
|---|---|
| Chief complaint | `chiefComplaintChanged` |
| Assessment | `assessmentChanged` |
| Follow-up | `followUpChanged` |
| History | `historyChanged` |

A boolean flag that is `false` is silently skipped — it is not shown as "unchanged".

### Special states

| State | Shown when |
|---|---|
| No previous consultation | `hasPreviousConsultation: false` |
| No changes detected | Previous consultation exists but diff is entirely empty |
| Error | Network failure or `success: false` from API |

Error messages never expose backend internals.

---

## Where it appears

`ConsultationDetailPage.jsx` renders `ChangeSummaryPanel` at the bottom of the page when `c.patientId` is present. Consultations without a patient link (V1 documents) do not show the panel.

---

## Files changed

| File | Change |
|---|---|
| `client/src/services/api/patients.js` | Added `apiGetChangeSummary(patientId, consultationId)` |
| `client/src/components/consultation/ChangeSummaryPanel.jsx` | New component |
| `client/src/pages/ConsultationDetailPage.jsx` | Imported `ChangeSummaryPanel`; rendered at page bottom when `patientId` present |
| `client/src/App.css` | Appended `cs-` CSS block |
| `client/src/tests/changeSummary.test.jsx` | New — 17 tests |

---

## Tests

**File:** `client/src/tests/changeSummary.test.jsx`  
**Runner:** Vitest + jsdom + @testing-library/react  
**New tests:** 17 | **Total frontend tests:** 77 (all passing)

| # | Describe | Tests | Result |
|---|---|---|---|
| 1 | Trigger button renders | Button present on idle | ✓ × 1 |
| 2 | API not called initially | `apiGetChangeSummary` not called on mount | ✓ × 1 |
| 3 | Clicking button calls API | Correct patientId + consultationId passed | ✓ × 1 |
| 4 | Loading state | Loading message shown in-flight | ✓ × 1 |
| 5 | No previous consultation | Correct message displayed | ✓ × 1 |
| 6 | Array changes display | New/resolved symptoms, medication labelling, date shown | ✓ × 4 |
| 7 | Boolean flag display | Assessment/chiefComplaint flags shown/hidden correctly | ✓ × 3 |
| 8 | No-changes state | "No changes detected" message shown | ✓ × 1 |
| 9 | API error state | Error message shown; no internals leaked | ✓ × 2 |
| 10 | Missing IDs | Panel renders nothing when patientId or consultationId absent | ✓ × 2 |

---

## Build result

```
vite v8.3.0 — production build

dist/index.html                   0.46 kB │ gzip:   0.29 kB
dist/assets/index-D7onM_KO.css   59.32 kB │ gzip:   9.14 kB
dist/assets/index-BDn06wNF.js   346.85 kB │ gzip: 101.84 kB

✓ 42 modules transformed — built in 2.81 s
0 errors · 0 warnings
```

---

## Remaining Phase 4D work

| Item | Notes |
|---|---|
| Bedrock/LLM narrative summary | Phase 4D — calls Bedrock with structured diff as context; returns an AI-written paragraph; explicitly NOT part of Phase 4C |
| Pre-fill new note from last-approved context | Separate UX task; related to correction workflow |
| Diff for `duration`, `missing_information`, `uncertain_fields` | Not in Phase 4A spec; addable without breaking existing output |
| Persisting symptoms visibility | Currently shown in pill list; could be de-emphasised in future UX iteration |
