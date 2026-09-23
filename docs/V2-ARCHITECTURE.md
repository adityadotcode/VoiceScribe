# VoiceScribe V2 — Technical Architecture

> **Type:** Architecture and design document — no implementation code.  
> **Baseline:** V1 audit (`docs/V2-ENGINEERING-AUDIT.md`) + deployed V1 at `https://d20yro74mg9hym.cloudfront.net/`  
> **V1 facts are marked ✅ verified. V2 design decisions are marked 🔷.**  
> **Revision:** Engineering Review — Revision 1 applied (see Section 19).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication](#2-authentication)
3. [Database Architecture](#3-database-architecture)
4. [Patient Identity](#4-patient-identity)
5. [Patient History](#5-patient-history)
6. ["What Changed Since Last Visit?"](#6-what-changed-since-last-visit)
7. [Consultation Model](#7-consultation-model)
8. [Note Versioning](#8-note-versioning)
9. [API Architecture](#9-api-architecture)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Consultation Pipeline](#11-consultation-pipeline)
12. [AWS Architecture](#12-aws-architecture)
13. [Security](#13-security)
14. [Testing Strategy](#14-testing-strategy)
15. [Migration from V1](#15-migration-from-v1)
16. [Phased Implementation Plan](#16-phased-implementation-plan)
17. [Architectural Decision Records](#17-architectural-decision-records)
18. [Final Deliverables](#18-final-deliverables)
19. [Engineering Review — Revision 1](#19-engineering-review--revision-1)

---

## 1. Architecture Overview

### Conceptual model shift

```
V1: Doctor → Consultation (standalone)
V2: Doctor → Patient → [Consultation, Consultation, ...] (longitudinal)
```

### Component diagram

```
BROWSER (React + Vite)
    │
    │  HTTPS
    ▼
Amazon CloudFront  (HTTPS termination, edge)
    │
    │  HTTP :3000
    ▼
Amazon EC2  (Node.js / Express + static client/dist)
    ├── Amazon S3          (audio — temporary)
    ├── Amazon Transcribe  (en-IN + hi-IN, speaker diarization)
    ├── Amazon Bedrock     (Nova Lite — extraction + change summary)
    └── MongoDB Atlas      (users · patients · consultations)
```

### Layer responsibilities

| Layer | Technology | Responsibility |
|---|---|---|
| CDN / TLS | CloudFront | HTTPS, edge caching of static assets |
| Compute | EC2 (t3.small+) | Express API + React production build |
| Database | MongoDB Atlas | All persistent data |
| Auth tokens | JWT (signed HS256) | Stateless session management |
| Audio storage | S3 | Temporary — deleted after extraction |
| Speech-to-text | Amazon Transcribe | Transcript + speaker diarization |
| AI extraction | Amazon Bedrock Nova Lite | Note extraction + change summary |
| Credentials | EC2 IAM Role | No keys in environment |

### Request routing (single origin)

All traffic enters CloudFront → EC2:3000.
Express routes `/api/*` to controllers.
Everything else (`/`, `/patients`, `/consultation/*`) serves `client/dist/index.html`.
React Router handles client-side navigation.

---

## 2. Authentication

### Decision: Email + Password with JWT

**Chosen approach:** Email + password authentication, stateless JWT access tokens stored in React memory, HTTP-only Secure cookie for refresh tokens.

**Why not Google OAuth:** Adds Google as a dependency. Adds complexity without benefit for a small clinical team. Doctors may not have or want to use Google accounts for medical tools.

**Why not Magic link:** Requires email delivery infrastructure (SES or similar). Has latency problems. Doesn't work offline. Adds complexity.

**Why Email + Password + JWT:** Self-contained, no external OAuth provider. Well-understood security model. JWT is stateless — no session store needed. HTTP-only Secure refresh token cookie prevents XSS theft of the long-lived token.

### User model

```
Collection: users

_id            ObjectId     auto
email          String       required, unique, lowercase, trimmed
passwordHash   String       required  (bcrypt, rounds: 12)
displayName    String       required
role           String       enum: ['doctor']   default: 'doctor'
                            (future: 'admin', 'clinic_admin')
createdAt      Date         auto (timestamps)
updatedAt      Date         auto (timestamps)
lastLoginAt    Date         updated on each successful login
isActive       Boolean      default: true  (soft disable without deletion)
refreshTokenHash String     bcrypt hash of the active refresh token;
                            null after logout (allows server-side invalidation)
```

> **⚠️ Deferred — Phase 1 does not include email verification or password reset.**
> These are later hardening features. See Section 2, "Scope of Phase 1 auth."

### Token strategy

```
Access token
  Payload:  { sub: userId, email, role, iat, exp }
  Expiry:   15 minutes
  Sent:     Authorization: Bearer <token>   (header, from client)
  Stored:   React in-memory state (AuthContext) ONLY
            ← NEVER in localStorage or sessionStorage
            ← NEVER in a cookie

Refresh token
  Payload:  { sub: userId, jti: uuid, iat, exp }
  Expiry:   7 days
  Sent:     HTTP-only cookie  (SameSite=Strict, Secure in production)
  Stored:   DB field refreshTokenHash (bcrypt hash) on User document
```

**Why access token in memory only:**  
localStorage and sessionStorage are readable by any JavaScript on the page.
A malicious script or XSS vulnerability can silently steal a token stored there.
React memory (a plain JavaScript variable inside a context) is not persisted anywhere
and is not accessible to third-party scripts outside the React module boundary.
The trade-off is that page refresh clears the access token — the refresh flow
(described below) restores it transparently before the user sees a login screen.

**Why 15-minute access token:** Short enough that a stolen token expires quickly. Long enough to avoid constant refresh during a consultation workflow.

**Why HTTP-only Secure cookie for refresh:** JavaScript cannot read it (`HttpOnly`). Transport layer encrypts it (`Secure`). XSS cannot steal the refresh token. The short-lived access token in memory is the only thing exposed to JavaScript, and it expires quickly.

### Authentication flow

```
REGISTER
POST /api/auth/register
  { email, password, displayName }
  → validate email uniqueness
  → bcrypt.hash(password, 12)
  → create User document
  → generate accessToken (15 min) + refreshToken (7 days)
  → store bcrypt(refreshToken) in user.refreshTokenHash
  → return { accessToken, user: { id, email, displayName } }
  → set cookie: refreshToken  (HttpOnly, Secure, SameSite=Strict, Path=/api/auth/refresh)

LOGIN
POST /api/auth/login
  { email, password }
  → find user by email
  → bcrypt.compare(password, user.passwordHash)
  → generate accessToken (15 min) + refreshToken (7 days)
  → store bcrypt(refreshToken) in user.refreshTokenHash
  → return { accessToken, user: { id, email, displayName } }
  → set cookie: refreshToken  (HttpOnly, Secure, SameSite=Strict, Path=/api/auth/refresh)

TOKEN REFRESH  (called silently on page load and on 401 responses)
POST /api/auth/refresh
  (no body — reads HttpOnly cookie automatically)
  → extract refreshToken from cookie
  → verify JWT signature and expiry
  → find user, bcrypt.compare(refreshToken, user.refreshTokenHash)
  → if valid: generate new accessToken
  → return { accessToken }
  → (optionally rotate refreshToken and update cookie)

  This call is made:
    1. On app mount, before rendering any protected page
       → silently restores the session after a page refresh
    2. When any API call returns 401
       → retry the original request once with the new token

LOGOUT
POST /api/auth/logout
  → clear refreshToken cookie (set to expired)
  → set user.refreshTokenHash = null  (server-side invalidation)
  → AuthContext clears accessToken from memory
  → client navigates to /login

PROFILE
GET /api/auth/me
  Authorization: Bearer <accessToken>
  → return { id, email, displayName, role }
```

### Scope of Phase 1 auth

Phase 1 delivers: **register, login, token refresh, logout, get-current-user**.

The following are **explicitly deferred** to a hardening phase:

- Email verification — the system does not verify that a registered email address is real. This is acceptable for a small known team. It must not be mistaken for a production-safe identity guarantee.
- Password reset / recovery — no reset flow exists. An account whose password is lost requires manual intervention at the database level by someone with Atlas access. The API does not expose any reset mechanism.

Neither of these gaps will be papered over with informal workarounds through the API. They are noted as known limitations until properly implemented.

### Authorization middleware

```
// middleware/authenticate.js  (design only — not implemented yet)
//
// 1. Extract Bearer token from Authorization header
// 2. jwt.verify(token, JWT_SECRET) — verifies signature + expiry
// 3. Attach req.user = { id, email, role }
// 4. If missing or invalid → 401 { success: false, message: 'Authentication required' }
//
// All protected routes use this middleware.
// The middleware NEVER trusts req.body or req.params for identity.
// userId is always taken from req.user.id (the verified JWT payload).
```

### Client-side auth state

```
React context: AuthContext
  {
    user,            // { id, email, displayName, role } or null
    accessToken,     // string or null — in-memory only, never persisted
    isLoading,       // true while refresh is in-flight on mount
    login(token, user),
    logout(),
  }

On app mount:
  1. Call POST /api/auth/refresh  (sends HttpOnly cookie automatically)
  2. If 200 → store accessToken in AuthContext memory
             → render protected pages normally
  3. If 401 → accessToken stays null → PrivateRoute redirects to /login

On any API 401 response:
  1. Attempt refresh once
  2. If refresh succeeds → retry original request with new token
  3. If refresh fails → logout() → redirect to /login

Protected routes: <PrivateRoute> wrapper
  If accessToken is null AND isLoading is false → redirect to /login
```

---

## 3. Database Architecture

### Collections

```
users                  → one per doctor/user
patients               → one per real patient, owned by a user
consultations          → one per consultation session, linked to patient + user
```

### Users collection

See Section 2. Indexes:

```
{ email: 1 }   unique: true
```

### Patients collection

```
Collection: patients

_id              ObjectId     auto
userId           ObjectId     required   ref: users   (owner — the creating doctor)

-- Identity fields --
firstName        String       required
lastName         String       required
dateOfBirth      Date         required
biologicalSex    String       enum: ['male','female','other','not_stated']  required

-- Search / reference --
medicalRecordId  String       optional
                              Doctor's own reference number (e.g. clinic system ID).
                              Used as an exact-match search identifier.
                              Unique per user (not globally unique — two doctors
                              can have different patients sharing the same ID in
                              their respective systems).

-- Contact / context (optional) --
phone            String       optional
notes            String       optional   free-text about patient (not clinical)

-- Metadata --
createdAt        Date         auto
updatedAt        Date         auto
isArchived       Boolean      default: false
```

**Indexes:**

```
{ userId: 1, lastName: 1, firstName: 1 }
{ userId: 1, dateOfBirth: 1 }
{ userId: 1, medicalRecordId: 1 }
  unique: true, sparse: true
  ← sparse because medicalRecordId is optional; null values are excluded.
  ← unique per userId so the same doctor cannot accidentally assign the same
     reference ID to two different patients.
  ← NOT globally unique — different doctors may legitimately use the same
     ID values in their respective systems.
```

### Consultations collection

See Section 7 for the full redesigned model.

**Core relationship indexes:**

```
{ userId: 1, createdAt: -1 }
{ patientId: 1, createdAt: -1 }
{ userId: 1, patientId: 1, createdAt: -1 }
{ status: 1, userId: 1 }
```

### Relationship map

```
User (1)
  └─owns──► Patient (N)
               └─has──► Consultation (N)

Consultation
  ├── userId    → User._id       (who created it)
  └── patientId → Patient._id    (which patient)

Authorization rule:
  A consultation is accessible only if:
    consultation.userId === req.user.id
```

### What belongs in Patient vs Consultation

| Data | Patient model | Consultation snapshot |
|---|---|---|
| Legal name | ✅ primary | ✅ capture at time of visit |
| Date of birth | ✅ primary | optional |
| Biological sex | ✅ primary | optional |
| Contact info | ✅ only | ✗ |
| Medical record ID | ✅ only | ✗ |
| Chief complaint | ✗ | ✅ each visit differs |
| Symptoms | ✗ | ✅ each visit differs |
| Medications mentioned | ✗ | ✅ snapshot of what was stated this visit |
| Assessment | ✗ | ✅ each visit differs |
| Transcript | ✗ | ✅ |
| Speaker data | ✗ | ✅ |

The consultation captures a snapshot of what was stated and observed during that specific visit. It does not replace the patient's master record.

---

## 4. Patient Identity

### The identity model

**`Patient._id` is the sole stable identity of a patient.**

`lastName` and `dateOfBirth` are used only as a search/candidate-matching mechanism to help the doctor find the correct existing patient record. They are not the identity. Once a match is confirmed and selected by the doctor, `Patient._id` is what links all consultations to that person.

`medicalRecordId`, when present, may be used as an additional exact-match search identifier — it can narrow a search to a single candidate if the doctor knows the reference number. It does not replace `_id` as the identity.

### The merge problem

Merging two patient records means attaching a consultation intended for person A to person B's history. In a clinical tool this is a patient safety issue.

The system prevents accidental merges by:
1. Never auto-matching or auto-linking patients — every link is a deliberate doctor action
2. Scoping all searches to `userId` — a doctor can only search their own patient records
3. Presenting candidates, not decisions — the doctor sees a list and must select
4. Requiring visual confirmation before attaching a consultation to a patient
5. Warning (not blocking) if a new patient record is being created that shares `lastName + dateOfBirth` with an existing patient for the same user

### Patient search flow

```
Search input: lastName (required) + dateOfBirth (required)
              optionally: medicalRecordId (exact match if provided)

Query:
  { userId, lastName: case-insensitive match, dateOfBirth: exact match }
  or, if medicalRecordId is provided:
  { userId, medicalRecordId: exact match }

Result: list of 0–N matching patients
  → Doctor reviews the list
  → Doctor selects the correct record  (explicit action)
  → System attaches the new consultation to the selected Patient._id
  → If no match found: Doctor creates a new Patient record
```

### Patient creation flow

```
1. Doctor navigates to: New Consultation
2. UI presents: "Search for existing patient OR create new"
3. Doctor searches: lastName + dateOfBirth (or medicalRecordId)
4. System returns matching patients (userId-scoped)
5. If found: Doctor confirms and selects the correct patient
6. If not found: Doctor fills in new patient form
   → firstName, lastName, dateOfBirth, biologicalSex (required)
   → medicalRecordId, phone (optional)
   → If lastName + dateOfBirth match an existing patient:
     show warning "A patient with this name and date of birth already
     exists in your records. Are you sure you want to create a new record?"
     Doctor must actively confirm to proceed.
7. New Patient document created; Patient._id assigned
8. Consultation linked to Patient._id
```

### Doctor must visually confirm

The system never silently links a consultation to a patient. The doctor's explicit selection action is the only mechanism. There is no background fuzzy-matching, no auto-suggest that auto-accepts, no fallback to "closest match."

---

## 5. Patient History

### Patient profile page

```
/patients/:patientId

Displays:
  ─ Patient identity (name, DOB, sex, medical record ID)
  ─ Clinical encounter count  ← counts encounters, not correction documents
  ─ Last consultation date + status
  ─ Encounter list (sorted newest-first):
      each row: consultationDate, chief complaint, status (Draft/Approved)
      corrections grouped under their original encounter (see Section 8)
  ─ "New consultation for this patient" button
```

### Pre-consultation context

Before a new consultation starts, if an existing patient is selected, the system displays:

```
Patient context panel (read-only):

  Last approved consultation: [date]
  Chief complaint: [text]
  Last known symptoms: [list]
  Medications mentioned at last visit: [list]
  Assessment: [text]
  Follow-up instructed: [text]

  [Start new consultation]
```

**"Last approved consultation"** here means the most recent document where:
- `status === 'approved'`
- `correctionOf` is null (i.e. it is an original clinical encounter, not a correction document)

See Section 8 for the query semantics.

This context comes from: `GET /api/patients/:id/last-approved` which uses those filtering rules.

### Consultation history API flow

```
GET  /api/patients/:id/consultations
  → returns: clinical encounters only (correctionOf: null)
  → sorted: consultationDate DESC
  → each row includes: corrections array (documents where correctionOf === encounter._id)
  → auth: consultation.userId must === req.user.id

GET  /api/consultations/:id
  → returns: full consultation document
  → auth: consultation.userId === req.user.id
```

### Starting a new consultation for an existing patient

```
1. Doctor is on /patients/:id
2. Clicks "New consultation"
3. Frontend navigates to /consultation/new?patientId=:id
4. Pre-consultation context is shown (last approved encounter)
5. Doctor records audio / uploads file
6. Pipeline runs: S3 → Transcribe → Bedrock
7. On review screen: patient context shown alongside the new draft note
8. Doctor reviews, edits, approves
9. POST /api/consultations { patientId, userId, transcript, note, ... }
```

---

## 6. "What Changed Since Last Visit?"

### Design principle

Use **deterministic logic first**, LLM second.

The LLM is expensive, non-deterministic, and slow. Use it only for clinical language tasks it is genuinely better at. Use code for everything that can be expressed as structured data comparison.

### What can be done deterministically

```javascript
// Fields that are arrays → set difference
newSymptoms        = setDiff(current.symptoms, previous.symptoms)
resolvedSymptoms   = setDiff(previous.symptoms, current.symptoms)
persistingSymptoms = setIntersection(current.symptoms, previous.symptoms)

// medications_mentioned: what was stated in each consultation
// This is NOT a medication reconciliation. It compares what the patient
// or clinician mentioned during each session. A medication not mentioned
// in the current visit does not mean it was stopped — the doctor must judge.
mentionedNewMedications     = setDiff(
  current.medications_mentioned, previous.medications_mentioned)
noLongerMentionedMedications = setDiff(
  previous.medications_mentioned, current.medications_mentioned)

newObservations    = setDiff(current.observations, previous.observations)

// Fields that are strings → change flag
assessmentChanged      = current.assessment !== previous.assessment
chiefComplaintChanged  = current.chief_complaint !== previous.chief_complaint
followUpChanged        = current.follow_up !== previous.follow_up
```

> **Important — `medications_mentioned` is not a medication list.**  
> This field records medications that were named during the consultation transcript.
> VoiceScribe does not maintain a cumulative medication record for the patient.
> The diff above compares what was mentioned in two consultations, not what the
> patient is or was prescribed. The LLM prompt must be written to reflect this.

These structured diffs are computed in `consultationDiffService.js` — pure functions, no LLM, instant, testable.

### What benefits from LLM interpretation

1. **Clinical significance of changes** — The diff tells you what changed; the LLM provides context (without diagnosing).
2. **Summary of overall trajectory** — "Over three visits, fever has resolved but cough has persisted."
3. **Noting discrepancies** — "Patient previously mentioned hypertension as history but did not mention it this visit."

The LLM prompt must explicitly state that `medications_mentioned` reflects only what was stated during each session, and that the model must not draw conclusions about the patient's current medication regimen.

### LLM call design for "what changed"

The LLM is called **only** when:
1. There is a previous approved clinical encounter for this patient (not a correction)
2. The current consultation has been extracted (note exists)
3. The doctor explicitly requests the summary (not automatic)

Input to Bedrock:

```json
{
  "previousNote": {
    "chief_complaint": "...",
    "symptoms": [],
    "observations": [],
    "assessment": "...",
    "medications_mentioned": [],
    "follow_up": "..."
  },
  "currentNote": { "same fields" },
  "structuredDiff": {
    "newSymptoms": [],
    "resolvedSymptoms": [],
    "persistingSymptoms": [],
    "mentionedNewMedications": [],
    "noLongerMentionedMedications": [],
    "newObservations": [],
    "assessmentChanged": true,
    "followUpChanged": false
  },
  "context": {
    "note": "medications_mentioned reflects only what was stated aloud during each consultation. It is not a confirmed medication list. Do not infer that a medication was started or stopped."
  }
}
```

The model is instructed to:
- Describe changes in clinical language
- NOT diagnose or prescribe
- NOT invent changes not present in the diff
- Treat `medications_mentioned` as what was verbally stated, not a medication record
- Use plain, readable language the doctor can scan quickly
- Be brief (under 200 words)

### Response schema for "changes since last visit"

```json
{
  "previousConsultationId": "ObjectId string",
  "previousConsultationDate": "ISO date",
  "structuredDiff": {
    "newSymptoms": ["shortness of breath"],
    "resolvedSymptoms": ["fever"],
    "persistingSymptoms": ["cough"],
    "mentionedNewMedications": [],
    "noLongerMentionedMedications": [],
    "newObservations": ["oxygen saturation 96%"],
    "assessmentChanged": true,
    "chiefComplaintChanged": true,
    "followUpChanged": false
  },
  "clinicalSummary": "LLM-generated plain-language description of notable changes. Not a diagnosis. Does not imply medication changes.",
  "generatedAt": "ISO timestamp"
}
```

**"Previous consultation" here means:**
The most recent approved clinical encounter for this patient (i.e., the most recent document where `status === 'approved'` AND `correctionOf === null`), not simply the most recent document by `createdAt`.

Endpoint: `POST /api/patients/:id/change-summary` with `{ currentConsultationId }`.

---

## 7. Consultation Model

### V2 Consultation schema

```
Collection: consultations

-- Ownership --
_id              ObjectId     auto
userId           ObjectId     required   ref: users
patientId        ObjectId     nullable during migration period
                              required for all new V2 consultations
                              null only on V1 legacy documents
                              (see Section 15 for migration strategy)

-- Encounter context --
consultationDate Date         default: createdAt  (allows backdating)
encounterType    String       enum: ['in_person','telemedicine','upload']
                              default: 'in_person'

-- Raw audio / processing --
sourceAudioKey   String       S3 key at upload time; null after deletion
audioFormat      String       e.g. 'webm', 'mp3' (for debugging)
processingStatus String       enum: ['pending','transcribing','extracting',
                              'complete','failed']

-- Transcript data --
transcript       String       raw Transcribe output
detectedLanguages [Object]    { code, duration }
speakerUtterances [Object]    { speaker, startTime, endTime, text }
speakerRoleMapping Mixed      { spk_0: 'Patient', spk_1: 'Clinician' }

-- Structured note --
note             Object       NoteSchema (same as V1)

-- Approval --
status           String       enum: ['draft','approved']  default: 'draft'
approvedAt       Date         null until approved
approvedBy       ObjectId     ref: users

-- Correction chain --
correctionOf     ObjectId     ref: consultations (null unless this IS a correction)
supersededBy     ObjectId     ref: consultations (null unless this has BEEN superseded)

-- Metadata --
createdAt        Date         auto
updatedAt        Date         auto
```

**`patientId` nullability note:**
The Mongoose schema declares `patientId` as nullable (`default: null`) to allow V1 documents to remain valid. However, the `POST /api/consultations` controller rejects requests that do not include a valid `patientId`. V1 documents are exempt from this rule only because they pre-date the field. Once migration is complete and all V1 documents have been linked, `patientId` can be made a database-level required field.

### NoteSchema (unchanged from V1)

```
patient            Object   { name, age, sex }  — snapshot of stated demographics
chief_complaint    String
symptoms           [String]
duration           String
history            String
observations       [String]
assessment         String
medications_mentioned [String]   — what was stated during the consultation,
                                    not a confirmed/current medication list
follow_up          String
missing_information [String]
uncertain_fields   [String]
```

### New fields explained

| Field | Reason |
|---|---|
| `userId` | Enables per-user data isolation — every query scoped by this |
| `patientId` | Links consultation to persistent patient record; nullable for V1 compatibility |
| `consultationDate` | Allows backdating when uploading historical audio |
| `encounterType` | Useful for filtering (in-person vs upload testing) |
| `sourceAudioKey` | Retained until deletion for debugging; null after cleanup |
| `audioFormat` | Useful if Transcribe fails — know what was uploaded |
| `processingStatus` | Supports async pipeline in future phases |
| `approvedBy` | Future-proofs for clinic review workflow |
| `correctionOf` | Non-null only on correction documents — links to the encounter being corrected |
| `supersededBy` | Non-null only on original documents that have been corrected |

---

## 8. Note Versioning

### Decision: Mutable draft + immutable approval + correction documents

**Chosen: Mutable draft, immutable once approved. Corrections create new consultation documents.**

### Normal lifecycle

```
draft      → doctor saves multiple times (mutable, replaces previous draft)
approved   → locked — no further edits via the UI
```

When `status === 'approved'`:
- `PUT` with `status: 'approved'` → 409 (already in V1)
- `PUT` with `status: 'draft'` → not allowed (cannot un-approve)
- Editing any note field → not allowed once approved

### Correction of an approved note

A correction is **not a new clinical encounter**. It is an administrative correction to the documentation of an existing encounter. The original consultation date is preserved; the original audio and transcript are reused.

```
1. Doctor opens an approved consultation
2. Clicks "Create correction"
3. System creates a new Consultation document:
   { patientId, userId,
     status: 'draft',
     correctionOf: <original _id>,    ← marks this as a correction
     consultationDate: <same as original>,
     encounterType: <same as original>,
     note: { ...copy of approved note },
     transcript: <same transcript> }
4. Doctor edits the draft correction
5. Doctor approves the correction
6. Original consultation is updated: { supersededBy: <correction _id> }
   The original document is otherwise unchanged — its content is preserved.
```

The original approved note is never modified or deleted — the audit trail is complete.

### Encounter count and "previous visit" semantics

Because corrections and original encounters coexist in the same collection, all queries involving patient history must distinguish between them:

```javascript
// Clinical encounter count (for patient profile)
Consultation.countDocuments({
  patientId,
  userId,
  correctionOf: null         // ← exclude correction documents
})

// Patient consultation history list
Consultation.find({
  patientId,
  userId,
  correctionOf: null         // ← original encounters only
}).sort({ consultationDate: -1 })
// Then separately fetch corrections for each encounter:
// Consultation.find({ correctionOf: { $in: encounterIds } })
// Group them under their originals in the UI.

// "Last approved consultation" / "previous visit" for change summary
Consultation.findOne({
  patientId,
  userId,
  status: 'approved',
  correctionOf: null         // ← must be an original encounter
}).sort({ consultationDate: -1 })
// If the original has been superseded, still use IT as the reference —
// the supersededBy correction reflects the corrected version. Use the
// correction's approved note for the change-summary comparison.
// The correct query for "effective last approved note":
Consultation.findOne({
  patientId,
  userId,
  status: 'approved',
  supersededBy: null,        // ← not yet superseded (most current version)
  correctionOf: null         // ← original encounter (not a correction itself)
}).sort({ consultationDate: -1 })
// This returns the most recent original encounter that has not been
// superseded by a correction — i.e., the effective last approved state.
```

### Why not full version history

A full version array inside the document adds complexity for a use case (mid-session editing) that is already handled by the mutable draft. The extra complexity is not justified for V2.

---

## 9. API Architecture

All routes require `Authorization: Bearer <accessToken>` unless marked PUBLIC.
All responses: `{ success: boolean, ... }`.

### Auth routes

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Create account | PUBLIC |
| POST | `/api/auth/login` | Login | PUBLIC |
| POST | `/api/auth/refresh` | Refresh access token | PUBLIC (cookie) |
| POST | `/api/auth/logout` | Logout | Authenticated |
| GET | `/api/auth/me` | Get current user | Authenticated |

### Patient routes (all scoped to `userId = req.user.id`)

| Method | Endpoint | Purpose | Owner rule |
|---|---|---|---|
| POST | `/api/patients` | Create patient | userId set from token |
| GET | `/api/patients` | List own patients | `userId` filter |
| GET | `/api/patients/:id` | Get patient | `userId` check |
| PUT | `/api/patients/:id` | Update patient | `userId` check |
| GET | `/api/patients/:id/consultations` | List patient's clinical encounters | `userId` check, `correctionOf: null` |
| GET | `/api/patients/:id/last-approved` | Most recent effective approved note | `userId` check, correction-aware query |
| POST | `/api/patients/:id/change-summary` | "What changed" | `userId` check |

### Consultation routes

| Method | Endpoint | Purpose | Owner rule |
|---|---|---|---|
| POST | `/api/consultations` | Create | userId from token; `patientId` required and must be owned by user |
| GET | `/api/consultations` | List own | `userId` filter |
| GET | `/api/consultations/:id` | Get single | `userId` check |
| PUT | `/api/consultations/:id` | Update draft | `userId` check, `status !== 'approved'` |
| DELETE | `/api/consultations/:id` | Delete draft only | `userId` check, `status === 'draft'` |

No DELETE on approved consultations — medical records must not be destroyed.

### Audio / pipeline routes

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/api/audio` | Upload audio to S3 | Authenticated |
| POST | `/api/transcribe` | Transcribe S3 object | Authenticated |
| POST | `/api/extract-note` | Bedrock note extraction | Authenticated |

### Health route

| Method | Endpoint | Auth |
|---|---|---|
| GET | `/api/health` | PUBLIC |

---

## 10. Frontend Architecture

### React Router routes

```
/                    → redirect: /dashboard (authed) or /login
/login               → LoginPage
/register            → RegisterPage
/dashboard           → DashboardPage
/patients            → PatientListPage
/patients/new        → NewPatientPage
/patients/:id        → PatientProfilePage
/consultation/new    → NewConsultationPage  (patient select + pipeline)
/consultation/:id    → ConsultationPage     (review / edit / approve)
/consultation/:id/change-summary → ChangeSummaryPage
```

All routes except `/login` and `/register` protected by `<PrivateRoute>`.

### Directory structure

```
src/
├── main.jsx
├── App.jsx                     Router setup + AuthProvider
├── contexts/
│   └── AuthContext.jsx         user, accessToken (memory only), login/logout
├── hooks/
│   ├── useAuth.js
│   ├── usePatients.js
│   └── useConsultations.js
├── pages/
│   ├── LoginPage.jsx
│   ├── RegisterPage.jsx
│   ├── DashboardPage.jsx
│   ├── PatientListPage.jsx
│   ├── NewPatientPage.jsx
│   ├── PatientProfilePage.jsx
│   ├── NewConsultationPage.jsx  (pipeline orchestrator)
│   └── ConsultationPage.jsx    (review / approve)
├── components/
│   ├── layout/
│   │   ├── AppShell.jsx
│   │   ├── TopBar.jsx
│   │   └── PrivateRoute.jsx
│   ├── consultation/
│   │   ├── AudioRecorder.jsx       (reuse from V1)
│   │   ├── FileUploadSection.jsx   (reuse from V1)
│   │   ├── PipelineProgress.jsx    (extracted from App.jsx)
│   │   ├── ClinicalNoteReview.jsx  (reuse from V1)
│   │   └── ChangeSummaryPanel.jsx  (new)
│   ├── patient/
│   │   ├── PatientCard.jsx
│   │   ├── PatientSearchModal.jsx
│   │   ├── PatientContextPanel.jsx
│   │   └── ConsultationHistoryList.jsx
│   └── common/
│       └── Dashboard.jsx           (reuse from V1)
├── api.js
└── services/api/
    ├── auth.js
    ├── patients.js
    └── consultations.js
```

### Pipeline state management

🔷 **Decision: `useReducer` in `NewConsultationPage.jsx`, not global context.**

The pipeline state is specific to one active consultation flow. Moving it from App.jsx into a dedicated page component with `useReducer` gives clear state transitions and avoids stale-closure issues.

```javascript
// Pipeline reducer state shape (design only)
{
  stage: 'idle'|'uploading'|'transcribing'|'analyzing'|'extracting'|'review'|'error',
  pipelineStep: string,
  processingFailed: boolean,
  pipelineError: string,
  objectKey: string,
  transcript: string,
  detectedLanguages: [],
  speakerUtterances: [],
  note: null,
  pendingObjectKey: string,
  pendingTranscript: string,
}
```

---

## 11. Consultation Pipeline

### V1 synchronous approach (✅ verified, still works)

```
POST /api/transcribe
  → starts AWS Transcribe job
  → polls every 3 s, up to 60 attempts (3 min max)
  → single HTTP connection held open for up to 3 minutes
```

### V2 Phase 1: Keep synchronous (recommended)

**Why:** Works today. No new infrastructure. One CloudFront setting to verify/change.

**Required action:** Verify CloudFront origin response timeout is ≥ 180 s.
Default is 30 s — must be changed in the CloudFront distribution settings.

### V2 Phase 3+: Async job pattern (to evaluate)

```
POST /api/transcribe/start   → returns { jobId } immediately
GET  /api/transcribe/:jobId  → returns { status, transcript? }
Frontend polls /status every 5 s
```

🔷 **Decision: V2 Phase 1 uses synchronous approach. Phase 3 evaluates async.**

---

## 12. AWS Architecture

### What stays unchanged

| Service | Status |
|---|---|
| S3 (ap-southeast-2) | ✅ Unchanged — same bucket, same deletion logic |
| Amazon Transcribe | ✅ Unchanged — same config |
| Amazon Bedrock Nova Lite | ✅ Unchanged — same model, same Converse API |
| EC2 | ✅ Unchanged — same instance, same PM2 |
| IAM Role | ✅ Unchanged — existing permissions sufficient |

### What changes

| Service | Change |
|---|---|
| CloudFront | Verify/set origin response timeout ≥ 180 s |
| EC2 `.env` | Add `JWT_SECRET`, `JWT_REFRESH_SECRET` |

### New environment variables (names only)

```
JWT_SECRET=           (generated, never committed)
JWT_REFRESH_SECRET=   (separate secret)
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
```

### No new AWS services required for Phases 1–4

Future (Phase 5+, optional): SES for email verification/reset, SQS+Lambda for async transcription, CloudWatch for structured logging.

---

## 13. Security

### Authentication enforcement

```
Every API route except /api/auth/* and /api/health
MUST call authenticate middleware before any business logic.

authenticate extracts userId ONLY from the verified JWT.
Never from req.body, req.params, or req.query.
```

### Access token security model

```
Access token stored in React memory only.
Never written to localStorage, sessionStorage, or a cookie.
Lost on page refresh — silently restored via /api/auth/refresh before rendering.
Short expiry (15 min) limits the exposure window if somehow intercepted.
```

### IDOR prevention

```javascript
// CORRECT — ownership enforced at query level
const consultation = await Consultation.findOne({
  _id: req.params.id,
  userId: req.user.id    // ← never retrieve without this
})
if (!consultation) return res.status(404).json(...)
// Returns 404 not 403 — don't reveal that the resource exists for another user
```

### Patient ownership

A patient is accessible only if `patient.userId === req.user.id`.
A consultation is accessible only if `consultation.userId === req.user.id`.
Enforced at query time, not after retrieval.

### Rate limiting (one new package: `express-rate-limit`)

```
Auth routes:    10 requests / 15 min per IP  (brute-force protection)
API routes:     200 requests / 15 min per IP
Audio upload:   10 requests / 15 min per user
```

### Security headers (one new package: `helmet`)

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy`.

### Refresh token cookie attributes

```
Set-Cookie: refreshToken=<value>;
  HttpOnly;           ← JavaScript cannot read
  Secure;             ← HTTPS only (production)
  SameSite=Strict;    ← not sent on cross-site requests
  Path=/api/auth/refresh;  ← scoped to the refresh endpoint only
  Max-Age=604800      ← 7 days
```

Scoping the cookie path to `/api/auth/refresh` means the browser only sends it to that specific endpoint. It is never transmitted alongside other API requests.

### MongoDB query safety

```
Mongoose strict: true (already enforced).
All IDs validated with mongoose.isValidObjectId() before queries.
No raw $where queries.
User-provided strings not interpolated into query operators.
```

### AWS IAM (principle of least privilege)

```
S3: scoped to the specific audio bucket only
Transcribe: StartTranscriptionJob, GetTranscriptionJob only
Bedrock: InvokeModel on amazon.nova-lite-v1:0 only
No long-lived access keys in codebase or environment.
```

### Sensitive data logging

```
NEVER log: passwords, JWT tokens, MongoDB URI, full transcripts in production, AWS credentials.
LOG safely: request method/path/status, S3 key (not contents), job names, sanitised error messages.
```

---

## 14. Testing Strategy

### Priority order (highest value first)

**1. Authorization tests**
```
- Unauthenticated requests → 401 on all protected routes
- Doctor A cannot access Doctor B's patients
- Doctor A cannot access Doctor B's consultations
- Cannot update/delete another user's resource
- Approved consultation cannot be modified
```

**2. Authentication unit tests**
```
- Password hashing + comparison
- JWT generation + verification
- Expired token → 401; Invalid token → 401
- Refresh token flow (page-refresh recovery)
- Access token NOT present in localStorage after login
```

**3. Consultation controller integration tests**
```
- Create → correct patientId + userId set
- Create without patientId → 400
- Create with another user's patientId → 400
- List → only current user's records
- Approve → approvedAt set; subsequent approve → 409
- Delete draft → works; Delete approved → 403
```

**4. Patient controller integration tests**
```
- Create → owned by userId
- Search by lastName + DOB → correct patient, not others
- medicalRecordId unique per userId (duplicate → error)
- Cannot read another user's patient
```

**5. Bedrock service unit tests (existing)**
```
- normalizeNote() handles all placeholder values
- normalizeSymptoms() splits lists correctly
- recomputeMissingInformation() correct for all states
```

**6. Diff service unit tests (new in V2)**
```
- setDiff returns correct new/resolved/persisting sets
- empty previous → all current items are "new"
- empty current → all previous items are "resolved"
- mentionedNewMedications vs noLongerMentionedMedications correct
```

**7. Patient history query tests**
```
- correctionOf: null filter returns only encounters
- last-approved query uses correction-aware logic
- encounter count excludes correction documents
```

**8. API integration tests**
```
- Full consultation lifecycle: create → draft → approve
- Pipeline: audio upload → transcribe (mocked) → extract (mocked)
```

**9. Frontend component tests**
```
- LoginPage: form validation, error display
- PrivateRoute: redirects unauthenticated users
- Page refresh: access token restored from refresh, user stays logged in
- ClinicalNoteReview: approval checklist gates button
- PipelineProgress: correct step highlighting
```

**10. E2E tests (Playwright, Phase 7)**
```
- Register → login → create patient → record → review → approve → history
- Page refresh during a session → still logged in, no login screen
- Patient search finds correct patient, not wrong one
- "What changed" shows correct diff for known consultations
- Correction of approved consultation does not increment encounter count
```

### Testing infrastructure

```
Unit + integration: Jest + Supertest (backend), Vitest (frontend)
E2E: Playwright
AWS mocking: aws-sdk-client-mock
MongoDB: dedicated test Atlas cluster or mongoosemem
```

---

## 15. Migration from V1

### V1 data situation (✅ verified)

Existing V1 `consultations` documents:
- Have no `userId` (no users existed in V1)
- Have patient data embedded in `note.patient.{name, age, sex}`
- Have no `patientId`
- Have `status` ('draft' or 'approved')
- Have `speakerUtterances`, `detectedLanguages`, `speakerRoleMapping`

### Decision: Hybrid migration

**V1 documents retained in-place. New `userId` and `patientId` fields default to `null`.**

V2 API filters by `userId: req.user.id` — V1 documents (`userId: null`) are invisible to new users by default. An optional admin migration tool assigns `userId` and optionally creates Patient records from embedded `note.patient` data.

**`patientId` compatibility contract:**

- Mongoose schema: `patientId` declared as nullable (`default: null`)
- V1 documents: `patientId: null` — valid under the schema
- `POST /api/consultations` (V2): rejects requests without a `patientId` — enforced in the controller, not the schema
- This dual contract (nullable at schema level, required at API level) is intentional and temporary
- Once all V1 documents have been migrated, `patientId` can be promoted to a schema-level required field

**Why not auto-migrate:** No way to know which user owns V1 data. Auto-creating patients from name strings risks duplicates and incorrect associations with live patient records.

**Why not delete:** Approved consultations are medical records — must not be destroyed.

**Schema backward compatibility:** All new fields have defaults (`null`, `null`, `'in_person'`, etc.). Existing V1 documents are valid under the new schema with `strict: true` retained.

### Migration script (design only — not yet implemented)

```
For each V1 consultation where userId is null:
  1. Admin assigns userId (the deploying doctor)
  2. System checks if Patient with matching name + DOB exists
  3. If yes: link consultation.patientId = patient._id
  4. If no: create Patient from note.patient fields, then link
  5. Mark consultation.migrationStatus = 'migrated'
```

---

## 16. Phased Implementation Plan

### Phase 0 — Infrastructure preparation (1–2 days)

**What changes:** Install `bcrypt`, `jsonwebtoken`, `express-rate-limit`, `helmet`, `cookie-parser`. Set up Jest + Supertest. Verify CloudFront timeout.  
**Database:** None  
**Files:** `server/package.json`, new middleware placeholders  
**Testing:** Verify build passes

---

### Phase 1 — Authentication + user isolation (3–5 days)

**What changes:** `User` model, auth routes (`register`, `login`, `refresh`, `logout`, `me`), JWT with memory-only access token + HttpOnly Secure refresh cookie, `authenticate` middleware, `userId` on consultations, all existing consultation queries scoped by `userId`, frontend `AuthContext` (memory-only token) + `LoginPage` + `RegisterPage` + `PrivateRoute` + silent refresh on mount.

**Not included in Phase 1:** email verification, password reset. Both are deferred hardening features.

**Database:** `users` collection created; `consultations.userId` field added; index `{ userId: 1, createdAt: -1 }`  
**New files:** `User.js`, `authController.js`, `authRoutes.js`, `authenticate.js`, client auth pages  
**Testing:** All authorization tests; token tests; refresh-on-page-reload test; verify consultation endpoints require auth; verify access token not in localStorage

---

### Phase 2 — Patient model + management (3–4 days)

**What changes:** `Patient` model, patient CRUD routes, patient search UI, `patientId` on consultations (nullable in schema, required by API).  
**Database:** `patients` collection created; `consultations.patientId` added; patient indexes including `{ userId, medicalRecordId }` unique+sparse  
**New files:** `Patient.js`, `patientController.js`, `patientRoutes.js`, client patient pages  
**Testing:** Patient ownership tests; search tests; medicalRecordId uniqueness per user; cross-user access blocked

---

### Phase 3 — Consultation ↔ Patient relationship (2–3 days)

**What changes:** New consultation flow requires `patientId`; validate `patientId` belongs to user; `NewConsultationPage` with patient selection + visual confirmation step; patient profile shows encounter history (correctionOf: null filter).  
**Database:** `patientId` now required by API for new consultations (nullable in schema for V1 compat)  
**New APIs:** `GET /api/patients/:id/consultations`, `GET /api/patients/:id/last-approved` (correction-aware query)  
**Testing:** Cannot create consultation with another user's patientId; encounter count excludes corrections

---

### Phase 4 — React Router + App decomposition (2–3 days)

**What changes:** Install `react-router-dom`; replace `App.jsx` state machine with Router + pages; `NewConsultationPage` with `useReducer` pipeline; `PipelineProgress` extracted; all routes implemented.  
**Testing:** Route protection; pipeline state transitions; page refresh stays logged in

---

### Phase 5 — Patient history + context (2–3 days)

**What changes:** `PatientContextPanel` (last approved encounter before new consultation, using correction-aware query); encounter history on patient profile.  
**Testing:** Last approved returned correctly using effective-state query; empty result when no approved encounters

---

### Phase 6 — "What changed since last visit?" (3–4 days)

**What changes:** `consultationDiffService.js` (pure diff functions with correct `medications_mentioned` semantics); `POST /api/patients/:id/change-summary`; Bedrock prompt with explicit medication disclaimer; `ChangeSummaryPanel.jsx`.  
**Testing:** Diff service unit tests (including medications_mentioned semantics); Bedrock not called when no previous approved encounter; previous-visit reference uses correction-aware query

---

### Phase 7 — Testing + security hardening (3–4 days)

**What changes:** Complete authorization test suite; rate limiting; `helmet`; input validation (Zod or manual); MongoDB query review; Playwright E2E including page-refresh auth test; logging audit.

---

### Phase 8 — Deployment (1–2 days)

**What changes:** CloudFront origin timeout updated; EC2 `.env` updated with `JWT_SECRET`, `JWT_REFRESH_SECRET`; `NODE_ENV=production` ensures Secure cookie flag; PM2 restart; smoke tests.

---

## 17. Architectural Decision Records

### ADR-001: Authentication Method (revised R1)

**Decision:** Email + password with JWT.  
Access token: stored in React memory only, never in localStorage/sessionStorage.  
Refresh token: HTTP-only, Secure (production), SameSite=Strict cookie, scoped to `/api/auth/refresh`.  
Session recovery: silent refresh on page load restores the access token before rendering.

**Alternatives:** Google OAuth, Magic link, Sessions + Redis, localStorage JWT  
**Reason:** Self-contained. No external provider. Standard security model. Stateless access token. HTTP-only Secure cookie protects refresh token from XSS and network interception. Memory-only access token is not persisted anywhere, so page XSS cannot exfiltrate it after the session ends.  
**Trade-offs:** Access token lost on page refresh — mitigated by silent refresh. Password reset requires email infrastructure (deferred).  
**Deferred items:** Email verification, password reset. These are hardening features not present in Phase 1. They must not be emulated through informal API mechanisms.  
**Future migration:** Can add OAuth providers as additional login methods without changing the core JWT model.

---

### ADR-002: Separate Patient Collection

**Decision:** Create a `patients` collection with persistent patient records linked via `patientId`.  
**Alternatives:** Keep patient data embedded in consultation; virtual patient grouping  
**Reason:** Longitudinal history requires stable patient identity. `_id` is the only reliable anchor.  
**Trade-offs:** New entity to manage. Schema migration for V1 documents.  
**Future migration:** Patient collection can gain allergy/chronic condition fields without touching consultation schema.

---

### ADR-003: Ownership Model

**Decision:** `User → Patient` (1:N), `Patient → Consultation` (1:N). `userId` on both. All queries scoped by `userId`.  
**Alternatives:** Clinic/org model; global patient pool  
**Reason:** Simplest correct model for single-doctor practice. Preserves patient privacy.  
**Trade-offs:** Two doctors cannot collaborate on the same patient in V2.  
**Future migration:** Add `organisationId` to both models.

---

### ADR-004: Consultation Relationship to Patient (revised R1)

**Decision:** `consultation.patientId` is a nullable-at-schema-level, required-at-API-level ObjectId reference to `patients._id`. Nullable in schema only for V1 backward compatibility. `consultation.userId` is denormalised for efficient queries.  
**Alternatives:** Only `patientId`; only `userId`; hard required at schema level  
**Reason:** Both fields are needed for efficient queries. Schema nullable + API required allows V1 documents to remain valid while enforcing the constraint on all new data.  
**Trade-offs:** The split enforcement (schema vs controller) requires documentation and tests to maintain. Once migration is complete, schema-level required can be enabled.

---

### ADR-005: Note Versioning (revised R1)

**Decision:** Mutable draft, immutable once approved. Corrections create new documents (with `correctionOf`) that are not new clinical encounters.  
**Alternatives:** Full version array; immutable from creation; allow overwriting approved notes  
**Reason:** Simplest model that preserves audit trail. Correction chain is traceable. Encounter count and "previous visit" logic explicitly exclude correction documents.  
**Trade-offs:** History queries must filter by `correctionOf: null`. "Effective last approved note" query must check `supersededBy: null` to get the current version.

---

### ADR-006: Synchronous Transcription (Phase 1)

**Decision:** Retain V1 synchronous polling. Evaluate async in Phase 3.  
**Alternatives:** SQS+Lambda async; SSE progress streaming; WebSocket  
**Reason:** Works today. One CloudFront setting change. No new infrastructure.  
**Trade-offs:** 3-min max wait on single HTTP connection. CloudFront timeout must be configured.  
**Future migration:** `processingStatus` field already on Consultation model.

---

### ADR-007: AI vs Deterministic Change Detection (revised R1)

**Decision:** Deterministic set-difference logic for structured fields. LLM only for clinical narrative, only on explicit doctor request. `medications_mentioned` treated as "what was verbally stated this visit" — not a medication record — in both the diff logic and the LLM prompt.  
**Alternatives:** Pure LLM; pure deterministic; auto-generate; full medication reconciliation  
**Reason:** Structured diff is cheap, instant, testable. LLM adds value for narrative. Gating controls cost. Explicitly limiting the medication semantics prevents the system from implying clinical conclusions it cannot support.  
**Trade-offs:** Extra click to see narrative. LLM quality varies. No cumulative medication record.

---

### ADR-008: V1 Data Migration

**Decision:** Hybrid — V1 documents retained with `userId: null`. Admin tool enables optional linking.  
**Alternatives:** Full automatic migration; delete V1 data; separate system  
**Reason:** No way to auto-assign ownership without human judgment. Medical records must not be destroyed.  
**Trade-offs:** V1 data temporarily inaccessible until manually linked.

---

## 18. Final Deliverables

### A. Final V2 Architecture Diagram

```
BROWSER (React + Vite + React Router)
  access token: React memory only
  refresh token: sent via HttpOnly Secure cookie
    │  HTTPS
    ▼
AMAZON CLOUDFRONT
  origin timeout: 180s
  allowed methods: GET HEAD OPTIONS PUT POST PATCH DELETE
  cache: disabled for /api/*
    │  HTTP :3000
    ▼
AMAZON EC2  (ap-southeast-2)  ←  IAM Role: VoiceScribeEC2Role
  Node.js 20 + PM2 + Express 5
  Serves client/dist/ (NODE_ENV=production)
  │
  ├── /api/auth/*          → authController
  ├── /api/patients/*      → patientController
  ├── /api/consultations/* → consultationController
  ├── /api/audio           → audioController
  ├── /api/transcribe      → transcribeController
  └── /api/extract-note    → bedrockController
  │
  ├── MONGODB ATLAS
  │     users
  │     patients
  │     consultations
  │
  ├── AMAZON S3 (ap-southeast-2)
  │     audio deleted after extraction
  │
  ├── AMAZON TRANSCRIBE (ap-southeast-2)
  │     IdentifyMultipleLanguages: hi-IN, en-IN
  │     ShowSpeakerLabels: true, MaxSpeakerLabels: 2
  │
  └── AMAZON BEDROCK (ap-southeast-2)
        amazon.nova-lite-v1:0
        note extraction + change summary
```

### B. Final Database Schema

```
COLLECTION: users
  _id*, email* (unique), passwordHash*, displayName*, role,
  refreshTokenHash, isActive, lastLoginAt, createdAt*, updatedAt*
  INDEX: { email: 1 } unique

COLLECTION: patients
  _id*, userId*, firstName*, lastName*, dateOfBirth*, biologicalSex*,
  medicalRecordId (optional), phone, notes, isArchived, createdAt*, updatedAt*
  INDEX: { userId:1, lastName:1, firstName:1 }
  INDEX: { userId:1, dateOfBirth:1 }
  INDEX: { userId:1, medicalRecordId:1 } unique:true, sparse:true

COLLECTION: consultations
  _id*, userId*, patientId (nullable for V1 docs; required by API for new docs),
  consultationDate, encounterType,
  sourceAudioKey, audioFormat, processingStatus,
  transcript, detectedLanguages[], speakerUtterances[], speakerRoleMapping,
  note { patient{name,age,sex}, chief_complaint, symptoms[], duration,
         history, observations[], assessment, medications_mentioned[],
         follow_up, missing_information[], uncertain_fields[] },
  status*, approvedAt, approvedBy,
  correctionOf (null = original encounter; ObjectId = correction document),
  supersededBy (null = current version; ObjectId = has been corrected),
  createdAt*, updatedAt*
  INDEX: { userId:1, createdAt:-1 }
  INDEX: { patientId:1, createdAt:-1 }
  INDEX: { userId:1, patientId:1, createdAt:-1 }

* = required or auto-generated
```

### C. Final API Map

```
PUBLIC
  POST /api/auth/register
  POST /api/auth/login
  POST /api/auth/refresh   (HttpOnly Secure cookie)
  GET  /api/health

AUTHENTICATED
  POST /api/auth/logout
  GET  /api/auth/me

  POST   /api/patients
  GET    /api/patients
  GET    /api/patients/:id
  PUT    /api/patients/:id
  GET    /api/patients/:id/consultations        (correctionOf:null filter)
  GET    /api/patients/:id/last-approved        (correction-aware query)
  POST   /api/patients/:id/change-summary

  POST   /api/consultations                     (patientId required)
  GET    /api/consultations
  GET    /api/consultations/:id
  PUT    /api/consultations/:id
  DELETE /api/consultations/:id   (draft only)

  POST   /api/audio
  POST   /api/transcribe
  POST   /api/extract-note
```

### D. Final Frontend Route Structure

```
/                              → redirect
/login                         → LoginPage
/register                      → RegisterPage
/dashboard                     → DashboardPage
/patients                      → PatientListPage
/patients/new                  → NewPatientPage
/patients/:id                  → PatientProfilePage
/consultation/new?patientId=:id → NewConsultationPage
/consultation/:id              → ConsultationPage
/consultation/:id/change-summary → ChangeSummaryPage
```

### E. Final AWS Architecture

| Service | Change from V1 | Action required |
|---|---|---|
| EC2 | Add JWT env vars; Secure cookie in production | Edit `.env`, `pm2 restart voicescribe` |
| CloudFront | Origin timeout | Set origin response timeout to 180s in console |
| S3 | None | — |
| Transcribe | None | — |
| Bedrock | None | New change-summary prompt uses same model |
| IAM Role | None | Existing permissions sufficient |

### F. Architectural decisions now FROZEN

1. JWT authentication: memory-only access token + HTTP-only Secure refresh cookie — ADR-001 (R1)
2. Separate `patients` collection — ADR-002
3. `userId` on both Patient and Consultation — ADR-003
4. `patientId` nullable in schema, required by API, explicit migration contract — ADR-004 (R1)
5. Mutable draft + correction-document (not a new encounter) for approved notes — ADR-005 (R1)
6. Deterministic diff first, Bedrock second; `medications_mentioned` = stated-in-session only — ADR-007 (R1)
7. V1 data retained with `userId: null`, not deleted — ADR-008
8. No Docker, no Kubernetes, no ECS, no Redis for V2
9. Email verification and password reset are deferred hardening features, not Phase 1 scope — ADR-001 (R1)

### G. Decisions still requiring human review

| # | Decision | Options | What to decide |
|---|---|---|---|
| G-1 | Synchronous vs async transcription | Keep sync (Phase 1) OR build async now | How reliable is CloudFront timeout in practice? |
| G-2 | Organisation/clinic model | Doctor-only (current) OR org model now | Are there multi-doctor use cases? |
| G-3 | Email verification | Skip OR add with SES | How important is email verification for doctors? |
| G-4 | Password reset | Skip OR add with SES | Can admin manually reset passwords for now? |
| G-5 | Change summary — auto or on demand | On explicit request (current) OR auto after approval | Cost/UX tradeoff |
| G-6 | Encounter type enum | Use current values OR customise | Does clinical use case need different types? |
| G-7 | Patient deletion | Soft delete only (current) OR allow hard delete with no consultations | Regulatory preference |
| G-8 | V1 data linking | Manual admin tool OR self-service by deploying doctor | Who performs the migration? |

---

## 19. Engineering Review — Revision 1

**Date:** Post initial architecture document  
**Purpose:** Incorporate five targeted corrections identified during engineering review.  
**No application code was changed.**

---

### Change 1 — Access token storage clarified

**What changed:** Section 2 (Authentication), Section 10 (Frontend), Section 13 (Security), ADR-001, final deliverables.

**Original design:** The token strategy section listed "Client memory / localStorage" as the access token storage location. ADR-001 did not explicitly prohibit localStorage.

**Revised design:** Access token is stored in React in-memory state (`AuthContext`) only. `localStorage` and `sessionStorage` are explicitly prohibited. The refresh flow silently restores the access token on page load so the user does not experience a login interruption after browser refresh. The refresh token cookie gains the `Secure` attribute (required in production) and is scoped to `Path=/api/auth/refresh` to prevent it from being sent on other API requests.

**Why:** `localStorage` and `sessionStorage` are readable by any JavaScript executing on the page. An XSS vulnerability — even in a third-party script — can silently exfiltrate a token stored there. React in-memory state is not persisted and is not accessible outside the module's execution context. The 15-minute access token expiry further limits the exposure window.

---

### Change 2 — Patient identity semantics clarified

**What changed:** Section 3 (Patients collection — `medicalRecordId` index), Section 4 (Patient Identity), ADR-002.

**Original design:** Section 4 described `dateOfBirth + lastName` as the "primary identity anchor." The uniqueness strategy for `medicalRecordId` was documented as `{ userId, medicalRecordId }` sparse without explicit uniqueness.

**Revised design:** `Patient._id` is explicitly named as the sole stable identity. `dateOfBirth + lastName` is described as a search/candidate-matching mechanism only. `medicalRecordId` is an additional exact-match search identifier. The `{ userId, medicalRecordId }` index is now `unique: true, sparse: true` — preventing a doctor from accidentally assigning the same reference ID to two different patients in their own system, while allowing the field to be absent. The doctor-confirmation step (visual selection, never auto-merge) is explicitly stated as a safety requirement.

**Why:** Without this distinction, an implementer could reasonably build a system that treats `lastName + dateOfBirth` equality as sufficient to auto-link patients. That would be a clinical safety error. The uniqueness constraint on `medicalRecordId` prevents a specific class of data-entry error without over-constraining the schema.

---

### Change 3 — `patientId` / V1 migration compatibility made explicit

**What changed:** Section 7 (Consultation model, `patientId` field description), Section 9 (API — `POST /api/consultations`), Section 15 (Migration), ADR-004.

**Original design:** The consultation schema listed `patientId` as `required`. This created an implicit contradiction with Section 15, which states V1 documents have no `patientId`.

**Revised design:** `patientId` is explicitly declared as nullable at the Mongoose schema level (`default: null`) to allow V1 documents to remain valid without migration. The `POST /api/consultations` controller enforces `patientId` as required for all new V2 data. This dual contract — nullable in schema, required in controller — is documented as intentional and temporary. The path to promoting it to a schema-level required field after migration is described.

**Why:** A `required: true` Mongoose field would cause all V1 documents to fail validation on any write operation, breaking the migration path. The controller-level enforcement provides the same guarantee for new data without invalidating existing data.

---

### Change 4 — Correction documents are not clinical encounters

**What changed:** Section 5 (Patient History), Section 7 (NoteSchema — `medications_mentioned` description), Section 8 (Note Versioning — full correction semantics and query design), Section 14 (Testing), ADR-005, final deliverables.

**Original design:** Corrections were described as "new consultation documents" and the encounter count / "previous visit" queries were not defined to exclude them. This could lead to an implementation where corrections inflate the patient's encounter count and appear as separate visits in the history.

**Revised design:** Corrections are explicitly described as administrative corrections to an existing encounter's documentation, not new clinical visits. All patient history queries, encounter counts, and "previous visit" lookups are specified to filter `correctionOf: null` (original encounters only). The "effective last approved note" query additionally requires `supersededBy: null` to return the current version of the most recent encounter. Precise MongoDB query semantics are given for each case.

**Why:** From a clinical documentation perspective, correcting a note does not constitute a new patient visit. Counting corrections as encounters would give misleading statistics (e.g., "5 visits" when 3 were real and 2 were corrections). The "previous visit" for change-summary purposes must reference the correct clinical timeline.

---

### Change 5 — `medications_mentioned` semantics and password recovery scope

**What changed (medications):** Section 6 ("What Changed Since Last Visit?"), ADR-007.

**Original design:** The change summary diff used field names `newMedications` and `stoppedMedications` which imply that medications were started or stopped. The LLM prompt did not include a disclaimer about the limited nature of this field.

**Revised design:** The field names are changed to `mentionedNewMedications` and `noLongerMentionedMedications` to accurately reflect what is being compared. An explicit note is added: `medications_mentioned` records what was verbally stated during each session — it is not a confirmed medication list and does not support conclusions about what the patient is or was prescribed. This constraint is included as a `context` field in the Bedrock input and in the model instruction.

**Why:** Presenting "stopped medications" based on what was mentioned in a consultation is clinically misleading. A medication not mentioned in a follow-up visit may still be ongoing. The system must not create documentation that implies clinical conclusions it cannot support.

**What changed (password recovery):** Section 2 (Scope of Phase 1 auth), ADR-001.

**Original design:** The absence of password reset was mentioned as a trade-off but not explicitly scoped as a deferred feature. The phrasing implied that manual admin reset was an acceptable substitute.

**Revised design:** Email verification and password reset are explicitly marked as deferred hardening features. Phase 1 scope is precisely stated. The document explicitly states that no informal reset mechanism should be exposed through the API as a substitute for a proper implementation.

**Why:** Describing a manual database reset as an acceptable workaround creates a false sense of completeness and may lead to insecure shortcuts (e.g., a `POST /api/admin/reset-password` route with weak controls). The correct position is to acknowledge the gap and defer it properly.
