import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiUrl } from './api.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatDateShort(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
  })
}

// ---------------------------------------------------------------------------
// SummaryCard
// ---------------------------------------------------------------------------
function SummaryCard({ label, value, accent, loading }) {
  return (
    <div className={`db-summary-card db-summary-card--${accent}`} aria-label={`${label}: ${value}`}>
      <span className="db-summary-value">
        {loading ? <span className="db-summary-skeleton" aria-hidden="true" /> : value}
      </span>
      <span className="db-summary-label">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConsultationCard
// ---------------------------------------------------------------------------
function ConsultationCard({ consultation, onOpen }) {
  const { note, status, createdAt, _id } = consultation
  const name      = note?.patient?.name?.trim() || null
  const complaint = note?.chief_complaint?.trim() || null

  return (
    <li className={`db-card db-card--${status}`}>
      <button
        type="button"
        className="db-card-btn"
        onClick={() => onOpen(consultation)}
        aria-label={`Open consultation${name ? ` for ${name}` : ''} from ${formatDate(createdAt)}`}
      >
        {/* Left accent bar colour is driven by CSS --[status] */}
        <div className="db-card-main">
          <div className="db-card-top">
            <span className="db-card-name">
              {name ?? <em className="db-card-unnamed">Patient name not recorded</em>}
            </span>
            <span className={`db-card-badge db-card-badge--${status}`}>
              {status === 'approved' ? '✓ Approved' : '⏳ Draft'}
            </span>
          </div>

          <p className="db-card-complaint">
            {complaint ?? <em className="db-card-unnamed">No chief complaint recorded</em>}
          </p>

          <div className="db-card-meta">
            <span className="db-card-date">{formatDateShort(createdAt)}</span>
            <span className="db-card-id">ID {_id.slice(-6)}</span>
          </div>
        </div>
        <span className="db-card-arrow" aria-hidden="true">→</span>
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
/**
 * Props:
 *   onOpen(consultation)  — called when a card is clicked
 *   onNewConsultation()   — called when "New consultation" is clicked
 *   refreshTrigger        — increment from parent to force re-fetch
 */
function Dashboard({ onOpen, onNewConsultation, refreshTrigger = 0 }) {
  const [consultations, setConsultations] = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState('')
  const [search, setSearch]               = useState('')
  const [filter, setFilter]               = useState('all')   // 'all' | 'draft' | 'approved'

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch(apiUrl('/api/consultations'))
      const data = await res.json()
      if (!data.success) {
        setError(data.message || 'Could not load consultations.')
      } else {
        setConsultations(data.consultations)
      }
    } catch {
      setError('Network error — could not load consultations.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll, refreshTrigger])

  // --------------------------------------------------------------------------
  // Derived data — all calculated from real API response
  // --------------------------------------------------------------------------
  const stats = useMemo(() => ({
    total:    consultations.length,
    draft:    consultations.filter((c) => c.status === 'draft').length,
    approved: consultations.filter((c) => c.status === 'approved').length,
  }), [consultations])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    return consultations.filter((c) => {
      // Status filter
      if (filter !== 'all' && c.status !== filter) return false

      // Search filter — name, chief complaint, transcript
      if (q) {
        const name      = (c.note?.patient?.name      ?? '').toLowerCase()
        const complaint = (c.note?.chief_complaint    ?? '').toLowerCase()
        const transcript = (c.transcript              ?? '').toLowerCase()
        if (!name.includes(q) && !complaint.includes(q) && !transcript.includes(q)) {
          return false
        }
      }

      return true
    })
  }, [consultations, search, filter])

  const FILTERS = [
    { key: 'all',      label: 'All',      count: stats.total },
    { key: 'draft',    label: 'Draft',    count: stats.draft },
    { key: 'approved', label: 'Approved', count: stats.approved },
  ]

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------
  return (
    <section className="db-wrapper" aria-label="Consultation dashboard">

      {/* ── Summary cards ── */}
      <div className="db-summary-row" aria-label="Summary statistics">
        <SummaryCard label="Total consultations" value={stats.total}    accent="neutral" loading={loading} />
        <SummaryCard label="Draft"               value={stats.draft}    accent="draft"   loading={loading} />
        <SummaryCard label="Approved"            value={stats.approved} accent="approved" loading={loading} />
      </div>

      {/* ── Section header + New button ── */}
      <div className="db-section-header">
        <h2 className="db-section-title">Consultations</h2>
        <button
          type="button"
          className="db-new-btn"
          onClick={onNewConsultation}
          aria-label="Start a new consultation recording"
        >
          + New consultation
        </button>
      </div>

      {/* ── Search ── */}
      <div className="db-search-row">
        <label htmlFor="db-search" className="db-search-label">Search</label>
        <div className="db-search-field">
          <span className="db-search-icon" aria-hidden="true">🔍</span>
          <input
            id="db-search"
            type="search"
            className="db-search-input"
            placeholder="Patient name, complaint, or transcript…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search consultations"
          />
          {search && (
            <button
              type="button"
              className="db-search-clear"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >✕</button>
          )}
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <div className="db-filter-tabs" role="tablist" aria-label="Filter consultations">
        {FILTERS.map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            role="tab"
            className={`db-filter-tab ${filter === key ? 'is-active' : ''}`}
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className="db-filter-count">{loading ? '…' : count}</span>
          </button>
        ))}
      </div>

      {/* ── Error ── */}
      {!loading && error && (
        <div className="db-error" role="alert">
          {error}
          <button type="button" className="db-error-retry" onClick={fetchAll}>Retry</button>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <ul className="db-list" aria-busy="true" aria-label="Loading…">
          {[1, 2, 3].map((i) => (
            <li key={i} className="db-card-skeleton">
              <span className="db-skeleton-line db-skeleton-line--wide"  aria-hidden="true" />
              <span className="db-skeleton-line db-skeleton-line--mid"   aria-hidden="true" />
              <span className="db-skeleton-line db-skeleton-line--short" aria-hidden="true" />
            </li>
          ))}
        </ul>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && filtered.length === 0 && (
        <div className="db-empty">
          {search || filter !== 'all' ? (
            <>
              <p className="db-empty-headline">No results found</p>
              <p className="db-empty-sub">
                Try adjusting your search or filter.
              </p>
              <button
                type="button"
                className="db-empty-action"
                onClick={() => { setSearch(''); setFilter('all') }}
              >
                Clear search &amp; filters
              </button>
            </>
          ) : (
            <>
              <p className="db-empty-headline">No consultations yet</p>
              <p className="db-empty-sub">
                Record your first consultation to get started.
              </p>
              <button
                type="button"
                className="db-empty-action"
                onClick={onNewConsultation}
              >
                Start recording
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Consultation list ── */}
      {!loading && !error && filtered.length > 0 && (
        <>
          <p className="db-result-count" aria-live="polite">
            {filtered.length === consultations.length
              ? `${filtered.length} consultation${filtered.length !== 1 ? 's' : ''}`
              : `${filtered.length} of ${consultations.length} consultation${consultations.length !== 1 ? 's' : ''}`
            }
          </p>
          <ul className="db-list" role="list">
            {filtered.map((c) => (
              <ConsultationCard key={c._id} consultation={c} onOpen={onOpen} />
            ))}
          </ul>
        </>
      )}

    </section>
  )
}

export default Dashboard
