'use strict';

/**
 * consultationDiffService — Phase 4A
 *
 * Pure, deterministic functions for comparing two consultation notes.
 * No I/O, no Mongoose, no AWS, no Bedrock.  Safe to call from a controller,
 * a background job, or a test without any mocking.
 *
 * Terminology (mirrors Consultation.js NoteSchema):
 *   symptoms              — symptoms reported by the patient
 *   medications_mentioned — medications mentioned during the consultation
 *                           (NOT confirmed prescriptions; no reconciliation)
 *   observations          — clinical observations recorded by the clinician
 *   chief_complaint       — primary reason for the encounter
 *   assessment            — clinician's assessment
 *   follow_up             — follow-up instructions
 *   history               — relevant medical history
 *
 * Normalisation rules:
 *   - All string comparisons are case-insensitive.
 *   - Leading/trailing whitespace is trimmed before comparison.
 *   - Empty strings after trimming are treated as absent.
 *   - Duplicate values within a single note are deduplicated before diffing.
 *   - Readable current-note values (original casing/spacing) are preserved
 *     in the output arrays.
 *
 * @module consultationDiffService
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a string for comparison: trim whitespace and lower-case.
 * Returns an empty string for anything that isn't a non-empty string.
 *
 * @param {*} v
 * @returns {string}
 */
function normalise(v) {
  if (typeof v !== 'string') return '';
  return v.trim().toLowerCase();
}

/**
 * Convert a potentially-null/undefined/non-array value into a clean array of
 * non-empty strings, deduplicating by normalised value while preserving the
 * original (un-normalised) form of the first occurrence.
 *
 * @param {*} arr
 * @returns {string[]}
 */
function toCleanArray(arr) {
  if (!Array.isArray(arr)) return [];
  const seen  = new Set();
  const result = [];
  for (const item of arr) {
    const n = normalise(item);
    if (n && !seen.has(n)) {
      seen.add(n);
      result.push(typeof item === 'string' ? item.trim() : n);
    }
  }
  return result;
}

/**
 * Diff two arrays of strings.
 *
 * Returns items that appear in `current` but not in `previous` (added),
 * items that appear in `previous` but not in `current` (removed), and
 * items that appear in both (persisting).
 *
 * Output values come from the current array (for added/persisting) or the
 * previous array (for removed), preserving their original readable form.
 *
 * @param {*} previous
 * @param {*} current
 * @returns {{ added: string[], removed: string[], persisting: string[] }}
 */
function diffArrays(previous, current) {
  const prev = toCleanArray(previous);
  const curr = toCleanArray(current);

  const prevSet = new Set(prev.map(normalise));
  const currSet = new Set(curr.map(normalise));

  const added     = curr.filter((v) => !prevSet.has(normalise(v)));
  const removed   = prev.filter((v) => !currSet.has(normalise(v)));
  const persisting = curr.filter((v) => prevSet.has(normalise(v)));

  return { added, removed, persisting };
}

/**
 * Determine whether a string field has meaningfully changed between two notes.
 * Empty/null/undefined and a non-empty value are considered a change.
 * Two empty values are considered identical.
 *
 * @param {*} prevVal
 * @param {*} currVal
 * @returns {boolean}
 */
function stringChanged(prevVal, currVal) {
  return normalise(prevVal) !== normalise(currVal);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare two consultation note objects and return a structured diff.
 *
 * Both `previousNote` and `currentNote` are the `note` sub-documents from a
 * Consultation document (plain objects or Mongoose sub-documents with .toObject).
 * Passing null/undefined for either is safe — it is treated as an empty note.
 *
 * @param {object|null|undefined} previousNote
 * @param {object|null|undefined} currentNote
 * @returns {{
 *   newSymptoms: string[],
 *   resolvedSymptoms: string[],
 *   persistingSymptoms: string[],
 *   newMedicationsMentioned: string[],
 *   stoppedMedicationsMentioned: string[],
 *   newObservations: string[],
 *   resolvedObservations: string[],
 *   assessmentChanged: boolean,
 *   chiefComplaintChanged: boolean,
 *   followUpChanged: boolean,
 *   historyChanged: boolean,
 * }}
 */
function diffNotes(previousNote, currentNote) {
  const prev = previousNote ?? {};
  const curr = currentNote  ?? {};

  const symptomDiff = diffArrays(prev.symptoms, curr.symptoms);
  const medsDiff    = diffArrays(prev.medications_mentioned, curr.medications_mentioned);
  const obsDiff     = diffArrays(prev.observations, curr.observations);

  return {
    // Symptoms
    newSymptoms:        symptomDiff.added,
    resolvedSymptoms:   symptomDiff.removed,
    persistingSymptoms: symptomDiff.persisting,

    // Medications mentioned
    newMedicationsMentioned:     medsDiff.added,
    stoppedMedicationsMentioned: medsDiff.removed,

    // Observations
    newObservations:      obsDiff.added,
    resolvedObservations: obsDiff.removed,

    // String fields
    assessmentChanged:    stringChanged(prev.assessment,    curr.assessment),
    chiefComplaintChanged: stringChanged(prev.chief_complaint, curr.chief_complaint),
    followUpChanged:      stringChanged(prev.follow_up,     curr.follow_up),
    historyChanged:       stringChanged(prev.history,       curr.history),
  };
}

module.exports = { diffNotes };
