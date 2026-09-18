import { useEffect, useMemo, useReducer, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'voicescribe_draft_note'

const STATUS = {
  DRAFT:    'Draft',
  APPROVED: 'Approved',
}

// The three statements the doctor must confirm before approving.
// Stored as an ordered array so the index serves as the checkbox key.
const CHECKLIST_ITEMS = [
  'I reviewed the extracted information against the transcript.',
  'I verified that the important fields are accurate.',
  'I understand that VoiceScribe provides documentation assistance only and does not diagnose or prescribe.',
]

// ---------------------------------------------------------------------------
// Evidence map — built from the real transcript, nothing invented
// ---------------------------------------------------------------------------
function buildEvidenceMap(transcript) {
  if (!transcript) return {}
  const evidence = {}
  const PATTERNS = [
    ['fever',                /fever[^.]*?(?:\.|$)/i],
    ['cough',                /cough[^.]*?(?:\.|$)/i],
    ['fatigue',              /(?:tired|fatigue|exhausted)[^.]*?(?:\.|$)/i],
    ['tired',                /(?:tired|fatigue|exhausted)[^.]*?(?:\.|$)/i],
    ['pain',                 /pain[^.]*?(?:\.|$)/i],
    ['headache',             /headache[^.]*?(?:\.|$)/i],
    ['nausea',               /nausea[^.]*?(?:\.|$)/i],
    ['vomit',                /vomit[^.]*?(?:\.|$)/i],
    ['diarrhea',             /diarr?hoe?a[^.]*?(?:\.|$)/i],
    ['breathless',           /breath[^.]*?(?:\.|$)/i],
    ['shortness of breath',  /breath[^.]*?(?:\.|$)/i],
  ]
  for (const [key, pattern] of PATTERNS) {
    const match = transcript.match(pattern)
    if (match) {
      const phrase = match[0].trim().replace(/\.$/, '')
      if (phrase) evidence[key.toLowerCase()] = phrase
    }
  }
  return evidence
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------
function noteReducer(state, action) {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value }
    case 'SET_PATIENT_FIELD':
      return { ...state, patient: { ...state.patient, [action.field]: action.value } }
    case 'SET_ARRAY_ITEM': {
      const arr = [...state[action.field]]
      arr[action.index] = action.value
      return { ...state, [action.field]: arr }
    }
    case 'ADD_ARRAY_ITEM':
      return { ...state, [action.field]: [...state[action.field], ''] }
    case 'REMOVE_ARRAY_ITEM':
      return { ...state, [action.field]: state[action.field].filter((_, i) => i !== action.index) }
    case 'RESET':
      return action.note
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Small reusable form elements
// ---------------------------------------------------------------------------
function Field({ label, id, value, onChange, placeholder, required, disabled }) {
  return (
    <div className="cnr-field">
      <label htmlFor={id} className="cnr-label">
        {label}
        {required && <span className="cnr-required" aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        className="cnr-input"
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''}
        disabled={disabled}
        aria-required={required ? 'true' : undefined}
      />
    </div>
  )
}

function TextArea({ label, id, value, onChange, placeholder, rows = 3, disabled }) {
  return (
    <div className="cnr-field">
      <label htmlFor={id} className="cnr-label">{label}</label>
      <textarea
        id={id}
        className="cnr-textarea"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''}
        rows={rows}
        disabled={disabled}
      />
    </div>
  )
}

function EditableList({ label, fieldKey, items, dispatch, evidenceMap, disabled }) {
  return (
    <div className="cnr-field">
      <span className="cnr-label">{label}</span>
      {items.length === 0 && <p className="cnr-empty">None recorded</p>}
      <ul className="cnr-list">
        {items.map((item, idx) => {
          const evidence = evidenceMap?.[( item || '').toLowerCase().trim()]
          return (
            <li key={idx} className="cnr-list-item">
              <div className="cnr-list-row">
                <input
                  className="cnr-input cnr-list-input"
                  type="text"
                  value={item}
                  aria-label={`${label} item ${idx + 1}`}
                  disabled={disabled}
                  onChange={(e) =>
                    dispatch({ type: 'SET_ARRAY_ITEM', field: fieldKey, index: idx, value: e.target.value })
                  }
                />
                {!disabled && (
                  <button
                    type="button"
                    className="cnr-icon-btn cnr-remove-btn"
                    aria-label={`Remove ${item || 'item'}`}
                    onClick={() => dispatch({ type: 'REMOVE_ARRAY_ITEM', field: fieldKey, index: idx })}
                  >✕</button>
                )}
              </div>
              {evidence && (
                <p className="cnr-evidence">
                  <span className="cnr-evidence-icon" aria-hidden="true">🔍</span>
                  &ldquo;{evidence}&rdquo;
                </p>
              )}
            </li>
          )
        })}
      </ul>
      {!disabled && (
        <button
          type="button"
          className="cnr-add-btn"
          onClick={() => dispatch({ type: 'ADD_ARRAY_ITEM', field: fieldKey })}
        >+ Add item</button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function apiSave(consultationId, payload) {
  if (consultationId) {
    const res = await fetch(`/api/consultations/${consultationId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.json()
  }
  const res = await fetch('/api/consultations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.json()
}

// ---------------------------------------------------------------------------
// ApprovalChecklist
// ---------------------------------------------------------------------------
/**
 * Three doctor-confirmation checkboxes required before Approve & Finalize.
 *
 * Props:
 *   checked   {object}  { 0: bool, 1: bool, 2: bool }
 *   onChange  {fn(idx)} toggle a single item
 *   disabled  {bool}    true when consultation is already approved
 *   approved  {bool}    true → show collapsed read-only approved state
 */
function ApprovalChecklist({ checked, onChange, disabled, approved }) {
  const allChecked = CHECKLIST_ITEMS.every((_, i) => checked[i])

  if (approved) {
    return (
      <div className="cnr-checklist cnr-checklist--approved" aria-label="Approval checklist">
        <span className="cnr-checklist-approved-label">
          <span aria-hidden="true">✅</span> Doctor review confirmed and note approved.
        </span>
      </div>
    )
  }

  return (
    <fieldset
      className={`cnr-checklist ${allChecked ? 'cnr-checklist--complete' : ''}`}
      aria-label="Approval checklist"
      disabled={disabled}
    >
      <legend className="cnr-checklist-legend">
        <span aria-hidden="true">📋</span> Doctor approval checklist
        <span className="cnr-checklist-required-note">
          — all items required before approving
        </span>
      </legend>

      <ul className="cnr-checklist-list" role="list">
        {CHECKLIST_ITEMS.map((label, idx) => (
          <li key={idx} className="cnr-checklist-item">
            <label className={`cnr-checklist-label ${checked[idx] ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                className="cnr-checklist-input"
                checked={checked[idx] ?? false}
                onChange={() => onChange(idx)}
                disabled={disabled}
                aria-label={label}
              />
              <span className="cnr-checklist-box" aria-hidden="true">
                {checked[idx] ? '✓' : ''}
              </span>
              <span className="cnr-checklist-text">{label}</span>
            </label>
          </li>
        ))}
      </ul>

      {!allChecked && (
        <p className="cnr-checklist-hint" aria-live="polite">
          Complete all items above to enable Approve &amp; finalize.
        </p>
      )}
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// LanguageIndicator — shows detected languages from Amazon Transcribe
// ---------------------------------------------------------------------------
/**
 * Displays the languages detected by Amazon Transcribe's IdentifyMultipleLanguages.
 *
 * Props:
 *   languages  {Array<{code: string, duration: number|null}>}
 *              Sorted by duration descending (primary language first).
 *              Empty array → nothing shown.
 */
function LanguageIndicator({ languages }) {
  if (!Array.isArray(languages) || languages.length === 0) return null

  // Human-readable label map for the two supported languages
  const LANG_LABELS = {
    'en-IN': 'English (India)',
    'hi-IN': 'Hindi',
    'en-US': 'English (US)',
    'en-GB': 'English (UK)',
  }

  return (
    <div className="cnr-lang-indicator" aria-label="Detected languages">
      <span className="cnr-lang-icon" aria-hidden="true">🌐</span>
      <span className="cnr-lang-label">Languages detected:</span>
      <span className="cnr-lang-chips">
        {languages.map(({ code, duration }) => (
          <span key={code} className="cnr-lang-chip" title={duration != null ? `~${Math.round(duration)} s spoken` : undefined}>
            {LANG_LABELS[code] ?? code}
          </span>
        ))}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ExtractionSummary — pure calculation, no API calls
// ---------------------------------------------------------------------------
/**
 * Counts how many note fields have real content vs are missing or uncertain.
 * Numbers are calculated from the actual note — nothing is hard-coded.
 */
function ExtractionSummary({ noteState, isDemo }) {
  const summary = useMemo(() => {
    const stringFields = [
      noteState.patient?.name,
      noteState.patient?.sex,
      noteState.chief_complaint,
      noteState.duration,
      noteState.history,
      noteState.assessment,
      noteState.follow_up,
    ]
    const arrayFields = [
      noteState.symptoms,
      noteState.observations,
      noteState.medications_mentioned,
    ]
    const agePresent = noteState.patient?.age !== null && noteState.patient?.age !== undefined && noteState.patient?.age !== ''

    let extracted = 0
    if (agePresent) extracted++
    stringFields.forEach((f) => { if (f && String(f).trim()) extracted++ })
    arrayFields.forEach((a) => { if (Array.isArray(a) && a.length > 0) extracted++ })

    const missing  = noteState.missing_information?.length ?? 0
    const uncertain = noteState.uncertain_fields?.length ?? 0

    return { extracted, missing, uncertain }
  }, [noteState])

  return (
    <div className="cnr-extraction-summary" aria-label="Extraction quality summary">
      <span className="cnr-summary-title">Extraction summary</span>
      {isDemo && <span className="cnr-summary-demo-tag">DEMO</span>}
      <div className="cnr-summary-chips">
        <span className="cnr-summary-chip cnr-summary-chip--ok">
          ✓ {summary.extracted} field{summary.extracted !== 1 ? 's' : ''} extracted
        </span>
        {summary.missing > 0 && (
          <span className="cnr-summary-chip cnr-summary-chip--warn">
            ⚠ {summary.missing} field{summary.missing !== 1 ? 's' : ''} missing
          </span>
        )}
        {summary.uncertain > 0 && (
          <span className="cnr-summary-chip cnr-summary-chip--review">
            ⚠ {summary.uncertain} field{summary.uncertain !== 1 ? 's' : ''} needs review
          </span>
        )}
        {summary.missing === 0 && summary.uncertain === 0 && (
          <span className="cnr-summary-chip cnr-summary-chip--ok">
            ✓ No issues flagged
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
/**
 * ClinicalNoteReview
 *
 * Props:
 *   note                  {object}       Structured clinical note
 *   transcript            {string}       Original transcript (read-only)
 *   isDemo                {boolean}      Show DEMO DATA banner
 *   bedrockFailed         {boolean}      True when Bedrock extraction failed;
 *                                        shows a manual-entry notice
 *   initialConsultationId {string|null}  MongoDB _id if opening a saved doc
 *   onBack                {function}     Called on "← Back"
 *   onSaved               {function(id)} Called after every successful API save
 */
function ClinicalNoteReview({
  note,
  transcript,
  isDemo = false,
  bedrockFailed = false,
  detectedLanguages = [],
  initialConsultationId = null,
  onBack,
  onSaved,
}) {
  const [noteState, dispatch]   = useReducer(noteReducer, note)
  const [noteStatus, setNoteStatus] = useState(STATUS.DRAFT)
  const [consultationId, setConsultationId] = useState(initialConsultationId)
  const [isSaving, setIsSaving] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [saveMessage, setSaveMessage]  = useState('')
  const [saveError, setSaveError]      = useState('')
  const saveTimerRef = useRef(null)

  // Approval checklist — one boolean per CHECKLIST_ITEMS entry.
  // Starts all-false; reset whenever the component represents a fresh draft.
  const [checklist, setChecklist] = useState({ 0: false, 1: false, 2: false })

  function toggleChecklistItem(idx) {
    setChecklist((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  const allChecklistChecked = CHECKLIST_ITEMS.every((_, i) => checklist[i])

  // Restore draft from localStorage on first mount (same transcript prefix)
  useEffect(() => {
    if (initialConsultationId) return  // opened from history — don't overwrite
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && parsed._transcript === transcript?.slice(0, 80)) {
          dispatch({ type: 'RESET', note: parsed })
          setNoteStatus(parsed._status || STATUS.DRAFT)
          if (parsed._id) setConsultationId(parsed._id)
        }
      }
    } catch { /* malformed — ignore */ }
  }, [transcript, initialConsultationId])

  // Initialise status when opening an already-approved doc from history
  useEffect(() => {
    if (note?._status === 'approved' || note?.status === 'approved') {
      setNoteStatus(STATUS.APPROVED)
    }
  }, [note])

  // Reset checklist whenever a fresh (non-approved) draft is opened.
  // If opened from history and already approved, keep checklist irrelevant.
  useEffect(() => {
    if (!initialConsultationId) {
      setChecklist({ 0: false, 1: false, 2: false })
    }
  }, [initialConsultationId, transcript])

  useEffect(() => () => clearTimeout(saveTimerRef.current), [])

  const evidenceMap = buildEvidenceMap(transcript)
  const isApproved  = noteStatus === STATUS.APPROVED

  // ── localStorage mirror ──────────────────────────────────────────────────
  function persistLocal(state, status, id) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...state,
        _transcript: transcript?.slice(0, 80),
        _status: status,
        _id: id ?? null,
      }))
    } catch { /* quota exceeded — fail silently */ }
  }

  // ── Flash a timed message ────────────────────────────────────────────────
  function flashMessage(msg) {
    setSaveMessage(msg)
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => setSaveMessage(''), 4000)
  }

  // ── Save draft ───────────────────────────────────────────────────────────
  async function saveDraft() {
    setIsSaving(true)
    setSaveError('')
    setValidationError('')

    const payload = { transcript, note: noteState, status: 'draft' }

    try {
      const data = await apiSave(consultationId, payload)
      if (!data.success) {
        setSaveError(data.message || 'Save failed.')
        setIsSaving(false)
        return
      }
      const id = data.consultation._id
      setConsultationId(id)
      persistLocal(noteState, STATUS.DRAFT, id)
      flashMessage(`Draft saved. ID: ${id}`)
      onSaved?.(id)
    } catch {
      setSaveError('Network error — draft not saved.')
    }

    setIsSaving(false)
  }

  // ── Approve ──────────────────────────────────────────────────────────────
  async function approveNote() {
    setValidationError('')
    setSaveError('')

    if (!noteState.chief_complaint?.trim()) {
      setValidationError('Chief complaint is required before approving.')
      return
    }

    setIsSaving(true)
    const payload = { transcript, note: noteState, status: 'approved' }

    try {
      const data = await apiSave(consultationId, payload)
      if (!data.success) {
        setSaveError(data.message || 'Approval failed.')
        setIsSaving(false)
        return
      }
      const id = data.consultation._id
      setConsultationId(id)
      setNoteStatus(STATUS.APPROVED)
      persistLocal(noteState, STATUS.APPROVED, id)
      setSaveMessage(`✅ Approved and saved. ID: ${id}`)
      onSaved?.(id)
    } catch {
      setSaveError('Network error — approval not saved.')
    }

    setIsSaving(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="cnr-wrapper">

      {/* AI draft banner */}
      <div className="cnr-draft-banner" role="status">
        <span aria-hidden="true">⚠️</span>
        AI-generated draft — Doctor review required
      </div>

      {/* Demo notice */}
      {isDemo && (
        <div className="cnr-demo-banner" role="status">
          <strong>DEMO DATA</strong> — Generated from a hardcoded sample transcript.
          Not a real AI output.
        </div>
      )}

      {/* Bedrock extraction failed — manual entry required */}
      {bedrockFailed && !isDemo && (
        <div className="cnr-bedrock-failed-banner" role="alert">
          <strong>Note extraction unavailable.</strong> The transcript has been preserved
          in the panel on the right. Please review the transcript and fill in the
          clinical note fields manually before approving.
        </div>
      )}

      {/* Safety statement */}
      <p className="cnr-safety">
        VoiceScribe does not diagnose or prescribe. The doctor reviews and
        approves the documentation.
      </p>

      {/* Top bar */}
      <div className="cnr-topbar">
        <button type="button" className="cnr-back-btn" onClick={onBack}>
          ← Back
        </button>
        <div className="cnr-topbar-right">
          {consultationId && (
            <span className="cnr-db-id" title="MongoDB document ID">
              ID: <code>{consultationId}</code>
            </span>
          )}
          <span className={`cnr-status-pill cnr-status-${noteStatus.toLowerCase()}`}>
            {noteStatus}
          </span>
        </div>
      </div>

      {/* Approved banner */}
      {isApproved && (
        <div className="cnr-approved-banner" role="status">
          <span aria-hidden="true">✅</span> Note approved and finalized.
          No further changes are permitted.
        </div>
      )}

      {/* Extraction quality summary */}
      <ExtractionSummary noteState={noteState} isDemo={isDemo} />

      {/* Two-column layout */}
      <div className="cnr-layout">

        {/* Left: editable note */}
        <section className="cnr-note-panel" aria-label="Clinical note editor">
          <h2 className="cnr-panel-title">Clinical Note</h2>

          {/* Patient */}
          <fieldset className="cnr-fieldset">
            <legend className="cnr-legend">Patient</legend>
            <div className="cnr-row">
              <Field label="Name"   id="patient-name" value={noteState.patient?.name}
                onChange={(v) => dispatch({ type: 'SET_PATIENT_FIELD', field: 'name', value: v })}
                placeholder="Not stated" disabled={isApproved} />
              <Field label="Age"    id="patient-age"  value={noteState.patient?.age ?? ''}
                onChange={(v) => dispatch({
                  type: 'SET_PATIENT_FIELD', field: 'age',
                  value: v === '' ? null : Number(v),
                })}
                placeholder="Not stated" disabled={isApproved} />
              <Field label="Sex"    id="patient-sex"  value={noteState.patient?.sex}
                onChange={(v) => dispatch({ type: 'SET_PATIENT_FIELD', field: 'sex', value: v })}
                placeholder="Not stated" disabled={isApproved} />
            </div>
          </fieldset>

          {/* Consultation */}
          <fieldset className="cnr-fieldset">
            <legend className="cnr-legend">Consultation</legend>
            <Field label="Chief complaint" id="chief-complaint"
              value={noteState.chief_complaint}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'chief_complaint', value: v })}
              placeholder="Primary reason for visit" required disabled={isApproved} />
            <EditableList label="Symptoms" fieldKey="symptoms"
              items={noteState.symptoms ?? []} dispatch={dispatch}
              evidenceMap={evidenceMap} disabled={isApproved} />
            <Field label="Duration / onset" id="duration" value={noteState.duration}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'duration', value: v })}
              placeholder="e.g. fever for 3 days" disabled={isApproved} />
            <TextArea label="Relevant history" id="history" value={noteState.history}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'history', value: v })}
              placeholder="Past medical history mentioned in the consultation"
              disabled={isApproved} />
          </fieldset>

          {/* Clinical findings */}
          <fieldset className="cnr-fieldset">
            <legend className="cnr-legend">Clinical findings</legend>
            <EditableList label="Observations" fieldKey="observations"
              items={noteState.observations ?? []} dispatch={dispatch}
              evidenceMap={evidenceMap} disabled={isApproved} />
            <TextArea label="Assessment" id="assessment" value={noteState.assessment}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'assessment', value: v })}
              placeholder="Clinician's assessment as stated in the consultation"
              rows={4} disabled={isApproved} />
            <EditableList label="Medications mentioned" fieldKey="medications_mentioned"
              items={noteState.medications_mentioned ?? []} dispatch={dispatch}
              evidenceMap={null} disabled={isApproved} />
            <Field label="Follow-up" id="follow-up" value={noteState.follow_up}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'follow_up', value: v })}
              placeholder="Follow-up instructions stated in the consultation"
              disabled={isApproved} />
          </fieldset>

          {/* Quality flags */}
          <fieldset className="cnr-fieldset cnr-fieldset--flags">
            <legend className="cnr-legend cnr-legend--flags">⚠ Quality flags</legend>
            <EditableList label="Missing information" fieldKey="missing_information"
              items={noteState.missing_information ?? []} dispatch={dispatch}
              evidenceMap={null} disabled={isApproved} />
            <EditableList label="Uncertain fields" fieldKey="uncertain_fields"
              items={noteState.uncertain_fields ?? []} dispatch={dispatch}
              evidenceMap={null} disabled={isApproved} />
          </fieldset>

          {/* Action footer */}
          {!isApproved && (
            <div className="cnr-actions">
              {validationError && (
                <p className="cnr-validation-error" role="alert">{validationError}</p>
              )}
              {saveError && (
                <p className="cnr-validation-error" role="alert">{saveError}</p>
              )}
              {saveMessage && (
                <p className="cnr-save-message" role="status">{saveMessage}</p>
              )}

              {/* Approval checklist — must be complete before approving */}
              <ApprovalChecklist
                checked={checklist}
                onChange={toggleChecklistItem}
                disabled={isSaving}
                approved={false}
              />

              <div className="cnr-action-row">
                <button type="button" className="cnr-btn cnr-btn-secondary"
                  onClick={saveDraft} disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Save draft'}
                </button>
                <button
                  type="button"
                  className="cnr-btn cnr-btn-primary"
                  onClick={approveNote}
                  disabled={isSaving || !allChecklistChecked}
                  title={!allChecklistChecked ? 'Complete the approval checklist to enable this button.' : undefined}
                  aria-describedby={!allChecklistChecked ? 'checklist-hint' : undefined}
                >
                  {isSaving ? 'Saving…' : 'Approve & finalize'}
                </button>
              </div>
            </div>
          )}

          {isApproved && (
            <div className="cnr-actions">
              {/* Collapsed approved-state checklist */}
              <ApprovalChecklist
                checked={{ 0: true, 1: true, 2: true }}
                onChange={() => {}}
                disabled
                approved
              />
              {saveMessage && (
                <p className="cnr-save-message" role="status">{saveMessage}</p>
              )}
            </div>
          )}
        </section>

        {/* Right: transcript panel */}
        <aside className="cnr-transcript-panel" aria-label="Original transcript">
          <h2 className="cnr-panel-title">Transcript evidence</h2>
          <LanguageIndicator languages={detectedLanguages} />
          <p className="cnr-transcript-hint">
            Read-only. Verify each field against what was actually said.
          </p>
          <div className="cnr-transcript-box" tabIndex={0}>
            {transcript
              ? transcript
              : <span className="cnr-empty">No transcript available.</span>}
          </div>
        </aside>
      </div>
    </div>
  )
}

export default ClinicalNoteReview
