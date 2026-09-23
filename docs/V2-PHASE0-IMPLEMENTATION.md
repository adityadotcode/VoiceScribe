# VoiceScribe V2 — Phase 0 Implementation

> Status: **COMPLETE**  
> All Phase 0 tasks verified and passing.

---

## Summary

Phase 0 prepared the repository for safe V2 implementation without changing any V1 behaviour. The existing recording → S3 → Transcribe → Bedrock → review → approve → MongoDB → history pipeline is unchanged and the frontend production build succeeds.

---

## 1. Changes Made

### server/package.json

- Added production dependencies: `bcrypt`, `jsonwebtoken`, `express-rate-limit`, `helmet`, `cookie-parser`
- Added dev dependencies: `jest`, `supertest`
- Added `test` script: `jest --runInBand --forceExit`
- Added `test:watch` script: `jest --watch --runInBand`
- Added `jest` configuration block (testEnvironment, setupFiles, testMatch, coverage)
- `--forceExit` is required because Mongoose module-level initialization creates open handles that would otherwise block Jest from exiting cleanly

### server/src/app.js

Two additive changes (no existing behaviour removed):

1. **helmet** added as the first middleware, before CORS:
   ```js
   app.use(helmet({ contentSecurityPolicy: false }))
   ```
   `contentSecurityPolicy` is disabled because the Vite-built React SPA uses inline scripts. A proper CSP will be configured in Phase 7 (security hardening).

2. **cookie-parser** added after the JSON body parser:
   ```js
   app.use(cookieParser())
   ```
   No cookies are created or read in Phase 0. This is preparation for the Phase 1 HTTP-only refresh token cookie.

### server/src/server.js

Applied the production-ready startup sequence designed in V2-ARCHITECTURE.md:
- `await connectDb(mongodbUri)` **before** `app.listen()` — ensures no requests are served before the DB is ready
- Startup logs for port, region, S3 bucket, CORS origin
- `SIGTERM` and `SIGINT` graceful shutdown handlers with 10s forced-exit fallback
- `start()` async wrapper with error catch

V1 behaviour preserved: if MongoDB connection fails, the process exits (same as before).

### server/.env.example

Added:
- `NODE_ENV=production` entry with explanation
- Phase 1 JWT variable placeholders as comments (not yet active):
  ```
  # JWT_SECRET=
  # JWT_REFRESH_SECRET=
  # JWT_EXPIRY=15m
  # JWT_REFRESH_EXPIRY=7d
  ```

### New files created

| File | Purpose |
|---|---|
| `server/tests/setup.js` | Jest global setup — sets safe fake env vars before any test file loads, preventing `env.js` from calling `process.exit(1)` |
| `server/tests/integration/app.smoke.test.js` | Smoke tests: app loads, `/api/health` returns 200, unknown route returns 404 |
| `server/tests/unit/` | Empty directory — reserved for Phase 1+ unit tests |
| `docs/V2-PHASE0-BASELINE.md` | Baseline snapshot taken before Phase 0 changes |
| `docs/V2-PHASE0-IMPLEMENTATION.md` | This file |

---

## 2. Dependencies Added

### Production (server/package.json `dependencies`)

| Package | Version | Purpose |
|---|---|---|
| `bcrypt` | ^6.0.0 | Password hashing for Phase 1 user authentication |
| `jsonwebtoken` | ^9.0.3 | JWT access + refresh token generation/verification |
| `express-rate-limit` | ^8.7.0 | Route-level rate limiting (Phase 1 auth routes) |
| `helmet` | ^8.3.0 | HTTP security headers (active in Phase 0) |
| `cookie-parser` | ^1.4.7 | Parse HTTP-only cookies (active in Phase 0, used by Phase 1) |

### Development (server/package.json `devDependencies`)

| Package | Version | Purpose |
|---|---|---|
| `jest` | ^30.5.2 | Test runner |
| `supertest` | ^7.3.0 | HTTP assertion library for Express integration tests |

---

## 3. Files Changed

| File | Type | Change |
|---|---|---|
| `server/package.json` | Modified | New deps, test script, Jest config |
| `server/package-lock.json` | Modified | Updated by npm install |
| `server/src/app.js` | Modified | Added helmet + cookie-parser |
| `server/src/server.js` | Modified | Improved startup sequence with graceful shutdown |
| `server/.env.example` | Modified | Added NODE_ENV entry + Phase 1 JWT placeholders |
| `server/tests/setup.js` | New | Test environment setup |
| `server/tests/integration/app.smoke.test.js` | New | Smoke tests |
| `server/tests/unit/` | New | Empty directory placeholder |
| `docs/V2-PHASE0-BASELINE.md` | New | Baseline snapshot |
| `docs/V2-PHASE0-IMPLEMENTATION.md` | New | This file |

---

## 4. Test Commands

```bash
# Run all tests (Phase 0 and future phases):
cd server && npm test

# Run tests in watch mode (development):
cd server && npm run test:watch
```

---

## 5. Build Commands

```bash
# Frontend production build:
cd client && npm run build

# Backend + frontend combined build:
cd server && npm run build

# Start production server (requires NODE_ENV=production in .env):
cd server && npm start
```

---

## 6. Regression Checks Performed

| Check | Result |
|---|---|
| `npm test` (3 smoke tests) | ✅ 3/3 PASS (0.754 s) |
| `npm run build` (frontend) | ✅ 21 modules, 0 errors, 0 warnings |
| `node --check src/app.js` | ✅ Syntax OK |
| `node --check src/server.js` | ✅ Syntax OK |
| `git diff --check` | ✅ No whitespace errors |

### Test output (verbatim)

```
PASS  tests/integration/app.smoke.test.js
  Express app — smoke tests
    ✓ app module loads without throwing (2 ms)
    ✓ GET /api/health returns 200 with expected shape (22 ms)
    ✓ unknown route returns 404 (6 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Time:        0.754 s
```

---

## 7. Issues Encountered and Resolved

### Jest hanging (open handles)

**Symptom:** `npm test` without `--forceExit` hung indefinitely.

**Root cause:** Importing `src/app.js` triggers the Mongoose module to initialize internal connection pool logic, leaving open handles that prevent Jest's event loop from draining naturally.

**Resolution:** Added `--forceExit` to the `test` script. This is standard practice for Express/Mongoose test suites. It does not affect test correctness; it only tells Jest to hard-exit after all tests complete rather than waiting for all handles to close.

### dotenvx auto-injection in tests

**Symptom:** `dotenv` v17 (`dotenvx`) registers a Node.js module hook that injects `.env` values at require time, even when test env vars are pre-set.

**Resolution:** `tests/setup.js` is loaded via Jest's `setupFiles` (before any `require` calls in test files). Because `dotenvx` does not override existing `process.env` values, the test values set in `setup.js` take precedence over the real `.env` values. The setup file provides safe non-functional placeholders that satisfy `env.js` validation without connecting to real services.

---

## 8. Intentionally Deferred to Phase 1

| Item | Reason |
|---|---|
| `User` Mongoose model | Phase 1 scope |
| Auth routes and controllers | Phase 1 scope |
| JWT token generation/verification code | Phase 1 scope |
| `authenticate` middleware | Phase 1 scope |
| Rate limiting applied to routes | Phase 1 scope — packages installed, middleware not applied |
| `helmet` CSP configuration | Phase 7 (security hardening) — disabled for now due to Vite inline scripts |
| Frontend auth pages (Login, Register) | Phase 1 scope |
| `react-router-dom` installation | Phase 4 scope |
| `Consultation.userId` field | Phase 1 schema migration |
| `Patient` model | Phase 2 scope |

---

## 9. Phase 0 Completion Status

| Task | Status |
|---|---|
| Baseline documented | ✅ Completed |
| Production deps installed (bcrypt, jsonwebtoken, express-rate-limit, helmet, cookie-parser) | ✅ Completed |
| Dev deps installed (jest, supertest) | ✅ Completed |
| Jest configuration in package.json | ✅ Completed |
| Test directory structure created | ✅ Completed |
| Test environment setup (tests/setup.js) | ✅ Completed |
| Smoke test written and passing | ✅ Completed (3/3) |
| App/server separation verified (already correct) | ✅ Verified |
| helmet added to app.js | ✅ Completed |
| cookie-parser added to app.js | ✅ Completed |
| .env.example updated with Phase 1 JWT placeholders | ✅ Completed |
| server.js startup sequence improved | ✅ Completed |
| Frontend production build passes | ✅ Completed |
| V1 regression: all 3 smoke tests pass | ✅ Completed |
| git diff --check: no whitespace errors | ✅ Verified |

**Phase 0 is complete. Phase 1 (Authentication) may begin.**
