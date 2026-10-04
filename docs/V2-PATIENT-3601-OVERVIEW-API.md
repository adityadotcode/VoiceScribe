# VoiceScribe V2 — Patient 360.1: Overview API

**Status:** Complete  
**Date:** 2026-10-02  
**Scope:** Backend only — no frontend, no AWS, no Bedrock  
**Tests:** 177 passing (14 new) across 10 suites

---

## Endpoint

```
GET /api/patients/:id/overview
```

Authentication required (Bearer token). All routes under `/api/patients` pass through the `authenticate` middleware registered in `routes/index.js`.

---

## Authorization

| Check | Failure response |
|---|---|
| `:id` is not a valid ObjectId | 400 |
| Patient does not exist or belongs to another user | 404 |

The patient query is `Patient.findOne({ _id: patientId, userId: req.user.id })`. A patient belonging to another user returns `null` — indistinguishable from "not found" to the caller.

---

## Response

```json
{
  "success": true,
  "patient": {
    "id":              "<ObjectId>",
    "firstName":       "Alice",
    "lastName":        "Smith",
    "dateOfBirth":     "<ISO date>",
    "biologicalSex":   "female",
    "phone":           "0400000001",
    "medicalRecordId": "MR001",
    "notes":           "",
    "isArchived":      false
  },
  "statistics": {
    "totalConsultations":    3,
    "approvedConsultations": 2,
    "draftConsultations":    1,
    "lastConsultationDate":  "<ISO date>"
  },
  "latestApprovedConsultation": {
    "id":                    "<ObjectId>",
    "consultationDate":      "<ISO date>",
    "chief_complaint":       "Persistent cough",
    "symptoms":              ["cough", "fatigue"],
    "medications_mentioned": ["paracetamol"],
    "assessment":            "Viral URTI",
    "follow_up":             "Return in 1 week"
  },
  "recentConsultations": [
    {
      "id":               "<ObjectId>",
      "consultationDate": "<ISO date>",
      "status":           "approved",
      "chief_complaint":  "Cough",
      "correctionOf":     null,
      "supersededBy":     null
    }
  ]
}
```

`latestApprovedConsultation` is `null` when no effective approved consultation exists.  
`lastConsultationDate` is `null` when the patient has no consultations at all.

---

## Consultation counting rules

Statistics count only **clinical encounter documents** — corrections are excluded.

```
correctionOf: null   ← required in the aggregate $match stage
```

A correction amendment (`correctionOf !== null`) represents a documentation fix for an existing encounter, not a new clinical visit. Including it would inflate `totalConsultations` and misrepresent the patient's actual visit count.

The aggregate pipeline groups by status to compute `approvedConsultations` and `draftConsultations` in a single query:

```js
Consultation.aggregate([
  {
    $match: {
      patientId:    patient._id,
      userId:       <req.user.id as ObjectId>,
      correctionOf: null,           // clinical encounters only
    },
  },
  {
    $group: {
      _id:                   null,
      totalConsultations:    { $sum: 1 },
      approvedConsultations: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
      draftConsultations:    { $sum: { $cond: [{ $eq: ['$status', 'draft']    }, 1, 0] } },
      lastConsultationDate:  { $max: '$consultationDate' },
    },
  },
])
```

---

## Correction handling

### Statistics

Correction documents (`correctionOf !== null`) are excluded from all counts.

### latestApprovedConsultation

The same correction-aware query as `GET /api/patients/:id/last-approved`:

```js
{
  status:       'approved',
  supersededBy: null,   // not replaced by a correction
  correctionOf: null,   // not itself a correction
}
// sorted by consultationDate descending
```

- An approved consultation that has been corrected (`supersededBy` is set) is **excluded** — it is the old version.
- A correction note (`correctionOf` is set) is **excluded** — it is the amendment, not the standalone encounter.
- Only the current standing approved note is returned.

### recentConsultations

Corrections **do** appear in `recentConsultations` — the doctor needs full chronological visibility of all documents. The `correctionOf` and `supersededBy` fields in each row allow the consumer to identify amendments.

---

## Latest-approved selection logic

Reuses the semantics established in Phase 3A (`getLastApproved`):

1. `patientId = req.params.id`
2. `userId = req.user.id` (from token — never from body)
3. `status = 'approved'`
4. `supersededBy = null`
5. `correctionOf = null`
6. Sorted by `consultationDate` descending → first result is the current effective note

---

## Recent consultations

- Limited to **5** documents
- Sorted by `consultationDate` descending, then `createdAt` descending (tiebreak)
- Projected fields only — no `transcript`, no `speakerUtterances`, no `detectedLanguages`
- Each item: `id`, `consultationDate`, `status`, `chief_complaint`, `correctionOf`, `supersededBy`

---

## Files changed

| File | Change |
|---|---|
| `server/src/controllers/patientController.js` | Added `getPatientOverview` function; updated `module.exports` |
| `server/src/routes/patientRoutes.js` | Imported `getPatientOverview`; added `GET /:id/overview` route |
| `server/tests/integration/patient_overview.test.js` | New — 14 tests |

---

## Tests

**File:** `server/tests/integration/patient_overview.test.js`  
**Runner:** Jest + supertest  
**New tests:** 14 | **Total backend tests:** 177 (all passing)

| # | Scenario | Expected |
|---|---|---|
| 1 | Unauthenticated | 401 |
| 2 | Invalid patient ObjectId | 400 |
| 3 | Patient not found | 404 |
| 4 | Another user's patient | 404; query includes correct userId |
| 5 | Correct totalConsultations | Returned from aggregate result |
| 6 | Corrections excluded from count | aggregate $match includes `correctionOf: null` |
| 7 | Approved / draft counts | Both fields correct from aggregate |
| 8 | Latest effective approved note fields | chief_complaint, symptoms, medications, assessment, follow_up |
| 9 | Superseded consultation ignored | findOne query includes `supersededBy: null, correctionOf: null` |
| 10 | No approved consultation → null | `latestApprovedConsultation` is null |
| 11 | recentConsultations ≤ 5 | Array length checked; find called with limit |
| 12 | Summary fields only in recent | No transcript, speakerUtterances, note object |
| 13 | IDOR (Doctor A ≠ Doctor B) | 404; query includes Doctor B's userId |
| 14 | Full response shape | All four top-level keys present with correct structure |

---

## Deferred to Patient 360.2

| Item | Notes |
|---|---|
| Frontend Patient 360 page | `/patients/:id/overview` UI — displays the overview as a rich patient summary card |
| Medication history aggregation | Consolidated list of all distinct medications mentioned across all visits |
| Symptom trend data | Frequency/recurrence of symptoms across consultations |
| Archive/reopen patient action | Deferred to 360.2 frontend |
| Pagination for recentConsultations | Currently hard-limited to 5; 360.2 could add cursor-based pagination |
