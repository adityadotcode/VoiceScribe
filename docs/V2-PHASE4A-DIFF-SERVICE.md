# VoiceScribe V2 — Phase 4A: Consultation Diff Service

**Status:** Complete  
**Date:** 2026-09-24  
**Scope:** Backend service + unit tests only  
**No API endpoint, no frontend, no schema changes, no AWS changes**  
**Tests:** 110 passing (36 new unit tests) across 5 suites

---

## Service purpose

`consultationDiffService.js` provides a single pure function, `diffNotes(previousNote, currentNote)`, that compares two consultation note sub-documents and returns a structured, deterministic diff.

It is designed to power:
- A "what changed since last visit" section in the consultation review screen (Phase 4B)
- Possible Bedrock prompt enrichment (future phase)
- Any export or audit trail that needs a structured changelog

The service is **purely computational** — no I/O, no Mongoose, no Express, no AWS. It can be called from a controller, a background job, or a test without any mocking.

---

## Comparison rules

### Array fields

Three array fields are compared: `symptoms`, `medications_mentioned`, `observations`.

| Output key | Meaning |
|---|---|
| `newSymptoms` | In current, not in previous |
| `resolvedSymptoms` | In previous, not in current |
| `persistingSymptoms` | In both |
| `newMedicationsMentioned` | In current, not in previous |
| `stoppedMedicationsMentioned` | In previous, not in current |
| `newObservations` | In current, not in previous |
| `resolvedObservations` | In previous, not in current |

**`medications_mentioned` means medications mentioned during the consultation — not confirmed prescriptions. No medication reconciliation is performed.**

### String fields

Four string fields are compared for equality: `chief_complaint`, `assessment`, `follow_up`, `history`.

| Output key | Type | True when |
|---|---|---|
| `chiefComplaintChanged` | boolean | `chief_complaint` text differs |
| `assessmentChanged` | boolean | `assessment` text differs |
| `followUpChanged` | boolean | `follow_up` text differs |
| `historyChanged` | boolean | `history` text differs |

### Normalisation

All comparisons are **case-insensitive** and **trim whitespace** before comparing. The original (un-normalised) value from the **current note** is preserved in output arrays. Output values from the **previous note** (for resolved/stopped items) preserve their original form too.

Duplicate values within a single note are deduplicated by normalised value before diffing; the first occurrence's original form is kept.

### Safety

`null`, `undefined`, non-array, and empty arrays are all treated as empty arrays. `null`/`undefined` string fields are treated as empty strings. Both `previousNote` and `currentNote` may be `null`/`undefined` — the function treats them as empty notes and never throws.

---

## Output structure

```js
{
  // Symptoms
  newSymptoms:        string[],   // new this visit
  resolvedSymptoms:   string[],   // gone since last visit
  persistingSymptoms: string[],   // present at both visits

  // Medications mentioned (not prescriptions)
  newMedicationsMentioned:     string[],
  stoppedMedicationsMentioned: string[],

  // Observations
  newObservations:      string[],
  resolvedObservations: string[],

  // String field change flags
  assessmentChanged:    boolean,
  chiefComplaintChanged: boolean,
  followUpChanged:      boolean,
  historyChanged:       boolean,
}
```

---

## Files created

| File | Description |
|---|---|
| `server/src/services/consultationDiffService.js` | Pure diff service (exports `diffNotes`) |
| `server/tests/unit/consultationDiffService.test.js` | 36 unit tests |

---

## Tests

**Runner:** Jest (Node)  
**New tests:** 36 across 11 `describe` blocks  
**Total backend tests:** 110 (all passing)

| # | Describe | Tests | Result |
|---|---|---|---|
| 1 | New symptoms | 2 | ✓ |
| 2 | Resolved symptoms | 2 | ✓ |
| 3 | Persisting symptoms | 3 | ✓ |
| 4 | Medication differences | 3 | ✓ |
| 5 | Observation differences | 3 | ✓ |
| 6 | Changed string fields | 5 | ✓ |
| 7 | Identical notes | 1 | ✓ |
| 8 | Empty previous note | 3 | ✓ |
| 9 | Empty current note | 2 | ✓ |
| 10 | Casing / whitespace normalisation | 6 | ✓ |
| 11 | Null / missing fields | 6 | ✓ |

---

## Test result

```
Test Suites: 5 passed, 5 total
Tests:       110 passed, 110 total
Time:        23.4 s
```

---

## Deferred to later phases

| Item | Notes |
|---|---|
| API endpoint exposing the diff | Phase 4B |
| Frontend "what changed" section | Phase 4B |
| Bedrock prompt enrichment using diff | Future |
| Diff for `duration`, `missing_information`, `uncertain_fields` | Not requested in Phase 4A spec; trivially addable |
