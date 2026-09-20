# VoiceScribe

### AI-Assisted Clinical Documentation using AWS

VoiceScribe is an AI-powered clinical documentation assistant that converts doctor-patient conversations into structured, reviewable clinical notes.

A clinician can **record a consultation or upload an existing audio file**, and VoiceScribe uses AWS services to transcribe the conversation, identify languages and speakers, generate a structured clinical note, and present it to the clinician for review and approval.

> **AI drafts. The clinician reviews. The clinician approves.**

---

## 🚀 Features

- 🎙️ Browser-based consultation recording
- 📁 Upload pre-recorded consultation audio
- ☁️ Temporary audio storage using Amazon S3
- 🗣️ Speech-to-text using Amazon Transcribe
- 🌐 English (`en-IN`) and Hindi (`hi-IN`) language support
- 👥 Speaker diarization for multi-person conversations
- 🤖 AI-powered note generation using Amazon Bedrock
- 🧠 Amazon Nova Lite for structured clinical note extraction
- 🔎 Transcript-linked evidence for extracted information
- ⚠️ Missing information and uncertainty detection
- ✏️ Doctor review and editing
- ✅ Doctor approval workflow
- 🗂️ Consultation history
- 📊 Dashboard with search and filtering
- 🔄 Processing status and error handling
- 🔁 Retry failed processing
- 🧹 Temporary audio cleanup after successful processing
- 💾 MongoDB Atlas persistence

---

## 🏗️ Architecture

```text
                 ┌─────────────────────┐
                 │      Clinician      │
                 │   Browser / Desktop │
                 └──────────┬──────────┘
                            │
                 Record / Upload Audio
                            │
                            ▼
                 ┌─────────────────────┐
                 │   React + Vite      │
                 │     Frontend        │
                 └──────────┬──────────┘
                            │
                         REST API
                            │
                            ▼
                 ┌─────────────────────┐
                 │  Node.js + Express  │
                 │      Backend        │
                 └──────────┬──────────┘
                            │
             ┌──────────────┼───────────────┐
             │              │               │
             ▼              ▼               ▼
        Amazon S3       Transcribe       Bedrock
        Audio Storage   Speech +         AI Note
                         Speakers
                                            │
                                            ▼
                                    Structured Note
                                            │
                                            ▼
                                      Doctor Review
                                            │
                                            ▼
                                      MongoDB Atlas
