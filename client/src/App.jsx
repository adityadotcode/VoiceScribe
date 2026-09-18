import { useEffect, useState } from 'react'
import AudioRecorder from './AudioRecorder.jsx'
import ClinicalNoteReview from './ClinicalNoteReview.jsx'
import './App.css'

// ---------------------------------------------------------------------------
// Demo data — ONLY used when the "Load demo" button is clicked.
// This is NOT presented as a real AI output and never shown automatically.
// ---------------------------------------------------------------------------
const DEMO_TRANSCRIPT =
  "Hello, sir. I'm having a fever for the last three days and cough for two days. I also feel tired."

const DEMO_NOTE = {
  patient: { name: '', age: null, sex: '' },
  chief_complaint: 'fever',
  symptoms: ['fever', 'cough', 'fatigue'],
  duration: 'fever for three days; cough for two days',
  history: '',
  observations: [],
  assessment: '',
  medications_mentioned: [],
  follow_up: '',
  missing_information: ['patient name', 'age', 'sex'],
  uncertain_fields: [],
}

// ---------------------------------------------------------------------------
// Journey stages
// ---------------------------------------------------------------------------
//   'record'   → recorder visible, no transcript yet
//   'review'   → ClinicalNoteReview visible
const STAGE = { RECORD: 'record', REVIEW: 'review' }

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [apiStatus, setApiStatus] = useState('Checking API…')
  const [stage, setStage] = useState(STAGE.RECORD)

  // Transcript and note handed to the review screen
  const [transcript, setTranscript] = useState('')
  const [note, setNote] = useState(null)
  const [isDemo, setIsDemo] = useState(false)

  // Health-check on mount
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setApiStatus(d.success ? d.message : 'API responded unexpectedly'))
      .catch(() => setApiStatus('API is not reachable yet'))
  }, [])

  // ── Called by AudioRecorder once upload + transcription succeed ──
  function handleTranscriptReady(objectKey, rawTranscript) {
    setTranscript(rawTranscript)
    // Bedrock not yet available: note will be null until Bedrock is unblocked.
    // For now we advance to the review screen with the transcript visible so
    // the doctor can at least read the raw text. The note fields start blank.
    setNote({
      patient: { name: '', age: null, sex: '' },
      chief_complaint: '',
      symptoms: [],
      duration: '',
      history: '',
      observations: [],
      assessment: '',
      medications_mentioned: [],
      follow_up: '',
      missing_information: [],
      uncertain_fields: [],
    })
    setIsDemo(false)
    setStage(STAGE.REVIEW)
  }

  // ── Load demo data (development / hackathon path) ──
  function loadDemo() {
    setTranscript(DEMO_TRANSCRIPT)
    setNote(DEMO_NOTE)
    setIsDemo(true)
    setStage(STAGE.REVIEW)
  }

  // ── Return to recorder from review screen ──
  function handleBack() {
    setStage(STAGE.RECORD)
    setTranscript('')
    setNote(null)
    setIsDemo(false)
  }

  // ── Review screen ──
  if (stage === STAGE.REVIEW && note) {
    return (
      <main className="page page--review">
        <div className="page-header">
          <p className="eyebrow">Clinical documentation assistant</p>
          <h1>VoiceScribe</h1>
        </div>
        <ClinicalNoteReview
          note={note}
          transcript={transcript}
          isDemo={isDemo}
          onBack={handleBack}
        />
      </main>
    )
  }

  // ── Record screen (default) ──
  return (
    <main className="page">
      <p className="eyebrow">Clinical documentation assistant</p>
      <h1>VoiceScribe</h1>
      <p className="lede">
        A doctor records a consultation, reviews the extracted note, and
        approves it before anything is saved.
      </p>
      <p className="status">{apiStatus}</p>

      {/* Journey steps indicator */}
      <ol className="journey-steps" aria-label="Workflow steps">
        <li className="journey-step is-active">Record</li>
        <li className="journey-step">Upload &amp; Transcribe</li>
        <li className="journey-step">Review note</li>
        <li className="journey-step">Approve</li>
      </ol>

      <AudioRecorder onTranscriptReady={handleTranscriptReady} />

      {/* Demo shortcut — clearly labelled, development only */}
      <div className="demo-block">
        <p className="demo-label">
          ⚙️ Development shortcut — skip recording and load demo data
        </p>
        <button type="button" className="recorder-button secondary" onClick={loadDemo}>
          Load demo note
        </button>
      </div>
    </main>
  )
}

export default App
