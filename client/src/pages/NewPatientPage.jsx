import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCreatePatient } from '../services/api/patients.js';

const SEX_OPTIONS = [
  { value: '',           label: 'Select…' },
  { value: 'male',       label: 'Male' },
  { value: 'female',     label: 'Female' },
  { value: 'other',      label: 'Other' },
  { value: 'not_stated', label: 'Prefer not to state' },
];

export default function NewPatientPage() {
  const navigate = useNavigate();

  const [fields, setFields] = useState({
    firstName:      '',
    lastName:       '',
    dateOfBirth:    '',
    biologicalSex:  '',
    phone:          '',
    medicalRecordId: '',
    notes:          '',
  });

  const [fieldErrors,  setFieldErrors]  = useState({});
  const [serverError,  setServerError]  = useState('');
  const [dupWarning,   setDupWarning]   = useState(null); // possibleDuplicate payload
  const [submitting,   setSubmitting]   = useState(false);

  function set(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }));
    // Clear the field error when the user edits
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: '' }));
  }

  function validate() {
    const errs = {};
    if (!fields.firstName.trim())     errs.firstName     = 'First name is required.';
    if (!fields.lastName.trim())      errs.lastName      = 'Last name is required.';
    if (!fields.dateOfBirth)          errs.dateOfBirth   = 'Date of birth is required.';
    else if (new Date(fields.dateOfBirth) > new Date())
                                       errs.dateOfBirth  = 'Date of birth cannot be in the future.';
    if (!fields.biologicalSex)        errs.biologicalSex = 'Please select a biological sex.';
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    setServerError('');
    setDupWarning(null);

    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);

    const body = {
      firstName:      fields.firstName.trim(),
      lastName:       fields.lastName.trim(),
      dateOfBirth:    fields.dateOfBirth,
      biologicalSex:  fields.biologicalSex,
      phone:          fields.phone.trim(),
      medicalRecordId: fields.medicalRecordId.trim(),
      notes:          fields.notes.trim(),
    };

    const data = await apiCreatePatient(body);

    setSubmitting(false);

    if (!data.success) {
      setServerError(data.message || 'Failed to create patient. Please try again.');
      return;
    }

    // Backend may return a possibleDuplicate signal — show it but still navigate
    if (data.possibleDuplicate) {
      setDupWarning(data.possibleDuplicate.message);
    }

    // Navigate to the new patient's profile
    navigate(`/patients/${data.patient._id}`, { replace: true });
  }

  return (
    <div className="pt-page">
      <div className="pt-page-header">
        <h1 className="pt-page-title">New patient</h1>
        <button type="button" className="pt-back-btn" onClick={() => navigate('/patients')}>
          ← Back to patients
        </button>
      </div>

      {dupWarning && (
        <div className="pt-dup-warning" role="alert">
          <strong>⚠ Possible duplicate:</strong> {dupWarning}
        </div>
      )}

      {serverError && (
        <div className="pt-server-error" role="alert">{serverError}</div>
      )}

      <form className="pt-form" onSubmit={handleSubmit} noValidate>
        <div className="pt-form-section">
          <h2 className="pt-section-title">Identity</h2>

          <div className="pt-form-row">
            <div className="pt-field">
              <label htmlFor="firstName" className="pt-label">First name <span className="pt-required">*</span></label>
              <input id="firstName" type="text" className={`pt-input${fieldErrors.firstName ? ' is-invalid' : ''}`}
                value={fields.firstName} onChange={(e) => set('firstName', e.target.value)}
                autoComplete="given-name" disabled={submitting} />
              {fieldErrors.firstName && <p className="pt-field-error">{fieldErrors.firstName}</p>}
            </div>

            <div className="pt-field">
              <label htmlFor="lastName" className="pt-label">Last name <span className="pt-required">*</span></label>
              <input id="lastName" type="text" className={`pt-input${fieldErrors.lastName ? ' is-invalid' : ''}`}
                value={fields.lastName} onChange={(e) => set('lastName', e.target.value)}
                autoComplete="family-name" disabled={submitting} />
              {fieldErrors.lastName && <p className="pt-field-error">{fieldErrors.lastName}</p>}
            </div>
          </div>

          <div className="pt-form-row">
            <div className="pt-field">
              <label htmlFor="dateOfBirth" className="pt-label">Date of birth <span className="pt-required">*</span></label>
              <input id="dateOfBirth" type="date" className={`pt-input${fieldErrors.dateOfBirth ? ' is-invalid' : ''}`}
                value={fields.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)}
                disabled={submitting} />
              {fieldErrors.dateOfBirth && <p className="pt-field-error">{fieldErrors.dateOfBirth}</p>}
            </div>

            <div className="pt-field">
              <label htmlFor="biologicalSex" className="pt-label">Biological sex <span className="pt-required">*</span></label>
              <select id="biologicalSex" className={`pt-select${fieldErrors.biologicalSex ? ' is-invalid' : ''}`}
                value={fields.biologicalSex} onChange={(e) => set('biologicalSex', e.target.value)}
                disabled={submitting}>
                {SEX_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {fieldErrors.biologicalSex && <p className="pt-field-error">{fieldErrors.biologicalSex}</p>}
            </div>
          </div>
        </div>

        <div className="pt-form-section">
          <h2 className="pt-section-title">Contact &amp; reference</h2>

          <div className="pt-form-row">
            <div className="pt-field">
              <label htmlFor="phone" className="pt-label">Phone <span className="pt-optional">(optional)</span></label>
              <input id="phone" type="tel" className="pt-input"
                value={fields.phone} onChange={(e) => set('phone', e.target.value)}
                autoComplete="tel" disabled={submitting} />
            </div>

            <div className="pt-field">
              <label htmlFor="medicalRecordId" className="pt-label">Medical record ID <span className="pt-optional">(optional)</span></label>
              <input id="medicalRecordId" type="text" className="pt-input"
                value={fields.medicalRecordId} onChange={(e) => set('medicalRecordId', e.target.value)}
                disabled={submitting} />
            </div>
          </div>
        </div>

        <div className="pt-form-section">
          <h2 className="pt-section-title">Notes <span className="pt-optional">(optional)</span></h2>
          <textarea id="notes" className="pt-textarea" rows={3}
            value={fields.notes} onChange={(e) => set('notes', e.target.value)}
            placeholder="Administrative notes about this patient"
            disabled={submitting} />
        </div>

        <div className="pt-form-actions">
          <button type="button" className="pt-cancel-btn" onClick={() => navigate('/patients')} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="pt-submit-btn" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create patient'}
          </button>
        </div>
      </form>
    </div>
  );
}
