import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  apiGetPatient,
  apiUpdatePatient,
  apiGetPatientConsultations,
} from '../services/api/patients.js';

const SEX_OPTIONS = [
  { value: 'male',       label: 'Male' },
  { value: 'female',     label: 'Female' },
  { value: 'other',      label: 'Other' },
  { value: 'not_stated', label: 'Prefer not to state' },
];

function formatDob(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function sexLabel(v) {
  return SEX_OPTIONS.find((o) => o.value === v)?.label ?? v ?? '—';
}

/** Format a date+time for the consultation list. */
function formatConsultationDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// ConsultationHistorySection
// ---------------------------------------------------------------------------
// Isolated sub-component so its loading state is independent from the
// patient-load state above it.
function ConsultationHistorySection({ patientId }) {
  const [consultations, setConsultations] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await apiGetPatientConsultations(patientId);
      if (!data.success) {
        setError(data.message || 'Could not load consultation history.');
      } else {
        setConsultations(data.consultations);
      }
    } catch {
      setError('Network error — could not load consultation history.');
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [patientId]);

  return (
    <section className="ph-section" aria-labelledby="ph-heading">
      <div className="ph-section-header">
        <h2 className="ph-heading" id="ph-heading">Consultation history</h2>
        {!loading && (
          <button
            type="button"
            className="ph-refresh-btn"
            onClick={load}
            aria-label="Refresh consultation history"
          >
            ↻ Refresh
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <p className="ph-loading" aria-live="polite">Loading history…</p>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="ph-error" role="alert">
          {error}
          <button type="button" className="pt-retry-btn" onClick={load}>Retry</button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && consultations.length === 0 && (
        <p className="ph-empty">No consultations recorded for this patient yet.</p>
      )}

      {/* History list */}
      {!loading && !error && consultations.length > 0 && (
        <ul className="ph-list" role="list">
          {consultations.map((c) => (
            <ConsultationRow key={c._id} consultation={c} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ConsultationRow
// ---------------------------------------------------------------------------
function ConsultationRow({ consultation: c }) {
  const isSuperseded = Boolean(c.supersededBy);
  const isCorrection = Boolean(c.correctionOf);

  // /consultation/:id route is not implemented yet (Phase 3B.2).
  // Render as a static row with an "Open" button that is disabled + labelled.
  return (
    <li className={`ph-item${isSuperseded ? ' ph-item--superseded' : ''}`}>
      <div className="ph-item-main">

        {/* Top row: date + status badge */}
        <div className="ph-item-top">
          <span className="ph-date">
            {formatConsultationDate(c.consultationDate ?? c.createdAt)}
          </span>
          <span className={`ph-badge ph-badge--${c.status}`}>
            {c.status}
          </span>
          {isCorrection && (
            <span className="ph-badge ph-badge--correction" title="This note corrects an earlier consultation">
              correction
            </span>
          )}
          {isSuperseded && (
            <span className="ph-badge ph-badge--superseded" title="This note has been superseded by a correction">
              superseded
            </span>
          )}
        </div>

        {/* Chief complaint */}
        <p className="ph-complaint">
          {c.note?.chief_complaint
            ? c.note.chief_complaint
            : <em className="ph-no-complaint">No chief complaint recorded</em>
          }
        </p>

        {/* Encounter type */}
        {c.encounterType && (
          <span className="ph-encounter">{c.encounterType.replace('_', ' ')}</span>
        )}
      </div>

      {/* Open action — deferred until /consultation/:id is built (Phase 3B.2) */}
      <button
        type="button"
        className="ph-open-btn"
        disabled
        aria-label="Open consultation (coming soon)"
        title="Consultation detail view coming in a future update"
      >
        Open
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// PatientProfilePage
// ---------------------------------------------------------------------------
export default function PatientProfilePage() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [patient,     setPatient]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [editing,     setEditing]     = useState(false);
  const [editFields,  setEditFields]  = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [saveError,   setSaveError]   = useState('');
  const [saving,      setSaving]      = useState(false);

  async function loadPatient() {
    setLoading(true);
    setError('');
    try {
      const data = await apiGetPatient(id);
      if (!data.success) {
        setError(data.message || 'Could not load patient.');
      } else {
        setPatient(data.patient);
      }
    } catch {
      setError('Network error — could not load patient.');
    }
    setLoading(false);
  }

  useEffect(() => { loadPatient(); }, [id]);

  function startEditing() {
    setEditFields({
      firstName:       patient.firstName ?? '',
      lastName:        patient.lastName ?? '',
      dateOfBirth:     patient.dateOfBirth
        ? new Date(patient.dateOfBirth).toISOString().split('T')[0]
        : '',
      biologicalSex:   patient.biologicalSex ?? '',
      phone:           patient.phone ?? '',
      medicalRecordId: patient.medicalRecordId ?? '',
      notes:           patient.notes ?? '',
      isArchived:      patient.isArchived ?? false,
    });
    setFieldErrors({});
    setSaveError('');
    setEditing(true);
  }

  function setEF(key, value) {
    setEditFields((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: '' }));
  }

  function validateEdit() {
    const errs = {};
    if (!editFields.firstName?.trim())    errs.firstName    = 'First name is required.';
    if (!editFields.lastName?.trim())     errs.lastName     = 'Last name is required.';
    if (!editFields.dateOfBirth)          errs.dateOfBirth  = 'Date of birth is required.';
    else if (new Date(editFields.dateOfBirth) > new Date())
                                           errs.dateOfBirth = 'Date of birth cannot be in the future.';
    if (!editFields.biologicalSex)        errs.biologicalSex = 'Please select a biological sex.';
    return errs;
  }

  async function handleSave(e) {
    e.preventDefault();
    if (saving) return;

    const errs = validateEdit();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    setSaveError('');

    const data = await apiUpdatePatient(id, {
      firstName:       editFields.firstName.trim(),
      lastName:        editFields.lastName.trim(),
      dateOfBirth:     editFields.dateOfBirth,
      biologicalSex:   editFields.biologicalSex,
      phone:           editFields.phone.trim(),
      medicalRecordId: editFields.medicalRecordId.trim(),
      notes:           editFields.notes.trim(),
      isArchived:      editFields.isArchived,
    });

    setSaving(false);

    if (!data.success) {
      setSaveError(data.message || 'Save failed. Please try again.');
      return;
    }

    setPatient(data.patient);
    setEditing(false);
  }

  // ── Loading / error states ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="pt-page">
        <p className="pt-loading">Loading patient…</p>
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="pt-page">
        <div className="pt-page-header">
          <button type="button" className="pt-back-btn" onClick={() => navigate('/patients')}>
            ← Back to patients
          </button>
        </div>
        <div className="pt-error" role="alert">
          {error || 'Patient not found.'}
          <button type="button" className="pt-retry-btn" onClick={loadPatient}>Retry</button>
        </div>
      </div>
    );
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="pt-page">
        <div className="pt-page-header">
          <h1 className="pt-page-title">Edit patient</h1>
          <button type="button" className="pt-back-btn" onClick={() => setEditing(false)}>
            ← Cancel
          </button>
        </div>

        {saveError && <div className="pt-server-error" role="alert">{saveError}</div>}

        <form className="pt-form" onSubmit={handleSave} noValidate>
          <div className="pt-form-section">
            <h2 className="pt-section-title">Identity</h2>
            <div className="pt-form-row">
              <div className="pt-field">
                <label htmlFor="ef-firstName" className="pt-label">First name <span className="pt-required">*</span></label>
                <input id="ef-firstName" type="text" className={`pt-input${fieldErrors.firstName ? ' is-invalid' : ''}`}
                  value={editFields.firstName} onChange={(e) => setEF('firstName', e.target.value)} disabled={saving} />
                {fieldErrors.firstName && <p className="pt-field-error">{fieldErrors.firstName}</p>}
              </div>
              <div className="pt-field">
                <label htmlFor="ef-lastName" className="pt-label">Last name <span className="pt-required">*</span></label>
                <input id="ef-lastName" type="text" className={`pt-input${fieldErrors.lastName ? ' is-invalid' : ''}`}
                  value={editFields.lastName} onChange={(e) => setEF('lastName', e.target.value)} disabled={saving} />
                {fieldErrors.lastName && <p className="pt-field-error">{fieldErrors.lastName}</p>}
              </div>
            </div>
            <div className="pt-form-row">
              <div className="pt-field">
                <label htmlFor="ef-dob" className="pt-label">Date of birth <span className="pt-required">*</span></label>
                <input id="ef-dob" type="date" className={`pt-input${fieldErrors.dateOfBirth ? ' is-invalid' : ''}`}
                  value={editFields.dateOfBirth} onChange={(e) => setEF('dateOfBirth', e.target.value)} disabled={saving} />
                {fieldErrors.dateOfBirth && <p className="pt-field-error">{fieldErrors.dateOfBirth}</p>}
              </div>
              <div className="pt-field">
                <label htmlFor="ef-sex" className="pt-label">Biological sex <span className="pt-required">*</span></label>
                <select id="ef-sex" className={`pt-select${fieldErrors.biologicalSex ? ' is-invalid' : ''}`}
                  value={editFields.biologicalSex} onChange={(e) => setEF('biologicalSex', e.target.value)} disabled={saving}>
                  <option value="">Select…</option>
                  {SEX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {fieldErrors.biologicalSex && <p className="pt-field-error">{fieldErrors.biologicalSex}</p>}
              </div>
            </div>
          </div>

          <div className="pt-form-section">
            <h2 className="pt-section-title">Contact &amp; reference</h2>
            <div className="pt-form-row">
              <div className="pt-field">
                <label htmlFor="ef-phone" className="pt-label">Phone</label>
                <input id="ef-phone" type="tel" className="pt-input"
                  value={editFields.phone} onChange={(e) => setEF('phone', e.target.value)} disabled={saving} />
              </div>
              <div className="pt-field">
                <label htmlFor="ef-mrid" className="pt-label">Medical record ID</label>
                <input id="ef-mrid" type="text" className="pt-input"
                  value={editFields.medicalRecordId} onChange={(e) => setEF('medicalRecordId', e.target.value)} disabled={saving} />
              </div>
            </div>
          </div>

          <div className="pt-form-section">
            <h2 className="pt-section-title">Notes</h2>
            <textarea className="pt-textarea" rows={3}
              value={editFields.notes} onChange={(e) => setEF('notes', e.target.value)}
              placeholder="Administrative notes" disabled={saving} />
          </div>

          <div className="pt-form-section">
            <label className="pt-checkbox-label">
              <input type="checkbox" checked={editFields.isArchived}
                onChange={(e) => setEF('isArchived', e.target.checked)} disabled={saving} />
              <span>Archive this patient</span>
            </label>
            <p className="pt-checkbox-hint">Archived patients are hidden from the default list but not deleted.</p>
          </div>

          <div className="pt-form-actions">
            <button type="button" className="pt-cancel-btn" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="pt-submit-btn" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ── View mode ─────────────────────────────────────────────────────────────
  return (
    <div className="pt-page">
      <div className="pt-page-header">
        <button type="button" className="pt-back-btn" onClick={() => navigate('/patients')}>
          ← Patients
        </button>
        <button type="button" className="pt-edit-btn" onClick={startEditing}>
          Edit patient
        </button>
      </div>

      {patient.isArchived && (
        <div className="pt-archived-banner" role="status">
          This patient record is archived.
        </div>
      )}

      <div className="pt-profile-card">
        <h1 className="pt-profile-name">{patient.firstName} {patient.lastName}</h1>

        <dl className="pt-detail-grid">
          <div className="pt-detail-row">
            <dt className="pt-detail-label">Date of birth</dt>
            <dd className="pt-detail-value">{formatDob(patient.dateOfBirth)}</dd>
          </div>
          <div className="pt-detail-row">
            <dt className="pt-detail-label">Biological sex</dt>
            <dd className="pt-detail-value">{sexLabel(patient.biologicalSex)}</dd>
          </div>
          {patient.medicalRecordId && (
            <div className="pt-detail-row">
              <dt className="pt-detail-label">Medical record ID</dt>
              <dd className="pt-detail-value">{patient.medicalRecordId}</dd>
            </div>
          )}
          {patient.phone && (
            <div className="pt-detail-row">
              <dt className="pt-detail-label">Phone</dt>
              <dd className="pt-detail-value">{patient.phone}</dd>
            </div>
          )}
          {patient.notes && (
            <div className="pt-detail-row pt-detail-row--wide">
              <dt className="pt-detail-label">Notes</dt>
              <dd className="pt-detail-value pt-detail-notes">{patient.notes}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Consultation history — Phase 3B.1 */}
      <ConsultationHistorySection patientId={id} />
    </div>
  );
}
