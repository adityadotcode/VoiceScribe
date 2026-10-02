# VoiceScribe V2 — Deployment Readiness Audit

**Date:** 2026-10-02  
**Type:** Inspection only — no production changes made  
**Auditor:** Kiro automated readiness pass  
**Production URL:** https://d20yro74mg9hym.cloudfront.net/  
**Architecture:** EC2 (ap-southeast-2) + CloudFront + MongoDB Atlas + S3 + Transcribe + Bedrock Nova Lite

---

## A. Build Status

### Backend

```
npm test (server/)
  Test Suites: 9 passed, 9 total
  Tests:       163 passed, 163 total
  Time:        ~4.6 s
  Exit Code:   0
```

**PASS** — no failures, no skips.

### Frontend

```
npx vitest run (client/)
  Test Files: 7 passed
  Tests:      86 passed, 86 total
  Exit Code:  0

npm run build (client/)
  vite v8.3.0 — production build
  ✓ 42 modules transformed
  dist/assets/index-qKcMUVhh.js   348.46 kB │ gzip: 102.14 kB
  dist/assets/index-D6LJeSBo.css   60.89 kB │ gzip:   9.29 kB
  Built in ~420 ms
  0 errors · 0 warnings
  Exit Code: 0
```

**PASS** — clean build, no unresolved imports, no warnings.

---

## B. Test Status

| Suite | Tests | Status |
|---|---|---|
| Backend (Jest, 9 suites) | 163 / 163 | ✅ PASS |
| Frontend (Vitest, 7 suites) | 86 / 86 | ✅ PASS |
| E2E (Playwright) | Not configured | MANUAL — see Section N |

---

## C. Required Production Environment Variables

The server validates required variables at startup (`server/src/config/env.js`) and calls `process.exit(1)` if any are absent.

### Required (startup will fail without these)

| Variable | Purpose | Default if unset | Required? |
|---|---|---|---|
| `MONGODB_URI` | Atlas connection string | `''` → exit(1) | ✅ REQUIRED |
| `AWS_REGION` | Region for S3, Transcribe, Bedrock | `'ap-southeast-2'` but validated | ✅ REQUIRED |
| `S3_BUCKET_NAME` | Temporary audio bucket | `''` → exit(1) | ✅ REQUIRED |
| `JWT_SECRET` | Access token signing key | `''` → exit(1) in production | ✅ REQUIRED |
| `JWT_REFRESH_SECRET` | Refresh token signing key | `''` → exit(1) in production | ✅ REQUIRED |

### Required for correct behaviour (will not crash but will malfunction)

| Variable | Purpose | Default | Action required? |
|---|---|---|---|
| `CLIENT_ORIGIN` | CORS allowed origin | `'http://localhost:5174'` | ✅ Must be set to CloudFront HTTPS URL |
| `NODE_ENV` | Enables static file serving + Secure cookie flag | unset | ✅ Must be `production` |
| `PORT` | Express listen port | `5000` (env.js default) | ⚠️ Set to `3000` per .env.example for EC2 |

### Optional (sensible defaults)

| Variable | Purpose | Default |
|---|---|---|
| `JWT_EXPIRY` | Access token lifetime | `'15m'` |
| `JWT_REFRESH_EXPIRY` | Refresh token lifetime | `'7d'` |
| `MAX_AUDIO_FILE_BYTES` | Upload size limit | `26214400` (25 MB) |

### AWS Credentials

**Do NOT set `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` on the EC2 instance.**  
The EC2 instance uses the attached IAM role `VoiceScribeEC2Role`. Credentials are obtained automatically via the instance metadata service. Setting static keys would bypass this and create a credential rotation risk.

### Generating JWT secrets

```bash
# Run on the EC2 instance or locally — copy result to .env
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Run twice — once for JWT_SECRET, once for JWT_REFRESH_SECRET (must be different)
```

---

## D. AWS Requirements

### EC2

| Requirement | Status | Notes |
|---|---|---|
| Instance type | Existing (t3.small+ per V2-ARCHITECTURE.md) | No change required |
| Node.js 20 | Existing | No change required |
| PM2 process manager | Existing | PM2 restart required on deploy |
| PM2 process name | `voicescribe` (per V2-ARCHITECTURE.md) | `pm2 restart voicescribe` |
| New env vars in `.env` | **ACTION REQUIRED** | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_ORIGIN`, `NODE_ENV=production` must be set |
| `server/.env` not in git | ✅ Confirmed gitignored | `.gitignore` line 2: `.env` |

### S3

| Requirement | Status |
|---|---|
| Bucket exists | Existing (from V1) |
| Bucket: `voicescribe-audio-sydney-2026-47k2` | No change required |
| Objects: temporary, deleted after Bedrock success | No change required |
| IAM role has `AmazonS3FullAccess` | Existing |

### Amazon Transcribe

| Requirement | Status |
|---|---|
| Service configuration | Unchanged from V1 |
| `IdentifyMultipleLanguages: true`, `hi-IN` + `en-IN` | Existing |
| `ShowSpeakerLabels: true`, `MaxSpeakerLabels: 2` | Existing |
| IAM role has `AmazonTranscribeFullAccess` | Existing |

### Amazon Bedrock

| Requirement | Status |
|---|---|
| Model: `amazon.nova-lite-v1:0` | Unchanged from V1 |
| API: `ConverseCommand` (note extraction) + `ConverseCommand` (change summary) | Note: change summary is a new call pattern (no tool forcing) |
| Region: `ap-southeast-2` | Existing |
| IAM role has `AmazonBedrockFullAccess` | Existing — sufficient for both ConverseCommand patterns |

### IAM Role (`VoiceScribeEC2Role`)

| Permission | Required for | Status |
|---|---|---|
| `AmazonS3FullAccess` | Audio upload + deletion | Existing |
| `AmazonTranscribeFullAccess` | Transcription jobs | Existing |
| `AmazonBedrockFullAccess` | Note extraction + change summary narrative | Existing |
| MongoDB Atlas | Network-level access (Atlas IP allowlist) | Pre-existing — verify EC2 IP is still on allowlist |

---

## E. CloudFront Requirement

### Transcription timeout — ACTION REQUIRED

The `/api/transcribe` endpoint holds the HTTP connection open for up to **3 minutes** (polls AWS Transcribe every 3 s × 60 attempts = 180 s max).

**CloudFront default origin response timeout: 30 seconds.**  
**Required setting: ≥ 180 seconds.**

If this is not set, CloudFront will return a `504 Gateway Timeout` on any transcription that takes longer than 30 seconds — which is most real consultations.

| CloudFront Setting | Required Value | Current Status |
|---|---|---|
| Origin response timeout | ≥ 180 s | **⚠️ MUST VERIFY — ACTION REQUIRED if not already set from V1** |
| Cache policy for `/api/*` | CachingDisabled | Existing from V1 |
| Allowed methods | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE | Existing from V1 |
| Viewer protocol | Redirect HTTP → HTTPS | Existing from V1 |
| Origin request policy | AllViewer | Existing from V1 |

**Note:** This was an action item in V1. If the timeout was already increased for V1's transcription feature, it remains valid for V2. The V2-ARCHITECTURE.md confirms: *"Verify CloudFront origin response timeout is ≥ 180 s. Default is 30 s — must be changed in the CloudFront distribution settings."*

**Verdict: ACTION REQUIRED** — confirm in CloudFront console before deployment.

---

## F. Database / Migration Notes

### V1 → V2 compatibility

V2 is **fully backward compatible** with V1 documents. No migration script is needed before deployment.

| V1 behaviour | V2 treatment | Safe? |
|---|---|---|
| Consultations with `userId: null` | Queries always include `userId: req.user.id` — V1 null-userId documents are invisible to V2 users | ✅ Safe |
| Consultations with no `patientId` | `patientId` is `null` by default in the schema; V1 docs are excluded from patient-scoped queries by the `patientId` filter | ✅ Safe |
| V1 documents never reassigned | No migration touches existing documents | ✅ Safe |
| V2 API rejects new consultations without `patientId` | Controller-level check: 400 if `patientId` missing on `POST /api/consultations` | ✅ Correct |
| V1 data not visible to V2 authenticated users | All queries scoped to `req.user.id`; V1 docs have `userId: null` which never matches | ✅ Safe |

### New MongoDB indexes (V2)

The V2 Consultation schema defines these indexes beyond the V1 `_id` default. They will be created automatically by Mongoose on first connect if they do not already exist:

```js
{ userId: 1, createdAt: -1 }           // Phase 1A
{ patientId: 1, createdAt: -1 }        // Phase 3A
{ userId: 1, patientId: 1, createdAt: -1 }  // Phase 3A
```

The Patient collection indexes are:
```js
{ userId: 1, lastName: 1, firstName: 1 }
{ userId: 1, dateOfBirth: 1 }
{ userId: 1, medicalRecordId: 1 }   (unique, sparse)
```

Mongoose creates missing indexes automatically at startup (`autoIndex: true` default). First startup may be slightly slower on index creation. **No manual index migration needed.**

### Atlas IP allowlist

Verify the EC2 instance's IP address (or the VPC's NAT gateway IP, if applicable) remains on the MongoDB Atlas network access list. This was pre-existing for V1 but EC2 public IPs can change on instance stop/start unless an Elastic IP is attached.

---

## G. Security Checklist

| Check | Status | Notes |
|---|---|---|
| Authentication required on all data endpoints | ✅ PASS | `authenticate` middleware at router level in `routes/index.js` |
| Ownership enforced server-side (userId from JWT) | ✅ PASS | All queries include `userId: req.user.id` |
| Client cannot override userId | ✅ PASS | `userId` in body silently ignored across all controllers |
| Access token in memory only (never localStorage) | ✅ PASS | Verified by test (auth.test.jsx test 6) |
| Refresh token HTTP-only cookie | ✅ PASS | `httpOnly: true, sameSite: 'strict'` in authService.js |
| Refresh token Secure flag in production | ✅ PASS | `secure: process.env.NODE_ENV === 'production'` |
| Refresh token from cookie only (not body/header) | ✅ PASS | `getRefreshTokenFromCookie` reads only `req.cookies` |
| No secrets in source code | ✅ PASS | All values from env vars; git log confirms no secret commits |
| `server/.env` gitignored | ✅ PASS | `.gitignore` line 2 — confirmed not tracked |
| No PHI in production logs | ✅ PASS | bedrockService PHI logs removed in Security Hardening 1 |
| No stack traces in API responses | ✅ PASS | errorHandler returns generic `'Something went wrong.'` |
| No AWS error details in API responses | ✅ PASS | bedrockController fixed in Security Hardening 1 |
| No internal error.message in API responses | ✅ PASS | transcribeController fixed in Security Hardening 1 |
| CORS: single origin, credentials: true | ✅ PASS | `cors({ origin: clientOrigin, credentials: true })` in app.js |
| Helmet security headers | ✅ PASS | `helmet()` with defaults in app.js |
| Rate limiting on auth endpoints | ✅ PASS | 10 req/15 min login+register, 20 req/15 min refresh |
| Rate limiting on data/pipeline endpoints | ⚠️ DEFERRED | Not implemented; requires Redis — documented in Security Hardening 1 & 2 |
| Content-Security-Policy | ⚠️ DEFERRED | Helmet CSP disabled; pending Vite build config — see app.js comment |
| IDOR: Doctor A cannot access Doctor B's data | ✅ PASS | 404 for all cross-user access — 18 IDOR tests passing |
| JWT secrets are different values | **⚠️ OPERATOR MUST VERIFY** | Cannot be verified without reading .env values |

---

## H. Manual Deployment Procedure

**Do not execute until all pre-conditions are confirmed.**

### Pre-conditions (verify before starting)

1. Backend tests pass: `npm test` → 163/163  
2. Frontend tests pass: `npx vitest run` → 86/86  
3. Frontend build clean: `npm run build` → 0 errors  
4. CloudFront origin timeout ≥ 180 s — confirmed in CloudFront console  
5. EC2 `.env` has `JWT_SECRET` and `JWT_REFRESH_SECRET` set to strong unique values  
6. MongoDB Atlas IP allowlist includes the EC2 IP  

### Step 1 — Build frontend locally (or on EC2)

```bash
# Run from repository root
cd client
npm install
npm run build
# Verify: client/dist/ contains index.html and assets/
```

### Step 2 — Transfer source to EC2 (choose one method)

**Option A — git pull (recommended if EC2 has the repo):**
```bash
# On EC2
cd /path/to/voicescribe
git pull origin main
```

**Option B — rsync from local machine:**
```bash
# From local machine (replace with actual EC2 address)
rsync -avz --exclude 'node_modules' --exclude '.git' \
  /path/to/voicescribe/ \
  ec2-user@<EC2_PUBLIC_DNS>:/home/ec2-user/voicescribe/
```

### Step 3 — Update production environment variables

```bash
# On EC2 — edit server/.env
# Add/update these variables (never commit this file):
# JWT_SECRET=<strong-random-64-hex-bytes>
# JWT_REFRESH_SECRET=<different-strong-random-64-hex-bytes>
# CLIENT_ORIGIN=https://d20yro74mg9hym.cloudfront.net
# NODE_ENV=production
# PORT=3000
# MONGODB_URI=<existing Atlas URI>
# AWS_REGION=ap-southeast-2
# S3_BUCKET_NAME=<existing bucket name>
```

### Step 4 — Install backend dependencies

```bash
# On EC2
cd /home/ec2-user/voicescribe/server
npm install --omit=dev
```

### Step 5 — Build frontend (if building on EC2)

```bash
# On EC2 — only if Step 1 was not done locally
cd /home/ec2-user/voicescribe/client
npm install
npm run build
# client/dist/ is now ready; app.js serves it when NODE_ENV=production
```

### Step 6 — Restart PM2

```bash
# On EC2
pm2 restart voicescribe
# Verify startup:
pm2 logs voicescribe --lines 20
# Expected log lines:
#   [server] VoiceScribe API listening on port 3000
#   [server] AWS region : ap-southeast-2
#   [db] MongoDB connected
```

### Step 7 — Health check

```bash
# From EC2 or any machine
curl http://localhost:3000/api/health
# Expected: {"success":true,"service":"VoiceScribe API","status":"healthy","message":"VoiceScribe API is running"}

# Via CloudFront (public HTTPS)
curl https://d20yro74mg9hym.cloudfront.net/api/health
```

### Step 8 — CloudFront verification

1. Open CloudFront distribution `d20yro74mg9hym` in AWS Console  
2. Confirm **Origins → Origin response timeout ≥ 180 seconds**  
3. Confirm cache is disabled for `/api/*` behavior  
4. If origin timeout was changed: wait for CloudFront to propagate (~1–2 min)

### Step 9 — Production smoke test (manual)

See Section N for the full manual smoke test list. Minimum before declaring success:

1. Navigate to `https://d20yro74mg9hym.cloudfront.net/`  
2. Register a new doctor account  
3. Log in  
4. Create a new patient  
5. Navigate to `/consultation/new`, select the patient  
6. Upload a short audio file  
7. Verify transcription completes (≤ 3 min)  
8. Verify clinical note is extracted  
9. Save draft consultation  
10. Approve consultation  
11. Open patient profile → verify consultation appears in history  
12. Open the consultation from history (detail page)  
13. Click "Compare with previous visit" — should show "No previous approved consultation"  
14. Log out → verify redirect to /login  
15. Refresh browser → verify no stale session (back to /login)  

### Step 10 — Rollback procedure

If any step fails or the application is in a bad state:

```bash
# On EC2

# Option A: Revert to previous git commit
git log --oneline -5        # identify the last known-good commit
git checkout <commit-hash>  # or: git revert HEAD
pm2 restart voicescribe
pm2 logs voicescribe --lines 20

# Option B: Restore from PM2 saved state (if pm2 save was run before deploy)
pm2 stop voicescribe
# Manually restore previous server/ and client/dist/ from backup
pm2 start voicescribe

# Verify rollback:
curl https://d20yro74mg9hym.cloudfront.net/api/health
```

**Note on V1 data:** A rollback to V1 code is safe. V2 did not delete any V1 Consultation documents. V2 only added new fields with defaults (userId=null, patientId=null) that don't break V1 queries.

---

## I. Rollback Procedure

See Step 10 above. Summary:

- **Code rollback:** `git checkout <last-good-commit>` + `pm2 restart voicescribe`
- **Data safety:** V2 added no destructive migrations. V1 documents are unmodified.
- **JWT rollback concern:** If JWT_SECRET is rotated between deploy and rollback, all active sessions are invalidated — doctors must re-login. This is acceptable and expected.
- **PM2 logs** are the first diagnostic tool: `pm2 logs voicescribe --lines 50`

---

## J. Blockers

### Critical blockers (deployment must not proceed without these)

| # | Blocker | Action |
|---|---|---|
| J-1 | **`JWT_SECRET` and `JWT_REFRESH_SECRET` not set in EC2 `.env`** | Generate two unique 64-byte hex secrets and add to `server/.env` on EC2. `env.js` will call `process.exit(1)` if missing in production. |
| J-2 | **`NODE_ENV=production` not confirmed in EC2 `.env`** | Without this: Secure cookie flag is off (HTTP-only refresh token not secure over HTTP); SPA routes not served (React Router routes return 404). |
| J-3 | **`CLIENT_ORIGIN` must be set to the CloudFront HTTPS URL** | Without this: CORS will reject all browser requests from the production domain (defaulting to `http://localhost:5174`). |

### Action required (not a crash-blocker but important)

| # | Item | Action |
|---|---|---|
| J-4 | **CloudFront origin response timeout must be ≥ 180 s** | Verify in CloudFront console. If < 180 s, transcription requests will 504. If already set from V1, no action needed. |
| J-5 | **MongoDB Atlas IP allowlist — verify EC2 IP** | Confirm EC2 IP is on the Atlas network access list. |

### Known deferred items (not blockers for this deployment)

| # | Item | Notes |
|---|---|---|
| J-6 | Rate limiting on data/pipeline APIs | Requires Redis; documented in Security Hardening 1 |
| J-7 | Content-Security-Policy | Helmet CSP disabled; deferred per Phase 7 plan |
| J-8 | Email verification / password reset | Explicitly out of scope for V2 |
| J-9 | Async transcription (background jobs) | V1 sync pattern retained; CloudFront timeout is the mitigation |

---

## K. READY / NOT READY Verdict

### ✅ READY — with pre-deployment operator actions

The VoiceScribe V2 codebase is **code-complete and deployment-ready** subject to the following operator actions that must be completed on the EC2 instance before PM2 restart:

1. **Set `JWT_SECRET`** to a strong unique 64-byte hex value in `server/.env`
2. **Set `JWT_REFRESH_SECRET`** to a different strong unique 64-byte hex value in `server/.env`
3. **Set `NODE_ENV=production`** in `server/.env`
4. **Set `CLIENT_ORIGIN=https://d20yro74mg9hym.cloudfront.net`** in `server/.env`
5. **Verify CloudFront origin response timeout ≥ 180 s** in AWS Console (or confirm unchanged from V1)
6. **Verify MongoDB Atlas IP allowlist** includes current EC2 IP

Once items 1–6 are confirmed, the deployment procedure in Section H can proceed.

### What makes V2 ready

| Criterion | Status |
|---|---|
| Backend tests | ✅ 163/163 passing |
| Frontend tests | ✅ 86/86 passing |
| Production build | ✅ Clean, 0 errors, 0 warnings |
| Authentication | ✅ JWT + HTTP-only cookie, fully implemented |
| Authorization / IDOR | ✅ Per-user isolation on all endpoints |
| Security hardening | ✅ Security Hardening 1 + 2 complete |
| V1 backward compatibility | ✅ V1 documents unaffected |
| SPA routing (direct URLs) | ✅ Express catch-all serves index.html in production |
| No secrets in git | ✅ `.env` gitignored, confirmed not tracked |
| Code integrity | ✅ Integration validation complete, 2 minor bugs fixed |

---

*This document was generated from repository inspection only. No production changes were made.*  
*Production URL: https://d20yro74mg9hym.cloudfront.net/*
