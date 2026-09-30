# VoiceScribe V2 — Phase 4B: Change-Summary API Endpoint

**Status:** Complete  
**Date:** 2026-09-24  
**Scope:** Backend only — no frontend, no AWS, no Bedrock, no schema changes  
**Tests:** 121 passing (11 new) across 6 suites

---

## Endpoint

```
POST /api/patients/:id/change-summary
```

Authentication required (Bearer token). All routes under `/api/patients` already pass through the `authenticate` middleware registered in `routes/index.js`.

---

## Request

```json
{
  "currentConsultationId": "<MongoDB ObjectId string>"
}
```

`userId` must **never** be supplied by the client — it is always taken from the verified JWT (`req.user.id`).

---

## Authorization rules

| Check | Failure response |
|---|---|
| `:id` is not a valid ObjectId | 400 |
| `currentConsultationId` absent | 400 |
| `currentConsultationId` is not a valid ObjectId | 400 |
| Patient does not exist or belongs to another user | 404 |
| Consultation does not exist, belongs to another user, or belongs to a different patient | 404 |

The patient query is: `{ _id: patientId, userId: req.user.id }`.  
The consultation query is: `{ _id: currentConsultationId, userId: req.user.id, patientId }`.  
Cross-patient and cross-user comparisons are structurally impossible.

---

## Previous-consultation selection logic

After the current consultation is authorised, the controller searches for the most recent **effective approved** consultation for this patient that predates the current one.

Query:

```js
Consultation.findOne({
  patientId,
  userId:           req.user.id,
  status:           'approved',
  supersededBy:     null,   // not replaced by a correction
  correctionOf:     null,   // not itself a correction
  consultationDate: { $lt: currentConsultation.consultationDate },
}).sort({ consultationDate: -1 })
```

- `supersededBy: null` — excludes originals that have been corrected (they are old versions).
- `correctionOf: null` — excludes correction notes themselves (they are amendments).
- Only "standing" approved notes — notes that are the current canonical record — are valid comparison bases.
- Sorted newest-first, so the first result is the closest prior encounter.

---

## Response shape

### When a previous consultation exists

```json
{
  "success": true,
  "hasPreviousConsultation": true,
  "previousConsultation": {
    "id": "<ObjectId>",
    "consultationDate": "<ISO date>"
  },
  "structuredDiff": {
    "newSymptoms": [],
    "resolvedSymptoms": [],
    "persistingSymptoms": [],
    "newMedicationsMentioned": [],
    "stoppedMedicationsMentioned": [],
    "newObservations": [],
    "resolvedObservations": [],
    "assessmentChanged": false,
    "chiefComplaintChanged": false,
    "followUpChanged": false,
    "historyChanged": false
  }
}
```

`structuredDiff` is the direct output of `diffNotes(previousNote, currentNote)` from `consultationDiffService.js`.

### When no previous approved consultation exists

```json
{
  "success": true,
  "hasPreviousConsultation": false,
  "previousConsultation": null,
  "structuredDiff": null
}
```

This is **not an error** — it means the current consultation is the patient's first effective approved note.

---

## Files changed

| File | Change |
|---|---|
| `server/src/controllers/patientController.js` | Added `diffNotes` import; added `getChangeSummary` function; added to `module.exports` |
| `server/src/routes/patientRoutes.js` | Added `getChangeSummary` import; added `POST /:id/change-summary` route |
| `server/tests/integration/change_summary.test.js` | New — 11 integration tests |

---

## Tests

**File:** `server/tests/integration/change_summary.test.js`  
**Runner:** Jest + supertest  
**New tests:** 11 | **Total backend tests:** 121 (all passing)

| # | Scenario | Expected |
|---|---|---|
| 1 | Unauthenticated | 401 |
| 2 | Invalid patient ObjectId | 400 |
| 3 | Missing `currentConsultationId` | 400, message matches |
| 4 | Invalid `currentConsultationId` ObjectId | 400, message matches |
| 5 | Patient owned by another user | 404; query includes attacker's userId |
| 6 | Consultation owned by another user | 404 |
| 7 | Consultation belongs to a different patient | 404; query includes `patientId` |
| 8 | No previous approved consultation | 200, `hasPreviousConsultation: false` |
| 9 | Previous approved consultation found | 200, diff contains correct items |
| 10 | Correction-aware query shape verified | `{ supersededBy: null, correctionOf: null, status: 'approved' }` confirmed |
| 11 | Client-supplied `userId` ignored | Patient and consultation queries use `req.user.id` |

---

## Test result

```
Test Suites: 6 passed, 6 total
Tests:       121 passed, 121 total
Time:        2.663 s
```

---

## Deferred to Phase 4C

| Item | Notes |
|---|---|
| Frontend "change summary" section on ConsultationDetailPage | Calls this endpoint, displays the diff |
| Handling `currentConsultation.consultationDate` absent (V1 docs use `createdAt`) | Controller falls back to `createdAt` already; test coverage could be extended |
| Diff for `duration`, `missing_information`, `uncertain_fields` | Not in Phase 4A/4B spec; addable to diffService without breaking existing output |
| Bedrock enrichment using structured diff | Future phase |
