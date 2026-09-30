/**
 * ConsultationDetailPage — Phase 3C.1
 *
 * Read-only view of a single consultation fetched via:
 *   GET /api/consultations/:id
 *
 * Navigation:
 *   - Arrives from PatientProfilePage consultation history (Open button).
 *   - "Back to patient" link when patientId is available on the consultation.
 *   - Generic "← Back" otherwise.
 *
 * Displays all clinical note fields, correction/superseded indicators,
 * transcript, detected languages, and speaker utterances.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiGetConsultation } from '../services/api/consultations.js';
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
  in_person:   'In person',
  telemedicine: 'Telemedicine',
  upload:      'File upload',
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
// ConsultationDetailPage
// ---------------------------------------------------------------------------
export default function ConsultationDetailPage() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [consultation, setConsultation] = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [notFound,     setNotFound]     = useState(false);
  const [error,        setError]        = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError('');
    setConsultation(null);

    apiGetConsultation(id)
      .then((data) => {
        if (cancelled) return;
        if (!data.success) {
          // Treat any failure as not-found from the user's perspective —
          // the backend returns 404 for both missing and unauthorised.
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

  // Back destination: patient profile if patientId is present, else browser back.
  function handleBack() {
    if (c?.patientId) {
      navigate(`/patients/${c.patientId}`);
    } else {
      navigate(-1);
    }
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

  return (
    <div className="cd-page">
      {/* Page header */}
      <div className="cd-page-header">
        <button type="button" className="pt-back-btn" onClick={handleBack}>
          {c.patientId ? '← Back to patient' : '← Back'}
        </button>
        <h1 className="cd-page-title">Consultation</h1>
      </div>

      {/* Status / correction banners */}
      {isApproved && (
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
              const role = c.speakerRoleMapping?.[u.speaker];
              const label = SPEAKER_META[u.speaker] ?? u.speaker;
              const m = Math.floor(u.startTime / 60);
              const s = Math.floor(u.startTime % 60);
              const time = `${m}:${String(s).padStart(2, '0')}`;
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

      {/* Raw transcript (fallback / always shown if present) */}
      {c.transcript && (
        <section className="cd-card" aria-label="Transcript">
          <h2 className="cd-card-title">Transcript</h2>
          <p className="cd-transcript-hint">Read-only — original transcription output.</p>
          <div className="cd-transcript-box" tabIndex={0}>
            {c.transcript}
          </div>
        </section>
      )}

      {/* Change summary — Phase 4C
          Only shown when the consultation is linked to a patient, so the
          backend can locate a previous effective approved note to compare.
          The comparison is user-triggered, not automatic. */}
      {c.patientId && (
        <ChangeSummaryPanel
          patientId={
            typeof c.patientId === 'object' ? c.patientId.toString() : c.patientId
          }
          consultationId={
            typeof c._id === 'object' ? c._id.toString() : (c._id ?? id)
          }
        />
      )}
    </div>
  );
}
