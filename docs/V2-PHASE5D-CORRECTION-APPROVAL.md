# Phase 5D — Correction Approval and Effective Consultation History

## Overview

Phase 5D completes the correction lifecycle by ensuring:

1. The existing `PUT /api/consultations/:id` approval flow handles correction drafts correctly — no second approval mechanism is needed.
2. All effective-history queries (`getLastApproved`, `getChangeSummary`, `getPatientOverview`) surface approved corrections as the effective version of a consultation.
3. Clinical encounter counting continues to exclude correction documents, so corrections are not counted as new patient visits.

---

## Background: The Correction Lifecycle

A correction is created via `POST /api/consultations/:id/correct` (Phase 5B). At that point:

| Document | `status` | `correctionOf` | `supersededBy` |
|---|---|---|---|
| Original (approved) | `approved` | `null` | `<correction _id>` |
| Correction (new) | `draft` | `<original _id>` | `null` |

When the correction draft is approved via `PUT /api/consultations/:id`:

| Document | `status` | `correctionOf` | `supersededBy` |
|---|---|---|---|
| Original | `approved` | `null` | `<correction _id>` — **immutable** |
| Correction | **`approved`** | `<original _id>` | `null` |

The approved correction is now the **effective version**: it has `supersededBy: null` (not itself replaced) but `correctionOf != null` (it amends an original). Any query that wants the current effective note must include approved corrections.

---

## What Was Changed

### `server/src/controllers/patientController.js`

Three queries had `correctionOf: null` in their filter, which incorrectly excluded approved corrections from effective-history results. The fix removes that constraint from each. The aggregate `$match` for clinical encounter statistics retains `correctionOf: null` — this is intentional and correct.

#### 1. `getLastApproved` — `GET /api/patients/:id/last-approved`

```js
// BEFORE (Phase 5C and earlier) — excluded approved corrections:
Consultation.findOne({
  patientId, userId, status: 'approved',
  supersededBy: null, correctionOf: null,   // ← bug
})

// AFTER (Phase 5D) — approved corrections are the effective version:
Consultation.findOne({
  patientId, userId, status: 'approved',
  supersededBy: null,                       // correctionOf removed
})
```

#### 2. `getChangeSummary` — `POST /api/patients/:id/change-summary`

The previous-consultation query used to exclude documents with `correctionOf != null`. Since an approved correction is a valid comparison base, that filter is removed.

```js
// BEFORE:
Consultation.findOne({
  patientId, userId, status: 'approved',
  supersededBy: null, correctionOf: null,   // ← bug
  consultationDate: { $lt: currentDate },
})

// AFTER:
Consultation.findOne({
  patientId, userId, status: 'approved',
  supersededBy: null,                       // correctionOf removed
  consultationDate: { $lt: currentDate },
})
```

#### 3. `getPatientOverview` — `GET /api/patients/:id/overview` (latestApproved findOne)

```js
// BEFORE:
Consultation.findOne({
  patientId: patient._id, userId,
  status: 'approved', supersededBy: null, correctionOf: null,   // ← bug
})

// AFTER:
Consultation.findOne({
  patientId: patient._id, userId,
  status: 'approved', supersededBy: null,   // correctionOf removed
})
```

#### 4. `getPatientOverview` — aggregate `$match` for statistics (UNCHANGED)

```js
// CORRECT — kept as-is:
{ $match: { patientId: patient._id, userId: ..., correctionOf: null } }
```

Corrections amend an existing encounter; they are not new clinical encounters. This filter is intentional and must not be removed.

---

## Why No Second Approval Endpoint Was Needed

The existing `updateConsultation` handler (`PUT /api/consultations/:id`) already:

- Finds any draft owned by `req.user.id`.
- Sets `status: 'approved'`, `approvedAt: new Date()`, `approvedBy: req.user.id`.
- Does **not** touch `correctionOf` or `supersededBy` — these are immutable after creation.

A correction draft goes through this identical path. The only change in Phase 5D is on the **read side** (history queries), not the write side (approval).

---

## Test Coverage

### New test file: `server/tests/integration/correction_approval.test.js`

18 tests across 5 describe blocks:

| Section | Tests | What is verified |
|---|---|---|
| Approval flow | 1–6 | Normal draft approval, correction draft approval, `approvedAt`/`approvedBy` set, `correctionOf` preserved, original immutability (409), `supersededBy` not touched by PUT |
| `getLastApproved` | 7, 8, 8b | Approved correction returned; superseded original excluded; query lacks `correctionOf` |
| `getChangeSummary` | 9, 10, 10b | Approved correction valid as comparison base; superseded original excluded; query lacks `correctionOf` |
| `getPatientOverview` | 11–15 | Approved correction as `latestApproved`; superseded original excluded; `findOne` query shape; aggregate still has `correctionOf: null`; count not inflated |
| End-to-end lifecycle | 16 | Full sequence: before-correction overview returns original; after-correction overview returns correction; count stays the same |

### Updated pre-existing tests (3 files)

The following existing tests asserted `correctionOf: null` in the query — they were correct for Phase 5C behaviour but needed updating for Phase 5D:

| File | Test | Change |
|---|---|---|
| `patient_overview.test.js` | Test 9 | Renamed; now asserts `correctionOf` is NOT in the query |
| `consultation_patient.test.js` | Test 13 | Now asserts `correctionOf` is NOT in the query |
| `change_summary.test.js` | Test 10 | Now asserts `correctionOf` is NOT in the query |

---

## Test Results

```
Test Suites: 12 passed, 12 total
Tests:       207 passed, 207 total  (189 pre-existing + 18 new)
```

All pre-existing tests continue to pass unchanged (except the 3 query-shape tests updated above).

---

## Data Invariants (Post-Phase 5D)

| Invariant | Enforced by |
|---|---|
| Correction draft is created with `status: draft`, `approvedAt: null`, `approvedBy: null` | `createCorrection` (Phase 5B) |
| Original is marked `supersededBy: <correction _id>` at correction-creation time | `createCorrection` (Phase 5B) |
| Correction draft is approved via the standard `PUT /api/consultations/:id` path | `updateConsultation` (unchanged) |
| Approved correction has `correctionOf != null`, `supersededBy: null` | Model fields set at creation; approval never modifies these |
| Original remains `status: approved`, `supersededBy != null` after correction approved | Original is never modified by the approval PUT (ownership check ensures this) |
| `getLastApproved`, `getChangeSummary`, `getPatientOverview latestApproved` all return approved correction as effective version | Phase 5D query fixes |
| Clinical encounter count excludes corrections | Aggregate `$match: { correctionOf: null }` — intentionally unchanged |

---

## Related Documents

- [Phase 5B — Correction Backend](./V2-PHASE5B-CORRECTION-BACKEND.md)
- [Phase 5C — Correction UI](./V2-PHASE5C-CORRECTION-UI.md)
- [V2 Architecture](./V2-ARCHITECTURE.md)
- [V2 Engineering Audit](./V2-ENGINEERING-AUDIT.md)
