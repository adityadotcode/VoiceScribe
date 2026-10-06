/**
 * ConsultationDetailPage — Phase 3C.1 / Phase 5C
 *
 * Read-only view of a single consultation fetched via:
 *   GET /api/consultations/:id
 *
 * Phase 5C adds:
 *   - "Correct consultation" action on approved, non-superseded consultations.
 *   - An inline correction editor that pre-fills the existing note.
 *   - POST /api/consultations/:id/correct on submit.
 *   - Navigation to the new draft correction on success.
 *   - Superseded/correction relationship links in banners (already existed).
 */

import { useEffect, useReducer, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiGetConsultation, apiCreateCorrection } from '../services/api/consultations.js';
import ChangeSummaryPanel from '../components/consultation/ChangeSummaryPanel.jsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const ENCOUNTER_LABELS = {
  in_person:    'In person',
  telemedicine: 'Telemedicine',
  upload:       'File upload',
};

const LANG_LABELS = {
  'en-IN': 'English (India)',
  'hi-IN': 'Hindi',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
};

const SPEAKER_META = {
  spk_0: 'Speaker A',
  spk_1: 'Speaker B',
};

function FieldRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="cd-field-row">
      <dt className="cd-field-label">{label}</dt>
      <dd className="cd-field-value">{value}</dd>
    </div>
  );
}

function ListField({ label, items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="cd-field-row cd-field-row--wide">
      <dt className="cd-field-label">{label}</dt>
      <dd className="cd-field-value">
        <ul className="cd-inline-list">
          {items.filter(Boolean).map((item, i) => (
            <li key={i} className="cd-inline-item">{item}</li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CorrectionEditor — inline note edit form (Phase 5C)
// ---------------------------------------------------------------------------
/**
 * Reducer for the mutable correction note fields.
 * Each action targets a single field by name.
 */
function noteReducer(state, action) {
  switch (action.type) {
    case 'SET_STRING':
      return { ...state, [action.field]: action.value };
    case 'SET_ARRAY': {
      // Store comma-separated user input as an array
      const arr = action.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return { ...state, [action.field]: arr };
    }
    case 'RESET':
      return action.note;
    default:
      return state;
  }
}

function CorrectionEditor({ sourceNote, sourceId, patientId, onCancel, onSuccess }) {
  const [noteState, dispatch] = useReducer(
    noteReducer,
    // Seed from source note — flatten arrays to comma-separated strings for
    // textarea editing, then re-split on submit.
    {
      chief_complaint:       sourceNote?.chief_complaint       ?? '',
      duration:              sourceNote?.duration              ?? '',
      history:               sourceNote?.history               ?? '',
      assessment:            sourceNote?.assessment            ?? '',
      follow_up:             sourceNote?.follow_up             ?? '',
      // Arrays stored as comma-joined strings inside the reducer;
      // converted to arrays when building the payload.
      symptoms:              (sourceNote?.symptoms             ?? []).join(', '),
      observations:          (sourceNote?.observations         ?? []).join(', '),
      medications_mentioned: (sourceNote?.medications_mentioned ?? []).join(', '),
    }
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  function setStr(field, value) {
    dispatch({ type: 'SET_STRING', field, value });
  }

  function buildNotePayload() {
    return {
      chief_complaint:       noteState.chief_complaint,
      duration:              noteState.duration,
      history:               noteState.history,
      assessment:            noteState.assessment,
      follow_up:             noteState.follow_up,
      symptoms:              noteState.symptoms
        .split(',').map((s) => s.trim()).filter(Boolean),
      observations:          noteState.observations
        .split(',').map((s) => s.trim()).filter(Boolean),
      medications_mentioned: noteState.medications_mentioned
        .split(',').map((s) => s.trim()).filter(Boolean),
      // Preserve unedited fields from source
      missing_information:   sourceNote?.missing_information ?? [],
      uncertain_fields:      sourceNote?.uncertain_fields    ?? [],
      patient:               sourceNote?.patient             ?? {},
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setSubmitError('');

    try {
      const notePayload = buildNotePayload();
      const data = await apiCreateCorrection(sourceId, notePayload);
      if (!data.success) {
        setSubmitError(data.message || 'Could not create correction.');
        setSubmitting(false);
        return;
      }
      // Navigate to the new correction draft
      const newId = data.consultation?._id;
      if (newId) {
        onSuccess(newId);
      } else {
        setSubmitError('Correction created but ID was missing. Please reload.');
        setSubmitting(false);
      }
    } catch {
      setSubmitError('Network error — could not create correction.');
      setSubmitting(false);
    }
  }

  return (
    <div className="cd-correction-editor" role="region" aria-label="Correction editor">
      <div className="cd-correction-editor-header">
        <h2 className="cd-correction-editor-title">Create correction</h2>
        <p className="cd-correction-editor-note">
          The original approved consultation will remain unchanged. A new draft
          correction will be created with your edits.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="cd-correction-form">
        {/* Chief complaint */}
        <div className="cd-cf-field">
          <label htmlFor="cf-chief" className="cd-cf-label">
            Chief complaint <span className="cd-cf-required" aria-hidden="true">*</span>
          </label>
          <input
            id="cf-chief"
            type="text"
            className="cd-cf-input"
            value={noteState.chief_complaint}
            onChange={(e) => setStr('chief_complaint', e.target.value)}
            disabled={submitting}
            required
          />
        </div>

        {/* Symptoms — comma-separated */}
        <div className="cd-cf-field">
          <label htmlFor="cf-symptoms" className="cd-cf-label">
            Symptoms <span className="cd-cf-hint">(comma-separated)</span>
          </label>
          <input
            id="cf-symptoms"
            type="text"
            className="cd-cf-input"
            value={noteState.symptoms}
            onChange={(e) => setStr('symptoms', e.target.value)}
            disabled={submitting}
            placeholder="e.g. cough, fatigue"
          />
        </div>

        {/* Duration */}
        <div className="cd-cf-field">
          <label htmlFor="cf-duration" className="cd-cf-label">Duration / onset</label>
          <input
            id="cf-duration"
            type="text"
            className="cd-cf-input"
            value={noteState.duration}
            onChange={(e) => setStr('duration', e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* History */}
        <div className="cd-cf-field">
          <label htmlFor="cf-history" className="cd-cf-label">Relevant history</label>
          <textarea
            id="cf-history"
            className="cd-cf-textarea"
            rows={2}
            value={noteState.history}
            onChange={(e) => setStr('history', e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* Observations */}
        <div className="cd-cf-field">
          <label htmlFor="cf-observations" className="cd-cf-label">
            Observations <span className="cd-cf-hint">(comma-separated)</span>
          </label>
          <input
            id="cf-observations"
            type="text"
            className="cd-cf-input"
            value={noteState.observations}
            onChange={(e) => setStr('observations', e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* Assessment */}
        <div className="cd-cf-field">
          <label htmlFor="cf-assessment" className="cd-cf-label">Assessment</label>
          <textarea
            id="cf-assessment"
            className="cd-cf-textarea"
            rows={2}
            value={noteState.assessment}
            onChange={(e) => setStr('assessment', e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* Medications mentioned */}
        <div className="cd-cf-field">
          <label htmlFor="cf-meds" className="cd-cf-label">
            Medications mentioned <span className="cd-cf-hint">(comma-separated)</span>
          </label>
          <input
            id="cf-meds"
            type="text"
            className="cd-cf-input"
            value={noteState.medications_mentioned}
            onChange={(e) => setStr('medications_mentioned', e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* Follow-up */}
        <div className="cd-cf-field">
          <label htmlFor="cf-followup" className="cd-cf-label">Follow-up</label>
          <input
            id="cf-followup"
            type="text"
            className="cd-cf-input"
            value={noteState.follow_up}
            onChange={(e) => setStr('follow_up', e.target.value)}
            disabled={submitting}
          />
        </div>

        {submitError && (
          <div className="cd-cf-error" role="alert">{submitError}</div>
        )}

        <div className="cd-cf-actions">
          <button
            type="button"
            className="cd-cf-cancel-btn"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="cd-cf-submit-btn"
            disabled={submitting || !noteState.chief_complaint.trim()}
          >
            {submitting ? 'Creating correction…' : 'Create correction draft'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConsultationDetailPage
// ---------------------------------------------------------------------------
export default function ConsultationDetailPage() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [consultation, setConsultation] = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [notFound,     setNotFound]     = useState(false);
  const [error,        setError]        = useState('');

  // Phase 5C — correction editor visibility
  const [showCorrectionEditor, setShowCorrectionEditor] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError('');
    setConsultation(null);
    setShowCorrectionEditor(false);

    apiGetConsultation(id)
      .then((data) => {
        if (cancelled) return;
        if (!data.success) {
          setNotFound(true);
        } else {
          setConsultation(data.consultation);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Network error — could not load consultation.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [id]);

  const c    = consultation;
  const note = c?.note ?? {};

  function handleBack() {
    if (c?.patientId) {
      navigate(`/patients/${c.patientId}`);
    } else {
      navigate(-1);
    }
  }

  function handleCorrectionSuccess(newId) {
    navigate(`/consultation/${newId}`);
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="cd-page">
        <p className="cd-loading" aria-live="polite">Loading consultation…</p>
      </div>
    );
  }

  // ── Not found ────────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="cd-page">
        <div className="cd-page-header">
          <button type="button" className="pt-back-btn" onClick={() => navigate(-1)}>
            ← Back
          </button>
        </div>
        <div className="cd-not-found" role="alert">
          <p className="cd-not-found-headline">Consultation not found.</p>
          <p className="cd-not-found-sub">
            It may have been deleted or you may not have access to it.
          </p>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="cd-page">
        <div className="cd-page-header">
          <button type="button" className="pt-back-btn" onClick={() => navigate(-1)}>
            ← Back
          </button>
        </div>
        <div className="pt-error" role="alert">
          {error}
          <button
            type="button"
            className="pt-retry-btn"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────
  const isApproved   = c.status === 'approved';
  const isCorrection = Boolean(c.correctionOf);
  const isSuperseded = Boolean(c.supersededBy);

  // A consultation is eligible for correction when:
  //  - it is approved, AND
  //  - it has not already been superseded by a correction
  const canCorrect = isApproved && !isSuperseded;

  const consultationId =
    typeof c._id === 'object' ? c._id.toString() : (c._id ?? id);

  return (
    <div className="cd-page">
      {/* Page header */}
      <div className="cd-page-header">
        <button type="button" className="pt-back-btn" onClick={handleBack}>
          {c.patientId ? '← Back to patient' : '← Back'}
        </button>
        <h1 className="cd-page-title">
          {isCorrection ? 'Correction draft' : 'Consultation'}
        </h1>

        {/* Correct consultation action — Phase 5C */}
        {canCorrect && !showCorrectionEditor && (
          <button
            type="button"
            className="cd-correct-btn"
            onClick={() => setShowCorrectionEditor(true)}
            aria-label="Correct this consultation"
          >
            ✏️ Correct consultation
          </button>
        )}
      </div>

      {/* Status / correction banners */}
      {isApproved && !isSuperseded && (
        <div className="cd-banner cd-banner--approved" role="status">
          ✅ Approved note
        </div>
      )}
      {isCorrection && (
        <div className="cd-banner cd-banner--correction" role="status">
          ✏️ This note corrects an earlier consultation.
          {' '}
          <Link to={`/consultation/${c.correctionOf}`} className="cd-banner-link">
            View original
          </Link>
        </div>
      )}
      {isSuperseded && (
        <div className="cd-banner cd-banner--superseded" role="status">
          ⚠️ This note has been superseded by a correction.
          {' '}
          <Link to={`/consultation/${c.supersededBy}`} className="cd-banner-link">
            View correction
          </Link>
        </div>
      )}

      {/* Inline correction editor — Phase 5C */}
      {showCorrectionEditor && (
        <CorrectionEditor
          sourceNote={c.note}
          sourceId={consultationId}
          patientId={c.patientId}
          onCancel={() => setShowCorrectionEditor(false)}
          onSuccess={handleCorrectionSuccess}
        />
      )}

      {/* Meta card */}
      <section className="cd-card" aria-label="Consultation metadata">
        <dl className="cd-meta-grid">
          <FieldRow label="Consultation date" value={formatDate(c.consultationDate ?? c.createdAt)} />
          <FieldRow label="Encounter type"    value={ENCOUNTER_LABELS[c.encounterType] ?? c.encounterType} />
          <FieldRow label="Status"            value={c.status} />
          <FieldRow label="Created"           value={formatDateTime(c.createdAt)} />
          {isApproved && (
            <FieldRow label="Approved at" value={formatDateTime(c.approvedAt)} />
          )}
        </dl>
      </section>

      {/* Clinical note */}
      <section className="cd-card" aria-label="Clinical note">
        <h2 className="cd-card-title">Clinical note</h2>
        <dl className="cd-fields">
          <FieldRow label="Chief complaint"  value={note.chief_complaint} />
          <FieldRow label="Duration / onset" value={note.duration} />
          <FieldRow label="History"          value={note.history} />
          <FieldRow label="Assessment"       value={note.assessment} />
          <FieldRow label="Follow-up"        value={note.follow_up} />
          <ListField label="Symptoms"               items={note.symptoms} />
          <ListField label="Observations"           items={note.observations} />
          <ListField label="Medications mentioned"  items={note.medications_mentioned} />
          <ListField label="Missing information"    items={note.missing_information} />
          <ListField label="Uncertain fields"       items={note.uncertain_fields} />
        </dl>

        {/* Legacy note.patient inline fields (V1 compatibility) */}
        {(note.patient?.name || note.patient?.age || note.patient?.sex) && (
          <div className="cd-legacy-patient">
            <p className="cd-legacy-label">Noted patient info (from transcript)</p>
            <dl className="cd-fields">
              <FieldRow label="Name" value={note.patient?.name} />
              <FieldRow label="Age"  value={note.patient?.age} />
              <FieldRow label="Sex"  value={note.patient?.sex} />
            </dl>
          </div>
        )}
      </section>

      {/* Detected languages */}
      {Array.isArray(c.detectedLanguages) && c.detectedLanguages.length > 0 && (
        <section className="cd-card" aria-label="Detected languages">
          <h2 className="cd-card-title">Detected languages</h2>
          <ul className="cd-lang-list">
            {c.detectedLanguages.map(({ code, duration }) => (
              <li key={code} className="cd-lang-item">
                <span className="cd-lang-name">{LANG_LABELS[code] ?? code}</span>
                {duration != null && (
                  <span className="cd-lang-duration">~{Math.round(duration)} s</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Speaker utterances */}
      {Array.isArray(c.speakerUtterances) && c.speakerUtterances.length > 0 && (
        <section className="cd-card" aria-label="Speaker utterances">
          <h2 className="cd-card-title">Conversation</h2>
          <p className="cd-speaker-notice">
            Speaker roles are as assigned during the consultation review.
          </p>
          <ol className="cd-utterance-list">
            {c.speakerUtterances.map((u, i) => {
              const role  = c.speakerRoleMapping?.[u.speaker];
              const label = SPEAKER_META[u.speaker] ?? u.speaker;
              const m     = Math.floor(u.startTime / 60);
              const s     = Math.floor(u.startTime % 60);
              const time  = `${m}:${String(s).padStart(2, '0')}`;
              return (
                <li key={i} className={`cd-utterance cd-utterance--${u.speaker}`}>
                  <div className="cd-utterance-header">
                    <span className="cd-utterance-speaker">{label}</span>
                    {role && role !== 'Unknown' && (
                      <span className="cd-utterance-role">{role}</span>
                    )}
                    <span className="cd-utterance-time">{time}</span>
                  </div>
                  <p className="cd-utterance-text">{u.text}</p>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Raw transcript */}
      {c.transcript && (
        <section className="cd-card" aria-label="Transcript">
          <h2 className="cd-card-title">Transcript</h2>
          <p className="cd-transcript-hint">Read-only — original transcription output.</p>
          <div className="cd-transcript-box" tabIndex={0}>
            {c.transcript}
          </div>
        </section>
      )}

      {/* Change summary — Phase 4C */}
      {c.patientId && (
        <ChangeSummaryPanel
          patientId={
            typeof c.patientId === 'object' ? c.patientId.toString() : c.patientId
          }
          consultationId={consultationId}
        />
      )}
    </div>
  );
}
