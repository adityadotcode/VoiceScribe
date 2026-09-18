import { useEffect, useState } from 'react'
import AudioRecorder from './AudioRecorder.jsx'
import ClinicalNoteReview from './ClinicalNoteReview.jsx'
import Dashboard from './Dashboard.jsx'
import './App.css'

// ---------------------------------------------------------------------------
// Demo data — ONLY for the offline "Load demo note" shortcut.
// Never used in the real pipeline. Not a real AI output.
// ---------------------------------------------------------------------------
const DEMO_TRANSCRIPT =
  "Hello, sir. I'm having a fever for the last three days and cough for two days. I also feel tired."

const DEMO_NOTE = {
  patient: { name: '', age: null, sex: '' },
  chief_complaint: 'Fever for three days with cough',
  symptoms: ['fever', 'cough', 'fatigue'],
  duration: 'fever for three days; cough for two days',
  history: '',
  observations: [],
  assessment: '',
  medications_mentioned: [],
  follow_up: '',
  missing_information: ['patient name', 'patient age', 'patient sex'],
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
// Pipeline stages
// ---------------------------------------------------------------------------
const STAGE = { DASHBOARD: 'dashboard', RECORDING: 'recording', PROCESSING: 'processing', REVIEW: 'review' }

const PIPELINE_STEPS = [
  { key: 'uploading',    label: 'Uploading to S3'          },
  { key: 'transcribing', label: 'Transcribing audio'        },
  { key: 'extracting',   label: 'Extracting clinical note'  },
  { key: 'ready',        label: 'Ready for doctor review'   },
]

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [apiStatus, setApiStatus] = useState('Checking API…')
  const [stage, setStage]         = useState(STAGE.DASHBOARD)

  const [pipelineStep, setPipelineStep]   = useState('')
  const [pipelineError, setPipelineError] = useState('')

  const [transcript, setTranscript]                     = useState('')
  const [note, setNote]                                 = useState(null)
  const [isDemo, setIsDemo]                             = useState(false)
  const [bedrockFailed, setBedrockFailed]               = useState(false)
  const [activeConsultationId, setActiveConsultationId] = useState(null)
  const [detectedLanguages, setDetectedLanguages]       = useState([])

  // Bump to force Dashboard to re-fetch after a save/approve
  const [dashboardRefresh, setDashboardRefresh] = useState(0)

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
      setStage(STAGE.RECORDING)
      setPipelineStep('')
      setPipelineError('')
    }
  }

  // ── Transcript ready → call Bedrock ───────────────────────────────────────
  async function handleTranscriptReady(objectKey, rawTranscript, langs = []) {
    setTranscript(rawTranscript)
    setDetectedLanguages(langs)
    setPipelineStep('extracting')
    setPipelineError('')

    try {
      const res  = await fetch('/api/extract-note', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ transcript: rawTranscript }),
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
        openReview()
        return
      }

      setNote(data.note)
      setBedrockFailed(false)
      setActiveConsultationId(null)
      setIsDemo(false)
      setPipelineStep('ready')
      await delay(500)
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
    setDetectedLanguages([])
    setStage(STAGE.REVIEW)
  }

  // ── Open from dashboard ───────────────────────────────────────────────────
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
      setDetectedLanguages([])
      setStage(STAGE.REVIEW)
    } catch {
      alert('Network error — could not load consultation.')
    }
  }

  // ── Back to dashboard ─────────────────────────────────────────────────────
  function handleBack() {
    setStage(STAGE.DASHBOARD)
    setTranscript('')
    setNote(null)
    setBedrockFailed(false)
    setActiveConsultationId(null)
    setIsDemo(false)
    setDetectedLanguages([])
    setPipelineStep('')
    setPipelineError('')
  }

  // ── After save/approve — refresh dashboard ────────────────────────────────
  function handleSaved(id) {
    setActiveConsultationId(id)
    setDashboardRefresh((n) => n + 1)
  }

  // ==========================================================================
  // PROCESSING SCREEN
  // ==========================================================================
  if (stage === STAGE.PROCESSING) {
    const activeIndex = PIPELINE_STEPS.findIndex((s) => s.key === pipelineStep)

    return (
      <div className="app-shell">
        <header className="app-topbar">
          <div className="app-topbar-brand">
            <span className="app-logo-mark" aria-hidden="true">VS</span>
            <span className="app-brand-name">VoiceScribe</span>
          </div>
          <span className="app-topbar-sub">Clinical documentation assistant</span>
        </header>

        <main className="page page--centered">
          <div className="pipeline-card">
            <p className="pipeline-title">Processing consultation…</p>
            <ol className="pipeline-steps" aria-label="Pipeline progress">
              {PIPELINE_STEPS.map(({ key, label }, idx) => {
                const isDone   = idx < activeIndex
                const isActive = idx === activeIndex
                const cls = isDone ? 'is-done' : isActive ? 'is-active' : ''
                return (
                  <li key={key} className={`pipeline-step ${cls}`}>
                    <span className="pipeline-step-icon" aria-hidden="true">
                      {isDone ? '✓' : idx + 1}
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
      </div>
    )
  }

  // ==========================================================================
  // REVIEW SCREEN
  // ==========================================================================
  if (stage === STAGE.REVIEW && note) {
    return (
      <div className="app-shell">
        <header className="app-topbar">
          <div className="app-topbar-brand">
            <span className="app-logo-mark" aria-hidden="true">VS</span>
            <span className="app-brand-name">VoiceScribe</span>
          </div>
          <span className="app-topbar-sub">Clinical documentation assistant</span>
        </header>

        <main className="page page--review">
          <ClinicalNoteReview
            note={note}
            transcript={transcript}
            isDemo={isDemo}
            bedrockFailed={bedrockFailed}
            detectedLanguages={detectedLanguages}
            initialConsultationId={activeConsultationId}
            onBack={handleBack}
            onSaved={handleSaved}
          />
        </main>
      </div>
    )
  }

  // ==========================================================================
  // RECORDING PANEL — shown inline in the workspace when recording is active
  // ==========================================================================
  const showRecorder = stage === STAGE.RECORDING

  // ==========================================================================
  // DASHBOARD (default)
  // ==========================================================================
  return (
    <div className="app-shell">

      {/* ── Top bar ── */}
      <header className="app-topbar">
        <div className="app-topbar-brand">
          <span className="app-logo-mark" aria-hidden="true">VS</span>
          <span className="app-brand-name">VoiceScribe</span>
        </div>
        <span className="app-topbar-sub">Clinical documentation assistant</span>
        <div className="app-topbar-right">
          <span className="app-api-dot" title={apiStatus} aria-label={`API status: ${apiStatus}`} />
          <span className="app-api-label">{apiStatus}</span>
        </div>
      </header>

      <main className="app-workspace">

        {/* ── Left column: hero + recorder ── */}
        <aside className="workspace-left">

          <div className="workspace-hero">
            <h1 className="workspace-hero-title">
              {showRecorder ? 'Recording consultation' : 'New consultation'}
            </h1>
            <p className="workspace-hero-sub">
              Record a consultation and VoiceScribe will generate a structured
              clinical note for your review.
            </p>
            <p className="workspace-safety">
              <span aria-hidden="true">🔒</span>
              VoiceScribe does not diagnose or prescribe.
              All notes require doctor review and approval.
            </p>
          </div>

          {/* Workflow steps */}
          <ol className="stepper" aria-label="Workflow steps">
            {['Record', 'Transcribe', 'Extract note', 'Review & Approve'].map((label, idx) => (
              <li key={label} className={`stepper-item ${idx === 0 && showRecorder ? 'is-active' : idx === 0 && !showRecorder ? 'is-idle' : ''}`}>
                <span className="stepper-circle" aria-hidden="true">{idx + 1}</span>
                <span className="stepper-label">{label}</span>
              </li>
            ))}
          </ol>

          {/* Recorder or "start" prompt */}
          {showRecorder ? (
            <AudioRecorder
              onTranscriptReady={handleTranscriptReady}
              onStageChange={handleStageChange}
            />
          ) : (
            <div className="workspace-start-card">
              <button
                type="button"
                className="ws-start-btn"
                onClick={() => setStage(STAGE.RECORDING)}
              >
                <span className="ws-start-icon" aria-hidden="true">🎙</span>
                Start recording
              </button>
              <p className="ws-start-hint">
                Microphone access will be requested when you start.
              </p>
            </div>
          )}

          {/* Demo shortcut — clearly secondary, dev-only */}
          <div className="demo-block">
            <p className="demo-label">⚙️ Dev shortcut — load demo data without recording</p>
            <button type="button" className="recorder-button secondary small" onClick={loadDemo}>
              Load demo note
            </button>
          </div>

        </aside>

        {/* ── Right column: dashboard ── */}
        <section className="workspace-right">
          <Dashboard
            onOpen={handleOpenConsultation}
            onNewConsultation={() => setStage(STAGE.RECORDING)}
            refreshTrigger={dashboardRefresh}
          />
        </section>

      </main>
    </div>
  )
}

export default App
