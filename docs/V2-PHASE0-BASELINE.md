# VoiceScribe V2 — Phase 0 Baseline

> Captured at the start of Phase 0 before any changes were made.  
> Source: repository inspection, `git log`, `node --version`.

---

## Runtime

| Item | Value |
|---|---|
| Node.js | v24.18.1 |
| npm | (bundled with Node 24) |
| Platform | Windows (win32), bash shell |

---

## Git baseline

```
HEAD commit : f527ebf  feat: prepare single-origin production deployment
Branch      : main (up to date with origin/main)
Dirty files : server/src/server.js (minor modification from prior session)
Untracked   : docs/ directory
```

---

## Backend (server/)

### Dependencies at baseline

```json
{
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "3.1134.0",
    "@aws-sdk/client-s3": "^3.1134.0",
    "@aws-sdk/client-transcribe": "^3.1134.0",
    "cors": "^2.8.6",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "mongoose": "^9.10.1",
    "multer": "^2.4.0"
  },
  "devDependencies": {}
}
```

No test framework. No security middleware (helmet, rate-limit). No cookie handling. No auth libraries.

### npm scripts at baseline

```
start      : node src/server.js
dev        : node --watch src/server.js
build      : cd ../client && npm install && npm run build
```

No `test` script.

### Source structure at baseline

```
server/src/
  app.js                 Express setup (CORS, JSON body, API routes, static serving)
  server.js              Entry point (listen + connectDb)
  config/
    db.js                Mongoose connect; process.exit(1) on failure
    env.js               dotenv load + startup validation (exits on missing vars)
  controllers/
    audioController.js
    bedrockController.js
    consultationController.js
    healthController.js
    transcribeController.js
  middleware/
    audioUpload.js        multer config
    errorHandler.js       global Express error handler
  models/
    Consultation.js       single Mongoose model
  routes/
    index.js
    audioRoutes.js
    bedrockRoutes.js
    consultationRoutes.js
    healthRoutes.js
    transcribeRoutes.js
  services/
    bedrockService.js
    s3Service.js
    transcribeService.js
```

### Existing test setup at baseline

None. No test runner, no test directory, no test scripts.

---

## Frontend (client/)

### Dependencies at baseline

```json
{
  "dependencies": {
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.7",
    "@vitejs/plugin-react": "^6.1.1",
    "eslint": "^10.10.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.6",
    "globals": "^17.12.0",
    "vite": "^8.3.0"
  }
}
```

### npm scripts at baseline

```
dev     : vite
build   : vite build
lint    : eslint .
preview : vite preview
```

---

## Production build command (baseline)

```bash
# From server/:
npm run build   # runs: cd ../client && npm install && npm run build
# Then:
npm start       # runs: node src/server.js
```

---

## Development commands (baseline)

```bash
# Terminal 1:
cd server && npm run dev    # node --watch src/server.js — port 5000

# Terminal 2:
cd client && npm run dev    # vite dev server — port 5173 or 5174
```

---

## Notes

- `dotenv` package is actually `dotenvx` v17, which registers a Node module hook and auto-injects `.env` values. This affects test setup (see Phase 0 implementation notes).
- The V1 `server.js` did not sequence MongoDB connection before `app.listen()` — the improved version is part of Phase 0.
- No `.gitignore` entry for `server/.env` at root level already covers it.
