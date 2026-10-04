/**
 * PatientProfilePage — Patient 360° view (Patient 360.2)
 *
 * Loads a single call to GET /api/patients/:id/overview which returns
 * the patient record, aggregate statistics, latest effective approved
 * consultation, and 5 most recent consultations — all in one round-trip.
 *
 * Layout:
 *   ┌ Page header (← Patients | Edit patient)
 *   ├ Archived banner (conditional)
 *   ├ Patient header  (name, DOB, sex, MR, phone)
 *   ├ Statistics cards (total / approved / draft / last visit)
 *   ├ Latest approved visit (chief complaint, symptoms, meds, assessment, follow-up)
 *   └ Recent consultations timeline (up to 5, correction-aware)
 *
 * Edit mode is unchanged from the original PatientProfilePage.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  apiGetPatientOverview,
  apiUpdatePatient,
} from '../services/api/patients.js';

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const SEX_OPTIONS = [
  { value: 'male',       label: 'Male' },
  { value: 'female',     label: 'Female' },
  { value: 'other',      label: 'Other' },
  { value: 'not_stated', label: 'Prefer not to state' },
];

function sexLabel(v) {
  return SEX_OPTIONS.find((o) => o.value === v)?.label ?? v ?? '—';
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function fmtShortDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function listOrDash(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return <em className="p360-none">None recorded</em>;
  return arr.join(', ');
}

// ---------------------------------------------------------------------------
// StatCard — one of the four statistics tiles
// ---------------------------------------------------------------------------
function StatCard({ label, value, accent }) {
  return (
    <div className={`p360-stat-card p360-stat-card--${accent}`}>
      <span className="p360-stat-value">{value ?? '—'}</span>
      <span className="p360-stat-label">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LatestVisitSection
// ---------------------------------------------------------------------------
function LatestVisitSection({ consultation }) {
  if (!consultation) {
    return (
      <section className="p360-card" aria-label="Latest approved visit">
        <h2 className="p360-section-title">Latest approved visit</h2>
        <p className="p360-empty">No approved consultation available yet.</p>
      </section>
    );
  }

  return (
    <section className="p360-card" aria-label="Latest approved visit">
      <div className="p360-section-header">
        <h2 className="p360-section-title">Latest approved visit</h2>
        <span className="p360-section-date">{fmtShortDate(consultation.consultationDate)}</span>
      </div>

      <dl className="p360-fields">
        {consultation.chief_complaint && (
          <div className="p360-field">
            <dt>Chief complaint</dt>
            <dd>{consultation.chief_complaint}</dd>
          </div>
        )}
        <div className="p360-field">
          <dt>Symptoms</dt>
          <dd>{listOrDash(consultation.symptoms)}</dd>
        </div>
        <div className="p360-field">
          <dt>Medications mentioned</dt>
          <dd>{listOrDash(consultation.medications_mentioned)}</dd>
        </div>
        {consultation.assessment && (
          <div className="p360-field p360-field--wide">
            <dt>Assessment</dt>
            <dd>{consultation.assessment}</dd>
          </div>
        )}
        {consultation.follow_up && (
          <div className="p360-field p360-field--wide">
            <dt>Follow-up</dt>
            <dd>{consultation.follow_up}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// TimelineSection — recent consultations (up to 5)
// ---------------------------------------------------------------------------
function TimelineSection({ consultations }) {
  return (
    <section className="p360-card" aria-label="Recent consultations">
      <h2 className="p360-section-title">Recent consultations</h2>

      {(!consultations || consultations.length === 0) && (
        <p className="p360-empty">No consultations recorded for this patient yet.</p>
      )}

      {consultations && consultations.length > 0 && (
        <ul className="p360-timeline" role="list">
          {consultations.map((c) => {
            const isSuperseded = Boolean(c.supersededBy);
            const isCorrection = Boolean(c.correctionOf);
            const consultId    = c.id ?? c._id;

            return (
              <li
                key={consultId}
                className={`p360-tl-item${isSuperseded ? ' p360-tl-item--superseded' : ''}`}
              >
                <div className="p360-tl-meta">
                  <span className="p360-tl-date">
                    {fmtShortDate(c.consultationDate)}
                  </span>
                  <span className={`p360-tl-badge p360-tl-badge--${c.status}`}>
                    {c.status}
                  </span>
                  {isCorrection && (
                    <span
                      className="p360-tl-badge p360-tl-badge--correction"
                      title="This note corrects an earlier consultation"
                    >
                      correction
                    </span>
                  )}
                  {isSuperseded && (
                    <span
                      className="p360-tl-badge p360-tl-badge--superseded"
                      title="This note has been superseded by a correction"
                    >
                      superseded
                    </span>
                  )}
                </div>

                <p className="p360-tl-complaint">
                  {c.chief_complaint
                    ? c.chief_complaint
                    : <em className="p360-none">No chief complaint recorded</em>
                  }
                </p>

                <Link
                  to={`/consultation/${consultId}`}
                  className="p360-tl-open"
                  aria-label={`Open consultation from ${fmtShortDate(c.consultationDate)}`}
                >
                  Open
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// PatientProfilePage
// ---------------------------------------------------------------------------
export default function PatientProfilePage() {
  const { id }   = useParams();
  const navigate = useNavigate();

  // ── Overview state ──────────────────────────────────────────────────────
  const [overview,  setOverview]  = useState(null);  // full API response
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  // ── Edit state (unchanged from Phase 3B) ───────────────────────────────
  const [editing,     setEditing]     = useState(false);
  const [editFields,  setEditFields]  = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [saveError,   setSaveError]   = useState('');
  const [saving,      setSaving]      = useState(false);

  async function loadOverview() {
    setLoading(true);
    setError('');
    try {
      const data = await apiGetPatientOverview(id);
      if (!data.success) {
        setError(data.message || 'Could not load patient overview.');
      } else {
        setOverview(data);
      }
    } catch {
      setError('Network error — could not load patient overview.');
    }
    setLoading(false);
  }

  useEffect(() => { loadOverview(); }, [id]);

  // ── Edit helpers (unchanged) ────────────────────────────────────────────
  function startEditing() {
    const p = overview.patient;
    setEditFields({
      firstName:       p.firstName ?? '',
      lastName:        p.lastName ?? '',
      dateOfBirth:     p.dateOfBirth
        ? new Date(p.dateOfBirth).toISOString().split('T')[0]
        : '',
      biologicalSex:   p.biologicalSex ?? '',
      phone:           p.phone ?? '',
      medicalRecordId: p.medicalRecordId ?? '',
      notes:           p.notes ?? '',
      isArchived:      p.isArchived ?? false,
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
    // Refresh overview so header reflects the updated patient
    await loadOverview();
    setEditing(false);
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="pt-page">
        <p className="pt-loading">Loading patient…</p>
      </div>
    );
  }

  // ── Error / not found ────────────────────────────────────────────────────
  if (error || !overview) {
    return (
      <div className="pt-page">
        <div className="pt-page-header">
          <button type="button" className="pt-back-btn" onClick={() => navigate('/patients')}>
            ← Back to patients
          </button>
        </div>
        <div className="pt-error" role="alert">
          {error || 'Patient not found.'}
          <button type="button" className="pt-retry-btn" onClick={loadOverview}>Retry</button>
        </div>
      </div>
    );
  }

  const { patient, statistics, latestApprovedConsultation, recentConsultations } = overview;

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

  // ── Patient 360 view ──────────────────────────────────────────────────────
  return (
    <div className="pt-page p360-page">

      {/* Page header */}
      <div className="pt-page-header">
        <button type="button" className="pt-back-btn" onClick={() => navigate('/patients')}>
          ← Patients
        </button>
        <button type="button" className="pt-edit-btn" onClick={startEditing}>
          Edit patient
        </button>
      </div>

      {/* Archived banner */}
      {patient.isArchived && (
        <div className="pt-archived-banner" role="status">
          This patient record is archived.
        </div>
      )}

      {/* Patient header */}
      <div className="p360-header-card">
        <div className="p360-name-row">
          <h1 className="p360-name">{patient.firstName} {patient.lastName}</h1>
          {patient.medicalRecordId && (
            <span className="p360-mrid">MR: {patient.medicalRecordId}</span>
          )}
        </div>
        <dl className="p360-header-meta">
          <div className="p360-header-field">
            <dt>Date of birth</dt>
            <dd>{fmtDate(patient.dateOfBirth)}</dd>
          </div>
          <div className="p360-header-field">
            <dt>Biological sex</dt>
            <dd>{sexLabel(patient.biologicalSex)}</dd>
          </div>
          {patient.phone && (
            <div className="p360-header-field">
              <dt>Phone</dt>
              <dd>{patient.phone}</dd>
            </div>
          )}
          {patient.notes && (
            <div className="p360-header-field p360-header-field--wide">
              <dt>Notes</dt>
              <dd className="p360-notes-text">{patient.notes}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Statistics */}
      <section className="p360-stats-row" aria-label="Consultation statistics">
        <StatCard
          label="Total consultations"
          value={statistics.totalConsultations}
          accent="neutral"
        />
        <StatCard
          label="Approved"
          value={statistics.approvedConsultations}
          accent="approved"
        />
        <StatCard
          label="Draft"
          value={statistics.draftConsultations}
          accent="draft"
        />
        <StatCard
          label="Last visit"
          value={statistics.lastConsultationDate
            ? fmtShortDate(statistics.lastConsultationDate)
            : '—'}
          accent="date"
        />
      </section>

      {/* Latest approved visit */}
      <LatestVisitSection consultation={latestApprovedConsultation} />

      {/* Recent consultations timeline */}
      <TimelineSection consultations={recentConsultations} />

    </div>
  );
}
