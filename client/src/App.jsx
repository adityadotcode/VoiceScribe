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
// Stages
// ---------------------------------------------------------------------------
const STAGE = { RECORD: 'record', PROCESSING: 'processing', REVIEW: 'review' }

const PIPELINE_STEPS = [
  { key: 'uploading',    label: 'Uploading to S3' },
  { key: 'transcribing', label: 'Transcribing audio' },
  { key: 'extracting',   label: 'Extracting clinical note' },
  { key: 'ready',        label: 'Ready for doctor review' },
]

// Stepper steps mirror the pipeline stages
const STEPPER_STEPS = [
  { label: 'Record' },
  { label: 'Transcribe' },
  { label: 'Extract note' },
  { label: 'Review & Approve' },
]

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [apiStatus, setApiStatus] = useState('Checking API…')
  const [stage, setStage]         = useState(STAGE.RECORD)

  const [pipelineStep, setPipelineStep]   = useState('')
  const [pipelineError, setPipelineError] = useState('')

  const [transcript, setTranscript]                     = useState('')
  const [note, setNote]                                 = useState(null)
  const [isDemo, setIsDemo]                             = useState(false)
  const [bedrockFailed, setBedrockFailed]               = useState(false)
  const [activeConsultationId, setActiveConsultationId] = useState(null)

  const [historyRefresh, setHistoryRefresh] = useState(0)

  // ── Health-check ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setApiStatus(d.success ? d.message : 'API responded unexpectedly'))
      .catch(() => setApiStatus('API is not reachable yet'))
  }, [])

  // ── AudioRecorder stage mirror ────────────────────────────────────────────
  function handleStageChange(recorderStage) {
    if (recorderStage === 'uploading' || recorderStage === 'transcribing') {
      setPipelineStep(recorderStage)
      setStage(STAGE.PROCESSING)
    }
    if (recorderStage === 'error') {
      setStage(STAGE.RECORD)
      setPipelineStep('')
      setPipelineError('')
    }
  }

  // ── Transcript ready → call Bedrock ───────────────────────────────────────
  async function handleTranscriptReady(objectKey, rawTranscript) {
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
        console.warn('[App] /api/extract-note failed:', data.message)
        setPipelineError(
          `Note extraction failed: ${data.message || 'unknown error'}. ` +
          `The transcript has been preserved — please fill in the note manually.`
        )
        setNote(BLANK_NOTE)
        setBedrockFailed(true)
        setActiveConsultationId(null)
        setIsDemo(false)
        await delay(2200)
        setPipelineStep('ready')
        await delay(600)
        openReview()
        return
      }

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

  // ── Demo shortcut ─────────────────────────────────────────────────────────
  function loadDemo() {
    setTranscript(DEMO_TRANSCRIPT)
    setNote(DEMO_NOTE)
    setBedrockFailed(false)
    setActiveConsultationId(null)
    setIsDemo(true)
    setStage(STAGE.REVIEW)
  }

  // ── Open from history ─────────────────────────────────────────────────────
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

  // ── Back ──────────────────────────────────────────────────────────────────
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

  // ── Helpers ───────────────────────────────────────────────────────────────
  /** Map recorder pipeline step key → 0-based stepper index */
  function activePipelineIndex() {
    const map = { uploading: 1, transcribing: 1, extracting: 2, ready: 3 }
    return map[pipelineStep] ?? 0
  }

  // ==========================================================================
  // PROCESSING SCREEN
  // ==========================================================================
  if (stage === STAGE.PROCESSING) {
    const activeIndex = PIPELINE_STEPS.findIndex((s) => s.key === pipelineStep)

    return (
      <main className="page">
        <div className="hero" style={{ marginBottom: 0 }}>
          <span className="hero-eyebrow">Clinical documentation assistant</span>
          <h1>VoiceScribe</h1>
        </div>

        <div className="pipeline-card">
          <p className="pipeline-title">Processing consultation…</p>

          <ol className="pipeline-steps" aria-label="Pipeline progress">
            {PIPELINE_STEPS.map(({ key, label }, idx) => {
              const isDone   = idx < activeIndex
              const isActive = idx === activeIndex
              const stateClass = isDone ? 'is-done' : isActive ? 'is-active' : ''
              const icon = isDone ? '✓' : idx + 1
              return (
                <li key={key} className={`pipeline-step ${stateClass}`}>
                  <span className="pipeline-step-icon" aria-hidden="true">{icon}</span>
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

  // ==========================================================================
  // REVIEW SCREEN
  // ==========================================================================
  if (stage === STAGE.REVIEW && note) {
    return (
      <main className="page page--review">
        <div className="page-header">
          <span className="eyebrow">Clinical documentation assistant</span>
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

  // ==========================================================================
  // RECORD SCREEN (default)
  // ==========================================================================
  return (
    <main className="page">

      {/* Hero */}
      <div className="hero">
        <span className="hero-eyebrow">Clinical documentation assistant</span>
        <h1>VoiceScribe</h1>
        <p className="hero-tagline">
          Record a consultation, get an AI-drafted structured clinical note,
          and let the doctor review and approve — before anything is saved.
        </p>
        <span className="hero-safety">
          <span className="hero-safety-icon" aria-hidden="true">🔒</span>
          VoiceScribe does not diagnose or prescribe.
          The doctor reviews and approves all documentation.
        </span>
        <div>
          <span className="api-chip">{apiStatus}</span>
        </div>
      </div>

      {/* Workflow stepper */}
      <ol className="stepper" aria-label="Workflow steps">
        {STEPPER_STEPS.map(({ label }, idx) => (
          <li key={label} className={`stepper-item ${idx === 0 ? 'is-active' : ''}`}>
            <span className="stepper-circle" aria-hidden="true">{idx + 1}</span>
            <span className="stepper-label">{label}</span>
          </li>
        ))}
      </ol>

      {/* Recorder */}
      <AudioRecorder
        onTranscriptReady={handleTranscriptReady}
        onStageChange={handleStageChange}
      />

      {/* Demo shortcut — clearly secondary and dev-only */}
      <div className="demo-block">
        <p className="demo-label">⚙️ Dev shortcut — load demo data without recording</p>
        <button type="button" className="recorder-button secondary" onClick={loadDemo}>
          Load demo note
        </button>
      </div>

      {/* Consultation history */}
      <ConsultationHistory
        onOpen={handleOpenConsultation}
        refreshTrigger={historyRefresh}
      />

    </main>
  )
}

export default App
