# VoiceScribe V2 — Engineering Audit

> **Status:** Read-only audit document. No code was changed during preparation.  
> **Source:** Every claim below is verified from the actual repository files.  
> **Deployed V1:** https://d20yro74mg9hym.cloudfront.net/  
> **Last commit audited:** `f527ebf` — "feat: prepare single-origin production deployment"

---

## Table of Contents

1. [Current Architecture](#1-current-architecture)
2. [Current Data Flow — End-to-End](#2-current-data-flow--end-to-end)
3. [Frontend Structure](#3-frontend-structure)
4. [Backend Structure](#4-backend-structure)
5. [API Contract Map](#5-api-contract-map)
6. [Database Schema](#6-database-schema)
7. [AWS / Deployment Architecture](#7-aws--deployment-architecture)
8. [Security Audit](#8-security-audit)
9. [Technical Debt](#9-technical-debt)
10. [V2 Impact Analysis](#10-v2-impact-analysis)
11. [Open Questions for V2](#11-open-questions-for-v2)
12. [Executive Summary](#12-executive-summary)

---

## 1. Current Architecture

### Technology Stack (verified)

| Layer | Technology | Version |
|---|---|---|
| Frontend | React + Vite | React 19.2, Vite 8.3 |
| Backend | Node.js + Express | Express 5.2 |
| Database | MongoDB Atlas | Mongoose 9.10 |
| Audio upload | AWS S3 (ap-southeast-2) | `@aws-sdk/client-s3 ^3.1134` |
| Speech-to-text | Amazon Transcribe (ap-southeast-2) | `@aws-sdk/client-transcribe ^3.1134` |
| AI extraction | Amazon Bedrock Nova Lite (ap-southeast-2) | `@aws-sdk/client-bedrock-runtime 3.1134.0` |
| File handling | Multer 2.4 | memoryStorage, 25 MB limit |
| Process management | PM2 (on EC2) | Unknown — not in package.json |
| CDN / HTTPS | Amazon CloudFront | Unknown distribution ID |
| Compute | Amazon EC2 | Unknown instance type |

### Repository Structure (verified)

```
VoiceScribe/
├── client/                      ← React/Vite frontend
│   ├── src/
│   │   ├── App.jsx              ← Top-level orchestrator (stages + state)
│   │   ├── AudioRecorder.jsx    ← Mic recording + file upload + S3+Transcribe
│   │   ├── ClinicalNoteReview.jsx  ← Doctor review/edit/approve screen
│   │   ├── Dashboard.jsx        ← Consultation list + stats + search/filter
│   │   ├── ConsultationHistory.jsx ← Legacy history list (still used?)
│   │   ├── api.js               ← Central apiUrl() helper
│   │   ├── App.css              ← ~1,800 lines all styles
│   │   └── index.css            ← Design tokens
│   ├── vite.config.js
│   └── package.json
├── server/
│   ├── src/
│   │   ├── server.js            ← Entry point (listen + connectDb)
│   │   ├── app.js               ← Express setup + static serving
│   │   ├── config/env.js        ← Env vars with startup validation
│   │   ├── config/db.js         ← Mongoose connection (exits on failure)
│   │   ├── routes/              ← 5 route files
│   │   ├── controllers/         ← 5 controller files
│   │   ├── services/            ← s3Service, transcribeService, bedrockService
│   │   ├── middleware/          ← audioUpload (multer), errorHandler
│   │   └── models/Consultation.js
│   └── package.json
├── docs/
│   └── V2-ENGINEERING-AUDIT.md ← this file
└── README.md
```

### Authentication

**There is no authentication.** Verified — no auth middleware, no session management, no JWT, no user model. Every API endpoint is publicly accessible. All consultations are shared across all users.

---

## 2. Current Data Flow — End-to-End

```
[Browser]
    │
    │  1. Record mic / select file (AudioRecorder.jsx)
    │     → MediaRecorder API or File input
    │
    │  2. POST /api/audio  (multipart/form-data, field: "audio")
    ▼
[Express: audioController]
    │  → multer validates MIME + size
    │  → s3Service.uploadAudio() → S3 PutObject
    │  ← { success: true, objectKey: "consultations/timestamp-random.webm" }
    ▼
[Browser: AudioRecorder.jsx]
    │
    │  3. POST /api/transcribe  { objectKey }
    ▼
[Express: transcribeController]
    │  → transcribeService.transcribeAudio()
    │    → StartTranscriptionJobCommand (IdentifyMultipleLanguages, ShowSpeakerLabels)
    │    → polls GetTranscriptionJobCommand every 3s, up to 60 attempts (3 min max)
    │    → on COMPLETED: fetch(transcriptUri) → parse JSON
    │    → buildSpeakerUtterances() → groups words by speaker_label
    │  ← { success, transcript, detectedLanguages, speakerUtterances }
    ▼
[Browser: App.jsx handleTranscriptReady()]
    │
    │  4. POST /api/extract-note  { transcript, objectKey }
    ▼
[Express: bedrockController]
    │  → bedrockService.extractClinicalNote()
    │    → ConverseCommand with toolChoice forced to extract_clinical_note
    │    → normalizeNote() post-processing
    │    → recomputeMissingInformation()
    │  → [after success] deleteAudioObject(objectKey) — fire-and-forget
    │  ← { success: true, note: { patient, chief_complaint, symptoms, ... } }
    ▼
[Browser: App.jsx → STAGE.REVIEW]
    │
    │  5. Doctor reviews/edits ClinicalNoteReview.jsx
    │     Approval checklist (3 items must be checked)
    │
    │  6a. POST /api/consultations  { transcript, note, status:"draft", ... }
    │  6b. PUT  /api/consultations/:id  { ...same, status:"approved" }
    ▼
[Express: consultationController]
    │  → Consultation.create() / .save()
    │  ← { success: true, consultation: { _id, ... } }
    ▼
[MongoDB Atlas]
    └── consultations collection
```

---

## 3. Frontend Structure

### Pages / Screens (no router — state-machine navigation)

`App.jsx` uses a `STAGE` enum to switch between four mutually exclusive screens:

| Stage | What renders | Trigger |
|---|---|---|
| `DASHBOARD` | `<Dashboard>` (right) + start/recorder (left) | Default / `handleBack()` |
| `RECORDING` | `<AudioRecorder>` replaces start-card | "Start recording" click |
| `PROCESSING` | Full-screen pipeline progress card | `handleStageChange('uploading')` |
| `REVIEW` | `<ClinicalNoteReview>` full-screen | `openReview()` after Bedrock |

**There is no React Router.** Navigation is pure React state. Direct URL deep-links are not possible — refreshing always lands on DASHBOARD.

### Component Map (verified)

| Component | File | Responsibility |
|---|---|---|
| `App` | App.jsx | Stage machine, all pipeline state, Bedrock call |
| `AudioRecorder` | AudioRecorder.jsx | Mic capture, file upload, S3 upload, Transcribe call |
| `FileUploadSection` | (inside AudioRecorder.jsx) | File picker sub-component |
| `ClinicalNoteReview` | ClinicalNoteReview.jsx | Doctor review/edit, save/approve |
| `ApprovalChecklist` | (inside ClinicalNoteReview.jsx) | 3-item safety checklist |
| `SpeakerView` | (inside ClinicalNoteReview.jsx) | Speaker utterances + role mapping |
| `LanguageIndicator` | (inside ClinicalNoteReview.jsx) | Language detection display |
| `ExtractionSummary` | (inside ClinicalNoteReview.jsx) | Field extraction quality score |
| `Dashboard` | Dashboard.jsx | Stats cards, search, filter, consultation list |
| `ConsultationCard` | (inside Dashboard.jsx) | Individual consultation row |
| `ConsultationHistory` | ConsultationHistory.jsx | Legacy history list — **still imported?** Unknown. |

**Note:** `ConsultationHistory.jsx` exists but `App.jsx` imports `Dashboard.jsx`, not `ConsultationHistory.jsx`. Whether the old component is still used is **unknown** — it may be dead code.

### State Management

All application state lives in `App.jsx` via `useState`. No external state library. Major state variables:

```
stage, stageRef (ref mirror to avoid stale closures)
pipelineStep, pipelineError, processingFailed
pendingObjectKey, pendingTranscript          ← for Bedrock retry
transcript, note, isDemo, bedrockFailed
detectedLanguages, speakerUtterances, speakerRoleMapping
activeConsultationId, dashboardRefresh
```

`ClinicalNoteReview.jsx` has its own local state for the note form (via `useReducer`), checklist state, save/error messages, and `consultationId`. A `localStorage` cache (`voicescribe_draft_note`) mirrors the draft for refresh survivability.

### API URL Pattern

`client/src/api.js` exports `apiUrl(path)`. In production, `VITE_API_BASE_URL` is empty (single-origin), so all calls resolve as relative paths (`/api/...`). In dev, the Vite proxy forwards to `localhost:5000` with a 300-second timeout.

---

## 4. Backend Structure

### Entry Point Chain

```
server.js
  → dns.setServers(['8.8.8.8','1.1.1.1'])   ← global DNS override for Atlas
  → app.listen(port)
  → connectDb(mongodbUri)                    ← process.exit(1) on failure
```

**Note:** Server listens **then** connects to MongoDB. In the window between listen and connectDb resolving, API requests that hit the database will fail. This is a known ordering issue.

### Middleware Stack

```
cors({ origin: clientOrigin })
express.json({ limit: '1mb' })
/api → apiRoutes
  → /health     → healthController
  → /audio      → [audioUpload multer] → audioController
  → /transcribe → transcribeController
  → /extract-note → bedrockController
  → /consultations → consultationController (CRUD)
[NODE_ENV=production] express.static(client/dist)
[NODE_ENV=production] app.get('/{*path}') → index.html
errorHandler (multer errors + generic 500)
```

### Services

**s3Service.js**
- `uploadAudio(file)` — `PutObjectCommand`, key = `consultations/${timestamp}-${6-hex}.${ext}`
- `deleteAudioObject(objectKey)` — `DeleteObjectCommand`, swallows errors, only called after Bedrock success

**transcribeService.js**
- `startTranscription(objectKey)` — `StartTranscriptionJobCommand` with:
  - `IdentifyMultipleLanguages: true`, `LanguageOptions: ['hi-IN','en-IN']`
  - `Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 }`
- `waitForTranscription(jobName)` — polls up to 60×3s = 3 min max
- `buildSpeakerUtterances(items)` — groups words into utterance objects

**bedrockService.js**
- Model: `amazon.nova-lite-v1:0`
- API: `ConverseCommand` with `toolChoice: { tool: { name: 'extract_clinical_note' } }`
- Full normalizer pipeline: `normalizeString`, `normalizeArray`, `normalizeSymptoms`, `normalizeObservations`, `normalizeNote`, `recomputeMissingInformation`
- Exports: `extractClinicalNote`, `normalizeNote`, `recomputeMissingInformation`

---

## 5. API Contract Map

All endpoints return `{ success: boolean, ... }`. No authentication required on any endpoint.

| Method | Endpoint | Purpose | Auth | Request Body | Response |
|---|---|---|---|---|---|
| `GET` | `/api/health` | Health check | None | — | `{ success, service, status, message }` |
| `POST` | `/api/audio` | Upload audio to S3 | None | `multipart/form-data` field `audio` | `{ success, objectKey, message }` |
| `POST` | `/api/transcribe` | Start + poll Transcribe | None | `{ objectKey: string }` | `{ success, jobName, status, transcript, detectedLanguages[], speakerUtterances[] }` |
| `POST` | `/api/extract-note` | Bedrock note extraction + S3 cleanup | None | `{ transcript: string, objectKey?: string }` | `{ success, note: {...} }` |
| `POST` | `/api/consultations` | Create consultation | None | `{ transcript, note, status, speakerUtterances?, detectedLanguages?, speakerRoleMapping? }` | `{ success, consultation: {...} }` HTTP 201 |
| `GET` | `/api/consultations` | List all consultations | None | — | `{ success, consultations: [...summary fields] }` |
| `GET` | `/api/consultations/:id` | Get single consultation | None | — | `{ success, consultation: {...full doc} }` |
| `PUT` | `/api/consultations/:id` | Update consultation | None | Same as POST body | `{ success, consultation }` |

### Notable API Behaviours

- `PUT /api/consultations/:id` with `status: 'approved'` when already `approved` → HTTP 409 (duplicate-approval prevention)
- `POST /api/extract-note` triggers fire-and-forget S3 audio deletion if `objectKey` is provided and extraction succeeds
- `GET /api/consultations` uses `.select()` to return only summary fields — `speakerUtterances`, full `transcript`, and `note` subfields beyond patient/chief_complaint are **omitted** from the list. Full data is returned by `GET /api/consultations/:id`.
- `/api/transcribe` holds the HTTP connection open for up to 3 minutes (polling loop). This is a long-running synchronous request.

---

## 6. Database Schema

### Collection: `consultations`

**Model:** `server/src/models/Consultation.js`  
**Options:** `{ timestamps: true, strict: true }`

```
_id             ObjectId   (auto)
transcript      String     default: ''     — raw Transcribe output
status          String     enum: ['draft','approved']  default: 'draft'
approvedAt      Date       default: null   — set on first approval

note            Object (embedded)
  patient       Object
    name        String     default: ''
    age         Number     default: null
    sex         String     default: ''
  chief_complaint   String  default: ''
  symptoms          [String]  default: []
  duration          String    default: ''
  history           String    default: ''
  observations      [String]  default: []
  assessment        String    default: ''
  medications_mentioned [String] default: []
  follow_up         String    default: ''
  missing_information [String] default: []
  uncertain_fields   [String] default: []

speakerUtterances  [Object]   default: []
  speaker          String     required
  startTime        Number     required
  endTime          Number     required
  text             String     default: ''

detectedLanguages  [Object]   default: []
  code             String     required
  duration         Number     default: null

speakerRoleMapping  Mixed     default: {}   — { spk_0: 'Patient', spk_1: 'Clinician' }

createdAt          Date       (auto — timestamps)
updatedAt          Date       (auto — timestamps)
```

### Indexes

**Unknown.** No indexes are defined in the Mongoose schema. Only the default `_id` index exists unless MongoDB Atlas auto-created them. For V2 with multi-user support, indexes on `createdAt` (for sorting) and potentially a future `userId` field will be required.

### Relationships

**None.** There is no `User` collection, no `Patient` collection, no `Doctor` collection. A consultation document is a self-contained unit. Patient identity is captured only as unvalidated strings inside `note.patient`.

### What data represents what

- **A "user":** Does not exist. No user model, no authentication.
- **A "consultation":** One `Consultation` document = one audio recording session. Contains the raw transcript, the AI-extracted structured note, speaker diarization data, and the doctor's review status/edits.
- **A "medical record" / "approved note":** A `Consultation` document where `status === 'approved'`. There is no separate collection — approval is a field on the same document.

---

## 7. AWS / Deployment Architecture

### Verified Deployment (from README + .env.example + code)

```
HTTPS
  ▼
Amazon CloudFront
  (distribution: d20yro74mg9hym.cloudfront.net)
  ▼ HTTP :3000
Amazon EC2  (Amazon Linux 2023, ap-southeast-2)
  ├── Node.js 20 + PM2
  ├── git clone → server/
  ├── NODE_ENV=production → Express serves client/dist/
  └── IAM Instance Role: VoiceScribeEC2Role
       ├── AmazonS3FullAccess
       ├── AmazonTranscribeFullAccess
       └── AmazonBedrockFullAccess
  ▼
AWS Services (all ap-southeast-2)
  ├── S3 bucket: voicescribe-audio-sydney-2026-47k2
  │     Objects: consultations/{timestamp}-{hex}.{ext}
  │     Retention: deleted after successful Bedrock extraction
  ├── Amazon Transcribe
  │     IdentifyMultipleLanguages: true
  │     LanguageOptions: ['hi-IN', 'en-IN']
  │     ShowSpeakerLabels: true, MaxSpeakerLabels: 2
  └── Amazon Bedrock
        Model: amazon.nova-lite-v1:0
        API: Converse (tool use / forced tool choice)
  ▼
MongoDB Atlas  (cluster: unknown — URI from env)
  └── collections: consultations
```

### Environment Variables Required (names only, no values)

| Variable | Purpose |
|---|---|
| `PORT` | Express listen port (default: 3000 on EC2) |
| `NODE_ENV` | `production` to activate static serving |
| `MONGODB_URI` | Atlas connection string |
| `CLIENT_ORIGIN` | Allowed CORS origin (CloudFront URL) |
| `AWS_REGION` | `ap-southeast-2` |
| `S3_BUCKET_NAME` | Audio bucket name |
| `MAX_AUDIO_FILE_BYTES` | Upload limit (default 25 MB) |

AWS credentials: **not stored in env vars** — obtained via EC2 IAM instance role.

### CloudFront Configuration (from README — verified as documented)

| Setting | Value |
|---|---|
| Origin | EC2 public DNS, HTTP, port 3000 |
| Viewer protocol | Redirect HTTP → HTTPS |
| Allowed methods | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE |
| Cache policy | CachingDisabled |
| Origin request policy | AllViewer |

---

## 8. Security Audit

### Issues Found (verified)

| Severity | Issue | Evidence |
|---|---|---|
| 🔴 Critical | **No authentication on any endpoint** | No auth middleware anywhere in routes or controllers |
| 🔴 Critical | **Any user can read all consultations** | `GET /api/consultations` returns all documents, no filtering by user |
| 🔴 Critical | **Any user can approve/modify any consultation** | `PUT /api/consultations/:id` has no ownership check |
| 🟡 Medium | **No rate limiting** | No rate-limit middleware, no IP throttling |
| 🟡 Medium | **JSON body limited to 1 MB** | Set in `express.json({ limit: '1mb' })` — fine for notes, but the transcript field alone can exceed this for long consultations |
| 🟡 Medium | **S3 audio URL exposure risk** | Transcribe job stores `TranscriptFileUri` temporarily; it's fetched server-side so the client never sees it, but it is a time-limited public S3 URL |
| 🟡 Medium | **CORS allows configured origin only** | Good — but `CLIENT_ORIGIN` defaults to `http://localhost:5174`, so misconfigured production would be open |
| 🟢 Low | **No secret values hardcoded** | Verified — all from env vars |
| 🟢 Low | **Bedrock errors surface to client** | Error name/code returned to frontend — acceptable for a hackathon, worth sanitising in V2 |
| 🟢 Low | **Stack traces not exposed** | `errorHandler` returns only `"Something went wrong."` for unhandled errors |

### What is Safe

- AWS credentials never reach the frontend (IAM role only)
- Audio files are deleted from S3 after successful processing
- Mongoose `strict: true` prevents arbitrary field injection into the DB
- Note extraction is post-processed server-side before being returned

---

## 9. Technical Debt

### Architectural

1. **No user identity.** All consultations are global. V2 requires user accounts and per-user data isolation. This is the single most fundamental architectural gap.

2. **Single collection stores everything.** The `Consultation` document embeds the transcript (can be several KB), all speaker utterances, and the full structured note. For large-scale use this is inefficient, but for a hackathon it's acceptable.

3. **Synchronous transcription blocks HTTP.** `POST /api/transcribe` holds the connection for up to 3 minutes. The Vite proxy timeout was increased to 300s to compensate. In production, CloudFront and load balancers may have their own timeout limits. The proper solution is an async job pattern (start job → return job ID → poll from frontend) but this is a significant change.

4. **App.jsx is a God Component.** All pipeline state, all stage transitions, all Bedrock calls, all navigation logic live in one 420-line file. This will become unmaintainable as V2 adds features.

5. **No React Router.** Deep-linking is impossible. Browser back/forward don't work. Each refresh returns to the dashboard. V2 should introduce routing.

### Code Quality

6. **`ConsultationHistory.jsx` may be dead code.** `App.jsx` imports `Dashboard.jsx` (which has its own history list). `ConsultationHistory.jsx` is in the repo but its usage in App is unclear without running the app.

7. **`stageRef` pattern is a workaround for stale closures.** Using a `useRef` to mirror `useState` is unconventional React. It works but is a sign that the state design needs refactoring (e.g., using `useReducer` at the App level, or moving pipeline state into a context).

8. **`recomputeMissingInformation` always flags 7+ fields as missing** for typical consultations. The majority of consultations won't have observations, medications, or follow-up instructions — so most approved records will always have "missing information" flags. This may confuse users in V2 if patient history becomes important.

9. **`dns.setServers(['8.8.8.8','1.1.1.1'])` in server.js** overrides DNS globally. This was a fix for a specific MongoDB Atlas connectivity issue in a specific network. It may not be appropriate in all deployment environments. The root cause (local DNS not resolving Atlas hostnames) should be re-evaluated.

10. **Multer `memoryStorage()`** loads the entire audio file into RAM before uploading to S3. For the 25 MB limit this is acceptable, but for larger files V2 would need streaming (`passThrough` + S3 multipart upload).

### Missing Infrastructure

11. **No tests.** No unit tests, no integration tests, no E2E tests. Adding V2 features without tests makes regression very likely.

12. **No logging infrastructure.** Only `console.log/error/warn`. No structured logging, no log aggregation. Production debugging is difficult.

13. **No health check for AWS services.** The `/api/health` endpoint only confirms Express is up. It does not verify MongoDB, S3, or Bedrock connectivity.

14. **No pagination on `GET /api/consultations`.** All consultations are returned in one query. This will degrade with volume.

---

## 10. V2 Impact Analysis

### What Can Be Directly Reused

| Component | Reusability | Notes |
|---|---|---|
| `bedrockService.js` | ✅ Full reuse | Extraction logic, normalizer, tool spec are all solid |
| `transcribeService.js` | ✅ Full reuse | Speaker diarization + multilingual detection work well |
| `s3Service.js` | ✅ Full reuse | Upload and cleanup logic is clean |
| `audioUpload.js` middleware | ✅ Full reuse | MIME validation, size limits |
| `errorHandler.js` | ✅ Full reuse | |
| `ClinicalNoteReview.jsx` | ✅ Mostly reuse | May need minor additions for V2 patient context |
| `Dashboard.jsx` | ⚠️ Extend | Needs per-user filtering in V2 |
| `AudioRecorder.jsx` | ✅ Full reuse | |
| Design tokens / CSS | ✅ Full reuse | Clean token system in `index.css` |
| MongoDB Consultation schema | ⚠️ Extend | Needs `userId` foreign key |

### What Must Change for V2

#### 1. Authentication System

**Current:** None  
**V2 needs:** User accounts — at minimum email+password or OAuth  
**What it affects:** Every controller, every route, the Consultation schema, the dashboard, the entire session concept  
**Risk:** High — touches every layer

**Recommendation:** Add a `User` collection (`_id`, `email`, `passwordHash`, `createdAt`). Add JWT or session-based auth middleware. Add `userId` to `ConsultationSchema`. Filter all consultation queries by `req.user._id`.

---

#### 2. Multi-User Data Isolation

**Current:** One global pool of consultations  
**V2 needs:** Each doctor sees only their own consultations  
**What it affects:** `consultationController.js` (all 4 methods), `GET /api/consultations`, `Dashboard.jsx`  
**Risk:** Medium — schema migration needed for existing documents

```
CURRENT: Consultation.find().sort(...)
V2:      Consultation.find({ userId: req.user._id }).sort(...)
```

---

#### 3. Patient Identity

**Current:** `note.patient.{name, age, sex}` is a free-text field embedded in each consultation, re-entered every consultation  
**V2 needs:** (Decision required) Either persistent patient records or keep per-consultation patient data

If V2 introduces a `Patient` collection:
- New schema: `Patient { _id, name, dob, sex, userId, createdAt }`
- `Consultation.patientId → Patient._id`
- **Migration risk:** All existing consultations have embedded patient data with no `patientId`

If V2 keeps embedded patient data (simpler):
- No schema change needed
- Dashboard can still search by patient name
- Patient history is manual (doctor remembers/searches)

---

#### 4. Consultation History Per Patient

**Current:** Flat list of all consultations, sorted by date  
**V2 needs:** Group consultations by patient; show a patient's consultation history  
**What it affects:** `Dashboard.jsx`, `GET /api/consultations` (needs grouping/filtering by patient)  
**Risk:** Medium — requires query redesign + new UI components

---

#### 5. App.jsx Decomposition

**Current:** 420-line God Component with all state and pipeline logic  
**V2 needs:** React Router + split components + possibly a context/reducer for pipeline state  
**What it affects:** `App.jsx`, all screen components  
**Risk:** Medium — functional refactor, no data model changes

**Recommended V2 structure:**
```
/dashboard         → Dashboard
/consultation/new  → Recording + Processing flow
/consultation/:id  → ClinicalNoteReview (edit/approve)
/patients          → Patient list (if Patient model added)
```

---

#### 6. Async Transcription

**Current:** HTTP request held open for up to 3 minutes  
**V2 nice-to-have:** Background job pattern  
**What it affects:** `transcribeController.js`, `transcribeService.js`, `AudioRecorder.jsx`  
**Risk:** High complexity — requires websockets or polling endpoint

**Not blocking for V2** if CloudFront timeout is >= 3 minutes.

---

#### 7. Note Schema Extension

**Current:** Single embedded `NoteSchema` per consultation  
**V2 may need:**
- ICD-10 code fields
- Prescription linkage
- Digital signature / audit trail for approved notes
- Version history (draft v1, draft v2, approved)

**Recommendation:** Add fields incrementally — the `strict: true` schema prevents accidental data, so new fields require explicit additions to `Consultation.js`.

---

## 11. Open Questions for V2

These decisions must be made before implementation starts:

| # | Question | Options | Implication |
|---|---|---|---|
| 1 | **Authentication method?** | (a) Email+password JWT  (b) Google OAuth  (c) Magic link | Affects User model, session handling, client auth state |
| 2 | **Patient model — embedded or separate?** | (a) Keep embedded in consultation  (b) Create `Patient` collection | If (b): schema migration, patient search, patient history view |
| 3 | **Multi-tenancy model?** | (a) Doctor sees own consultations only  (b) Clinic/organisation model (multiple doctors share patients) | If (b): need `Organisation` model, role-based access |
| 4 | **What defines a "patient history"?** | (a) Same patient name (fuzzy match)  (b) Linked `patientId`  (c) Doctor manually groups consultations | Fundamental data model decision |
| 5 | **Keep synchronous transcription or go async?** | (a) Keep long-lived HTTP (works currently)  (b) Background job + polling endpoint | If (b): significant backend work, better UX |
| 6 | **Note versioning?** | (a) Single mutable note (current)  (b) Immutable snapshots on each save | If (b): new schema, more storage |
| 7 | **Language support expansion?** | (a) Keep hi-IN + en-IN only  (b) Add more languages | If (b): expand `LanguageOptions` array in transcribeService |
| 8 | **CloudFront timeout for transcription?** | Current unknown — must verify it's >= 180s | If < 180s: async required |

---

## 12. Executive Summary

### What VoiceScribe Currently Does

A doctor records or uploads a doctor–patient audio consultation. The system automatically transcribes it (with Hindi/English detection and speaker diarization), extracts a structured clinical note using Amazon Bedrock Nova Lite, and presents the note for the doctor to review, edit, and approve. Approved consultations are saved to MongoDB. A dashboard shows all consultations with search and filter. There is no authentication — all consultations are globally accessible.

### How the System Currently Works End-to-End

```
Audio (browser mic or file)
  → POST /api/audio → S3 (temporary)
  → POST /api/transcribe → Amazon Transcribe (2–3 min polling)
                        → returns: transcript, languages, speaker utterances
  → POST /api/extract-note → Amazon Bedrock Nova Lite (Converse API, tool use)
                           → normaliser pipeline server-side
                           → S3 audio deleted (fire-and-forget)
  → Doctor review screen (ClinicalNoteReview.jsx)
    → editable note form, evidence-linked from transcript
    → speaker A/B with role picker (Patient/Clinician/Unknown)
    → 3-item approval checklist (all must be checked)
  → POST/PUT /api/consultations → MongoDB Atlas
  → Dashboard: list + search + filter + status badges
```

### What Must Change for V2

1. **User authentication** — the single most critical gap for multi-user use
2. **Per-user data isolation** — every consultation query must be scoped to the logged-in user
3. **Patient identity decision** — embedded (simple) or separate Patient collection (powerful)
4. **App.jsx decomposition** — React Router + context/reducer, not a single 420-line component

### Biggest Architectural Decisions Before Implementation

1. **Authentication:** what mechanism, and how does it integrate with the existing session-less API design?
2. **Patient model:** one of the most consequential schema decisions — hard to migrate later
3. **Multi-tenancy:** doctor-only vs clinic/organisation — determines the access control model
4. **Sync vs async transcription:** affects frontend UX architecture (the current blocking pattern works but is fragile)

---

*Document generated from codebase inspection — no code was modified.*  
*All facts are verified against repository files. Items marked "Unknown" could not be determined from the codebase alone.*
