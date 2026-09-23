# VoiceScribe V2 — Phase 1A Backend Implementation

> **Status:** COMPLETE  
> **Scope:** Backend authentication and server-side user isolation only.  
> **Frontend authentication:** NOT implemented. The existing V1 React UI still works with the server but all API calls now require a Bearer token (except `/api/health` and `/api/auth/*`).

---

## What was implemented

### 1. User model (`server/src/models/User.js`)

New Mongoose schema, `strict: true`, `timestamps: true`:

| Field | Type | Notes |
|---|---|---|
| `email` | String | Required, unique, lowercase, trimmed |
| `passwordHash` | String | Required — bcrypt hash only, never plaintext |
| `displayName` | String | Required |
| `role` | String | enum `['doctor']`, default `'doctor'` |
| `refreshTokenHash` | String | bcrypt hash of active refresh token; `null` after logout |
| `isActive` | Boolean | default `true`; `false` to soft-disable without deletion |
| `lastLoginAt` | Date | Updated on each successful login |
| `createdAt`, `updatedAt` | Date | Auto via timestamps |

Explicit unique index: `{ email: 1 }`.

### 2. Environment configuration (`server/src/config/env.js`)

Added four new config values:

```
jwtSecret         → process.env.JWT_SECRET
jwtRefreshSecret  → process.env.JWT_REFRESH_SECRET
jwtExpiry         → process.env.JWT_EXPIRY         (default: '15m')
jwtRefreshExpiry  → process.env.JWT_REFRESH_EXPIRY (default: '7d')
```

JWT secrets are validated at startup in production (`NODE_ENV !== 'test'`). Missing secrets cause `process.exit(1)`. In test mode validation is skipped so the test runner can provide placeholder values.

### 3. Auth service (`server/src/services/authService.js`)

Pure functions — no Express dependencies:

| Function | Purpose |
|---|---|
| `generateAccessToken(user)` | JWT HS256, 15 min, payload `{ sub, email, role }` |
| `verifyAccessToken(token)` | Verifies + decodes access token |
| `generateRefreshToken(userId)` | JWT HS256, 7 days, payload `{ sub, jti }`, unique `jti` via `crypto.randomUUID()` |
| `verifyRefreshToken(token)` | Verifies + decodes refresh token |
| `setRefreshCookie(res, token)` | Sets HttpOnly, Secure (prod), SameSite=Strict cookie |
| `clearRefreshCookie(res)` | Clears the cookie (Expires=epoch) |
| `getRefreshTokenFromCookie(req)` | Reads cookie value or returns `null` |

Cookie name: `voicescribe_refresh`  
Cookie path: `/`  
Cookie `secure`: `true` in production, `false` in development

### 4. Authenticate middleware (`server/src/middleware/authenticate.js`)

Reads `Authorization: Bearer <token>` header. Verifies JWT signature and expiry. Attaches `req.user = { id, email, role }` from verified payload. Returns 401 for any failure. Identity never read from `req.body`, `req.params`, or `req.query`.

### 5. Auth controller (`server/src/controllers/authController.js`)

| Endpoint | Method | Auth | Behaviour |
|---|---|---|---|
| `/api/auth/register` | POST | Public | Validate input, check uniqueness, hash password (bcrypt 12), create User, issue tokens |
| `/api/auth/login` | POST | Public | Validate credentials, generic error for any failure, issue tokens, update `lastLoginAt` |
| `/api/auth/refresh` | POST | Public (cookie) | Read only from cookie, verify JWT, verify bcrypt hash, rotate both tokens |
| `/api/auth/logout` | POST | Authenticated | Clear cookie, set `refreshTokenHash = null` |
| `/api/auth/me` | GET | Authenticated | Return safe user object |

**Safe user object** never includes `passwordHash` or `refreshTokenHash`.

### 6. Auth routes (`server/src/routes/authRoutes.js`)

Rate limiting applied to auth routes (skipped in `NODE_ENV=test` to avoid flaky tests):
- `register`: 10 req / 15 min per IP
- `login`: 10 req / 15 min per IP
- `refresh`: 20 req / 15 min per IP

### 7. Routes index (`server/src/routes/index.js`)

Restructured:
- `/api/health` — public (unchanged)
- `/api/auth/*` — public (new)
- Everything else — `authenticate` middleware applied globally before routing

### 8. Consultation model (`server/src/models/Consultation.js`)

Added `userId` field:

```javascript
userId: {
  type:    mongoose.Schema.Types.ObjectId,
  ref:     'User',
  default: null,    // nullable — V1 documents remain valid
}
```

Added compound index: `{ userId: 1, createdAt: -1 }`.

### 9. Consultation controller (`server/src/controllers/consultationController.js`)

All five endpoints updated with ownership enforcement:

| Endpoint | Change |
|---|---|
| `POST /api/consultations` | `userId` set from `req.user.id`, never from client body |
| `GET /api/consultations` | `Consultation.find({ userId: req.user.id })` |
| `GET /api/consultations/:id` | `findOne({ _id, userId: req.user.id })` → 404 if not owned |
| `PUT /api/consultations/:id` | Same ownership query; blocks modification of approved docs (403) |
| `DELETE /api/consultations/:id` | New endpoint; ownership + draft-only check; approved docs return 403 |

ObjectId validation added to all `/:id` routes (`mongoose.isValidObjectId` → 400 if malformed).

### 10. Consultation routes (`server/src/routes/consultationRoutes.js`)

Added `DELETE /:id` route wired to `deleteConsultation`.

---

## Token flow

```
REGISTER / LOGIN
  → bcrypt.hash(password, 12) → passwordHash stored
  → generateAccessToken(user) → JWT HS256, 15 min
  → generateRefreshToken(userId) → JWT HS256, 7 days, unique jti
  → bcrypt.hash(refreshToken, 12) → refreshTokenHash stored in User
  → setRefreshCookie(res, refreshToken) → HttpOnly cookie
  → return { accessToken, user }   (no sensitive fields)

API REQUESTS
  → client sends: Authorization: Bearer <accessToken>
  → authenticate middleware verifies JWT
  → req.user = { id, email, role }

PAGE REFRESH / TOKEN EXPIRY
  → client POSTs to /api/auth/refresh (cookie sent automatically)
  → server reads cookie, verifies refresh JWT, bcrypt.compare hash
  → issues new accessToken + rotates refreshToken (new jti, new hash)
  → return { accessToken }

LOGOUT
  → POST /api/auth/logout (requires access token)
  → clearCookie + User.refreshTokenHash = null
  → refresh token is revoked server-side
```

---

## Cookie configuration

```
Name:     voicescribe_refresh
HttpOnly: true       (JavaScript cannot read)
Secure:   true       (production) / false (development)
SameSite: strict
Path:     /
MaxAge:   7 days (604800 s)
```

---

## Authorization rules (consultation endpoints)

- All `POST/GET/PUT/DELETE /api/consultations` require a valid access token.
- `GET /api/consultations` — scoped to `userId = req.user.id`. V1 documents with `userId: null` are invisible.
- `GET /api/consultations/:id` — ownership via `findOne({ _id, userId })` → 404 if not owned (never 403, to avoid leaking existence).
- `PUT /api/consultations/:id` — ownership check + blocks if `status === 'approved'` → 403.
- `DELETE /api/consultations/:id` — ownership check + draft-only guard → 403 if approved.
- `userId` from client body is always ignored; `req.user.id` is always used.

---

## V1 compatibility

V1 `Consultation` documents with `userId: null` remain untouched. They are not automatically assigned to any user. New authenticated users cannot see them. No migration is performed in Phase 1A.

---

## Tests created

### `server/tests/integration/auth.test.js` — 30 tests

| # | Test |
|---|---|
| 1 | Register valid user → 201 + accessToken + safe user shape |
| 2 | Duplicate email → 409 |
| 3a–3d | Invalid registration inputs → 400 |
| 4 | Password stored as bcrypt hash, never plaintext |
| 5 | Valid login → accessToken + HttpOnly refresh cookie |
| 6 | Wrong password → 401 with generic message |
| 6b | Unknown email → 401 with same generic message |
| 7 | Inactive user cannot login → 401 |
| 8 | Valid refresh cookie → new accessToken |
| 9 | Refresh without cookie → 401 |
| 10 | Refresh with tampered token → 401 |
| 11 | Logout clears refresh cookie + invalidates DB hash |
| 12 | `/api/auth/me` with valid token → user (no sensitive fields) |
| 13 | `/api/auth/me` without token → 401 |
| 14 | `/api/auth/me` with invalid token → 401 |
| 15 | listConsultations filters by userId |
| 16 | Doctor A cannot GET Doctor B consultation → 404 |
| 17 | Doctor A cannot PUT Doctor B consultation → 404 |
| 18 | Doctor A cannot DELETE Doctor B consultation → 404 |
| 19 | Client-supplied userId ignored; req.user.id used |
| 20 | Malformed ObjectId → 400 |
| 21 | Unauthenticated GET /api/consultations → 401 |
| 21b | Unauthenticated POST /api/consultations → 401 |
| 22 | Approved consultation cannot be modified → 403 |
| 23 | Approved consultation cannot be deleted → 403 |
| 24 | GET /api/health still works → 200 |
| 25 | app module loads without throwing |
| 26 | Unknown /api route without token → 401 |

### `server/tests/integration/app.smoke.test.js` — 3 tests (updated)

- app module loads without throwing
- GET /api/health → 200
- Unknown /api route without token → 401 (updated from 404)

---

## Test results

```
Test Suites: 2 passed, 2 total
Tests:       34 passed, 0 failed
Time:        1.203 s
```

Frontend production build: ✅ clean (21 modules, 0 errors)

---

## Commands

```bash
# Run all tests
cd server && npm test

# Verify syntax of new files
node --check src/models/User.js
node --check src/services/authService.js
node --check src/middleware/authenticate.js
node --check src/controllers/authController.js
node --check src/routes/authRoutes.js

# Build frontend
cd client && npm run build
```

---

## Known limitations

1. **No frontend auth UI** — the V1 React app cannot register/login. Adding a token to the Authorization header requires the Phase 1B frontend work.
2. **No email verification** — deferred to a hardening phase per the architecture document.
3. **No password reset** — deferred per architecture document.
4. **V1 consultations invisible** — documents with `userId: null` are not accessible until manually migrated.

---

## Deferred to Phase 1B (Frontend Authentication)

- `AuthContext` React context
- `LoginPage` and `RegisterPage` components
- `PrivateRoute` wrapper
- Silent token refresh on page load
- Authorization header injection for all API calls
- Protected route redirects

---

## Files changed in Phase 1A

| File | Status | Change |
|---|---|---|
| `server/src/models/User.js` | New | User schema |
| `server/src/services/authService.js` | New | Token generation/verification/cookie helpers |
| `server/src/middleware/authenticate.js` | New | JWT Bearer token middleware |
| `server/src/controllers/authController.js` | New | register, login, refresh, logout, me |
| `server/src/routes/authRoutes.js` | New | Auth routes with rate limiting |
| `server/src/config/env.js` | Modified | JWT config vars + conditional validation |
| `server/src/routes/index.js` | Modified | Auth routes added; authenticate applied globally |
| `server/src/models/Consultation.js` | Modified | userId field + compound index |
| `server/src/controllers/consultationController.js` | Modified | Ownership enforcement, DELETE endpoint |
| `server/src/routes/consultationRoutes.js` | Modified | DELETE route added |
| `server/.env.example` | Modified | JWT vars documented as required |
| `server/tests/setup.js` | Modified | JWT test secrets added |
| `server/tests/integration/auth.test.js` | New | 30 auth + authorization tests |
| `server/tests/integration/app.smoke.test.js` | Modified | Updated expectation for authenticated routes |
