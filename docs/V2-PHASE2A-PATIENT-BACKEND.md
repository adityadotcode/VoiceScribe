# VoiceScribe V2 — Phase 2A: Patient Backend

> **Status:** COMPLETE  
> **Scope:** Patient model, indexes, CRUD API, search, authorization.  
> **Consultation → Patient linking:** NOT implemented (Phase 3).  
> **Frontend patient pages:** NOT implemented (Phase 2B).

---

## Patient schema (`server/src/models/Patient.js`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | auto | |
| `userId` | ObjectId (ref User) | **Yes** | Set from `req.user.id`. Never trusted from client. |
| `firstName` | String | **Yes** | Trimmed |
| `lastName` | String | **Yes** | Trimmed |
| `dateOfBirth` | Date | **Yes** | Cannot be in the future |
| `biologicalSex` | String enum | **Yes** | `male | female | other | not_stated` |
| `phone` | String | No | Trimmed, default `''` |
| `medicalRecordId` | String | No | Trimmed, default `''`; unique per user (sparse) |
| `notes` | String | No | Trimmed, default `''`; omitted from list responses |
| `isArchived` | Boolean | No | Default `false`; soft-delete equivalent |
| `createdAt` | Date | auto | `timestamps: true` |
| `updatedAt` | Date | auto | `timestamps: true` |

`strict: true` — arbitrary fields are rejected.

---

## Indexes

| Index | Purpose |
|---|---|
| `{ userId: 1, lastName: 1, firstName: 1 }` | Alphabetical list scoped to user |
| `{ userId: 1, dateOfBirth: 1 }` | DOB search scoped to user |
| `{ userId: 1, medicalRecordId: 1 }` unique + sparse | Prevents duplicate MR IDs within the same user's namespace; empty values excluded |

The `medicalRecordId` index uses `partialFilterExpression: { medicalRecordId: { $exists: true, $ne: '' } }` so only non-empty values participate in the uniqueness check.

---

## Ownership model

Every Patient document carries a `userId` field pointing to its owning `User`.

**Rule:** Every query that reads, updates, or lists patients must include `userId: req.user.id` in the filter. `req.body.userId`, `req.query.userId`, and `req.params.userId` are never used for ownership.

Correct pattern:
```js
Patient.findOne({ _id: req.params.id, userId: req.user.id })
```

If a patient exists but belongs to a different user, the query returns `null` and the controller returns `404` — not `403` — to avoid leaking the existence of another user's data.

---

## API endpoints

All routes require the `authenticate` middleware (via `routes/index.js`).

| Method | Path | Status | Purpose |
|---|---|---|---|
| POST | `/api/patients` | 201 / 400 / 409 | Create patient |
| GET | `/api/patients` | 200 | List own patients (with optional search + archived flag) |
| GET | `/api/patients/:id` | 200 / 400 / 404 | Get single patient |
| PUT | `/api/patients/:id` | 200 / 400 / 404 / 409 | Update patient |

DELETE is not implemented — patients are archived, not deleted.

---

## Validation

| Rule | Response |
|---|---|
| Missing required fields | 400 |
| Invalid `biologicalSex` value | 400 |
| `dateOfBirth` in the future | 400 |
| Malformed ObjectId (`:id`) | 400 |
| Patient not found or not owned | 404 |
| Duplicate `medicalRecordId` for same user | 409 |
| `_id`, `userId`, `createdAt` in update body | Silently ignored |

---

## Duplicate patient handling

When creating a patient, the controller checks for an existing patient owned by the same user with the same `firstName + lastName + dateOfBirth`. If a match is found:

- Creation **still proceeds** (HTTP 201).
- The response includes a `possibleDuplicate` field with the existing patient's `id` and a human-readable message.
- The **frontend** decides whether to proceed or warn the doctor.
- The system **never auto-merges** two patients.

---

## Archive behavior

- `isArchived: true` is set via `PUT /api/patients/:id`.
- `GET /api/patients` excludes archived patients by default.
- Pass `?archived=true` to include them.
- Archived patients remain in the database and can be un-archived by setting `isArchived: false`.

---

## Search

`GET /api/patients?search=<term>` performs a case-insensitive regex match against `firstName`, `lastName`, and `medicalRecordId`. Results are always scoped to `userId: req.user.id`.

---

## Tests (`server/tests/integration/patient.test.js`)

24 new tests added. All mock the Patient model (no real DB connection).

| # | Test |
|---|---|
| 1 | Unauthenticated POST → 401 |
| 1b | Unauthenticated GET → 401 |
| 2 | Authenticated create → 201 |
| 3 | userId comes from `req.user.id`, not client |
| 4 | Client-supplied userId is ignored |
| missing-fields | Missing required fields → 400 |
| invalid-sex | Invalid biologicalSex → 400 |
| future-dob | Future dateOfBirth → 400 |
| 10 | Duplicate medicalRecordId same user → 409 |
| 11 | Same medicalRecordId different users → 201 |
| 15 | Possible name+DOB duplicate → 201 with `possibleDuplicate` signal |
| 5 | listPatients filters by userId |
| 13 | Archived patients excluded from default list |
| 14 | Search scoped to current user |
| 6 | Doctor A cannot GET Doctor B's patient → 404 |
| 8 | Malformed ObjectId → 400 |
| 9 | Valid unknown patient ID → 404 |
| get-own | Authenticated GET own patient → 200 |
| 7 | Doctor A cannot UPDATE Doctor B's patient → 404 |
| 12 | Archive patient (isArchived: true saved) |
| id-protect | `_id` and `userId` cannot be updated |
| no-fields | No updatable fields → 400 |
| 16+17 | GET /api/health still works (regression) |
| regression | Unauthenticated consultation → 401 (regression) |

---

## Test results

```
Test Suites: 3 passed, 3 total
Tests:       58 passed, 0 failed  (34 existing + 24 new)
Time:        1.813 s
```

---

## Deferred to Phase 2B / Phase 3

| Item | Phase |
|---|---|
| Frontend patient pages (`/patients`, `/patients/new`, `/patients/:id`) | 2B |
| Patient search UI | 2B |
| `patientId` added to `Consultation.js` | 3 |
| Consultation → Patient relationship | 3 |
| `GET /api/patients/:id/consultations` | 3 |
| `GET /api/patients/:id/last-approved` | 3 |
| Change-summary feature | 6 |
