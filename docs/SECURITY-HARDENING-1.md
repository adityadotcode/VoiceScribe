# VoiceScribe V2 — Security Hardening 1

**Date:** 2026-09-24  
**Scope:** Backend only — no frontend, no AWS infrastructure changes  
**Tests:** 149 passing (18 new security tests) across 8 suites  
**Result:** All findings addressed or documented with disposition

---

## Audit scope

Files reviewed:
- `server/src/middleware/authenticate.js`
- `server/src/services/authService.js`
- `server/src/controllers/authController.js`
- `server/src/routes/authRoutes.js`
- `server/src/controllers/consultationController.js`
- `server/src/routes/consultationRoutes.js`
- `server/src/controllers/patientController.js`
- `server/src/routes/patientRoutes.js`
- `server/src/controllers/audioController.js`
- `server/src/controllers/transcribeController.js`
- `server/src/controllers/bedrockController.js`
- `server/src/services/bedrockService.js`
- `server/src/services/transcribeService.js`
- `server/src/services/s3Service.js`
- `server/src/app.js`
- `server/src/config/env.js`
- `server/src/middleware/errorHandler.js`
- `server/src/models/User.js`
- All existing test files

---

## Authorization audit

### Authentication middleware (`authenticate.js`)

**PASS** — All JWT failure modes (expired, malformed, wrong algorithm, wrong secret) return identical `HTTP 401 { message: 'Authentication required.' }`. No error subtype is leaked. The catch block binds no variable so the error cannot be accidentally logged.

### Route-level protection (`routes/index.js`)

**PASS** — The `authenticate` middleware is applied at the router level before all data routes. No data endpoint is reachable without a valid access token.

### Ownership enforcement (all controllers)

**PASS** — Every query against `Patient` and `Consultation` includes `userId: req.user.id` (sourced from the verified JWT payload). This is the primary IDOR defense. Ownership is enforced at the database query level, not as a post-fetch check.

| Endpoint | Ownership enforced at |
|---|---|
| `GET /api/consultations` | `Consultation.find({ userId: req.user.id })` |
| `GET /api/consultations/:id` | `Consultation.findOne({ _id, userId: req.user.id })` |
| `PUT /api/consultations/:id` | `Consultation.findOne({ _id, userId: req.user.id })` |
| `DELETE /api/consultations/:id` | `Consultation.findOne({ _id, userId: req.user.id })` |
| `POST /api/consultations` | Patient verified: `Patient.findOne({ _id: patientId, userId: req.user.id, isArchived: false })` |
| `GET /api/patients` | `Patient.find({ userId: req.user.id })` |
| `GET /api/patients/:id` | `Patient.findOne({ _id, userId: req.user.id })` |
| `PUT /api/patients/:id` | `Patient.findOne({ _id, userId: req.user.id })` |
| `GET /api/patients/:id/consultations` | Patient ownership then `Consultation.find({ patientId, userId })` |
| `GET /api/patients/:id/last-approved` | Patient ownership then `Consultation.findOne({ patientId, userId })` |
| `POST /api/patients/:id/change-summary` | Patient + current consultation + previous consultation all scoped to `req.user.id` |

### userId source

**PASS** — `userId` is never read from `req.body`, `req.params`, or `req.query` in any controller. The `createConsultation` and `createPatient` handlers contain explicit comments confirming this.

### patientId ownership on consultation creation

**PASS** — `createConsultation` validates `patientId` as a valid ObjectId, then queries `Patient.findOne({ _id: patientId, userId: req.user.id, isArchived: false })` before creating the consultation. A user cannot create a consultation under another user's patient.

### ObjectId validation

**PASS** — All route parameters and relevant body IDs are validated with `mongoose.isValidObjectId()` before any database operation.

### Refresh token cookie-only

**PASS** — `getRefreshTokenFromCookie` reads exclusively from `req.cookies[REFRESH_COOKIE_NAME]`. No fallback to body or Authorization header exists. Cookie is set with `httpOnly: true`, `sameSite: 'strict'`, `secure: true` (production), `path: '/'`.

### Inactive user

**PASS** — `isActive` is checked in `login`, `refresh`, and `me`. There is a documented, expected gap: a deactivated user with a valid unexpired access token (max 15 minutes) can still call data APIs until the token expires. This is inherent to stateless JWT and is acceptable for the current threat model. No fix is needed unless the 15-minute window becomes unacceptable.

### Rate limiting

**PASS** — Auth endpoints are rate-limited: 10 req/15 min on register+login, 20 req/15 min on refresh. Rate limiting is disabled only in `NODE_ENV=test`.

**DEFERRED** — Data and pipeline endpoints (`/patients`, `/consultations`, `/audio`, `/transcribe`, `/extract-note`) are not rate-limited. Per-user throttling on these endpoints is deferred to a future hardening pass when Redis or an in-process sliding-window counter is available.

---

## Issues found and fixed

### FIXED 1: PHI logged to stdout in `bedrockService.js`

**Severity: High**  
**Finding:** Two `console.log` calls output the full AI-extracted clinical note (symptoms, assessment, medications, patient demographics) on every Bedrock call:
```js
console.log('[bedrockService] raw  :', JSON.stringify(rawNote))
console.log('[bedrockService] norm :', JSON.stringify(note))
```
This is debug instrumentation that was not removed. In any environment that persists stdout (EC2 logs, CloudWatch), this logs PHI.

**Fix:** Both `console.log` lines removed. A comment documents the removal.

**File:** `server/src/services/bedrockService.js`

---

### FIXED 2: AWS SDK error details leaked to clients via `bedrockController.js`

**Severity: Medium**  
**Finding:** On Bedrock extraction failure, the controller forwarded `error.message` and `error.name` (AWS SDK values such as `ValidationException`, `AccessDeniedException`) to the client response:
```js
return res.status(statusCode).json({
  message:   error.message,  // ← raw AWS SDK message
  errorCode: error.name,     // ← AWS exception class name
});
```
This reveals IAM permission state (`AccessDeniedException`) and internal request structure (`ValidationException`) to clients.

Additionally, the status code mapping used `403` for `AccessDeniedException`, which could reveal whether the server has Bedrock IAM access.

**Fix:**
- Removed `errorCode` field from all error responses.
- Removed `error.message` from all error responses.
- Simplified status code mapping to only `429` (ThrottlingException) and `500` (everything else) — avoids leaking IAM permission state.
- Added safe generic messages per error code.
- Changed server-side log to `error.name, error.message` only (not the full error object).

**File:** `server/src/controllers/bedrockController.js`

---

### FIXED 3: Internal error message leaked via `transcribeController.js`

**Severity: Medium**  
**Finding:** On transcription failure, `error.message` was forwarded directly to the client response body and the full error object was logged (potentially including stack trace):
```js
console.error('Transcription failed:', error);             // full error to logs
message: error.message || 'Transcription failed.',        // internal detail to client
```

**Fix:**
- Response now returns a fixed generic message: `'Transcription failed. Please try again.'`
- Log now outputs only `error.message` with a structured prefix: `'[transcribeController] transcription failed:'`

**File:** `server/src/controllers/transcribeController.js`

---

### FIXED 4: Full error objects logged in `audioController.js` and `consultationController.js`

**Severity: Low** (server-side logs only, not client-facing)  
**Finding:** Several controllers logged full `err` objects (which include stack traces) rather than `err.message`:
- `audioController.js`: `console.error('S3 upload failed:', error)` — no prefix, full object
- `consultationController.js` (5 instances): `console.error('[...] error:', err)` — full object

**Fix:** All changed to `err.message` with consistent `[controller]` prefix. Stack traces remain in the Node.js runtime but are not persisted by these log calls.

**Files:** `server/src/controllers/audioController.js`, `server/src/controllers/consultationController.js`

---

### FIXED 5: CORS missing `credentials: true`

**Severity: High** (functional security bug)  
**Finding:** `app.js` configured CORS without `credentials: true`:
```js
app.use(cors({ origin: clientOrigin }));
```
The application uses HTTP-only cookies for the refresh token. Without `credentials: true`, browsers refuse to include cookies on cross-origin requests, making the entire cookie-based refresh mechanism non-functional in production (where the API and frontend are on different origins).

**Fix:**
```js
app.use(cors({ origin: clientOrigin, credentials: true }));
```

**File:** `server/src/app.js`

---

## Issues not fixed (PASS or DEFERRED)

| Issue | Disposition | Reason |
|---|---|---|
| Content-Security-Policy disabled | DEFERRED | Comment in `app.js` explains this is pending Vite build pipeline finalization (Phase 7 scope) |
| Data routes not rate-limited | DEFERRED | Requires Redis or in-process sliding-window counter; scheduled for Security Hardening 2 |
| Active-token window for deactivated users | ACCEPTABLE | 15-minute JWT expiry; acceptable for current threat model |
| `transcribeService.js` logs raw transcript data to stdout on empty-transcript path | DEFERRED | Not PHI by itself (raw JSON from AWS Transcribe, not clinical note content); flagged for review in Hardening 2 |
| `errorHandler.js` logs full error object (`console.error(err)`) | LOW / DEFERRED | Only reached for uncaught errors, never sent to client; acceptable for server-side diagnostics |

---

## Security tests added

**File:** `server/tests/integration/security_hardening.test.js`  
**New tests:** 18 | **Total backend tests:** 149 (all passing)

| # | Group | Tests |
|---|---|---|
| 1 | Malformed Authorization header | No header, Basic scheme, empty Bearer, garbage token, wrong-secret token → all 401 |
| 2 | Expired access token | Returns 401; does not leak `TokenExpiredError` or `JsonWebToken` in response |
| 3 | Inactive user at login | Returns 401 with same message as wrong password (no account-existence leak) |
| 4 | Refresh token from request body | Ignored; returns 401 |
| 5 | Refresh token from Authorization header | Ignored; returns 401 |
| 6 | `/api/extract-note` AWS error safety | `AccessDeniedException` → 500 (not 403); no `errorCode` field; no AWS exception name in response; `ThrottlingException` → 429 |
| 7 | `/api/transcribe` error safety | Internal connection string not in response; fixed generic message returned |
| 8 | Stack trace absence | 400 and 401 responses contain no ` at ` or `file.js:line:col` patterns |
| 9 | CORS credentials | OPTIONS preflight includes `access-control-allow-credentials: true` |

### Pre-existing IDOR coverage (PASS — not changed)

| Endpoint | Test location |
|---|---|
| Doctor A cannot GET Doctor B consultation | auth.test.js test 16 |
| Doctor A cannot PUT Doctor B consultation | auth.test.js test 17 |
| Doctor A cannot DELETE Doctor B consultation | auth.test.js test 18 |
| Doctor A cannot GET Doctor B patient | patient.test.js test 6 |
| Doctor A cannot PUT Doctor B patient | patient.test.js test 7 |
| Consultation attached to another user's patient | consultation_patient.test.js test 3 |
| Patient history cross-user | consultation_patient.test.js test 10 |
| Last-approved cross-user | consultation_patient.test.js test 15 |
| Change summary cross-user (patient + consultation) | change_summary.test.js tests 5, 6, 7 |

---

## Files changed

| File | Change |
|---|---|
| `server/src/services/bedrockService.js` | Removed PHI-logging `console.log` calls |
| `server/src/controllers/bedrockController.js` | Removed `errorCode`/`error.message` from client response; safe status codes only; structured logging |
| `server/src/controllers/transcribeController.js` | Fixed full error logging; generic message to client |
| `server/src/controllers/audioController.js` | Fixed full error logging; added structured prefix |
| `server/src/controllers/consultationController.js` | Fixed 5 `console.error` calls from full object to `err.message` |
| `server/src/app.js` | Added `credentials: true` to CORS configuration |
| `server/tests/integration/security_hardening.test.js` | New — 18 security tests |

---

## Remaining security gaps (Security Hardening 2)

1. **Rate limiting on data APIs** — `/patients`, `/consultations`, `/audio`, `/transcribe`, `/extract-note` are unthrottled. Recommend per-user sliding-window rate limiter using in-process storage or Redis.
2. **Content-Security-Policy** — Helmet CSP is disabled. Configure after Vite build pipeline is finalised.
3. **`transcribeService.js` diagnostic logging** — Line 158–161 logs raw AWS Transcribe response JSON when the transcript is empty. While not PHI, this could contain S3 object metadata. Review in Hardening 2.
4. **Token revocation for deactivated users** — A deactivated user's access token remains valid for up to 15 minutes. If immediate revocation is required, a token blocklist (Redis or DB) is needed.
5. **Helmet `Permissions-Policy`** — Default Helmet permissions policy should be reviewed and tightened for a medical application (e.g. disable geolocation, microphone except when needed, camera).
