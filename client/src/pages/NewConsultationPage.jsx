/**
 * NewConsultationPage — Phase 3B.2A
 *
 * Flow:
 *   1. Doctor searches for and selects an existing patient.
 *   2. Selected patient's basic info is shown with a "Change patient" link.
 *   3. The patient's last effective approved consultation is fetched and
 *      displayed as context for the upcoming encounter.
 *   4. "Start consultation" button is enabled once a patient is selected.
 *      Clicking it navigates to /dashboard where the recording pipeline lives.
 *
 * TODO (Phase 3B.2B):
 *   Pass selectedPatient.id through to the recording/save pipeline so the
 *   new consultation is created with patientId set. Currently the navigate
 *   to /dashboard starts a vanilla consultation without patientId because
 *   DashboardApp holds all pipeline state internally and does not accept
 *   router state yet.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  apiListPatients,
  apiGetLastApproved,
} from '../services/api/patients.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatConsultDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
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
// PatientSearchPanel
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
    // Trigger search after 300 ms; always search (empty query returns all)
    debounceRef.current = setTimeout(() => search(q), 300);
  }

  // Trigger an initial load on mount so the list is pre-populated
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
// SelectedPatientPanel
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
      <dl className="nc-patient-details">
        <div className="nc-detail-row">
          <dt>Date of birth</dt>
          <dd>{formatDate(patient.dateOfBirth)}</dd>
        </div>
        <div className="nc-detail-row">
          <dt>Biological sex</dt>
          <dd>{sexLabel(patient.biologicalSex)}</dd>
        </div>
        {patient.medicalRecordId && (
          <div className="nc-detail-row">
            <dt>Medical record ID</dt>
            <dd>{patient.medicalRecordId}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LastApprovedPanel
// ---------------------------------------------------------------------------
function LastApprovedPanel({ patientId }) {
  const [consultation, setConsultation] = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [empty,        setEmpty]        = useState(false);
  const [error,        setError]        = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEmpty(false);
    setError('');
    setConsultation(null);

    apiGetLastApproved(patientId)
      .then((data) => {
        if (cancelled) return;
        if (!data.success) {
          // 404 = no approved consultation yet — not an error, just empty
          setEmpty(true);
        } else {
          setConsultation(data.consultation);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load last approved consultation.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [patientId]);

  return (
    <section className="nc-last-approved" aria-labelledby="nc-la-heading">
      <h3 className="nc-la-heading" id="nc-la-heading">
        Last approved consultation
      </h3>

      {loading && <p className="nc-la-loading">Loading…</p>}

      {!loading && error && (
        <p className="nc-la-error" role="alert">{error}</p>
      )}

      {!loading && !error && empty && (
        <p className="nc-la-empty">No previous approved consultation.</p>
      )}

      {!loading && !error && consultation && (
        <dl className="nc-la-fields">
          <div className="nc-la-row">
            <dt>Consultation date</dt>
            <dd>{formatConsultDate(consultation.consultationDate ?? consultation.createdAt)}</dd>
          </div>
          {consultation.note?.chief_complaint && (
            <div className="nc-la-row nc-la-row--wide">
              <dt>Chief complaint</dt>
              <dd>{consultation.note.chief_complaint}</dd>
            </div>
          )}
          {consultation.note?.symptoms !== undefined && (
            <div className="nc-la-row nc-la-row--wide">
              <dt>Symptoms</dt>
              <dd>{listField(consultation.note.symptoms)}</dd>
            </div>
          )}
          {consultation.note?.medications_mentioned !== undefined && (
            <div className="nc-la-row nc-la-row--wide">
              <dt>Medications mentioned</dt>
              <dd>{listField(consultation.note.medications_mentioned)}</dd>
            </div>
          )}
          {consultation.note?.assessment && (
            <div className="nc-la-row nc-la-row--wide">
              <dt>Assessment</dt>
              <dd>{consultation.note.assessment}</dd>
            </div>
          )}
          {consultation.note?.follow_up && (
            <div className="nc-la-row nc-la-row--wide">
              <dt>Follow-up</dt>
              <dd>{consultation.note.follow_up}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
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
    // TODO (Phase 3B.2B): pass selectedPatient._id through router state so
    // DashboardApp can pick it up and include patientId when creating the
    // consultation. Currently DashboardApp holds all pipeline state internally
    // and does not read location.state.  For now we navigate to /dashboard
    // which starts the recording flow — patientId wiring is the next task.
    navigate('/dashboard', {
      state: {
        startRecording: true,
        patientId:      selectedPatient?._id ?? null,
        patientName:    selectedPatient
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

        {/* ── Right column: last-approved context ── */}
        <div className="nc-col-right">
          {selectedPatient ? (
            <LastApprovedPanel patientId={selectedPatient._id} />
          ) : (
            <div className="nc-context-placeholder">
              <p className="nc-context-hint">
                Select a patient to see their last approved consultation.
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
