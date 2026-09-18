import { useEffect, useReducer, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'voicescribe_draft_note'

const STATUS = {
  DRAFT: 'Draft',
  REVIEWED: 'Reviewed',
  APPROVED: 'Approved',
}

/**
 * Source evidence: maps symptom/field keywords found in the transcript
 * to the verbatim phrase that supports them.
 *
 * Built at runtime from the actual transcript — nothing is invented.
 * If no evidence phrase is found for a value, nothing is shown.
 */
function buildEvidenceMap(transcript) {
  if (!transcript) return {}

  const t = transcript.toLowerCase()
  const evidence = {}

  // Ordered pairs of [keyword-to-match-in-note-value, phrase-to-search-in-transcript]
  const PATTERNS = [
    ['fever',   /fever[^.]*?(?:\.|$)/i],
    ['cough',   /cough[^.]*?(?:\.|$)/i],
    ['fatigue', /(?:tired|fatigue|exhausted)[^.]*?(?:\.|$)/i],
    ['tired',   /(?:tired|fatigue|exhausted)[^.]*?(?:\.|$)/i],
    ['pain',    /pain[^.]*?(?:\.|$)/i],
    ['headache',/headache[^.]*?(?:\.|$)/i],
    ['nausea',  /nausea[^.]*?(?:\.|$)/i],
    ['vomit',   /vomit[^.]*?(?:\.|$)/i],
    ['diarrhea',/diarr?hoe?a[^.]*?(?:\.|$)/i],
    ['breathless', /breath[^.]*?(?:\.|$)/i],
    ['shortness of breath', /breath[^.]*?(?:\.|$)/i],
  ]

  for (const [key, pattern] of PATTERNS) {
    const match = transcript.match(pattern)
    if (match) {
      // Trim whitespace and trailing punctuation for a clean quote
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
      return {
        ...state,
        patient: { ...state.patient, [action.field]: action.value },
      }

    case 'SET_ARRAY_ITEM': {
      const arr = [...state[action.field]]
      arr[action.index] = action.value
      return { ...state, [action.field]: arr }
    }

    case 'ADD_ARRAY_ITEM':
      return { ...state, [action.field]: [...state[action.field], ''] }

    case 'REMOVE_ARRAY_ITEM': {
      const arr = state[action.field].filter((_, i) => i !== action.index)
      return { ...state, [action.field]: arr }
    }

    case 'RESET':
      return action.note

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** A labelled text input */
function Field({ label, id, value, onChange, placeholder, required }) {
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
        aria-required={required ? 'true' : undefined}
      />
    </div>
  )
}

/** A labelled textarea */
function TextArea({ label, id, value, onChange, placeholder, rows = 3 }) {
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
      />
    </div>
  )
}

/**
 * An editable list of strings with optional inline evidence quotes.
 * Evidence is sourced from the transcript only — never invented.
 */
function EditableList({ label, fieldKey, items, dispatch, evidenceMap }) {
  return (
    <div className="cnr-field">
      <span className="cnr-label">{label}</span>
      {items.length === 0 && (
        <p className="cnr-empty">None recorded</p>
      )}
      <ul className="cnr-list">
        {items.map((item, idx) => {
          const evidence = evidenceMap
            ? evidenceMap[(item || '').toLowerCase().trim()]
            : null
          return (
            <li key={idx} className="cnr-list-item">
              <div className="cnr-list-row">
                <input
                  className="cnr-input cnr-list-input"
                  type="text"
                  value={item}
                  aria-label={`${label} item ${idx + 1}`}
                  onChange={(e) =>
                    dispatch({ type: 'SET_ARRAY_ITEM', field: fieldKey, index: idx, value: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="cnr-icon-btn cnr-remove-btn"
                  aria-label={`Remove ${item || 'item'}`}
                  onClick={() =>
                    dispatch({ type: 'REMOVE_ARRAY_ITEM', field: fieldKey, index: idx })
                  }
                >
                  ✕
                </button>
              </div>
              {/* Source evidence — only shown when found in the transcript */}
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
      <button
        type="button"
        className="cnr-add-btn"
        onClick={() => dispatch({ type: 'ADD_ARRAY_ITEM', field: fieldKey })}
      >
        + Add item
      </button>
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
 *   note        {object}   - Structured clinical note (from Bedrock or demo data)
 *   transcript  {string}   - Original transcript text (read-only reference)
 *   isDemo      {boolean}  - When true, shows a DEMO DATA banner
 *   onBack      {function} - Called when the doctor clicks "← Back to recorder"
 */
function ClinicalNoteReview({ note, transcript, isDemo = false, onBack }) {
  const [noteState, dispatch] = useReducer(noteReducer, note)
  const [noteStatus, setNoteStatus] = useState(STATUS.DRAFT)
  const [validationError, setValidationError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const saveTimerRef = useRef(null)

  // On mount, attempt to restore a saved draft from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        // Only restore if it matches the current session (same transcript prefix)
        if (parsed && parsed._transcript === transcript?.slice(0, 80)) {
          dispatch({ type: 'RESET', note: parsed })
          setNoteStatus(parsed._status || STATUS.DRAFT)
        }
      }
    } catch {
      // Malformed localStorage data — ignore
    }
  }, [transcript])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current)
  }, [])

  const evidenceMap = buildEvidenceMap(transcript)

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  function persistToLocalStorage(stateToSave, status) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...stateToSave,
          _transcript: transcript?.slice(0, 80),
          _status: status,
        })
      )
    } catch {
      // Storage quota exceeded or private browsing — fail silently
    }
  }

  function saveDraft() {
    persistToLocalStorage(noteState, noteStatus)
    setSaveMessage('Draft saved.')
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => setSaveMessage(''), 3000)
  }

  function approveNote() {
    setValidationError('')

    // Basic validation: chief complaint should not be empty
    if (!noteState.chief_complaint?.trim()) {
      setValidationError('Chief complaint is required before approving.')
      return
    }

    setNoteStatus(STATUS.APPROVED)
    persistToLocalStorage(noteState, STATUS.APPROVED)
    setSaveMessage('')
  }

  const isApproved = noteStatus === STATUS.APPROVED

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="cnr-wrapper">

      {/* ── AI draft banner ── */}
      <div className="cnr-draft-banner" role="status">
        <span className="cnr-draft-icon" aria-hidden="true">⚠️</span>
        AI-generated draft — Doctor review required
      </div>

      {/* ── Demo data notice ── */}
      {isDemo && (
        <div className="cnr-demo-banner" role="status">
          <strong>DEMO DATA</strong> — This note was generated from a hardcoded
          sample transcript for development purposes. It is not a real AI output.
        </div>
      )}

      {/* ── Safety statement ── */}
      <p className="cnr-safety">
        VoiceScribe does not diagnose or prescribe. The doctor reviews and
        approves the documentation.
      </p>

      {/* ── Status pill + back link ── */}
      <div className="cnr-topbar">
        <button type="button" className="cnr-back-btn" onClick={onBack}>
          ← Back to recorder
        </button>
        <span className={`cnr-status-pill cnr-status-${noteStatus.toLowerCase()}`}>
          {noteStatus}
        </span>
      </div>

      {/* ── Approved success state ── */}
      {isApproved && (
        <div className="cnr-approved-banner" role="status">
          <span aria-hidden="true">✅</span> Note approved and finalized. No further
          changes are permitted.
        </div>
      )}

      {/* ── Main two-column layout ── */}
      <div className="cnr-layout">

        {/* Left: editable note */}
        <section className="cnr-note-panel" aria-label="Clinical note editor">
          <h2 className="cnr-panel-title">Clinical Note</h2>

          {/* Patient */}
          <fieldset className="cnr-fieldset" disabled={isApproved}>
            <legend className="cnr-legend">Patient</legend>
            <div className="cnr-row">
              <Field
                label="Name"
                id="patient-name"
                value={noteState.patient?.name}
                onChange={(v) => dispatch({ type: 'SET_PATIENT_FIELD', field: 'name', value: v })}
                placeholder="Not stated"
              />
              <Field
                label="Age"
                id="patient-age"
                value={noteState.patient?.age ?? ''}
                onChange={(v) => dispatch({
                  type: 'SET_PATIENT_FIELD',
                  field: 'age',
                  value: v === '' ? null : Number(v),
                })}
                placeholder="Not stated"
              />
              <Field
                label="Sex"
                id="patient-sex"
                value={noteState.patient?.sex}
                onChange={(v) => dispatch({ type: 'SET_PATIENT_FIELD', field: 'sex', value: v })}
                placeholder="Not stated"
              />
            </div>
          </fieldset>

          {/* Core fields */}
          <fieldset className="cnr-fieldset" disabled={isApproved}>
            <legend className="cnr-legend">Consultation</legend>

            <Field
              label="Chief complaint"
              id="chief-complaint"
              value={noteState.chief_complaint}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'chief_complaint', value: v })}
              placeholder="Primary reason for visit"
              required
            />

            <EditableList
              label="Symptoms"
              fieldKey="symptoms"
              items={noteState.symptoms ?? []}
              dispatch={dispatch}
              evidenceMap={evidenceMap}
            />

            <Field
              label="Duration / onset"
              id="duration"
              value={noteState.duration}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'duration', value: v })}
              placeholder="e.g. fever for 3 days"
            />

            <TextArea
              label="Relevant history"
              id="history"
              value={noteState.history}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'history', value: v })}
              placeholder="Past medical history mentioned in the consultation"
            />
          </fieldset>

          {/* Clinical */}
          <fieldset className="cnr-fieldset" disabled={isApproved}>
            <legend className="cnr-legend">Clinical findings</legend>

            <EditableList
              label="Observations"
              fieldKey="observations"
              items={noteState.observations ?? []}
              dispatch={dispatch}
              evidenceMap={evidenceMap}
            />

            <TextArea
              label="Assessment"
              id="assessment"
              value={noteState.assessment}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'assessment', value: v })}
              placeholder="Clinician's assessment as stated in the consultation"
              rows={4}
            />

            <EditableList
              label="Medications mentioned"
              fieldKey="medications_mentioned"
              items={noteState.medications_mentioned ?? []}
              dispatch={dispatch}
              evidenceMap={null}
            />

            <Field
              label="Follow-up"
              id="follow-up"
              value={noteState.follow_up}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'follow_up', value: v })}
              placeholder="Follow-up instructions stated in the consultation"
            />
          </fieldset>

          {/* Quality flags */}
          <fieldset className="cnr-fieldset" disabled={isApproved}>
            <legend className="cnr-legend">Quality flags</legend>

            <EditableList
              label="Missing information"
              fieldKey="missing_information"
              items={noteState.missing_information ?? []}
              dispatch={dispatch}
              evidenceMap={null}
            />

            <EditableList
              label="Uncertain fields"
              fieldKey="uncertain_fields"
              items={noteState.uncertain_fields ?? []}
              dispatch={dispatch}
              evidenceMap={null}
            />
          </fieldset>

          {/* Actions */}
          {!isApproved && (
            <div className="cnr-actions">
              {validationError && (
                <p className="cnr-validation-error" role="alert">{validationError}</p>
              )}
              {saveMessage && (
                <p className="cnr-save-message" role="status">{saveMessage}</p>
              )}
              <div className="cnr-action-row">
                <button
                  type="button"
                  className="cnr-btn cnr-btn-secondary"
                  onClick={saveDraft}
                >
                  Save draft
                </button>
                <button
                  type="button"
                  className="cnr-btn cnr-btn-primary"
                  onClick={approveNote}
                >
                  Approve &amp; finalize
                </button>
              </div>
            </div>
          )}

          {isApproved && (
            <div className="cnr-actions">
              <p className="cnr-save-message" role="status">
                ✅ Approved on {new Date().toLocaleString()}
              </p>
            </div>
          )}
        </section>

        {/* Right: transcript evidence panel */}
        <aside className="cnr-transcript-panel" aria-label="Original transcript">
          <h2 className="cnr-panel-title">Transcript evidence</h2>
          <p className="cnr-transcript-hint">
            Read-only. Use this to verify each field against what was actually said.
          </p>
          <div className="cnr-transcript-box" tabIndex={0}>
            {transcript
              ? transcript
              : <span className="cnr-empty">No transcript available.</span>
            }
          </div>
        </aside>
      </div>
    </div>
  )
}

export default ClinicalNoteReview
