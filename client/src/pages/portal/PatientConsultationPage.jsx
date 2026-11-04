import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePatientAuth } from '../../contexts/PatientPortalAuthContext.jsx';
import { apiGetPatientConsultation } from '../../services/api/patientPortal.js';

const ENCOUNTER_LABELS = {
  in_person:    'In person',
  telemedicine: 'Telemedicine',
  upload:       'File upload',
};

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div className="portal-detail-field">
      <dt className="portal-detail-label">{label}</dt>
      <dd className="portal-detail-value">{value}</dd>
    </div>
  );
}

function PillList({ label, items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="portal-detail-field">
      <dt className="portal-detail-label">{label}</dt>
      <dd className="portal-detail-value">
        <ul className="portal-pill-list">
          {items.filter(Boolean).map((item, i) => (
            <li key={i} className="portal-pill">{item}</li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

export default function PatientConsultationPage() {
  const { id } = useParams();
  const { accessToken } = usePatientAuth();
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

    apiGetPatientConsultation(accessToken, id)
      .then((data) => {
        if (cancelled) return;
        if (!data.success) {
          setNotFound(true);
        } else {
          setConsultation(data.consultation);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Network error — could not load record.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [id, accessToken]);

  const c    = consultation;
  const note = c?.note ?? {};

  return (
    <div className="portal-page">
      <header className="portal-header">
        <div className="portal-brand">
          <span className="app-logo-mark" aria-hidden="true">VS</span>
          <span className="portal-brand-name">VoiceScribe — My Records</span>
        </div>
        <button
          type="button"
          className="portal-back-btn"
          onClick={() => navigate('/portal/history')}
        >
          ← Back to history
        </button>
      </header>

      <main className="portal-main">
        {loading && (
          <p className="portal-loading" aria-live="polite">Loading record…</p>
        )}

        {notFound && !loading && (
          <div className="portal-error" role="alert">
            Record not found. It may not be approved or may not be associated with your account.
          </div>
        )}

        {error && !loading && (
          <div className="portal-error" role="alert">{error}</div>
        )}

        {!loading && c && (
          <>
            {c.correctionOf && (
              <div className="portal-correction-notice" role="status">
                ✏️ This is a corrected version of an earlier consultation record.
              </div>
            )}

            <section className="portal-detail-card" aria-label="Consultation metadata">
              <h1 className="portal-section-title">Consultation record</h1>
              <dl className="portal-detail-grid">
                <Field label="Date"          value={fmtDate(c.consultationDate ?? c.createdAt)} />
                <Field label="Encounter"     value={ENCOUNTER_LABELS[c.encounterType] ?? c.encounterType} />
                <Field label="Approved"      value={fmtDateTime(c.approvedAt)} />
              </dl>
            </section>

            <section className="portal-detail-card" aria-label="Clinical note">
              <h2 className="portal-section-title">Clinical note</h2>
              <dl className="portal-detail-fields">
                <Field    label="Chief complaint"       value={note.chief_complaint} />
                <Field    label="Duration / onset"      value={note.duration} />
                <Field    label="History"               value={note.history} />
                <PillList label="Symptoms"              items={note.symptoms} />
                <PillList label="Observations"          items={note.observations} />
                <PillList label="Medications mentioned" items={note.medications_mentioned} />
                <Field    label="Assessment"            value={note.assessment} />
                <Field    label="Follow-up"             value={note.follow_up} />
              </dl>
            </section>

            <p className="portal-disclaimer">
              This record was generated by an AI transcription service and reviewed and
              approved by your doctor. It does not constitute independent medical advice.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
