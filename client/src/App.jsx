import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import AudioRecorder from './AudioRecorder.jsx'
import ClinicalNoteReview from './ClinicalNoteReview.jsx'
import Dashboard from './Dashboard.jsx'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import PrivateRoute from './components/layout/PrivateRoute.jsx'
import LoginPage from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import PatientListPage from './pages/PatientListPage.jsx'
import NewPatientPage from './pages/NewPatientPage.jsx'
import PatientProfilePage from './pages/PatientProfilePage.jsx'
import NewConsultationPage from './pages/NewConsultationPage.jsx'
import { apiFetch, apiUrl } from './api.js'
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
// TopBar — shown on every authenticated screen
// ---------------------------------------------------------------------------
function TopBar({ apiStatus }) {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="app-topbar">
      <div className="app-topbar-brand">
        <span className="app-logo-mark" aria-hidden="true">VS</span>
        <span className="app-brand-name">VoiceScribe</span>
      </div>
      <span className="app-topbar-sub">Clinical documentation assistant</span>
      <nav className="app-topbar-nav" aria-label="Main navigation">
        <Link to="/dashboard"         className="app-nav-link">Consultations</Link>
        <Link to="/consultation/new"  className="app-nav-link">New consultation</Link>
        <Link to="/patients"          className="app-nav-link">Patients</Link>
      </nav>
      <div className="app-topbar-right">
        {apiStatus && (
          <>
            <span className="app-api-dot" title={apiStatus} aria-label={`API status: ${apiStatus}`} />
            <span className="app-api-label">{apiStatus}</span>
          </>
        )}
        {user && (
          <div className="app-user-chip">
            <span className="app-user-name">{user.displayName}</span>
            <button
              type="button"
              className="app-logout-btn"
              onClick={handleLogout}
              aria-label="Sign out"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// DashboardApp — the entire V1 consultation workflow, now behind auth
// ---------------------------------------------------------------------------
function DashboardApp() {
  const [apiStatus, setApiStatus] = useState('Checking API…')
  const [stage, setStageRaw]      = useState(STAGE.DASHBOARD)

  function setStage(next) {
    stageRef.current = next
    setStageRaw(next)
  }

  const [pipelineStep, setPipelineStep]   = useState('')
  const [pipelineError, setPipelineError] = useState('')
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
  const [dashboardRefresh, setDashboardRefresh]         = useState(0)

  const stageRef = useRef(STAGE.DASHBOARD)

  // ── Health-check ──────────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch('/api/health')
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
    setPendingObjectKey(objectKey)
    setPendingTranscript(rawTranscript)
    setPipelineStep('analyzing')
    setPipelineError('')
    setProcessingFailed(false)
    await delay(400)
    await runBedrockExtraction(objectKey, rawTranscript)
  }

  async function runBedrockExtraction(objectKey, rawTranscript) {
    setPipelineStep('extracting')
    setPipelineError('')
    setProcessingFailed(false)

    try {
      const res  = await apiFetch('/api/extract-note', {
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

  function handleRetryExtraction() {
    if (!pendingTranscript) return
    runBedrockExtraction(pendingObjectKey, pendingTranscript)
  }

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

  async function handleOpenConsultation(summary) {
    try {
      const res  = await apiFetch(`/api/consultations/${summary._id}`)
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

  function handleSaved(id) {
    setActiveConsultationId(id)
    setDashboardRefresh((n) => n + 1)
  }

  // ==========================================================================
  // PROCESSING SCREEN
  // ==========================================================================
  if (stage === STAGE.PROCESSING) {
    const activeIndex   = PIPELINE_STEPS.findIndex((s) => s.key === pipelineStep)
    const resolvedActive = activeIndex >= 0 ? activeIndex : 0

    return (
      <div className="app-shell">
        <TopBar apiStatus={null} />
        <main className="page page--centered">
          <div className="pipeline-card">
            <p className="pipeline-title">
              {processingFailed ? 'Processing stopped' : 'Processing consultation…'}
            </p>

            <ol className="pipeline-steps" aria-label="Pipeline progress">
              {PIPELINE_STEPS.map(({ key, label }, idx) => {
                const isDone   = idx < resolvedActive
                const isActive = idx === resolvedActive && !processingFailed
                const isFailed = processingFailed && idx === resolvedActive
                const cls = isFailed ? 'is-failed' : isDone ? 'is-done' : isActive ? 'is-active' : ''
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

            {processingFailed && pipelineError && (
              <div className="pipeline-error-block" role="alert">
                <p className="pipeline-error-msg">{pipelineError}</p>
                <div className="pipeline-error-actions">
                  {pendingTranscript && (
                    <button type="button" className="pipeline-retry-btn" onClick={handleRetryExtraction}>
                      Try again
                    </button>
                  )}
                  <button type="button" className="pipeline-manual-btn" onClick={handleContinueManually}>
                    Fill in note manually
                  </button>
                  <button
                    type="button"
                    className="pipeline-back-btn"
                    onClick={() => { handleBack(); setStage(STAGE.RECORDING) }}
                  >
                    ← Back to recording
                  </button>
                </div>
              </div>
            )}

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
        <TopBar apiStatus={null} />
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
  // DASHBOARD (default)
  // ==========================================================================
  const showRecorder = stage === STAGE.RECORDING

  return (
    <div className="app-shell">
      <TopBar apiStatus={apiStatus} />

      <main className="app-workspace">
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

          <ol className="stepper" aria-label="Workflow steps">
            {['Record', 'Transcribe', 'Extract note', 'Review & Approve'].map((label, idx) => (
              <li key={label} className={`stepper-item ${idx === 0 && showRecorder ? 'is-active' : idx === 0 && !showRecorder ? 'is-idle' : ''}`}>
                <span className="stepper-circle" aria-hidden="true">{idx + 1}</span>
                <span className="stepper-label">{label}</span>
              </li>
            ))}
          </ol>

          {showRecorder ? (
            <AudioRecorder
              onTranscriptReady={handleTranscriptReady}
              onStageChange={handleStageChange}
            />
          ) : (
            <div className="workspace-start-card">
              <button type="button" className="ws-start-btn" onClick={() => setStage(STAGE.RECORDING)}>
                <span className="ws-start-icon" aria-hidden="true">🎙</span>
                Start recording
              </button>
              <p className="ws-start-hint">Microphone access will be requested when you start.</p>
            </div>
          )}

          <div className="demo-block">
            <p className="demo-label">⚙️ Dev shortcut — load demo data without recording</p>
            <button type="button" className="recorder-button secondary small" onClick={loadDemo}>
              Load demo note
            </button>
          </div>
        </aside>

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

// ---------------------------------------------------------------------------
// App root — Router + AuthProvider + routes
// ---------------------------------------------------------------------------
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Protected routes */}
          <Route element={<PrivateRoute />}>
            <Route path="/dashboard"        element={<DashboardApp />} />
            <Route path="/consultation/new" element={<NewConsultationPage />} />
            <Route path="/patients"         element={<PatientListPage />} />
            <Route path="/patients/new"     element={<NewPatientPage />} />
            <Route path="/patients/:id"     element={<PatientProfilePage />} />
          </Route>

          {/* Default redirect */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
