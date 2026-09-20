import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from './api.js'

/**
 * ConsultationHistory
 *
 * Props:
 *   onOpen(consultation) — called when the doctor clicks a row
 *   refreshTrigger       — increment this from the parent to force a re-fetch
 */
function ConsultationHistory({ onOpen, refreshTrigger = 0 }) {
  const [consultations, setConsultations] = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState('')

  const fetchHistory = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch(apiUrl('/api/consultations'))
      const data = await res.json()
      if (!data.success) {
        setError(data.message || 'Could not load history.')
      } else {
        setConsultations(data.consultations)
      }
    } catch {
      setError('Network error — could not load consultation history.')
    }
    setLoading(false)
  }, [])

  // Fetch on mount and whenever the parent increments refreshTrigger
  useEffect(() => { fetchHistory() }, [fetchHistory, refreshTrigger])

  function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }

  return (
    <section className="ch-wrapper" aria-label="Consultation history">
      <div className="ch-header">
        <h2 className="ch-title">Consultation history</h2>
        <button
          type="button"
          className="ch-refresh-btn"
          onClick={fetchHistory}
          aria-label="Refresh consultation list"
        >
          ↻ Refresh
        </button>
      </div>

      {loading && <p className="ch-loading">Loading…</p>}

      {!loading && error && (
        <p className="ch-error" role="alert">{error}</p>
      )}

      {!loading && !error && consultations.length === 0 && (
        <p className="ch-empty">No consultations saved yet.</p>
      )}

      {!loading && !error && consultations.length > 0 && (
        <ul className="ch-list" role="list">
          {consultations.map((c) => (
            <li key={c._id} className="ch-item">
              <button
                type="button"
                className="ch-item-btn"
                onClick={() => onOpen(c)}
                aria-label={`Open consultation from ${formatDate(c.createdAt)}`}
              >
                <div className="ch-item-top">
                  <span className="ch-complaint">
                    {c.note?.chief_complaint || <em>No chief complaint</em>}
                  </span>
                  <span className={`ch-status-badge ch-status-${c.status}`}>
                    {c.status}
                  </span>
                </div>
                <div className="ch-item-meta">
                  {c.note?.patient?.name
                    ? <span className="ch-patient">{c.note.patient.name}</span>
                    : <span className="ch-patient ch-patient--unknown">Patient not named</span>
                  }
                  <span className="ch-date">{formatDate(c.createdAt)}</span>
                </div>
                <div className="ch-item-id">ID: {c._id}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default ConsultationHistory
