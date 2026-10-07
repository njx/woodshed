import { describe, it, expect } from 'vitest';
import { generateAbc, shapeNumbers, parsePattern, chooseTypes, variantName, SCALES, CHORDS, VARY } from '../src/theory.js';

describe('scales and chords', () => {
  it('every type is spelled in order, from C up', () => {
    const order = 'CDEFGAB';
    for (const t of [...Object.values(SCALES), ...Object.values(CHORDS)]) {
      const idx = t.notes.map(([l]) => order.indexOf(l));
      expect(idx[0]).toBe(0);
      // 8-note scales reuse a letter (E♭ and E♮ in diminished), so never descending is enough.
      for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThanOrEqual(idx[i - 1]);
    }
    expect(VARY.scale.defaults.every((id) => SCALES[id])).toBe(true);
    expect(VARY.chord.defaults.every((id) => CHORDS[id])).toBe(true);
  });

  it('names a root with a type', () => {
    expect(variantName('C', 'scale', 'dorian')).toBe('C dor');
    expect(variantName('B♭', 'chord', 'm7b5')).toBe('B♭ø7');
    expect(variantName('F', 'chord', 'dom7')).toBe('F7');
  });
});

describe('generated notation', () => {
  it('writes a scale up and down with accidentals only where they change', () => {
    // Harmonic minor: A♭ and B♮. Accidentals are written again in each new bar.
    expect(generateAbc('scale', 'harmonic')).toBe('C D _E F G _A B c | B _A G F _E D C2 |');
  });

  it('marks a natural when the same note changes within a bar', () => {
    // Diminished half–whole: D♭ E♭ E♮ F♯ — the E needs a natural after E♭.
    const abc = generateAbc('scale', 'dimHW');
    expect(abc).toBe('C _D _E =E ^F G A _B | c _B A G ^F E _E _D | C8 |');
  });

  it('fills the last bar with the final note', () => {
    expect(generateAbc('scale', 'major')).toBe('C D E F G A B c | B A G F E D C2 |');
    expect(generateAbc('chord', 'm7')).toBe('C _E G _B c B G E | C8 |');
    expect(generateAbc('scale', 'major', { meter: '3/4' })).toBe('C D E F G A | B c B A G F | E D C4 |');
  });

  it('spells a diminished 7th with a double flat', () => {
    // Within a bar an accidental carries through, so the way back down needs none.
    expect(generateAbc('chord', 'dim7')).toBe('C _E _G __B c B G E | C8 |');
  });

  it('shapes adapt to the number of notes', () => {
    expect(shapeNumbers('updown', 5, 'scale')).toEqual([1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]);
    expect(shapeNumbers('thirds', 7, 'scale')).toEqual([1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 8, 7, 9, 8]);
    expect(shapeNumbers('p1235', 7, 'scale').slice(0, 8)).toEqual([1, 2, 3, 5, 2, 3, 4, 6]);
    expect(shapeNumbers('inversions', 4, 'chord')).toEqual([1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6, 4, 5, 6, 7, 9]);
    expect(generateAbc('chord', 'maj7', { shape: 'inversions' })).toBe("C E G B E G B c | G B c e B c e g | c'8 |");
  });

  it('reads custom patterns', () => {
    expect(parsePattern('1 2 3 5', 'scale').numbers).toEqual([1, 2, 3, 5]);
    expect(parsePattern('1-3-5-7-8', 'chord').numbers).toEqual([1, 2, 3, 4, 5]);
    expect(parsePattern('10 12', 'chord').numbers).toEqual([6, 7]);
    expect(parsePattern('1 2', 'chord').error).toMatch(/chord tones/);
    expect(parsePattern('1 x', 'scale').error).toMatch(/x/);
    expect(generateAbc('scale', 'dorian', { shape: 'custom', pattern: '1 3 5 7 9 7 5 3 1' })).toBe('C _E G _B d B G E | C8 |');
  });
});

describe('choosing types', () => {
  const vary = { kind: 'scale', types: ['major', 'dorian', 'harmonic'] };
  it('gives one per key, without repeats until all have had a turn', () => {
    const t = chooseTypes(vary, 3, []);
    expect(new Set(t).size).toBe(3);
    const t5 = chooseTypes(vary, 5, []);
    expect(new Set(t5.slice(0, 3)).size).toBe(3);
  });
  it('favours types played least', () => {
    const history = Array(10).fill('major').concat(Array(10).fill('dorian'));
    const counts = {};
    for (let i = 0; i < 200; i++) { const [first] = chooseTypes(vary, 1, history); counts[first] = (counts[first] || 0) + 1; }
    expect(counts.harmonic).toBeGreaterThan(150);
  });
  it('ignores unknown types', () => {
    expect(chooseTypes({ kind: 'scale', types: ['nope'] }, 2)).toEqual([]);
  });
});
