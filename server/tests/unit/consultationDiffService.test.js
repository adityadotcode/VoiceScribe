'use strict';

/**
 * Phase 4A — consultationDiffService unit tests
 *
 * Pure unit tests — no Mongoose, no Express, no HTTP, no mocks needed.
 * The service is a set of deterministic functions over plain objects.
 *
 * Covered scenarios (11):
 *   1.  New symptoms appear in current note
 *   2.  Resolved symptoms absent from current note
 *   3.  Persisting symptoms present in both notes
 *   4.  Medication differences (new + stopped)
 *   5.  Observation differences (new + resolved)
 *   6.  Changed string fields (assessment, chief_complaint, follow_up, history)
 *   7.  Identical notes produce empty arrays and false flags
 *   8.  Empty previous note — all current items are "new"
 *   9.  Empty current note — all previous items are "resolved/stopped"
 *  10.  Casing and whitespace normalisation
 *  11.  Null / missing fields handled safely
 */

const { diffNotes } = require('../../src/services/consultationDiffService');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeNote(overrides = {}) {
  return {
    chief_complaint:       '',
    symptoms:              [],
    history:               '',
    observations:          [],
    assessment:            '',
    medications_mentioned: [],
    follow_up:             '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1 — New symptoms
// ---------------------------------------------------------------------------
describe('1. new symptoms', () => {
  test('symptoms in current but not previous appear in newSymptoms', () => {
    const prev = makeNote({ symptoms: ['cough'] });
    const curr = makeNote({ symptoms: ['cough', 'fatigue', 'headache'] });
    const diff = diffNotes(prev, curr);
    expect(diff.newSymptoms).toEqual(['fatigue', 'headache']);
  });

  test('newSymptoms is empty when no new symptoms added', () => {
    const prev = makeNote({ symptoms: ['cough', 'fatigue'] });
    const curr = makeNote({ symptoms: ['cough', 'fatigue'] });
    expect(diffNotes(prev, curr).newSymptoms).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2 — Resolved symptoms
// ---------------------------------------------------------------------------
describe('2. resolved symptoms', () => {
  test('symptoms in previous but not current appear in resolvedSymptoms', () => {
    const prev = makeNote({ symptoms: ['cough', 'fever', 'fatigue'] });
    const curr = makeNote({ symptoms: ['cough'] });
    const diff = diffNotes(prev, curr);
    expect(diff.resolvedSymptoms).toEqual(['fever', 'fatigue']);
  });

  test('resolvedSymptoms is empty when nothing removed', () => {
    const prev = makeNote({ symptoms: ['cough'] });
    const curr = makeNote({ symptoms: ['cough', 'fatigue'] });
    expect(diffNotes(prev, curr).resolvedSymptoms).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3 — Persisting symptoms
// ---------------------------------------------------------------------------
describe('3. persisting symptoms', () => {
  test('symptoms in both notes appear in persistingSymptoms', () => {
    const prev = makeNote({ symptoms: ['cough', 'fever'] });
    const curr = makeNote({ symptoms: ['cough', 'fatigue'] });
    expect(diffNotes(prev, curr).persistingSymptoms).toEqual(['cough']);
  });

  test('all symptoms persist when notes are identical', () => {
    const note = makeNote({ symptoms: ['cough', 'fever'] });
    expect(diffNotes(note, { ...note }).persistingSymptoms).toEqual(['cough', 'fever']);
  });

  test('persistingSymptoms is empty when no overlap', () => {
    const prev = makeNote({ symptoms: ['fever'] });
    const curr = makeNote({ symptoms: ['cough'] });
    expect(diffNotes(prev, curr).persistingSymptoms).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4 — Medication differences
// ---------------------------------------------------------------------------
describe('4. medication differences', () => {
  test('new medications_mentioned appear in newMedicationsMentioned', () => {
    const prev = makeNote({ medications_mentioned: ['paracetamol'] });
    const curr = makeNote({ medications_mentioned: ['paracetamol', 'ibuprofen'] });
    expect(diffNotes(prev, curr).newMedicationsMentioned).toEqual(['ibuprofen']);
  });

  test('medications no longer mentioned appear in stoppedMedicationsMentioned', () => {
    const prev = makeNote({ medications_mentioned: ['paracetamol', 'amoxicillin'] });
    const curr = makeNote({ medications_mentioned: ['paracetamol'] });
    expect(diffNotes(prev, curr).stoppedMedicationsMentioned).toEqual(['amoxicillin']);
  });

  test('persistingMedications — medications in both notes are neither new nor stopped', () => {
    const prev = makeNote({ medications_mentioned: ['paracetamol', 'ibuprofen'] });
    const curr = makeNote({ medications_mentioned: ['paracetamol'] });
    const diff = diffNotes(prev, curr);
    expect(diff.newMedicationsMentioned).toEqual([]);
    expect(diff.stoppedMedicationsMentioned).toEqual(['ibuprofen']);
  });
});

// ---------------------------------------------------------------------------
// 5 — Observation differences
// ---------------------------------------------------------------------------
describe('5. observation differences', () => {
  test('new observations appear in newObservations', () => {
    const prev = makeNote({ observations: ['mild wheeze'] });
    const curr = makeNote({ observations: ['mild wheeze', 'bilateral crackles'] });
    expect(diffNotes(prev, curr).newObservations).toEqual(['bilateral crackles']);
  });

  test('removed observations appear in resolvedObservations', () => {
    const prev = makeNote({ observations: ['mild wheeze', 'elevated temperature'] });
    const curr = makeNote({ observations: ['mild wheeze'] });
    expect(diffNotes(prev, curr).resolvedObservations).toEqual(['elevated temperature']);
  });

  test('both new and resolved observations in same diff', () => {
    const prev = makeNote({ observations: ['fever', 'wheeze'] });
    const curr = makeNote({ observations: ['wheeze', 'rash'] });
    const diff = diffNotes(prev, curr);
    expect(diff.newObservations).toEqual(['rash']);
    expect(diff.resolvedObservations).toEqual(['fever']);
  });
});

// ---------------------------------------------------------------------------
// 6 — Changed string fields
// ---------------------------------------------------------------------------
describe('6. changed string fields', () => {
  test('assessmentChanged is true when assessment differs', () => {
    const prev = makeNote({ assessment: 'Likely viral URTI' });
    const curr = makeNote({ assessment: 'Confirmed bacterial infection' });
    expect(diffNotes(prev, curr).assessmentChanged).toBe(true);
  });

  test('chiefComplaintChanged is true when chief_complaint differs', () => {
    const prev = makeNote({ chief_complaint: 'cough' });
    const curr = makeNote({ chief_complaint: 'shortness of breath' });
    expect(diffNotes(prev, curr).chiefComplaintChanged).toBe(true);
  });

  test('followUpChanged is true when follow_up differs', () => {
    const prev = makeNote({ follow_up: 'Return in 1 week' });
    const curr = makeNote({ follow_up: 'Return in 2 weeks if no improvement' });
    expect(diffNotes(prev, curr).followUpChanged).toBe(true);
  });

  test('historyChanged is true when history differs', () => {
    const prev = makeNote({ history: 'No prior respiratory issues.' });
    const curr = makeNote({ history: 'Previous episode of pneumonia in 2024.' });
    expect(diffNotes(prev, curr).historyChanged).toBe(true);
  });

  test('all string flags are false when no string field changed', () => {
    const note = makeNote({
      chief_complaint: 'cough',
      assessment: 'Viral URTI',
      follow_up: 'Rest',
      history: 'None',
    });
    const diff = diffNotes(note, { ...note });
    expect(diff.assessmentChanged).toBe(false);
    expect(diff.chiefComplaintChanged).toBe(false);
    expect(diff.followUpChanged).toBe(false);
    expect(diff.historyChanged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7 — Identical notes
// ---------------------------------------------------------------------------
describe('7. identical notes', () => {
  test('identical notes produce all-empty arrays and all-false flags', () => {
    const note = makeNote({
      chief_complaint:       'cough',
      symptoms:              ['cough', 'fever'],
      observations:          ['mild wheeze'],
      medications_mentioned: ['paracetamol'],
      assessment:            'Viral URTI',
      follow_up:             'Rest and fluids',
      history:               'None',
    });
    const diff = diffNotes(note, { ...note });
    expect(diff.newSymptoms).toEqual([]);
    expect(diff.resolvedSymptoms).toEqual([]);
    expect(diff.persistingSymptoms).toEqual(['cough', 'fever']);
    expect(diff.newMedicationsMentioned).toEqual([]);
    expect(diff.stoppedMedicationsMentioned).toEqual([]);
    expect(diff.newObservations).toEqual([]);
    expect(diff.resolvedObservations).toEqual([]);
    expect(diff.assessmentChanged).toBe(false);
    expect(diff.chiefComplaintChanged).toBe(false);
    expect(diff.followUpChanged).toBe(false);
    expect(diff.historyChanged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8 — Empty previous note
// ---------------------------------------------------------------------------
describe('8. empty previous note', () => {
  test('all current items treated as new when previous note is empty', () => {
    const curr = makeNote({
      symptoms:              ['cough', 'fever'],
      medications_mentioned: ['paracetamol'],
      observations:          ['mild wheeze'],
      chief_complaint:       'cough',
      assessment:            'Viral URTI',
    });
    const diff = diffNotes({}, curr);
    expect(diff.newSymptoms).toEqual(['cough', 'fever']);
    expect(diff.resolvedSymptoms).toEqual([]);
    expect(diff.newMedicationsMentioned).toEqual(['paracetamol']);
    expect(diff.stoppedMedicationsMentioned).toEqual([]);
    expect(diff.newObservations).toEqual(['mild wheeze']);
    expect(diff.resolvedObservations).toEqual([]);
    expect(diff.chiefComplaintChanged).toBe(true);
    expect(diff.assessmentChanged).toBe(true);
  });

  test('null previousNote is treated as empty', () => {
    const curr = makeNote({ symptoms: ['cough'] });
    expect(diffNotes(null, curr).newSymptoms).toEqual(['cough']);
  });

  test('undefined previousNote is treated as empty', () => {
    const curr = makeNote({ symptoms: ['fever'] });
    expect(diffNotes(undefined, curr).newSymptoms).toEqual(['fever']);
  });
});

// ---------------------------------------------------------------------------
// 9 — Empty current note
// ---------------------------------------------------------------------------
describe('9. empty current note', () => {
  test('all previous items treated as resolved when current note is empty', () => {
    const prev = makeNote({
      symptoms:              ['cough', 'fever'],
      medications_mentioned: ['paracetamol'],
      observations:          ['mild wheeze'],
    });
    const diff = diffNotes(prev, {});
    expect(diff.newSymptoms).toEqual([]);
    expect(diff.resolvedSymptoms).toEqual(['cough', 'fever']);
    expect(diff.stoppedMedicationsMentioned).toEqual(['paracetamol']);
    expect(diff.resolvedObservations).toEqual(['mild wheeze']);
  });

  test('null currentNote is treated as empty', () => {
    const prev = makeNote({ symptoms: ['cough'] });
    expect(diffNotes(prev, null).resolvedSymptoms).toEqual(['cough']);
  });
});

// ---------------------------------------------------------------------------
// 10 — Casing and whitespace normalisation
// ---------------------------------------------------------------------------
describe('10. casing and whitespace normalisation', () => {
  test('same symptom with different casing is treated as persisting', () => {
    const prev = makeNote({ symptoms: ['Cough'] });
    const curr = makeNote({ symptoms: ['cough'] });
    const diff = diffNotes(prev, curr);
    expect(diff.newSymptoms).toEqual([]);
    expect(diff.resolvedSymptoms).toEqual([]);
    expect(diff.persistingSymptoms).toEqual(['cough']);
  });

  test('same symptom with extra whitespace is treated as persisting', () => {
    const prev = makeNote({ symptoms: ['  fever  '] });
    const curr = makeNote({ symptoms: ['fever'] });
    const diff = diffNotes(prev, curr);
    expect(diff.newSymptoms).toEqual([]);
    expect(diff.resolvedSymptoms).toEqual([]);
    expect(diff.persistingSymptoms).toEqual(['fever']);
  });

  test('string field comparison is case-insensitive', () => {
    const prev = makeNote({ assessment: 'Viral URTI' });
    const curr = makeNote({ assessment: 'viral urti' });
    expect(diffNotes(prev, curr).assessmentChanged).toBe(false);
  });

  test('string field comparison trims whitespace', () => {
    const prev = makeNote({ follow_up: '  Rest  ' });
    const curr = makeNote({ follow_up: 'Rest' });
    expect(diffNotes(prev, curr).followUpChanged).toBe(false);
  });

  test('output values preserve current note casing for new symptoms', () => {
    const prev = makeNote({ symptoms: [] });
    const curr = makeNote({ symptoms: ['Shortness of Breath'] });
    expect(diffNotes(prev, curr).newSymptoms).toEqual(['Shortness of Breath']);
  });

  test('duplicates within the same note are deduplicated', () => {
    const curr = makeNote({ symptoms: ['cough', 'Cough', 'COUGH'] });
    const diff = diffNotes({}, curr);
    expect(diff.newSymptoms).toHaveLength(1);
    expect(diff.newSymptoms[0]).toBe('cough'); // first occurrence
  });
});

// ---------------------------------------------------------------------------
// 11 — Null / missing fields
// ---------------------------------------------------------------------------
describe('11. null and missing fields', () => {
  test('null symptoms array treated as empty', () => {
    const prev = makeNote({ symptoms: null });
    const curr = makeNote({ symptoms: ['cough'] });
    expect(diffNotes(prev, curr).newSymptoms).toEqual(['cough']);
  });

  test('undefined symptoms array treated as empty', () => {
    const prev = { /* no symptoms key */ };
    const curr = makeNote({ symptoms: ['fever'] });
    expect(diffNotes(prev, curr).newSymptoms).toEqual(['fever']);
  });

  test('non-string values in array are ignored', () => {
    const prev = makeNote({ symptoms: [42, null, undefined, '', 'cough'] });
    const curr = makeNote({ symptoms: ['cough', 'fever'] });
    const diff = diffNotes(prev, curr);
    expect(diff.persistingSymptoms).toEqual(['cough']);
    expect(diff.newSymptoms).toEqual(['fever']);
    expect(diff.resolvedSymptoms).toEqual([]);
  });

  test('null string fields treated as empty string', () => {
    const prev = makeNote({ assessment: null });
    const curr = makeNote({ assessment: 'Viral URTI' });
    expect(diffNotes(prev, curr).assessmentChanged).toBe(true);
  });

  test('both null string fields are not considered changed', () => {
    const prev = makeNote({ assessment: null });
    const curr = makeNote({ assessment: null });
    expect(diffNotes(prev, curr).assessmentChanged).toBe(false);
  });

  test('output shape always contains all keys even for empty inputs', () => {
    const diff = diffNotes(null, null);
    const expectedKeys = [
      'newSymptoms', 'resolvedSymptoms', 'persistingSymptoms',
      'newMedicationsMentioned', 'stoppedMedicationsMentioned',
      'newObservations', 'resolvedObservations',
      'assessmentChanged', 'chiefComplaintChanged',
      'followUpChanged', 'historyChanged',
    ];
    for (const key of expectedKeys) {
      expect(diff).toHaveProperty(key);
    }
  });
});
