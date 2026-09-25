# VoiceScribe V2 — Phase 3A: Consultation ↔ Patient Backend

**Status:** Complete  
**Date:** 2026-09-24  
**Tests:** 74 passing (16 new) across 4 suites  
**Scope:** Backend only — no frontend changes, no AWS changes, no migration script

---

## Overview

Phase 3A connects the `Consultation` document to the `Patient` collection.  
Every new consultation must reference a patient that belongs to the authenticated user. The API also gains two patient-history endpoints so the frontend can query a patient's consultation timeline and pre-fill a new encounter from the last approved note.

---

## Schema changes — `Consultation.js`

Six new fields added to `ConsultationSchema`. All default to `null` / a safe value so existing V1 documents remain valid without a migration.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `patientId` | `ObjectId` → `Patient` | `null` | Links the consultation to its patient. Nullable for V1 back-compat; required by the API layer on all new creates. |
| `consultationDate` | `Date` | `new Date()` | Actual date/time of the clinical encounter (may differ from `createdAt`). |
| `encounterType` | `String` enum | `'in_person'` | How the encounter was conducted: `in_person`, `telemedicine`, or `upload`. |
| `approvedBy` | `ObjectId` → `User` | `null` | ID of the clinician who approved the note. Set automatically on approve. |
| `correctionOf` | `ObjectId` → `Consultation` | `null` | Points to the consultation this note corrects (amendment chain forward ref). |
| `supersededBy` | `ObjectId` → `Consultation` | `null` | Points to the newer correction that replaces this note (amendment chain back ref). |

### New indexes

```js
// Patient history list — newest consultations for a patient first
{ patientId: 1, createdAt: -1 }

// Last-approved query — scoped by user + patient
{ userId: 1, patientId: 1, createdAt: -1 }
```

The existing `{ userId: 1, createdAt: -1 }` index (Phase 1A) is retained.

---

## API changes — `consultationController.js`

### POST /api/consultations

**New behaviour:**

1. `patientId` is extracted from the request body and **required** (400 if absent or not a valid ObjectId).
2. Patient ownership is verified: `Patient.findOne({ _id: patientId, userId: req.user.id, isArchived: false })`. Returns **404** if the patient does not exist, belongs to another user, or is archived.
3. `patientId`, `consultationDate`, and `encounterType` are persisted on creation.
4. `approvedBy` is set to `req.user.id` when `status: 'approved'` is passed at create time.
5. `userId` continues to come exclusively from the verified token — any `userId` in the request body is ignored.

**Response:** unchanged (`201` with `{ success: true, consultation: doc }`).

### PUT /api/consultations/:id

`patientId` and `userId` are **immutable after creation**. Any attempt to change them via PUT is silently ignored — the saved document retains the original values. `approvedBy` is now set when a draft is approved via PUT.

---

## New endpoints — `patientController.js` + `patientRoutes.js`

### GET /api/patients/:id/consultations

Returns a summary list of all consultations for the given patient, newest first.

**Auth:** required (Bearer token)  
**Ownership:** patient must belong to `req.user.id`; returns 404 otherwise (indistinguishable from not-found)

**Selected fields:**
```
_id  status  consultationDate  encounterType
note.chief_complaint  createdAt  approvedAt  approvedBy
correctionOf  supersededBy
```

**Success response:**
```json
{
  "success": true,
  "consultations": [ /* array, newest first */ ]
}
```

**Error responses:**

| Status | Condition |
|---|---|
| 401 | No / invalid token |
| 400 | `:id` is not a valid ObjectId |
| 404 | Patient not found or belongs to another user |
| 500 | DB error |

---

### GET /api/patients/:id/last-approved

Returns the most recent **approved** consultation for this patient that has **not** been superseded by a correction.

**Auth:** required (Bearer token)  
**Ownership:** same as above

**Correction-aware query:**
```js
{
  patientId,
  userId,
  status:       'approved',
  supersededBy: null,   // not replaced by a newer correction
  correctionOf: null,   // not itself a correction of another note
}
// sorted by: consultationDate descending
```

This means:
- A note that was corrected (`supersededBy` is set) is excluded — it is the old version.
- A correction note (`correctionOf` is set) is excluded — it is the amendment, not the canonical record.
- Only the current, standing approved note for a patient is returned.

**Selected fields (note context for pre-filling a new encounter):**
```
_id  consultationDate  encounterType  note
approvedAt  approvedBy  createdAt
```

**Success response:**
```json
{
  "success": true,
  "consultation": { /* full note context fields */ }
}
```

**Error responses:**

| Status | Condition |
|---|---|
| 401 | No / invalid token |
| 400 | `:id` is not a valid ObjectId |
| 404 | Patient not found, belongs to another user, or no qualifying approved consultation exists |
| 500 | DB error |

---

## Tests — `consultation_patient.test.js`

16 tests across 5 `describe` blocks. All models mocked (no real DB). Real JWT tokens from `setup.js`.

| # | Scenario | Expected |
|---|---|---|
| 1 | POST without `patientId` | 400 |
| 2 | POST with invalid (non-ObjectId) `patientId` | 400 |
| 3 | POST with `patientId` owned by another user | 404 |
| 4 | POST with archived patient | 404 (isArchived filter confirmed) |
| 5 | POST with valid owned patient | 201; `patientId` persisted in create call |
| 6 | POST with client-supplied `userId` | 201; `userId` from token only |
| 5b | POST unauthenticated | 401 |
| 7 | PUT attempting to change `patientId` | silently ignored; original value retained |
| 8 | PUT attempting to change `userId` | silently ignored; original value retained |
| 9 | GET `/patients/:id/consultations` unauthenticated | 401 |
| 10 | GET `/patients/:id/consultations` patient owned by another user | 404 |
| 11 | GET `/patients/:id/consultations` success | 200; query scoped to `userId` + `patientId` |
| 12 | GET `/patients/:id/last-approved` — no approved note | 404 |
| 13 | GET `/patients/:id/last-approved` — correction-aware query shape | `supersededBy: null, correctionOf: null` confirmed |
| 14 | GET `/patients/:id/last-approved` — success | 200 with consultation note context |
| 15 | GET `/patients/:id/last-approved` — patient owned by another user | 404 |

### Backward-compatibility fix — `auth.test.js`

Test 19 ("client-supplied userId is ignored") was updated to supply a `patientId` and a `Patient.findOne` mock, since `createConsultation` now requires patient verification before reaching `Consultation.create`. The `Patient` model mock was also added to `auth.test.js` so the module is available in that test file's scope.

---

## Files changed

| File | Change |
|---|---|
| `server/src/models/Consultation.js` | +6 fields, +2 indexes |
| `server/src/controllers/consultationController.js` | +Patient import, patientId required on create, approvedBy on approve, patientId/userId immutable on PUT |
| `server/src/controllers/patientController.js` | +Consultation import, +`listPatientConsultations`, +`getLastApproved` |
| `server/src/routes/patientRoutes.js` | +`GET /:id/consultations`, +`GET /:id/last-approved` |
| `server/tests/integration/consultation_patient.test.js` | New — 16 tests |
| `server/tests/integration/auth.test.js` | +Patient mock, updated test 19 |

---

## What is NOT in scope (deferred)

- Frontend patient history UI (Phase 3B)
- `NewConsultationPage` with patient context
- Change summary / diff view
- Correction/amendment UI flow
- `correctionOf` / `supersededBy` write endpoints
- Bedrock prompt changes
- AWS infrastructure changes
- Database migration script (V1 documents retain `patientId: null` and remain invisible to V2 users)
- Deployment
