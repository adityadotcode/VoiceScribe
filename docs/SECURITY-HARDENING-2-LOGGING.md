# VoiceScribe V2 — Security Hardening 2: Logging Audit

**Date:** 2026-09-24  
**Scope:** Backend logging and error responses — no schema, frontend, or AWS changes  
**Tests:** 163 passing (14 new) across 9 suites  
**Builds on:** Security Hardening 1 (SECURITY-HARDENING-1.md)

---

## Audit method

Every `console.log`, `console.warn`, and `console.error` call across all `server/src/**` files was reviewed. Each call was classified:

| Classification | Meaning |
|---|---|
| **Safe** | Logs only operational metadata (job names, object keys, counts, error messages). Keep as-is. |
| **Unsafe** | Logs PHI, pre-signed URLs, full error objects with stack traces, or internal AWS response bodies. Fix. |

---

## Unsafe logging found and fixed

### FIXED 1: `errorHandler.js` — full error object logged (stack traces in production logs)

**File:** `server/src/middleware/errorHandler.js`

**Before:**
```js
console.error(err);  // full error object — stack trace, file paths, all properties
```

**Problem:** The full `err` object printed by `console.error` includes the stack trace, which contains:
- Absolute file paths on the server (e.g. `/home/ec2-user/voicescribe/server/src/...`)
- Internal module names from `node_modules`
- Line and column numbers of source code

In environments that forward stdout/stderr to a log aggregator (CloudWatch, Datadog, etc.), these appear verbatim in log entries. While not PHI, they give an attacker a detailed map of the server's file system layout and dependency tree.

**After:**
```js
console.error('[errorHandler] unhandled error:', err.message ?? String(err));
```

The response body was already safe (`'Something went wrong.'`) — only the server-side log needed fixing. The Multer-specific handlers (413, 400) are unchanged.

---

### FIXED 2: `transcribeService.js` — full AWS Transcribe JSON response logged

**File:** `server/src/services/transcribeService.js`

**Before:**
```js
console.warn(
  '[transcribeService] transcript string is empty or missing. Raw transcript data:',
  JSON.stringify(transcriptData, null, 2)
);
```

**Problem:** When Amazon Transcribe returns a job with an empty transcript, this logged the **entire raw AWS response JSON** — which contains:
- `TranscriptFileUri`: a **pre-signed S3 URL** (time-limited but still a valid credential for reading the transcription output file during its TTL)
- Internal job metadata (account IDs may appear in some fields)
- The complete results structure

A pre-signed S3 URL in a log file is a secret: anyone with read access to the log can download the original audio file during the URL's TTL.

**After:**
```js
const topLevelKeys = transcriptData ? Object.keys(transcriptData).join(', ') : 'none';
console.warn(
  `[transcribeService] transcript string is empty or missing. ` +
  `Job: ${jobName} | top-level response keys: ${topLevelKeys}`
);
```

The replacement preserves diagnostic value (the job name and the shape of the response) without logging any credentials or content.

---

## Logging audit results — all other calls

| File | Call | Classification | Reason |
|---|---|---|---|
| `bedrockService.js` | (removed in Hardening 1) | ✅ Safe | PHI logs already removed |
| `bedrockController.js` | `error.name, error.message` | ✅ Safe | Message-only, no stack |
| `transcribeController.js` | `error.message` | ✅ Safe | Message-only |
| `audioController.js` | `error.message` | ✅ Safe | Message-only |
| `authController.js` (×4) | `err.message` | ✅ Safe | Message-only |
| `consultationController.js` (×5) | `err.message` | ✅ Safe | Message-only — fixed in Hardening 1 |
| `patientController.js` (×7) | `err.message` | ✅ Safe | Message-only |
| `s3Service.js` | Object keys only | ✅ Safe | `consultations/xxx.webm` — no content |
| `transcribeService.js` | `detected languages: [...]` | ✅ Safe | Language code metadata |
| `transcribeService.js` | `speaker utterances: N` | ✅ Safe | Count only |
| `db.js` | `MongoDB connected` / `err.message` | ✅ Safe | Status / message-only |
| `env.js` | Variable names (not values) | ✅ Safe | `'Missing required environment variable(s): ...'` |
| `server.js` | Port, region, bucket, CORS origin | ✅ Safe | Config metadata at startup |
| `errorHandler.js` | `err.message` (after fix) | ✅ Safe | Fixed — see above |

---

## Error-response rules (confirmed enforced)

Every client-facing error response in the application conforms to these rules, verified in Hardening 1 and re-confirmed here:

1. **No stack traces.** Error objects are never serialised into responses.
2. **No file paths.** Response bodies contain no `src/`, `node_modules/`, or OS-level paths.
3. **No JWT details.** All JWT failures return the same `'Authentication required.'` — `TokenExpiredError`, `JsonWebTokenError`, and algorithm details are never forwarded.
4. **No AWS SDK internals.** Exception names (`AccessDeniedException`, `ValidationException`) and SDK error messages never appear in responses. Only generic messages are returned.
5. **No Bedrock request details.** Prompt content, model IDs, and inference parameters are never included in error responses.
6. **No MongoDB internals.** Connection strings, collection names, and Mongoose error details are never returned to clients.
7. **No secrets.** `passwordHash`, `refreshTokenHash`, JWT secrets, and AWS credentials are never included in responses. `safeUser()` strips all sensitive fields before serialisation.
8. **Useful HTTP status codes preserved.** 400, 401, 403, 404, 409, 413, 429, 500, 502 are all used correctly — clients get enough information to handle errors programmatically without server internals being exposed.

---

## Files changed

| File | Change |
|---|---|
| `server/src/middleware/errorHandler.js` | `console.error(err)` → `console.error('[errorHandler] unhandled error:', err.message ?? String(err))` |
| `server/src/services/transcribeService.js` | `JSON.stringify(transcriptData, ...)` → safe summary with job name + top-level key names only |
| `server/tests/integration/hardening2_logging.test.js` | New — 14 security tests |

---

## Tests added

**File:** `server/tests/integration/hardening2_logging.test.js`  
**New tests:** 14 | **Total backend tests:** 163 (all passing)

| # | Group | What is tested |
|---|---|---|
| 1 | Global error handler | Response body contains no stack trace when controller throws |
| 2 | Global error handler | Response body contains no file path segments |
| 3 | errorHandler unit | `console.error` receives `err.message`, not a multi-line stack string |
| 4a | Auth failure | Expired token response contains no `secret`, `HS256`, `jwt`, `algorithm`, `TokenExpiredError` |
| 4b | Auth failure | Invalid token response contains no `signature`, `JsonWebToken`, `malformed` |
| 4c | Auth failure | 401 response has exactly `{ success, message }` — no extra keys |
| 5a | AWS errors | `EndpointResolutionError` does not appear in `/api/extract-note` response |
| 5b | AWS errors | Internal connection string (`ECONNREFUSED`, IMDS IP) does not appear in `/api/transcribe` response |
| 6a | Passwords | Login response does not include `passwordHash` or bcrypt hash prefix |
| 6b | Passwords | `GET /api/auth/me` response does not include `passwordHash` |
| 7a | Existing contracts | `GET /api/health` still returns `{ success: true }` |
| 7b | Existing contracts | `GET /api/patients` still returns `{ success: true, patients: [] }` |
| 8a | Multer errors | `errorHandler` returns 413 with safe shape for `LIMIT_FILE_SIZE` |
| 8b | Multer errors | `errorHandler` returns 400 with safe shape for `LIMIT_UNEXPECTED_FILE` |

---

## Test result

```
Test Suites: 9 passed, 9 total
Tests:       163 passed, 163 total
Time:        ~38 s
```

---

## Remaining logging work (Security Hardening 3)

| Item | Risk | Notes |
|---|---|---|
| `transcribeService.js` — full `job.FailureReason` logged in the thrown error path | Low | `FailureReason` from Amazon Transcribe can contain the S3 URI of the failed file. The current code throws `new Error(job.FailureReason)`, which means it appears in `console.error` calls upstream. Review in Hardening 3. |
| Rate limiting on data APIs | Medium | Deferred from Hardening 1. Needs in-process sliding-window or Redis. |
| Content-Security-Policy | Medium | Helmet CSP still disabled; requires Vite build pipeline finalisation. |
| `Permissions-Policy` tightening | Low | Default Helmet policy; should be restricted for a medical application. |
| Access token revocation for deactivated users | Low | 15-minute JWT window; acceptable for current threat model. |
| Structured logging (request ID, correlation ID) | Operational | Not a security gap, but would improve incident response. Consider in a future logging pass. |
