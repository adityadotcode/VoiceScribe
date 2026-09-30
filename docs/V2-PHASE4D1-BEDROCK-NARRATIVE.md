# VoiceScribe V2 — Phase 4D.1: Bedrock Narrative Generation

**Status:** Complete  
**Date:** 2026-09-24  
**Scope:** Backend only — no frontend, no schema changes  
**Tests:** 131 passing (10 new) across 7 suites

---

## Overview

Phase 4D.1 adds an **optional** Bedrock-generated clinical narrative to the existing deterministic change-summary endpoint. The structured diff remains the source of truth — the LLM narrative is an interpretation layered on top of it, never used to determine whether a field changed.

---

## `generateNarrative` behavior

The flag is passed in the POST body alongside the existing `currentConsultationId`:

```json
{
  "currentConsultationId": "<ObjectId>",
  "generateNarrative": true
}
```

| Value | Behavior |
|---|---|
| Absent (default) | Deterministic Phase 4B response only; Bedrock NOT called; no narrative fields in response |
| `false` | Same as absent |
| `true` | Deterministic diff computed first; then Bedrock called if conditions are met |

---

## Bedrock invocation conditions

Bedrock is called **only when all three conditions hold simultaneously**:

1. `generateNarrative === true` (client explicitly requested it)
2. A previous effective approved consultation was found
3. The current consultation has a valid note

If any condition is false, Bedrock is **not** called. This prevents unnecessary AWS invocations on every request.

Bedrock is **never** called automatically on:
- Patient page load
- Consultation creation
- Consultation approval
- Normal Phase 4B calls without `generateNarrative`

---

## Model input

The prompt sent to `amazon.nova-lite-v1:0` includes three sections:

1. **PREVIOUS CONSULTATION NOTE** — clinical fields serialised as labelled key-value text (chief complaint, symptoms, observations, assessment, medications mentioned, follow-up, history). No IDs, no tokens, no MongoDB internals.
2. **CURRENT CONSULTATION NOTE** — same format.
3. **STRUCTURED DIFF** — the deterministic output of `diffNotes()` serialised as labelled key-value text, explicitly marked as "ground truth".

Inference config: `maxTokens: 300`, `temperature: 0.2`, `topP: 0.9`.

---

## Safety instructions in the prompt

The model is instructed to:
- Describe only differences supported by the structured diff and notes.
- NOT invent, infer, or assume information not present in the supplied data.
- NOT diagnose, prescribe, recommend treatment, or make clinical decisions.
- Treat `medications_mentioned` as medications mentioned during the consultation only — NOT medication reconciliation. NOT state a medication was "started" or "stopped".
- Keep output under 200 words.
- Use concise, clinician-readable language.
- Synthesise — not repeat the diff verbatim.

---

## Response shapes

### `generateNarrative` omitted or `false` — unchanged Phase 4B shape

```json
{
  "success": true,
  "hasPreviousConsultation": true,
  "previousConsultation": { "id": "...", "consultationDate": "..." },
  "structuredDiff": { ... }
}
```

No `clinicalSummary`, `generatedAt`, or `narrativeError` keys appear.

### `generateNarrative: true` — Bedrock succeeded

```json
{
  "success": true,
  "hasPreviousConsultation": true,
  "previousConsultation": { "id": "...", "consultationDate": "..." },
  "structuredDiff": { ... },
  "clinicalSummary": "Patient presents with new onset fatigue...",
  "generatedAt": "2026-09-24T09:00:00.000Z"
}
```

### `generateNarrative: true` — no previous consultation

```json
{
  "success": true,
  "hasPreviousConsultation": false,
  "previousConsultation": null,
  "structuredDiff": null,
  "clinicalSummary": null,
  "narrativeError": "No previous approved consultation to compare against."
}
```

### `generateNarrative: true` — Bedrock failed

```json
{
  "success": true,
  "hasPreviousConsultation": true,
  "previousConsultation": { ... },
  "structuredDiff": { ... },
  "clinicalSummary": null,
  "narrativeError": "Unable to generate clinical summary."
}
```

`structuredDiff` is always returned even when Bedrock fails. Internal AWS/Bedrock error details are never exposed to the client — only the generic message above.

---

## Files changed

| File | Change |
|---|---|
| `server/src/services/bedrockService.js` | Added `generateChangeSummaryNarrative(previousNote, currentNote, structuredDiff)` + helper serialisers; updated `module.exports` |
| `server/src/controllers/patientController.js` | Added `generateChangeSummaryNarrative` import; updated `getChangeSummary` to read `generateNarrative`, conditionally call Bedrock, attach narrative fields |
| `server/package.json` | Added `--testTimeout=30000` to `npm test` script (prevents suite-ordering timeout) |
| `server/tests/integration/narrative_generation.test.js` | New — 10 integration tests |

---

## Tests

**File:** `server/tests/integration/narrative_generation.test.js`  
**Runner:** Jest + supertest  
**New tests:** 10 | **Total backend tests:** 131 (all passing)

| # | Scenario | Result |
|---|---|---|
| 1 | `generateNarrative` omitted → Bedrock not called; no narrative fields | ✓ |
| 2 | `generateNarrative: false` → Bedrock not called | ✓ |
| 3 | `generateNarrative: true` + no previous → Bedrock not called; `clinicalSummary: null` | ✓ |
| 4 | `generateNarrative: true` + valid comparison → Bedrock called | ✓ |
| 5 | `structuredDiff` passed as third argument to Bedrock function | ✓ |
| 6 | Bedrock response text becomes `clinicalSummary` | ✓ |
| 7 | Bedrock failure → `structuredDiff` still returned; `narrativeError` present | ✓ |
| 8 | Internal Bedrock error details not exposed to client | ✓ |
| 9 | Phase 4B response shape unchanged when `generateNarrative` omitted | ✓ |
| 10 | `generatedAt` is a valid ISO timestamp on success | ✓ |

---

## Test result

```
Test Suites: 7 passed, 7 total
Tests:       131 passed, 131 total
Time:        ~9 s
```

---

## Deferred to Phase 4D.2

| Item | Notes |
|---|---|
| Frontend `generateNarrative` toggle | `ChangeSummaryPanel` currently sends `generateNarrative: false` (or omits it); Phase 4D.2 adds a button to request the narrative |
| Narrative caching | Repeatedly generating for the same consultation pair costs money; a TTL cache could be added |
| Prompt versioning | The system prompt and inference config are hardcoded; externalising to config would ease tuning |
