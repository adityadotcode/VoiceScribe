/**
 * ChangeSummaryPanel — Phase 4C / 4D.2
 *
 * Explicitly user-triggered panel that compares the current consultation
 * against the previous effective approved consultation for the same patient.
 *
 * Phase 4C behaviour (unchanged):
 *   - "Compare with previous visit" button calls the API with generateNarrative=false.
 *   - Displays the deterministic structured diff.
 *   - "Medications mentioned" is always labelled as mentioned, never as
 *     prescriptions or confirmed medication changes.
 *
 * Phase 4D.2 addition:
 *   - After the diff loads, a "Generate clinical summary" button appears
 *     ONLY when hasPreviousConsultation === true.
 *   - Clicking it calls the SAME API with generateNarrative=true.
 *   - Displays the returned clinicalSummary labelled as "AI Clinical Summary".
 *   - If clinicalSummary is null or narrativeError is present, shows a small
 *     non-blocking error message; the diff remains visible.
 *   - Narrative is NEVER requested automatically.
 *
 * Props:
 *   patientId      {string}  The patient's MongoDB ObjectId.
 *   consultationId {string}  The current consultation's MongoDB ObjectId.
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
  // Diff state
  const [state,    setState]    = useState('idle'); // idle | loading | done | error
  const [result,   setResult]   = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Narrative state (independent of diff state)
  const [narrativeState,   setNarrativeState]   = useState('idle'); // idle | loading | done | error
  const [clinicalSummary,  setClinicalSummary]  = useState(null);
  const [narrativeErrMsg,  setNarrativeErrMsg]  = useState('');

  // Not renderable without both IDs
  if (!patientId || !consultationId) return null;

  // ── Diff request (generateNarrative: false — same as Phase 4C) ──────────
  async function handleCompare() {
    setState('loading');
    setResult(null);
    setErrorMsg('');
    // Also reset any existing narrative when re-comparing
    setNarrativeState('idle');
    setClinicalSummary(null);
    setNarrativeErrMsg('');
    try {
      const data = await apiGetChangeSummary(patientId, consultationId, false);
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

  // ── Narrative request (generateNarrative: true — Phase 4D.2) ────────────
  async function handleGenerateNarrative() {
    setNarrativeState('loading');
    setClinicalSummary(null);
    setNarrativeErrMsg('');
    try {
      const data = await apiGetChangeSummary(patientId, consultationId, true);
      if (!data.success) {
        setNarrativeErrMsg('Clinical summary could not be generated.');
        setNarrativeState('error');
      } else if (data.narrativeError || !data.clinicalSummary) {
        // Backend returned success but narrative failed (Bedrock error path)
        setNarrativeErrMsg('Clinical summary could not be generated.');
        setNarrativeState('error');
      } else {
        setClinicalSummary(data.clinicalSummary);
        setNarrativeState('done');
      }
    } catch {
      setNarrativeErrMsg('Clinical summary could not be generated.');
      setNarrativeState('error');
    }
  }

  // ── Idle ─────────────────────────────────────────────────────────────────
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

  // ── Loading (diff) ───────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <section className="cs-panel" aria-label="Change summary">
        <p className="cs-loading" aria-live="polite">Comparing with previous visit…</p>
      </section>
    );
  }

  // ── Error (diff) ─────────────────────────────────────────────────────────
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

          {/* Deterministic diff */}
          {(() => {
            const hasArrayChanges =
              diff.newSymptoms?.length                 > 0 ||
              diff.resolvedSymptoms?.length            > 0 ||
              diff.persistingSymptoms?.length          > 0 ||
              diff.newMedicationsMentioned?.length     > 0 ||
              diff.stoppedMedicationsMentioned?.length > 0 ||
              diff.newObservations?.length             > 0 ||
              diff.resolvedObservations?.length        > 0;

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
                <PillList label="New symptoms"                  items={diff.newSymptoms} />
                <PillList label="Resolved symptoms"             items={diff.resolvedSymptoms} />
                <PillList label="Persisting symptoms"           items={diff.persistingSymptoms} />
                <PillList label="New medications mentioned"     items={diff.newMedicationsMentioned} />
                <PillList label="Stopped medications mentioned" items={diff.stoppedMedicationsMentioned} />
                <PillList label="New observations"              items={diff.newObservations} />
                <PillList label="Resolved observations"         items={diff.resolvedObservations} />
                {diff.chiefComplaintChanged && <FlagRow label="Chief complaint" />}
                {diff.assessmentChanged     && <FlagRow label="Assessment" />}
                {diff.followUpChanged       && <FlagRow label="Follow-up" />}
                {diff.historyChanged        && <FlagRow label="History" />}
              </div>
            );
          })()}

          {/* ── Phase 4D.2 — AI narrative section ── */}
          <div className="cs-narrative-section">
            {/* Narrative: idle — show generate button */}
            {narrativeState === 'idle' && (
              <button
                type="button"
                className="cs-narrative-btn"
                onClick={handleGenerateNarrative}
                aria-label="Generate clinical summary"
              >
                Generate clinical summary
              </button>
            )}

            {/* Narrative: loading */}
            {narrativeState === 'loading' && (
              <p className="cs-narrative-loading" aria-live="polite">
                Generating clinical summary…
              </p>
            )}

            {/* Narrative: error — non-blocking, diff remains visible */}
            {narrativeState === 'error' && (
              <div className="cs-narrative-error">
                <span>{narrativeErrMsg}</span>
                <button
                  type="button"
                  className="cs-narrative-retry"
                  onClick={handleGenerateNarrative}
                >
                  Try again
                </button>
              </div>
            )}

            {/* Narrative: done */}
            {narrativeState === 'done' && clinicalSummary && (
              <div className="cs-narrative-result">
                <div className="cs-narrative-header">
                  <span className="cs-narrative-label">AI Clinical Summary</span>
                  <button
                    type="button"
                    className="cs-narrative-dismiss"
                    onClick={() => { setNarrativeState('idle'); setClinicalSummary(null); }}
                    aria-label="Dismiss clinical summary"
                  >
                    ✕
                  </button>
                </div>
                <p className="cs-narrative-text">{clinicalSummary}</p>
                <p className="cs-narrative-disclaimer">
                  Generated from the compared consultation data. Not a diagnosis or prescription.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
