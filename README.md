# VoiceScribe

AI-assisted clinical documentation assistant built for the **First Commit IRL Hackathon**.

VoiceScribe records a doctor–patient consultation, transcribes it with Amazon
Transcribe, extracts a structured clinical note with Amazon Bedrock, and lets
the doctor review, edit, and approve the note before it is stored in MongoDB.

---

## Architecture

```
Browser (React / Vite)
  │
  │  /api/*
  ▼
Express API (Node.js)
  ├── Amazon S3          — temporary audio storage
  ├── Amazon Transcribe  — speech-to-text (en-IN + hi-IN, speaker diarization)
  ├── Amazon Bedrock     — structured note extraction (amazon.nova-lite-v1:0)
  └── MongoDB Atlas      — consultation persistence
```

AWS region: **ap-southeast-2**

---

## Prerequisites

- Node.js ≥ 20
- An AWS account with access to S3, Transcribe, and Bedrock in `ap-southeast-2`
- A MongoDB Atlas cluster (M0 free tier is sufficient for development)
- AWS credentials available in the environment (IAM role, `~/.aws/credentials`, or env vars)

---

## Local development

### 1. Clone and install

```bash
# root (optional root-level node_modules)
npm install

# backend
cd server && npm install

# frontend
cd ../client && npm install
```

### 2. Configure the server

```bash
cp server/.env.example server/.env
# Edit server/.env — fill in MONGODB_URI, S3_BUCKET_NAME, and AWS_REGION
```

### 3. Start the backend

```bash
cd server
npm run dev          # uses Node.js --watch for auto-reload
```

### 4. Start the frontend

```bash
cd client
npm run dev          # Vite dev server with /api proxy → localhost:5000
```

Open http://localhost:5173

---

## Environment variables

### server/.env

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port (default: `5000`) |
| `MONGODB_URI` | **Yes** | MongoDB Atlas connection string |
| `CLIENT_ORIGIN` | No | Allowed CORS origin (default: `http://localhost:5174`) |
| `AWS_REGION` | **Yes** | AWS region (default: `ap-southeast-2`) |
| `S3_BUCKET_NAME` | **Yes** | S3 bucket for temporary audio |
| `MAX_AUDIO_FILE_BYTES` | No | Max upload size in bytes (default: 25 MB) |

AWS credentials are read from the default credential chain (environment variables,
`~/.aws/credentials`, IAM role). Never hardcode them.

### client/.env (or .env.local)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | No | Backend URL for production (empty = use Vite proxy) |

---

## Production build

```bash
# Build the React app
cd client && npm run build
# Output: client/dist/

# Start the backend
cd server && npm start
```

For production, set `CLIENT_ORIGIN` to the deployed frontend URL and
`VITE_API_BASE_URL` to the deployed backend URL in your deployment environment.

---

## Health check

```
GET /api/health
```

Response:
```json
{ "success": true, "service": "VoiceScribe API", "status": "ok" }
```

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/audio` | Upload consultation audio to S3 |
| `POST` | `/api/transcribe` | Transcribe audio (returns transcript + speaker data) |
| `POST` | `/api/extract-note` | Extract structured clinical note via Bedrock |
| `POST` | `/api/consultations` | Save a consultation |
| `GET` | `/api/consultations` | List all consultations |
| `GET` | `/api/consultations/:id` | Get a single consultation |
| `PUT` | `/api/consultations/:id` | Update a consultation |

---

## AWS services used

| Service | Purpose |
|---|---|
| Amazon S3 | Temporary audio storage — deleted after successful extraction |
| Amazon Transcribe | Speech-to-text with multilingual (en-IN + hi-IN) and speaker diarization |
| Amazon Bedrock (`amazon.nova-lite-v1:0`) | Structured clinical note extraction |

---

## Safety

VoiceScribe does **not** diagnose or prescribe. All AI-generated content is
clearly marked as a draft requiring doctor review and approval before storage.
Speaker identity is never automatically assigned.
