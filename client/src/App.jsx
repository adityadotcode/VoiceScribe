import { useEffect, useRef, useState } from 'react'
import AudioRecorder from './AudioRecorder.jsx'
import ClinicalNoteReview from './ClinicalNoteReview.jsx'
import Dashboard from './Dashboard.jsx'
import { apiUrl } from './api.js'
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
  { key: 'uploading',    label: 'Uploading audio'               },
  { key: 'transcribing', label: 'Transcribing'                   },
  { key: 'analyzing',    label: 'Detecting language and speakers' },
  { key: 'extracting',   label: 'Generating clinical note'        },
  { key: 'ready',        label: 'Ready for review'               },
]

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [apiStatus, setApiStatus] = useState('Checking API…')
  const [stage, setStageRaw]      = useState(STAGE.DASHBOARD)

  // Always use setStage() (not setStageRaw) so stageRef stays in sync.
  // This prevents stale-closure bugs in callbacks registered once (e.g. handleStageChange).
  function setStage(next) {
    stageRef.current = next
    setStageRaw(next)
  }

  const [pipelineStep, setPipelineStep]   = useState('')
  const [pipelineError, setPipelineError] = useState('')
  // Preserved during processing so the Bedrock-retry path can reuse them
  // without requiring a re-upload.
  const [pendingObjectKey, setPendingObjectKey]   = useState('')
  const [pendingTranscript, setPendingTranscript] = useState('')
  const [processingFailed, setProcessingFailed]   = useState(false)

  const [transcript, setTranscript]                     = useState('')
  const [note, setNote]                                 = useState(null)
  const [isDemo, setIsDemo]                             = useState(false)
  const [bedrockFailed, setBedrockFailed]               = useState(false)
  const [activeConsultationId, setActiveConsultationId] = useState(null)
  const [detectedLanguages, setDetectedLanguages]       = useState([])
  const [speakerUtterances, setSpeakerUtterances]       = useState([])
  const [speakerRoleMapping, setSpeakerRoleMapping]     = useState({})

  // Bump to force Dashboard to re-fetch after a save/approve
  const [dashboardRefresh, setDashboardRefresh] = useState(0)

  // Ref that mirrors the current stage value for use inside callbacks
  // (avoids stale-closure bugs where the closure captures the initial value).
  const stageRef = useRef(STAGE.DASHBOARD)

  // ── Health-check ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(apiUrl('/api/health'))
      .then((r) => r.json())
      .then((d) => setApiStatus(d.success ? d.message : 'API responded unexpectedly'))
      .catch(() => setApiStatus('API is not reachable yet'))
  }, [])

  // ── AudioRecorder stage mirror ────────────────────────────────────────────
  function handleStageChange(recorderStage) {
    if (recorderStage === 'uploading' || recorderStage === 'transcribing') {
      setPipelineStep(recorderStage)
      setProcessingFailed(false)
      setPipelineError('')
      setStage(STAGE.PROCESSING)
    }
    if (recorderStage === 'error') {
      // Use stageRef.current (not the stage state variable) to avoid the
      // stale-closure bug where stage is still RECORDING when the async
      // upload/transcription error arrives.
      if (stageRef.current === STAGE.PROCESSING) {
        setProcessingFailed(true)
        setPipelineError('Processing failed. Please check your connection and try again.')
      }
    }
  }

  // ── Transcript ready → call Bedrock ───────────────────────────────────────
  async function handleTranscriptReady(objectKey, rawTranscript, langs = [], utterances = []) {
    setTranscript(rawTranscript)
    setDetectedLanguages(langs)
    setSpeakerUtterances(utterances)
    // Preserve for Bedrock retry without re-uploading / re-transcribing
    setPendingObjectKey(objectKey)
    setPendingTranscript(rawTranscript)
    // 'analyzing' covers the language + speaker data that just came back
    setPipelineStep('analyzing')
    setPipelineError('')
    setProcessingFailed(false)

    // Brief visual pause so the doctor sees 'analyzing' complete before
    // the step advances to 'extracting'. This is not a fake timer —
    // the data has already been processed by this point.
    await delay(400)
    await runBedrockExtraction(objectKey, rawTranscript)
  }

  // Separated so it can be called both from handleTranscriptReady AND from
  // the Retry button without duplicating logic.
  async function runBedrockExtraction(objectKey, rawTranscript) {
    setPipelineStep('extracting')
    setPipelineError('')
    setProcessingFailed(false)

    try {
      const res  = await fetch(apiUrl('/api/extract-note'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ transcript: rawTranscript, objectKey }),
      })
      const data = await res.json()

      if (!res.ok || !data.success) {
        console.warn('[App] /api/extract-note failed:', data.message)
        setPipelineError(
          data.message && data.message.length < 200
            ? data.message
            : 'Unable to generate the clinical note.'
        )
        setProcessingFailed(true)
        // Stay on the processing screen — doctor can retry or continue manually
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
      setPipelineError('Could not reach the note extraction service. Check your connection and try again.')
      setProcessingFailed(true)
    }
  }

  // ── Retry Bedrock extraction using the preserved transcript ───────────────
  function handleRetryExtraction() {
    if (!pendingTranscript) return
    runBedrockExtraction(pendingObjectKey, pendingTranscript)
  }

  // ── Continue to review with a blank note (when Bedrock fails) ─────────────
  function handleContinueManually() {
    setNote(BLANK_NOTE)
    setBedrockFailed(true)
    setActiveConsultationId(null)
    setIsDemo(false)
    openReview()
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
    setSpeakerUtterances([])
    setSpeakerRoleMapping({})
    setStage(STAGE.REVIEW)
  }

  // ── Open from dashboard ───────────────────────────────────────────────────
  async function handleOpenConsultation(summary) {
    try {
      const res  = await fetch(apiUrl(`/api/consultations/${summary._id}`))
      const data = await res.json()
      if (!data.success) { alert(`Could not load consultation: ${data.message}`); return }
      const c = data.consultation
      setTranscript(c.transcript ?? '')
      setNote(c.note ?? BLANK_NOTE)
      setBedrockFailed(false)
      setActiveConsultationId(c._id)
      setIsDemo(false)
      setDetectedLanguages(c.detectedLanguages ?? [])
      setSpeakerUtterances(c.speakerUtterances ?? [])
      setSpeakerRoleMapping(c.speakerRoleMapping ?? {})
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
    setSpeakerUtterances([])
    setSpeakerRoleMapping({})
    setPipelineStep('')
    setPipelineError('')
    setPendingObjectKey('')
    setPendingTranscript('')
    setProcessingFailed(false)
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
    // If no step is active yet (pipelineStep is ''), treat all as pending
    const resolvedActive = activeIndex >= 0 ? activeIndex : 0

    // A recorder-level error (upload/transcription failure) means the
    // AudioRecorder itself is showing the error message, but we are still on
    // the processing screen.  Give the user a clear path back.
    const recorderFailed = pipelineStep === '' && !processingFailed

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
            <p className="pipeline-title">
              {processingFailed
                ? 'Processing stopped'
                : 'Processing consultation…'}
            </p>

            <ol className="pipeline-steps" aria-label="Pipeline progress">
              {PIPELINE_STEPS.map(({ key, label }, idx) => {
                const isDone   = idx < resolvedActive
                const isActive = idx === resolvedActive && !processingFailed
                const isFailed = processingFailed && idx === resolvedActive
                const cls = isFailed ? 'is-failed'
                          : isDone   ? 'is-done'
                          : isActive ? 'is-active'
                          : ''
                return (
                  <li key={key} className={`pipeline-step ${cls}`}>
                    <span className="pipeline-step-icon" aria-hidden="true">
                      {isFailed ? '✕' : isDone ? '✓' : idx + 1}
                    </span>
                    {label}
                    {isActive && key !== 'ready' && (
                      <span className="pipeline-spinner" aria-hidden="true" />
                    )}
                  </li>
                )
              })}
            </ol>

            {/* ── Error state with recovery options ── */}
            {processingFailed && pipelineError && (
              <div className="pipeline-error-block" role="alert">
                <p className="pipeline-error-msg">{pipelineError}</p>
                <div className="pipeline-error-actions">
                  {/* Retry is only possible if we have a preserved transcript */}
                  {pendingTranscript && (
                    <button
                      type="button"
                      className="pipeline-retry-btn"
                      onClick={handleRetryExtraction}
                    >
                      Try again
                    </button>
                  )}
                  <button
                    type="button"
                    className="pipeline-manual-btn"
                    onClick={handleContinueManually}
                    title="Open the review screen and fill in the note manually"
                  >
                    Fill in note manually
                  </button>
                  <button
                    type="button"
                    className="pipeline-back-btn"
                    onClick={() => {
                      handleBack()
                      setStage(STAGE.RECORDING)
                    }}
                  >
                    ← Back to recording
                  </button>
                </div>
              </div>
            )}

            {/* Non-processing error (e.g. upload/transcription failed inline in recorder) */}
            {!processingFailed && pipelineError && (
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
            speakerUtterances={speakerUtterances}
            initialSpeakerRoleMapping={speakerRoleMapping}
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
