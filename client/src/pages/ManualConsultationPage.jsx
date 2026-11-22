/**
 * ManualConsultationPage — Milestone 3
 *
 * Provides a focused form for entering a consultation note without audio
 * recording, transcription, or AI extraction.
 *
 * Flow:
 *   1. Read ?patientId= from URL, call GET /api/patients/:id (ownership enforced
 *      server-side — 404 if patient belongs to another doctor).
 *   2. Doctor fills in the note form (all NoteSchema fields supported).
 *   3. "Save draft" → POST /api/consultations (blank transcript, no consentEventId)
 *      → navigate to /consultation/:id for the standard review/approval workflow.
 *
 * Security:
 *   - patientId comes from the URL query param but is validated server-side.
 *   - apiGetPatient enforces doctor ownership (GET /api/patients/:id returns 404
 *     if the patient belongs to another doctor — see patientController.getPatient).
 *   - POST /api/consultations requires userId from the JWT, verifies patient
 *     ownership again, and enforces isArchived:false.
 *   - No transcript, no consentEventId → backend skips the consent gate entirely.
 *   - Status is always 'draft' on creation from this page (no direct approval).
 *
 * Note schema used (matches server/src/models/Consultation.js → NoteSchema):
 *   patient            {name, age, sex}  — optional demographic snapshot
 *   chief_complaint    string            — required for approval (backend enforces)
 *   symptoms           string[]
 *   duration           string
 *   history            string
 *   observations       string[]
 *   assessment         string
 *   medications_mentioned string[]
 *   follow_up          string
 *   missing_information string[]        — left empty for manual notes (no AI flags)
 *   uncertain_fields   string[]         — left empty for manual notes (no AI flags)
 */

import { useEffect, useReducer, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGetPatient }         from '../services/api/patients.js';
import { apiCreateConsultation } from '../services/api/consultations.js';

// ---------------------------------------------------------------------------
// Blank note — matches BLANK_NOTE in App.jsx and NoteSchema on the server
// ---------------------------------------------------------------------------
const BLANK_NOTE = {
  patient:               { name: '', age: null, sex: '' },
  chief_complaint:       '',
  symptoms:              [],
  duration:              '',
  history:               '',
  observations:          [],
  assessment:            '',
  medications_mentioned: [],
  follow_up:             '',
  missing_information:   [],
  uncertain_fields:      [],
};

// ---------------------------------------------------------------------------
// Encounter type options (matches Consultation schema enum)
// ---------------------------------------------------------------------------
const ENCOUNTER_TYPES = [
  { value: 'in_person',    label: 'In person' },
  { value: 'telemedicine', label: 'Telemedicine' },
];

// ---------------------------------------------------------------------------
// Reducer — mirrors the shape in ClinicalNoteReview
// ---------------------------------------------------------------------------
function noteReducer(state, action) {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'SET_PATIENT_FIELD':
      return { ...state, patient: { ...state.patient, [action.field]: action.value } };
    case 'SET_ARRAY_RAW':
      // Store raw comma-separated string; convert to array on submit
      return { ...state, [action.field + '_raw']: action.value };
    case 'RESET':
      return action.note;
    default:
      return state;
  }
}

// Raw state: string inputs for array fields (comma-separated in the textarea)
function initRaw() {
  return {
    symptoms_raw:              '',
    observations_raw:          '',
    medications_mentioned_raw: '',
  };
}

// Convert raw comma-separated strings back to string arrays for the API
function buildNote(noteState, rawState) {
  function toArray(raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return {
    patient:               noteState.patient,
    chief_complaint:       noteState.chief_complaint,
    duration:              noteState.duration,
    history:               noteState.history,
    assessment:            noteState.assessment,
    follow_up:             noteState.follow_up,
    symptoms:              toArray(rawState.symptoms_raw),
    observations:          toArray(rawState.observations_raw),
    medications_mentioned: toArray(rawState.medications_mentioned_raw),
    missing_information:   [],
    uncertain_fields:      [],
  };
}

// ---------------------------------------------------------------------------
// Small form-field helpers
// ---------------------------------------------------------------------------
function FormField({ id, label, value, onChange, placeholder, required, disabled, hint }) {
  return (
    <div className="mc-field">
      <label htmlFor={id} className="mc-label">
        {label}
        {required && <span className="mc-required" aria-hidden="true"> *</span>}
      </label>
      {hint && <p className="mc-field-hint">{hint}</p>}
      <input
        id={id}
        type="text"
        className="mc-input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ''}
        disabled={disabled}
        aria-required={required ? 'true' : undefined}
      />
    </div>
  );
}

function FormTextArea({ id, label, value, onChange, placeholder, rows = 3, disabled, hint }) {
  return (
    <div className="mc-field">
      <label htmlFor={id} className="mc-label">{label}</label>
      {hint && <p className="mc-field-hint">{hint}</p>}
      <textarea
        id={id}
        className="mc-textarea"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ''}
        rows={rows}
        disabled={disabled}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ManualConsultationPage
// ---------------------------------------------------------------------------
export default function ManualConsultationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ── Patient loading ──────────────────────────────────────────────────────
  const [patient,       setPatient]       = useState(null);
  const [patientLoading, setPatientLoading] = useState(true);
  const [patientError,  setPatientError]  = useState('');

  // ── Encounter type ───────────────────────────────────────────────────────
  const [encounterType, setEncounterType] = useState('in_person');

  // ── Note form state ──────────────────────────────────────────────────────
  const [noteState, dispatch] = useReducer(noteReducer, BLANK_NOTE);
  const [rawState,  setRaw]   = useState(initRaw());

  // ── Submission state ─────────────────────────────────────────────────────
  const [saving,      setSaving]      = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saveError,   setSaveError]   = useState('');

  // ── Unsaved-change guard ─────────────────────────────────────────────────
  const [isDirty, setIsDirty] = useState(false);

  // Mark form dirty on first meaningful input
  function markDirty() {
    if (!isDirty) setIsDirty(true);
  }

  function setField(field, value) {
    dispatch({ type: 'SET_FIELD', field, value });
    markDirty();
    if (fieldErrors[field]) setFieldErrors((e) => ({ ...e, [field]: '' }));
  }

  function setPatientField(field, value) {
    dispatch({ type: 'SET_PATIENT_FIELD', field, value });
    markDirty();
  }

  function setRawField(field, value) {
    setRaw((r) => ({ ...r, [field + '_raw']: value }));
    markDirty();
  }

  // ── Load patient from ?patientId= query param ────────────────────────────
  useEffect(() => {
    const patientId = searchParams.get('patientId');
    if (!patientId) {
      setPatientError('No patient specified. Please go back and select a patient.');
      setPatientLoading(false);
      return;
    }

    let cancelled = false;
    apiGetPatient(patientId)
      .then((data) => {
        if (cancelled) return;
        if (data.success && data.patient) {
          setPatient(data.patient);
        } else {
          setPatientError(
            data.message || 'Patient not found or not accessible. Please go back and select a patient.'
          );
        }
      })
      .catch(() => {
        if (!cancelled) setPatientError('Network error — could not load patient.');
      })
      .finally(() => {
        if (!cancelled) setPatientLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Back navigation with unsaved-change warning ──────────────────────────
  function handleBack() {
    if (isDirty) {
      const confirmed = window.confirm(
        'You have unsaved changes. Leave without saving?'
      );
      if (!confirmed) return;
    }
    if (patient?._id) {
      navigate(`/patients/${patient._id}`);
    } else {
      navigate('/patients');
    }
  }

  // ── Client-side validation ───────────────────────────────────────────────
  function validate() {
    const errors = {};
    if (!noteState.chief_complaint?.trim()) {
      errors.chief_complaint = 'Chief complaint is required.';
    }
    return errors;
  }

  // ── Save as draft ────────────────────────────────────────────────────────
  async function handleSave() {
    if (saving) return;

    const errors = validate();
    setFieldErrors(errors);
    setSaveError('');
    if (Object.keys(errors).length > 0) return;

    setSaving(true);

    const note = buildNote(noteState, rawState);
    const body = {
      patientId:   patient._id,
      encounterType,
      note,
      status:      'draft',
      // Explicitly empty transcript — no audio was recorded.
      // Backend will skip the consent gate because hasTranscript is false.
      transcript:  '',
    };

    try {
      const data = await apiCreateConsultation(body);
      if (!data.success) {
        setSaveError(data.message || 'Could not save consultation. Please try again.');
        setSaving(false);
        return;
      }
      setIsDirty(false);
      // Navigate to the standard consultation detail / review page
      navigate(`/consultation/${data.consultation._id}`, { replace: true });
    } catch {
      setSaveError('Network error — consultation not saved.');
      setSaving(false);
    }
  }

  // =========================================================================
  // Render: patient loading
  // =========================================================================
  if (patientLoading) {
    return (
      <div className="mc-page">
        <p className="mc-loading" aria-live="polite">Loading patient…</p>
      </div>
    );
  }

  // =========================================================================
  // Render: patient error / missing ?patientId
  // =========================================================================
  if (patientError || !patient) {
    return (
      <div className="mc-page">
        <div className="mc-page-header">
          <button type="button" className="pt-back-btn" onClick={() => navigate('/patients')}>
            ← Patients
          </button>
        </div>
        <div className="mc-error" role="alert">
          {patientError || 'Patient not found.'}
        </div>
      </div>
    );
  }

  // =========================================================================
  // Render: note entry form
  // =========================================================================
  const patientFullName = `${patient.firstName} ${patient.lastName}`;
  const dobLabel = patient.dateOfBirth
    ? new Date(patient.dateOfBirth).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : '—';

  return (
    <div className="mc-page">
      {/* ── Page header ── */}
      <div className="mc-page-header">
        <button type="button" className="pt-back-btn" onClick={handleBack}>
          ← Back
        </button>
        <h1 className="mc-page-title">Manual consultation</h1>
      </div>

      {/* ── Patient banner ── */}
      <div className="mc-patient-banner" aria-label="Patient">
        <div className="mc-patient-name">{patientFullName}</div>
        <div className="mc-patient-meta">
          DOB: {dobLabel}
          {patient.medicalRecordId && <> &nbsp;·&nbsp; MR: {patient.medicalRecordId}</>}
        </div>
      </div>

      {/* ── Manual entry notice ── */}
      <div className="mc-notice" role="status">
        <span aria-hidden="true">✏️</span>
        <span>
          <strong>Manual entry.</strong> No audio recording or AI extraction.
          Save as draft, then review and approve on the next screen.
        </span>
      </div>

      {/* ── Form ── */}
      <form
        className="mc-form"
        onSubmit={(e) => { e.preventDefault(); handleSave(); }}
        noValidate
        aria-label="Manual consultation note"
      >
        {/* Encounter type */}
        <div className="mc-section">
          <h2 className="mc-section-title">Encounter</h2>
          <div className="mc-field">
            <label htmlFor="mc-encounter-type" className="mc-label">
              Encounter type
            </label>
            <select
              id="mc-encounter-type"
              className="mc-select"
              value={encounterType}
              onChange={(e) => { setEncounterType(e.target.value); markDirty(); }}
              disabled={saving}
            >
              {ENCOUNTER_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Patient snapshot — optional demographic context captured at visit time */}
        <div className="mc-section">
          <h2 className="mc-section-title">Patient snapshot <span className="mc-section-optional">(optional)</span></h2>
          <p className="mc-section-hint">
            Record the demographics as stated during this visit.
            This is a clinical snapshot, not the patient's master record.
          </p>
          <div className="mc-row">
            <FormField id="mc-pt-name" label="Name as stated"
              value={noteState.patient?.name}
              onChange={(v) => setPatientField('name', v)}
              placeholder="As mentioned in the consultation"
              disabled={saving} />
            <FormField id="mc-pt-age" label="Age as stated"
              value={noteState.patient?.age ?? ''}
              onChange={(v) => setPatientField('age', v === '' ? null : Number(v))}
              placeholder="e.g. 45"
              disabled={saving} />
            <FormField id="mc-pt-sex" label="Sex as stated"
              value={noteState.patient?.sex}
              onChange={(v) => setPatientField('sex', v)}
              placeholder="e.g. Female"
              disabled={saving} />
          </div>
        </div>

        {/* Consultation */}
        <div className="mc-section">
          <h2 className="mc-section-title">Consultation</h2>

          <FormField
            id="mc-chief-complaint"
            label="Chief complaint"
            value={noteState.chief_complaint}
            onChange={(v) => setField('chief_complaint', v)}
            placeholder="Primary reason for visit"
            required
            disabled={saving}
          />
          {fieldErrors.chief_complaint && (
            <p className="mc-field-error" role="alert">{fieldErrors.chief_complaint}</p>
          )}

          <FormTextArea
            id="mc-symptoms"
            label="Symptoms"
            value={rawState.symptoms_raw}
            onChange={(v) => setRawField('symptoms', v)}
            placeholder="Comma-separated list, e.g. fever, cough, fatigue"
            rows={2}
            disabled={saving}
            hint="Separate multiple symptoms with commas."
          />

          <FormField
            id="mc-duration"
            label="Duration / onset"
            value={noteState.duration}
            onChange={(v) => setField('duration', v)}
            placeholder="e.g. fever for 3 days, cough for 1 week"
            disabled={saving}
          />

          <FormTextArea
            id="mc-history"
            label="Relevant history"
            value={noteState.history}
            onChange={(v) => setField('history', v)}
            placeholder="Past medical history relevant to this visit"
            rows={3}
            disabled={saving}
          />
        </div>

        {/* Clinical findings */}
        <div className="mc-section">
          <h2 className="mc-section-title">Clinical findings</h2>

          <FormTextArea
            id="mc-observations"
            label="Clinical observations"
            value={rawState.observations_raw}
            onChange={(v) => setRawField('observations', v)}
            placeholder="Comma-separated findings, e.g. temperature 38.5°C, blood pressure 120/80"
            rows={2}
            disabled={saving}
            hint="Separate multiple observations with commas."
          />

          <FormTextArea
            id="mc-assessment"
            label="Assessment"
            value={noteState.assessment}
            onChange={(v) => setField('assessment', v)}
            placeholder="Clinical assessment / working diagnosis"
            rows={3}
            disabled={saving}
          />

          <FormTextArea
            id="mc-medications"
            label="Medications mentioned"
            value={rawState.medications_mentioned_raw}
            onChange={(v) => setRawField('medications_mentioned', v)}
            placeholder="Comma-separated, e.g. paracetamol 500mg, amoxicillin"
            rows={2}
            disabled={saving}
            hint="Medications discussed during this consultation. Not a confirmed medication list."
          />

          <FormField
            id="mc-follow-up"
            label="Follow-up"
            value={noteState.follow_up}
            onChange={(v) => setField('follow_up', v)}
            placeholder="e.g. Return in 1 week if symptoms persist"
            disabled={saving}
          />
        </div>

        {/* Error messages */}
        {saveError && (
          <div className="mc-save-error" role="alert">{saveError}</div>
        )}

        {/* Actions */}
        <div className="mc-actions">
          <button
            type="button"
            className="pt-cancel-btn"
            onClick={handleBack}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="mc-save-btn"
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save draft →'}
          </button>
        </div>

        <p className="mc-actions-hint">
          Saving creates a draft. You will be taken to the review screen to
          edit further and approve before it becomes part of the patient record.
        </p>
      </form>
    </div>
  );
}
