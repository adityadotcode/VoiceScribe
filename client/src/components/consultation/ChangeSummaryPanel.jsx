/**
 * ChangeSummaryPanel — Phase 4C
 *
 * Explicitly user-triggered panel that compares the current consultation
 * against the previous effective approved consultation for the same patient.
 *
 * Behaviour:
 *   - Renders a "Compare with previous visit" button when idle.
 *   - Calls POST /api/patients/:patientId/change-summary on click.
 *   - Displays a deterministic structured diff — NO Bedrock / LLM output.
 *   - "Medications mentioned" is always labelled as mentioned, never as
 *     prescriptions or confirmed medication changes.
 *
 * Props:
 *   patientId             {string}  The patient's MongoDB ObjectId.
 *   consultationId        {string}  The current consultation's MongoDB ObjectId.
 *
 * The API call is never made automatically on mount. The doctor must
 * explicitly click the button.
 */

import { useState } from 'react';
import { apiGetChangeSummary } from '../../services/api/patients.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** Renders a labelled pill list. Returns null when items is empty. */
function PillList({ label, items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="cs-diff-row">
      <span className="cs-diff-label">{label}</span>
      <ul className="cs-pill-list">
        {items.map((item, i) => (
          <li key={i} className="cs-pill">{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Renders a labelled boolean flag. Returns null when value is false. */
function FlagRow({ label }) {
  return (
    <div className="cs-diff-row cs-diff-row--flag">
      <span className="cs-diff-label">{label}</span>
      <span className="cs-flag-indicator" aria-label="changed">changed</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChangeSummaryPanel
// ---------------------------------------------------------------------------
export default function ChangeSummaryPanel({ patientId, consultationId }) {
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Not renderable without both IDs
  if (!patientId || !consultationId) return null;

  async function handleCompare() {
    setState('loading');
    setResult(null);
    setErrorMsg('');
    try {
      const data = await apiGetChangeSummary(patientId, consultationId);
      if (!data.success) {
        setErrorMsg('Could not retrieve change summary.');
        setState('error');
      } else {
        setResult(data);
        setState('done');
      }
    } catch {
      setErrorMsg('Network error — could not retrieve change summary.');
      setState('error');
    }
  }

  // ── Idle: show trigger button ────────────────────────────────────────────
  if (state === 'idle') {
    return (
      <section className="cs-panel cs-panel--idle" aria-label="Change summary">
        <button
          type="button"
          className="cs-trigger-btn"
          onClick={handleCompare}
        >
          Compare with previous visit
        </button>
      </section>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <section className="cs-panel" aria-label="Change summary">
        <p className="cs-loading" aria-live="polite">Comparing with previous visit…</p>
      </section>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <section className="cs-panel" aria-label="Change summary">
        <div className="cs-error" role="alert">{errorMsg}</div>
        <button type="button" className="cs-retry-btn" onClick={handleCompare}>
          Try again
        </button>
      </section>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  const { hasPreviousConsultation, previousConsultation, structuredDiff: diff } = result;

  return (
    <section className="cs-panel cs-panel--result" aria-label="Change summary">
      <div className="cs-panel-header">
        <h3 className="cs-panel-title">Comparison with previous visit</h3>
        <button
          type="button"
          className="cs-close-btn"
          onClick={() => setState('idle')}
          aria-label="Close comparison"
        >
          ✕
        </button>
      </div>

      {/* No previous consultation */}
      {!hasPreviousConsultation && (
        <p className="cs-no-previous">
          No previous approved consultation available for comparison.
        </p>
      )}

      {/* Comparison available */}
      {hasPreviousConsultation && diff && (
        <>
          {previousConsultation?.consultationDate && (
            <p className="cs-compared-with">
              Compared with{' '}
              <strong>{formatDate(previousConsultation.consultationDate)}</strong>
            </p>
          )}

          {/* Check if there is anything to show */}
          {(() => {
            const hasArrayChanges =
              diff.newSymptoms?.length          > 0 ||
              diff.resolvedSymptoms?.length     > 0 ||
              diff.persistingSymptoms?.length   > 0 ||
              diff.newMedicationsMentioned?.length      > 0 ||
              diff.stoppedMedicationsMentioned?.length  > 0 ||
              diff.newObservations?.length      > 0 ||
              diff.resolvedObservations?.length > 0;

            const hasBooleanChanges =
              diff.chiefComplaintChanged ||
              diff.assessmentChanged     ||
              diff.followUpChanged       ||
              diff.historyChanged;

            if (!hasArrayChanges && !hasBooleanChanges) {
              return (
                <p className="cs-no-changes">
                  No changes detected in the compared fields.
                </p>
              );
            }

            return (
              <div className="cs-diff-body">
                {/* Array fields — only rendered when non-empty */}
                <PillList label="New symptoms"               items={diff.newSymptoms} />
                <PillList label="Resolved symptoms"          items={diff.resolvedSymptoms} />
                <PillList label="Persisting symptoms"        items={diff.persistingSymptoms} />
                <PillList label="New medications mentioned"  items={diff.newMedicationsMentioned} />
                <PillList label="Stopped medications mentioned" items={diff.stoppedMedicationsMentioned} />
                <PillList label="New observations"           items={diff.newObservations} />
                <PillList label="Resolved observations"      items={diff.resolvedObservations} />

                {/* Boolean flags — only rendered when true */}
                {diff.chiefComplaintChanged && <FlagRow label="Chief complaint" />}
                {diff.assessmentChanged     && <FlagRow label="Assessment" />}
                {diff.followUpChanged       && <FlagRow label="Follow-up" />}
                {diff.historyChanged        && <FlagRow label="History" />}
              </div>
            );
          })()}
        </>
      )}
    </section>
  );
}
