# VoiceScribe

AI-assisted clinical documentation assistant built for the **First Commit IRL Hackathon**.

VoiceScribe records or accepts a pre-recorded doctor–patient consultation, transcribes it
with Amazon Transcribe, extracts a structured clinical note with Amazon Bedrock, and lets
the doctor review, edit, and approve the note before it is stored in MongoDB.

---

## Architecture

```
Browser  (React / Vite)
  │
  │  HTTPS
  ▼
AWS Amplify Hosting  (static frontend)
  │
  │  HTTPS  /api/*
  ▼
Amazon EC2  (Node.js / Express API)
  ├── Amazon S3          — temporary audio storage (ap-southeast-2)
  ├── Amazon Transcribe  — speech-to-text (en-IN + hi-IN, speaker diarization)
  ├── Amazon Bedrock     — structured note extraction (amazon.nova-lite-v1:0)
  └── MongoDB Atlas      — consultation persistence
```

AWS region: **ap-southeast-2**

---

## Local development

### 1. Prerequisites

- Node.js ≥ 20
- AWS credentials configured (`~/.aws/credentials` or environment variables)
- MongoDB Atlas cluster (M0 free tier is fine)
- AWS access to S3, Transcribe, and Bedrock in `ap-southeast-2`

### 2. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 3. Configure the server

```bash
cp server/.env.example server/.env
# Edit server/.env — fill in MONGODB_URI, S3_BUCKET_NAME, AWS_REGION
```

### 4. Start the backend

```bash
cd server && npm run dev
```

### 5. Start the frontend

```bash
cd client && npm run dev
# Opens http://localhost:5174 with /api proxy → localhost:5000
```

---

## Environment variables

### server/.env (never committed)

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port (default: `5000`) |
| `MONGODB_URI` | **Yes** | MongoDB Atlas connection string |
| `CLIENT_ORIGIN` | No | Allowed CORS origin (default: `http://localhost:5174`) |
| `AWS_REGION` | **Yes** | AWS region — must be `ap-southeast-2` |
| `S3_BUCKET_NAME` | **Yes** | S3 bucket for temporary audio |
| `MAX_AUDIO_FILE_BYTES` | No | Max upload size in bytes (default: 25 MB) |

AWS credentials are read from the default credential chain. On EC2, use an IAM instance
role — do not put access keys in `.env`.

### client build environment

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | Production only | Full URL of the EC2 backend, e.g. `http://ec2-xxx.ap-southeast-2.compute.amazonaws.com` |

Leave `VITE_API_BASE_URL` unset for local development (Vite proxy handles it).

---

## Production build

```bash
# Build the React app
cd client
VITE_API_BASE_URL=https://<your-ec2-url> npm run build
# Output: client/dist/
```

---

## Deployment — Amplify + EC2

### Backend (EC2)

**Required EC2 setup:**

1. **Launch** an EC2 instance — `t3.small` or larger, Amazon Linux 2023, ap-southeast-2
2. **Attach IAM role** `VoiceScribeEC2Role` with these policies:
   - `AmazonS3FullAccess` (or a bucket-scoped policy for your audio bucket)
   - `AmazonTranscribeFullAccess`
   - `AmazonBedrockFullAccess`
3. **Security group** — inbound TCP `3000` (or your chosen port) from anywhere (`0.0.0.0/0`)
4. **SSH in** and run:

```bash
# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs git

# Clone the repo
git clone https://github.com/<your-org>/VoiceScribe.git
cd VoiceScribe/server
npm install --omit=dev

# Create .env (values from your real config)
cat > .env << 'EOF'
PORT=3000
NODE_ENV=production
MONGODB_URI=<your-atlas-uri>
AWS_REGION=ap-southeast-2
S3_BUCKET_NAME=<your-bucket>
MAX_AUDIO_FILE_BYTES=26214400
CLIENT_ORIGIN=https://<your-amplify-url>
EOF

# Install PM2 to keep the process alive
sudo npm install -g pm2
pm2 start src/server.js --name voicescribe
pm2 startup   # follow the printed command to auto-start on reboot
pm2 save
```

**Verify:**

```bash
curl http://localhost:3000/api/health
# Expected: {"success":true,"service":"VoiceScribe API","status":"ok"}
```

Public health check (from your machine):

```
http://<EC2-PUBLIC-IP>:3000/api/health
```

### Frontend (Amplify Hosting)

1. Open **AWS Amplify Console** → **New app** → **Host web app**
2. Connect GitHub → select `VoiceScribe` repo → branch `main`
3. **Build settings:**

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - cd client && npm install
    build:
      commands:
        - cd client && npm run build
  artifacts:
    baseDirectory: client/dist
    files:
      - '**/*'
  cache:
    paths:
      - client/node_modules/**/*
```

4. **Environment variables** in Amplify Console:
   - `VITE_API_BASE_URL` = `http://<EC2-PUBLIC-IP>:3000`

5. Save and deploy — Amplify gives you a URL like `https://main.xxxxxxxx.amplifyapp.com`

6. **Update EC2 `.env`** — set `CLIENT_ORIGIN` to the Amplify URL, then:

```bash
pm2 restart voicescribe
```

---

## Health check

```
GET /api/health
→ {"success":true,"service":"VoiceScribe API","status":"ok","message":"VoiceScribe API is running"}
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

## Teardown after hackathon

| Resource | How to stop |
|---|---|
| EC2 instance | EC2 Console → Stop or Terminate instance |
| Amplify app | Amplify Console → App → Actions → Delete app |
| S3 audio bucket | Audio is auto-deleted after processing; delete bucket manually if needed |
| MongoDB Atlas | No action needed (M0 free tier) |
| IAM role | IAM Console → Roles → Delete `VoiceScribeEC2Role` |

---

## AWS services used

| Service | Purpose |
|---|---|
| Amazon EC2 | Node.js/Express API host |
| AWS Amplify Hosting | React static frontend |
| Amazon S3 | Temporary audio storage (deleted after processing) |
| Amazon Transcribe | Speech-to-text (en-IN + hi-IN, speaker diarization) |
| Amazon Bedrock (`amazon.nova-lite-v1:0`) | Structured clinical note extraction |
| MongoDB Atlas | Consultation persistence |

---

## Safety

VoiceScribe does **not** diagnose or prescribe. All AI-generated content is clearly marked
as a draft requiring doctor review and approval before storage. Speaker identity is never
automatically assigned.
