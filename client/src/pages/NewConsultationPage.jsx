/**
 * NewConsultationPage — Phase 5A (Rich Pre-Consultation Context) / Phase 6A
 *
 * Flow:
 *   1. Doctor searches for and selects an existing patient.
 *   2. After selection, GET /api/patients/:id/overview is called once.
 *      This delivers: patient record + statistics + latest approved consultation
 *      (with full note) + recent consultations — all in a single round-trip.
 *   3. A rich pre-consultation context panel is shown:
 *        - Patient header (name, DOB, sex, MR)
 *        - Stats strip (total visits, approved, last visit date)
 *        - "Last visit" section with full clinical note fields
 *        - "What changed since last visit?" (Phase 6A — ChangeSummaryPanel)
 *        - "View full patient profile" link → /patients/:id
 *   4. "Start consultation" button navigates to /dashboard with patientId
 *      threaded through location.state (Phase 3B.2B wiring, unchanged).
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  apiListPatients,
  apiGetPatientOverview,
} from '../services/api/patients.js';
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

function formatShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

/** Approximate age in years from an ISO date string. */
function ageFromDob(iso) {
  if (!iso) return null;
  const dob  = new Date(iso);
  const now  = new Date();
  let age    = now.getFullYear() - dob.getFullYear();
  const m    = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : null;
}

const SEX_LABELS = {
  male:       'Male',
  female:     'Female',
  other:      'Other',
  not_stated: 'Prefer not to state',
};

function sexLabel(v) {
  return SEX_LABELS[v] ?? v ?? '—';
}

function listField(arr) {
  if (!arr || arr.length === 0) return <em className="nc-none">None recorded</em>;
  return arr.join(', ');
}

// ---------------------------------------------------------------------------
// PatientSearchPanel — unchanged
// ---------------------------------------------------------------------------
function PatientSearchPanel({ onSelect }) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef(null);

  async function search(q) {
    setLoading(true);
    setError('');
    try {
      const data = await apiListPatients({ search: q });
      if (!data.success) {
        setError(data.message || 'Could not load patients.');
        setResults([]);
      } else {
        setResults(data.patients);
        setSearched(true);
      }
    } catch {
      setError('Network error — could not search patients.');
      setResults([]);
    }
    setLoading(false);
  }

  function handleQueryChange(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 300);
  }

  useEffect(() => { search(''); }, []);

  return (
    <div className="nc-search-panel">
      <div className="nc-search-field">
        <span className="nc-search-icon" aria-hidden="true">🔍</span>
        <input
          type="search"
          className="nc-search-input"
          placeholder="Search by name or medical record ID…"
          value={query}
          onChange={handleQueryChange}
          aria-label="Search patients"
          autoFocus
        />
        {query && (
          <button
            type="button"
            className="nc-search-clear"
            onClick={() => { setQuery(''); search(''); }}
            aria-label="Clear search"
          >✕</button>
        )}
      </div>

      {loading && <p className="nc-search-loading">Searching…</p>}

      {!loading && error && (
        <p className="nc-search-error" role="alert">{error}</p>
      )}

      {!loading && !error && searched && results.length === 0 && (
        <p className="nc-search-empty">
          {query ? 'No patients match your search.' : 'No patients found. Add a patient first.'}
        </p>
      )}

      {!loading && !error && results.length > 0 && (
        <ul className="nc-results-list" role="listbox" aria-label="Matching patients">
          {results.map((p) => (
            <li key={p._id} role="option" aria-selected="false">
              <button
                type="button"
                className="nc-result-btn"
                onClick={() => onSelect(p)}
              >
                <span className="nc-result-name">
                  {p.lastName}, {p.firstName}
                </span>
                <span className="nc-result-meta">
                  DOB: {formatDate(p.dateOfBirth)}
                  {p.medicalRecordId && <> &nbsp;·&nbsp; MR: {p.medicalRecordId}</>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PatientContextPanel — Phase 5A
// Fetches /api/patients/:id/overview and renders rich clinical context.
// ---------------------------------------------------------------------------
function PatientContextPanel({ patientId, patientName }) {
  const [overview, setOverview] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setOverview(null);

    apiGetPatientOverview(patientId)
      .then((data) => {
        if (cancelled) return;
        if (!data.success) {
          setError('Could not load patient context.');
        } else {
          setOverview(data);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Network error — could not load patient context.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [patientId]);

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="pcp-panel pcp-panel--loading" aria-live="polite">
        <p className="pcp-loading">Loading patient context…</p>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="pcp-panel">
        <p className="pcp-error" role="alert">{error}</p>
      </div>
    );
  }

  if (!overview) return null;

  const { patient, statistics, latestApprovedConsultation: latest } = overview;
  const age = ageFromDob(patient.dateOfBirth);

  return (
    <div className="pcp-panel" aria-label="Patient clinical context">

      {/* ── Patient header ── */}
      <div className="pcp-header">
        <div className="pcp-name-row">
          <h3 className="pcp-name">{patient.firstName} {patient.lastName}</h3>
          {patient.medicalRecordId && (
            <span className="pcp-mrid">MR: {patient.medicalRecordId}</span>
          )}
        </div>
        <p className="pcp-meta">
          {age !== null ? `${age} y/o · ` : ''}{sexLabel(patient.biologicalSex)}
          {patient.dateOfBirth ? ` · Born ${formatShort(patient.dateOfBirth)}` : ''}
        </p>
      </div>

      {/* ── Statistics strip ── */}
      <div className="pcp-stats" aria-label="Consultation statistics">
        <div className="pcp-stat">
          <span className="pcp-stat-value">{statistics.totalConsultations}</span>
          <span className="pcp-stat-label">Total visits</span>
        </div>
        <div className="pcp-stat pcp-stat--approved">
          <span className="pcp-stat-value">{statistics.approvedConsultations}</span>
          <span className="pcp-stat-label">Approved</span>
        </div>
        <div className="pcp-stat pcp-stat--draft">
          <span className="pcp-stat-value">{statistics.draftConsultations}</span>
          <span className="pcp-stat-label">Draft</span>
        </div>
        <div className="pcp-stat pcp-stat--date">
          <span className="pcp-stat-value">
            {statistics.lastConsultationDate
              ? formatShort(statistics.lastConsultationDate)
              : '—'}
          </span>
          <span className="pcp-stat-label">Last visit</span>
        </div>
      </div>

      {/* ── Last visit details ── */}
      <div className="pcp-section">
        <h4 className="pcp-section-title">Last approved visit</h4>

        {!latest && (
          <p className="pcp-empty">No previous approved consultation.</p>
        )}

        {latest && (
          <dl className="pcp-fields">
            <div className="pcp-field">
              <dt>Date</dt>
              <dd>{formatShort(latest.consultationDate)}</dd>
            </div>
            {latest.chief_complaint && (
              <div className="pcp-field pcp-field--wide">
                <dt>Chief complaint</dt>
                <dd>{latest.chief_complaint}</dd>
              </div>
            )}
            {latest.symptoms?.length > 0 && (
              <div className="pcp-field pcp-field--wide">
                <dt>Symptoms</dt>
                <dd>{listField(latest.symptoms)}</dd>
              </div>
            )}
            {latest.medications_mentioned?.length > 0 && (
              <div className="pcp-field pcp-field--wide">
                <dt>Medications mentioned</dt>
                <dd>{listField(latest.medications_mentioned)}</dd>
              </div>
            )}
            {latest.assessment && (
              <div className="pcp-field pcp-field--wide">
                <dt>Assessment</dt>
                <dd>{latest.assessment}</dd>
              </div>
            )}
            {latest.follow_up && (
              <div className="pcp-field pcp-field--wide">
                <dt>Follow-up</dt>
                <dd>{latest.follow_up}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* ── What changed since last visit? — Phase 6A ── */}
      {latest && (
        <div className="pcp-change-section" aria-label="What changed since last visit">
          <h4 className="pcp-section-title">What changed since last visit?</h4>
          <ChangeSummaryPanel
            patientId={patientId}
            consultationId={latest.id}
          />
        </div>
      )}

      {/* ── View full profile link ── */}
      <div className="pcp-footer">
        <Link
          to={`/patients/${patientId}`}
          className="pcp-profile-link"
        >
          View full patient profile →
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectedPatientPanel — compact header; now shows Change patient only
// ---------------------------------------------------------------------------
function SelectedPatientPanel({ patient, onClear }) {
  return (
    <div className="nc-selected-patient">
      <div className="nc-selected-header">
        <h2 className="nc-selected-name">
          {patient.firstName} {patient.lastName}
        </h2>
        <button
          type="button"
          className="nc-change-btn"
          onClick={onClear}
        >
          Change patient
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewConsultationPage
// ---------------------------------------------------------------------------
export default function NewConsultationPage() {
  const navigate = useNavigate();
  const [selectedPatient, setSelectedPatient] = useState(null);

  function handleSelect(patient) {
    setSelectedPatient(patient);
  }

  function handleClear() {
    setSelectedPatient(null);
  }

  function handleStart() {
    navigate('/dashboard', {
      state: {
        startRecording: true,
        patientId:   selectedPatient?._id ?? null,
        patientName: selectedPatient
          ? `${selectedPatient.firstName} ${selectedPatient.lastName}`
          : null,
      },
    });
  }

  return (
    <div className="nc-page">
      {/* Page header */}
      <div className="nc-page-header">
        <button
          type="button"
          className="pt-back-btn"
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>
        <h1 className="nc-page-title">New consultation</h1>
      </div>

      <div className="nc-layout">
        {/* ── Left column: patient selection ── */}
        <div className="nc-col-left">
          <section className="nc-section" aria-labelledby="nc-patient-heading">
            <h2 className="nc-section-title" id="nc-patient-heading">
              Select existing patient
            </h2>

            {!selectedPatient ? (
              <PatientSearchPanel onSelect={handleSelect} />
            ) : (
              <SelectedPatientPanel
                patient={selectedPatient}
                onClear={handleClear}
              />
            )}
          </section>
        </div>

        {/* ── Right column: rich pre-consultation context ── */}
        <div className="nc-col-right">
          {selectedPatient ? (
            <PatientContextPanel
              patientId={selectedPatient._id}
              patientName={`${selectedPatient.firstName} ${selectedPatient.lastName}`}
            />
          ) : (
            <div className="nc-context-placeholder">
              <p className="nc-context-hint">
                Select a patient to see their clinical context.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Start button ── */}
      <div className="nc-footer">
        <button
          type="button"
          className="nc-start-btn"
          disabled={!selectedPatient}
          onClick={handleStart}
          aria-describedby={!selectedPatient ? 'nc-start-hint' : undefined}
        >
          Start consultation
        </button>
        {!selectedPatient && (
          <p className="nc-start-hint" id="nc-start-hint">
            Select a patient above to enable this button.
          </p>
        )}
      </div>
    </div>
  );
}
