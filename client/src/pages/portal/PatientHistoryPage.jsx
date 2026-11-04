import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePatientAuth } from '../../contexts/PatientPortalAuthContext.jsx';
import { apiListPatientConsultations, apiGetOwnPatient } from '../../services/api/patientPortal.js';

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

export default function PatientHistoryPage() {
  const { account, accessToken, logout } = usePatientAuth();
  const navigate = useNavigate();

  const [patient,         setPatient]         = useState(null);
  const [consultations,   setConsultations]   = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      apiGetOwnPatient(accessToken),
      apiListPatientConsultations(accessToken),
    ])
      .then(([patientData, consultData]) => {
        if (cancelled) return;
        if (patientData.success)  setPatient(patientData.patient);
        if (consultData.success)  setConsultations(consultData.consultations);
        if (!patientData.success && !consultData.success) {
          setError('Could not load your records. Please try again.');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Network error — could not load records.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [accessToken]);

  async function handleLogout() {
    await logout();
    navigate('/portal/login', { replace: true });
  }

  return (
    <div className="portal-page">
      {/* Header */}
      <header className="portal-header">
        <div className="portal-brand">
          <span className="app-logo-mark" aria-hidden="true">VS</span>
          <span className="portal-brand-name">VoiceScribe — My Records</span>
        </div>
        <div className="portal-header-right">
          {account && (
            <span className="portal-user-name">{account.displayName}</span>
          )}
          <button type="button" className="portal-logout-btn" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="portal-main">
        {loading && (
          <p className="portal-loading" aria-live="polite">Loading your records…</p>
        )}

        {error && !loading && (
          <div className="portal-error" role="alert">{error}</div>
        )}

        {!loading && !error && (
          <>
            {/* Patient summary */}
            {patient && (
              <section className="portal-patient-card" aria-label="Your details">
                <h1 className="portal-section-title">
                  {patient.firstName} {patient.lastName}
                </h1>
                <dl className="portal-meta">
                  {patient.dateOfBirth && (
                    <div className="portal-meta-row">
                      <dt>Date of birth</dt>
                      <dd>{fmtDate(patient.dateOfBirth)}</dd>
                    </div>
                  )}
                  {patient.medicalRecordId && (
                    <div className="portal-meta-row">
                      <dt>Medical record</dt>
                      <dd>{patient.medicalRecordId}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}

            {/* Consultation history */}
            <section className="portal-history" aria-label="Consultation history">
              <h2 className="portal-section-title">Your approved consultations</h2>

              {consultations.length === 0 ? (
                <p className="portal-empty">
                  No approved consultation records are available yet.
                </p>
              ) : (
                <ul className="portal-consult-list" role="list">
                  {consultations.map((c) => {
                    const consultId = c._id?.toString?.() ?? c._id;
                    return (
                      <li key={consultId} className="portal-consult-item">
                        <div className="portal-consult-meta">
                          <span className="portal-consult-date">
                            {fmtDate(c.consultationDate)}
                          </span>
                          <span className="portal-consult-type">
                            {ENCOUNTER_LABELS[c.encounterType] ?? c.encounterType ?? ''}
                          </span>
                          {c.correctionOf && (
                            <span className="portal-consult-badge portal-consult-badge--correction">
                              Corrected record
                            </span>
                          )}
                        </div>
                        {c.note?.chief_complaint && (
                          <p className="portal-consult-complaint">{c.note.chief_complaint}</p>
                        )}
                        <Link
                          to={`/portal/consultation/${consultId}`}
                          className="portal-consult-open"
                          aria-label={`Open consultation from ${fmtDate(c.consultationDate)}`}
                        >
                          View details →
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
