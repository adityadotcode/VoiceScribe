import { useEffect, useState } from 'react'
import AudioRecorder from './AudioRecorder.jsx'
import ClinicalNoteReview from './ClinicalNoteReview.jsx'
import ConsultationHistory from './ConsultationHistory.jsx'
import './App.css'

// ---------------------------------------------------------------------------
// Demo data — ONLY for the offline "Load demo note" shortcut.
// Never used in the real pipeline. Not presented as a real AI output.
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

// Empty note used when Bedrock extraction fails — preserves the transcript
// so the doctor can fill the note manually.
const BLANK_NOTE = {
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
}

// ---------------------------------------------------------------------------
// Pipeline stages
//
//  'record'     → recorder visible, no active pipeline run
//  'processing' → pipeline is running (upload / transcribe / extract)
//  'review'     → ClinicalNoteReview visible
// ---------------------------------------------------------------------------
const STAGE = { RECORD: 'record', PROCESSING: 'processing', REVIEW: 'review' }

// Human-readable labels for each pipeline step shown in the progress UI
const PIPELINE_STEPS = [
  { key: 'uploading',   label: 'Uploading to S3' },
  { key: 'transcribing',label: 'Transcribing audio' },
  { key: 'extracting',  label: 'Extracting clinical note' },
  { key: 'ready',       label: 'Ready for doctor review' },
]

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [apiStatus, setApiStatus] = useState('Checking API…')
  const [stage, setStage]         = useState(STAGE.RECORD)

  // Pipeline progress (only meaningful while stage === 'processing')
  const [pipelineStep, setPipelineStep]     = useState('')   // current step key
  const [pipelineError, setPipelineError]   = useState('')   // per-step error message

  // Active review data
  const [transcript, setTranscript]                     = useState('')
  const [note, setNote]                                 = useState(null)
  const [isDemo, setIsDemo]                             = useState(false)
  const [bedrockFailed, setBedrockFailed]               = useState(false)
  const [activeConsultationId, setActiveConsultationId] = useState(null)

  // Bump to force ConsultationHistory to re-fetch
  const [historyRefresh, setHistoryRefresh] = useState(0)

  // ── Health-check ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setApiStatus(d.success ? d.message : 'API responded unexpectedly'))
      .catch(() => setApiStatus('API is not reachable yet'))
  }, [])

  // ── AudioRecorder internal stage changes ─────────────────────────────────
  // Mirror 'uploading' and 'transcribing' from AudioRecorder into our
  // processing progress display.
  function handleStageChange(recorderStage) {
    if (recorderStage === 'uploading' || recorderStage === 'transcribing') {
      setPipelineStep(recorderStage)
      setStage(STAGE.PROCESSING)
    }
    // 'error' from recorder: recorder shows its own inline error; we return
    // to the record screen so the doctor can re-record or re-upload.
    if (recorderStage === 'error') {
      setStage(STAGE.RECORD)
      setPipelineStep('')
      setPipelineError('')
    }
  }

  // ── AudioRecorder → transcription complete → call Bedrock ─────────────────
  async function handleTranscriptReady(objectKey, rawTranscript) {
    // Transcription done — advance progress to Bedrock extraction
    setTranscript(rawTranscript)
    setPipelineStep('extracting')
    setPipelineError('')

    try {
      const res  = await fetch('/api/extract-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: rawTranscript }),
      })
      const data = await res.json()

      if (!res.ok || !data.success) {
        // Bedrock failed — open review with blank note + real transcript so
        // the doctor can fill in the note manually. Nothing is lost.
        console.warn('[App] /api/extract-note failed:', data.message)
        setPipelineError(
          `Clinical note extraction failed: ${data.message || 'unknown error'}. ` +
          `The transcript has been preserved. Please fill in the note manually.`
        )
        setNote(BLANK_NOTE)
        setBedrockFailed(true)
        setActiveConsultationId(null)
        setIsDemo(false)
        // Brief pause so the doctor can read the error before the screen changes
        await delay(2200)
        setPipelineStep('ready')
        await delay(600)
        openReview()
        return
      }

      // Success — populate review with Bedrock note
      setNote(data.note)
      setBedrockFailed(false)
      setActiveConsultationId(null)
      setIsDemo(false)
      setPipelineStep('ready')
      await delay(600)
      openReview()
    } catch (err) {
      console.error('[App] extract-note network error:', err)
      setPipelineError(
        'Could not reach the note extraction service. ' +
        'The transcript has been preserved — please fill in the note manually.'
      )
      setNote(BLANK_NOTE)
      setBedrockFailed(true)
      setActiveConsultationId(null)
      setIsDemo(false)
      await delay(2200)
      setPipelineStep('ready')
      await delay(600)
      openReview()
    }
  }

  function openReview() {
    setPipelineStep('')
    setPipelineError('')
    setStage(STAGE.REVIEW)
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // ── Demo shortcut (offline UI testing only) ───────────────────────────────
  function loadDemo() {
    setTranscript(DEMO_TRANSCRIPT)
    setNote(DEMO_NOTE)
    setBedrockFailed(false)
    setActiveConsultationId(null)
    setIsDemo(true)
    setStage(STAGE.REVIEW)
  }

  // ── Open a saved consultation from history ────────────────────────────────
  async function handleOpenConsultation(summary) {
    try {
      const res  = await fetch(`/api/consultations/${summary._id}`)
      const data = await res.json()
      if (!data.success) { alert(`Could not load consultation: ${data.message}`); return }
      const c = data.consultation
      setTranscript(c.transcript ?? '')
      setNote(c.note ?? BLANK_NOTE)
      setBedrockFailed(false)
      setActiveConsultationId(c._id)
      setIsDemo(false)
      setStage(STAGE.REVIEW)
    } catch {
      alert('Network error — could not load consultation.')
    }
  }

  // ── Back from review ──────────────────────────────────────────────────────
  function handleBack() {
    setStage(STAGE.RECORD)
    setTranscript('')
    setNote(null)
    setBedrockFailed(false)
    setActiveConsultationId(null)
    setIsDemo(false)
    setPipelineStep('')
    setPipelineError('')
  }

  // ── After save/approve ────────────────────────────────────────────────────
  function handleSaved(id) {
    setActiveConsultationId(id)
    setHistoryRefresh((n) => n + 1)
  }

  // ── Processing screen ─────────────────────────────────────────────────────
  if (stage === STAGE.PROCESSING) {
    return (
      <main className="page">
        <p className="eyebrow">Clinical documentation assistant</p>
        <h1>VoiceScribe</h1>

        <div className="pipeline-card">
          <h2 className="pipeline-title">Processing consultation…</h2>

          <ol className="pipeline-steps" aria-label="Pipeline progress">
            {PIPELINE_STEPS.map(({ key, label }) => {
              const stepIndex    = PIPELINE_STEPS.findIndex((s) => s.key === key)
              const activeIndex  = PIPELINE_STEPS.findIndex((s) => s.key === pipelineStep)
              const isDone       = stepIndex < activeIndex
              const isActive     = key === pipelineStep
              const stateClass   = isDone ? 'is-done' : isActive ? 'is-active' : 'is-pending'
              return (
                <li key={key} className={`pipeline-step ${stateClass}`}>
                  <span className="pipeline-step-icon" aria-hidden="true">
                    {isDone ? '✓' : isActive ? '◉' : '○'}
                  </span>
                  {label}
                  {isActive && key !== 'ready' && (
                    <span className="pipeline-spinner" aria-hidden="true" />
                  )}
                </li>
              )
            })}
          </ol>

          {pipelineError && (
            <div className="pipeline-error" role="alert">
              <strong>Note:</strong> {pipelineError}
            </div>
          )}
        </div>
      </main>
    )
  }

  // ── Review screen ─────────────────────────────────────────────────────────
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
          bedrockFailed={bedrockFailed}
          initialConsultationId={activeConsultationId}
          onBack={handleBack}
          onSaved={handleSaved}
        />
      </main>
    )
  }

  // ── Record screen (default) ───────────────────────────────────────────────
  return (
    <main className="page">
      <p className="eyebrow">Clinical documentation assistant</p>
      <h1>VoiceScribe</h1>
      <p className="lede">
        A doctor records a consultation, reviews the extracted note, and
        approves it before anything is saved.
      </p>
      <p className="status">{apiStatus}</p>

      <ol className="journey-steps" aria-label="Workflow steps">
        <li className="journey-step is-active">Record</li>
        <li className="journey-step">Upload &amp; Transcribe</li>
        <li className="journey-step">Extract note</li>
        <li className="journey-step">Review &amp; Approve</li>
      </ol>

      <AudioRecorder
        onTranscriptReady={handleTranscriptReady}
        onStageChange={handleStageChange}
      />

      {/* Demo shortcut — development / offline testing only */}
      <div className="demo-block">
        <p className="demo-label">
          ⚙️ Development shortcut — skip recording and load demo data
        </p>
        <button type="button" className="recorder-button secondary" onClick={loadDemo}>
          Load demo note
        </button>
      </div>

      <ConsultationHistory
        onOpen={handleOpenConsultation}
        refreshTrigger={historyRefresh}
      />
    </main>
  )
}

export default App
