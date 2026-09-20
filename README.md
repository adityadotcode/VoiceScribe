# VoiceScribe

AI-assisted clinical documentation assistant built for the **First Commit IRL Hackathon**.

VoiceScribe records or accepts a pre-recorded doctor–patient consultation, transcribes it
with Amazon Transcribe, extracts a structured clinical note with Amazon Bedrock, and lets
the doctor review, edit, and approve the note before it is stored in MongoDB.

---

## Deployment architecture

```
Browser  (HTTPS)
    │
    ▼
Amazon CloudFront  (HTTPS termination, public URL)
    │
    ▼ HTTP :3000
Amazon EC2  (Node.js / Express)
    ├── serves  React production build  (client/dist/)
    └── serves  /api/*  backend routes
         │
         ├── Amazon S3          (ap-southeast-2) — temporary audio
         ├── Amazon Transcribe  (ap-southeast-2) — speech → text
         ├── Amazon Bedrock     (ap-southeast-2) — clinical note extraction
         └── MongoDB Atlas      — consultation persistence
```

### Why single-origin

Express serves the React build **and** the API at the same CloudFront URL.
The frontend makes all API calls with relative paths (`/api/…`), so no
`VITE_API_BASE_URL` is needed in production and there is no CORS issue between
the static assets and the backend.

---

## Local development

### Prerequisites

- Node.js ≥ 20
- AWS credentials configured (`~/.aws/credentials` or env vars)
- MongoDB Atlas cluster (M0 free tier is fine)
- Access to S3, Transcribe, and Bedrock in `ap-southeast-2`

### Install

```bash
cd server && npm install
cd ../client && npm install
```

### Configure

```bash
cp server/.env.example server/.env
# Edit server/.env — fill in MONGODB_URI, S3_BUCKET_NAME
# Leave NODE_ENV unset (or remove it) for local dev
```

### Start (two terminals)

```bash
# Terminal 1 — backend
cd server && npm run dev      # http://localhost:5000

# Terminal 2 — frontend
cd client && npm run dev      # http://localhost:5174  (Vite proxies /api → :5000)
```

---

## Production build + start (EC2)

```bash
# 1. Build the React app into client/dist/
cd server && npm run build

# 2. Set environment variables in server/.env  (see table below)
#    NODE_ENV=production  is required so Express serves the React build.

# 3. Start the server
cd server && npm start
```

The server will:
- serve `client/dist/` as static assets
- serve `index.html` for any non-`/api` path (SPA routing)
- serve all `/api/*` routes normally

Verify locally at `http://localhost:3000`.

---

## Environment variables

### server/.env  (never committed)

| Variable | Required | Production value |
|---|---|---|
| `PORT` | No | `3000` |
| `NODE_ENV` | **Yes for prod** | `production` |
| `MONGODB_URI` | **Yes** | Atlas connection string |
| `CLIENT_ORIGIN` | No | CloudFront HTTPS URL |
| `AWS_REGION` | **Yes** | `ap-southeast-2` |
| `S3_BUCKET_NAME` | **Yes** | your S3 bucket name |
| `MAX_AUDIO_FILE_BYTES` | No | `26214400` (25 MB) |

AWS credentials are **not** needed in `.env` on EC2 — attach an IAM role to the
instance and the SDK picks up credentials automatically.

### No client env vars needed in production

The frontend uses relative API paths (`/api/…`) when `VITE_API_BASE_URL` is not
set.  Leave it unset in the production build.

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/audio` | Upload audio to S3 |
| `POST` | `/api/transcribe` | Transcribe audio |
| `POST` | `/api/extract-note` | Extract clinical note via Bedrock |
| `POST` | `/api/consultations` | Save consultation |
| `GET` | `/api/consultations` | List consultations |
| `GET` | `/api/consultations/:id` | Get one consultation |
| `PUT` | `/api/consultations/:id` | Update consultation |

---

## EC2 deployment steps

### 1. Create IAM role  `VoiceScribeEC2Role`

In **IAM → Roles → Create role**:
- Trusted entity: **AWS service → EC2**
- Attach these managed policies:
  - `AmazonS3FullAccess` *(or a bucket-scoped policy)*
  - `AmazonTranscribeFullAccess`
  - `AmazonBedrockFullAccess`

### 2. Launch EC2 instance

- AMI: Amazon Linux 2023
- Type: `t3.small` or larger
- Region: `ap-southeast-2`
- IAM instance profile: `VoiceScribeEC2Role`
- Security group — **inbound rules**:
  - TCP `22` from your IP (SSH)
  - TCP `3000` from `0.0.0.0/0` (API — CloudFront will be the only real caller)

### 3. Bootstrap the instance

SSH in, then:

```bash
# Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs git

# Clone
git clone https://github.com/<your-org>/VoiceScribe.git
cd VoiceScribe

# Install server dependencies
cd server && npm install --omit=dev

# Build the React frontend
npm run build

# Create .env
cat > .env << 'EOF'
PORT=3000
NODE_ENV=production
MONGODB_URI=<your-atlas-uri>
AWS_REGION=ap-southeast-2
S3_BUCKET_NAME=<your-bucket>
MAX_AUDIO_FILE_BYTES=26214400
CLIENT_ORIGIN=https://<your-cloudfront-url>
EOF

# Install PM2 (keeps the process alive after SSH disconnect)
sudo npm install -g pm2
pm2 start src/server.js --name voicescribe
pm2 startup    # run the printed command to enable auto-start on reboot
pm2 save
```

### 4. Verify the backend

```bash
# From the EC2 instance
curl http://localhost:3000/api/health
# Expected: {"success":true,"service":"VoiceScribe API","status":"ok"}

# From your laptop (replace with the public IP)
curl http://<EC2-PUBLIC-IP>:3000/api/health
```

Open `http://<EC2-PUBLIC-IP>:3000` in a browser to verify the React app loads.

---

## CloudFront configuration

Create a CloudFront distribution pointing to the EC2 origin:

| Setting | Value |
|---|---|
| Origin domain | `<EC2-PUBLIC-DNS>` (e.g. `ec2-xx-xx-xx-xx.ap-southeast-2.compute.amazonaws.com`) |
| Origin protocol | HTTP only |
| Origin port | `3000` |
| Viewer protocol policy | Redirect HTTP to HTTPS |
| Allowed HTTP methods | **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE** |
| Cache policy | `CachingDisabled` (all API responses must be fresh) |
| Origin request policy | `AllViewer` (forwards all headers, cookies, query strings) |

After the distribution is created:

1. Note the CloudFront domain, e.g. `https://dxxxxxxxx.cloudfront.net`
2. Update `CLIENT_ORIGIN` in `server/.env` on EC2 to that URL
3. `pm2 restart voicescribe`
4. Test the full pipeline from `https://dxxxxxxxx.cloudfront.net`

---

## Teardown after hackathon

| Resource | How to stop |
|---|---|
| EC2 instance | EC2 Console → Stop or Terminate |
| CloudFront distribution | CloudFront Console → Disable, then Delete |
| S3 bucket | Audio auto-deleted after processing; delete bucket if desired |
| MongoDB Atlas | No action needed (M0 free tier) |
| IAM role | IAM Console → Delete `VoiceScribeEC2Role` |

---

## Safety

VoiceScribe does **not** diagnose or prescribe.  All AI-generated content is
clearly marked as a draft requiring doctor review and approval before storage.
Speaker identity is never automatically assigned.
