import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiListPatients } from '../services/api/patients.js';

function formatDob(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function PatientListPage() {
  const navigate = useNavigate();

  const [patients,  setPatients]  = useState([]);
  const [search,    setSearch]    = useState('');
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const debounceRef = useRef(null);

  async function fetchPatients(q = '') {
    setLoading(true);
    setError('');
    try {
      const data = await apiListPatients({ search: q });
      if (!data.success) {
        setError(data.message || 'Could not load patients.');
      } else {
        setPatients(data.patients);
      }
    } catch {
      setError('Network error — could not load patients.');
    }
    setLoading(false);
  }

  // Initial load
  useEffect(() => { fetchPatients(); }, []);

  // Debounced search: wait 350 ms after the user stops typing
  function handleSearchChange(e) {
    const q = e.target.value;
    setSearch(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPatients(q), 350);
  }

  return (
    <div className="pt-page">
      <div className="pt-page-header">
        <h1 className="pt-page-title">Patients</h1>
        <button
          type="button"
          className="pt-new-btn"
          onClick={() => navigate('/patients/new')}
        >
          + New patient
        </button>
      </div>

      {/* Search */}
      <div className="pt-search-row">
        <label htmlFor="pt-search" className="pt-search-label">Search</label>
        <div className="pt-search-field">
          <span className="pt-search-icon" aria-hidden="true">🔍</span>
          <input
            id="pt-search"
            type="search"
            className="pt-search-input"
            placeholder="Name or medical record ID…"
            value={search}
            onChange={handleSearchChange}
            aria-label="Search patients"
          />
          {search && (
            <button
              type="button"
              className="pt-search-clear"
              onClick={() => { setSearch(''); fetchPatients(''); }}
              aria-label="Clear search"
            >✕</button>
          )}
        </div>
      </div>

      {/* States */}
      {loading && <p className="pt-loading">Loading…</p>}

      {!loading && error && (
        <div className="pt-error" role="alert">
          {error}
          <button type="button" className="pt-retry-btn" onClick={() => fetchPatients(search)}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && patients.length === 0 && (
        <div className="pt-empty">
          <p className="pt-empty-headline">
            {search ? 'No patients match your search.' : 'No patients yet.'}
          </p>
          {!search && (
            <button type="button" className="pt-new-btn" onClick={() => navigate('/patients/new')}>
              Add your first patient
            </button>
          )}
          {search && (
            <button type="button" className="pt-link-btn" onClick={() => { setSearch(''); fetchPatients(''); }}>
              Clear search
            </button>
          )}
        </div>
      )}

      {!loading && !error && patients.length > 0 && (
        <>
          <p className="pt-result-count">
            {patients.length} patient{patients.length !== 1 ? 's' : ''}
          </p>
          <ul className="pt-list" role="list">
            {patients.map((p) => (
              <li key={p._id} className="pt-item">
                <Link to={`/patients/${p._id}`} className="pt-item-link">
                  <div className="pt-item-main">
                    <span className="pt-item-name">
                      {p.lastName}, {p.firstName}
                    </span>
                    <span className="pt-item-dob">{formatDob(p.dateOfBirth)}</span>
                  </div>
                  {p.medicalRecordId && (
                    <span className="pt-item-mrid">MR: {p.medicalRecordId}</span>
                  )}
                  <span className="pt-item-arrow" aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
