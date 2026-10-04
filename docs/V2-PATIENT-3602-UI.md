# VoiceScribe V2 — Patient 360.2: Patient 360° UI

**Status:** Complete  
**Date:** 2026-10-02  
**Scope:** Frontend only — no backend, no API, no AWS changes  
**Tests:** 107 passing (21 new) across 9 suites  
**Build:** Clean — 0 errors, 0 warnings, 43 modules

---

## Overview API used

```
GET /api/patients/:id/overview
```

Service function: `apiGetPatientOverview(patientId)` — added to `client/src/services/api/patients.js`.

The page makes **one API call** on mount. The overview endpoint returns the patient record, aggregate statistics, latest effective approved consultation, and 5 most recent consultations in a single response. This replaces the previous `apiGetPatient` + `apiGetPatientConsultations` two-call pattern.

---

## Page sections

### Patient header

Displays the patient's identity and contact information:
- Full name (large heading)
- Medical record ID badge (when present)
- Date of birth
- Biological sex
- Phone

### Statistics cards (4 tiles)

| Card | Value | Accent |
|---|---|---|
| Total consultations | `statistics.totalConsultations` | Neutral |
| Approved | `statistics.approvedConsultations` | Green left border |
| Draft | `statistics.draftConsultations` | Amber left border |
| Last visit | `statistics.lastConsultationDate` | Brand left border |

Correction documents are **excluded** from all counts — they are not independent clinical encounters. This is enforced by the backend aggregate query (`correctionOf: null`).

### Latest approved visit

Shows the most recent effective approved consultation with:
- Consultation date
- Chief complaint
- Symptoms (comma-separated)
- Medications mentioned (comma-separated)
- Assessment
- Follow-up

Empty state: `"No approved consultation available yet."`

This section uses the `latestApprovedConsultation` field from the overview response, which is `null` when no effective approved consultation exists.

### Recent consultations timeline

Shows up to 5 consultations sorted newest first. Each item shows:
- Date
- Status badge (approved / draft)
- Chief complaint
- Correction/superseded badge when applicable
- Open link → `/consultation/:id`

Empty state: `"No consultations recorded for this patient yet."`

---

## Timeline behavior

Consultations are sorted by `consultationDate` descending (newest first). Correction documents **do** appear in the timeline — the doctor needs full chronological audit visibility. The `correctionOf` / `supersededBy` badges distinguish them visually from standalone encounters.

Superseded rows are visually de-emphasised (opacity 0.55) to indicate they are no longer the current record.

---

## Correction display

| Condition | Visual treatment |
|---|---|
| `correctionOf` is set | Amber `"correction"` badge |
| `supersededBy` is set | Grey strikethrough `"superseded"` badge + row opacity 0.55 |
| Neither | No badge |

Correction data is read-only — no write operations are performed on the correction chain by this page.

---

## Loading / error states

| State | What is shown |
|---|---|
| Loading | `"Loading patient…"` (full-page) |
| API error (`success: false`) | Error message from API with Retry button |
| Network failure | `"Network error — could not load patient overview."` with Retry button |
| Patient not found | Error message with Retry button |
| Successful | Full 360° layout |

---

## Files changed

| File | Change |
|---|---|
| `client/src/services/api/patients.js` | Added `apiGetPatientOverview(patientId)` |
| `client/src/pages/PatientProfilePage.jsx` | Rewrote view mode as Patient 360° layout; edit mode unchanged |
| `client/src/App.css` | Appended `p360-` CSS block |
| `client/src/tests/patient360.test.jsx` | New — 12 focused tests |
| `client/src/tests/patientHistory.test.jsx` | Migrated from old API mocks to `apiGetPatientOverview` |
| `client/src/tests/consultationDetail.test.jsx` | Added `apiGetPatientOverview` to mock; updated test 6 |

---

## Tests

### New: `patient360.test.jsx` (12 tests)

| # | Describe | Test |
|---|---|---|
| 1 | Overview loads | Name, DOB, sex, MR, phone rendered |
| 2 | Statistics | All four stat values visible |
| 3 | Latest approved visit | Chief complaint, assessment, follow-up shown |
| 4 | No approved consultation | Empty state message displayed |
| 5a | Timeline | Both recent consultations displayed |
| 5b | Timeline | Empty state when no consultations |
| 6 | Correction indicator | `"correction"` badge shown |
| 7 | Superseded indicator | `"superseded"` badge shown |
| 8 | Open link | Correct `/consultation/:id` href |
| 9 | Loading | `"Loading patient…"` shown in-flight |
| 10a | Error | API failure shows error message |
| 10b | Error | Network failure shows error message |

### Migrated: `patientHistory.test.jsx` (9 tests, same scenarios)

All 9 scenarios migrated to use `apiGetPatientOverview` instead of the old `apiGetPatient` + `apiGetPatientConsultations` pair. Test assertions updated where "Persistent cough" now appears in both the Latest visit and Timeline sections (uses `getAllByText`).

### Updated: `consultationDetail.test.jsx` (1 test updated)

Test 6 ("Open action from Patient Profile navigates correctly") updated to mock `apiGetPatientOverview` and pass a full overview response.

---

## Build result

```
vite v8.3.0 — production build

dist/index.html                   0.46 kB │ gzip:   0.29 kB
dist/assets/index-CYebSgUd.css   67.30 kB │ gzip:  10.08 kB
dist/assets/index-CctHwUo7.js   350.59 kB │ gzip: 102.68 kB

✓ 43 modules transformed — built in 1.10 s
0 errors · 0 warnings
```

---

## Deferred to later

| Item | Notes |
|---|---|
| "+ New consultation" button on Patient 360 | Would navigate to `/consultation/new?patientId=:id` — separate task |
| Change summary panel on Patient 360 | Could surface `ChangeSummaryPanel` here — separate task |
| Pagination for timeline | Currently hard-limited to 5 by the backend; cursor-based pagination deferred |
| Full consultation count in header | "3 consultations" count badge beside patient name — cosmetic enhancement |
| Medication history aggregation | Consolidated all-time medication list — requires new backend aggregate |
