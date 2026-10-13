import { describe, it, expect } from 'vitest';
import standards from './fixtures/standards.json';
import {
  parseChord, parseBar, chartFromStandard, chordName, qualityName, usesSharps, chartShift,
  chartToText, chartFromText, chordFamily, scaleFor, chordTimeline, mainChords, twoFives, formBars, overName,
} from '../src/chords.js';
import { CHORDS, SCALES } from '../src/theory.js';

const chart = (title) => chartFromStandard(standards.find((x) => x.Title === title));

describe('reading chords', () => {
  it('parses chord symbols', () => {
    expect(parseChord('Bbm7b5')).toEqual({ root: 10, q: 'm7b5' });
    expect(parseChord('F#7#9')).toEqual({ root: 6, q: '7#9' });
    expect(parseChord('C6/G')).toEqual({ root: 0, q: '6', bass: 7 });
    expect(parseChord('B♭ø7')).toEqual({ root: 10, q: 'm7b5' });
    expect(parseChord('Cmaj')).toEqual({ root: 0, q: 'maj7' });
    expect(parseChord('H7')).toBe(null);
  });
  it('reads a / in the quality (minor-major, 6/9) apart from a bass note', () => {
    for (const s of ['Cm/maj7', 'C-^7', 'CmM7', 'Cm(maj7)']) expect(parseChord(s)).toEqual({ root: 0, q: 'm/maj7' });
    expect(parseChord('Am/maj7/G#')).toEqual({ root: 9, q: 'm/maj7', bass: 8 });
    expect(parseChord('C6/9')).toEqual({ root: 0, q: '69' });
    expect(parseChord('C/E')).toEqual({ root: 0, q: '', bass: 4 });
    expect(chordFamily(parseChord('Dbm/maj7').q)).toBe('mMaj7');
    expect(chordFamily('69')).toBe('maj6');
    expect(parseChord('Cmin6')).toEqual({ root: 0, q: 'm6' });
    expect(parseChord('CM')).toEqual({ root: 0, q: '' });
    expect(chordFamily('2')).toBe('maj6');
    // All The Things You Are's last A (D♭ minor-major in bar 6) keeps it.
    expect(chart('All The Things You Are').sections[3].bars.flatMap((b) => b.chords).some((c) => c.q === 'm/maj7')).toBe(true);
  });
  it('reads bars with alternates in parentheses', () => {
    const b = parseBar('Dmaj7(Em7b5)');
    expect(b.chords).toEqual([{ root: 2, q: 'maj7' }]);
    expect(b.alts).toEqual([{ root: 4, q: 'm7b5' }]);
    expect(parseBar('G7(Gm7,C7)').alts).toHaveLength(2);
    expect(parseBar('').chords).toEqual([]);
  });
  it('reads a whole tune', () => {
    const c = chart('Autumn Leaves');
    expect(c.key).toBe(19); // G minor
    expect(c.sections.map((s) => s.label)).toEqual(['A', 'B', 'C']);
    expect(c.sections[0].bars[0].chords[0]).toEqual({ root: 0, q: 'm7' });
    const a = chart('Alone Together');
    expect(a.sections[0].endings).toHaveLength(2);
  });
  it('plays through the form: repeats, and a section once through each of its endings', () => {
    const al = chart('Autumn Leaves'); // A (twice), B, C: 8 bars each
    expect(formBars(al)).toHaveLength(32);
    expect(formBars(al).map((x) => x.at).slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
    const bar = (q) => ({ chords: [{ root: 0, q }], alts: [] });
    const c = { key: 0, meter: '4/4', sections: [
      { label: 'A', repeats: 0, bars: [bar('a1'), bar('a2')], endings: [[bar('e1')], [bar('e2')]] },
      { label: 'B', repeats: 0, bars: [bar('b')], endings: [] },
    ] };
    // Shown as A: a1 a2 | 1. e1 | 2. e2 | B: b (numbered 0–4); played a1 a2 e1 a1 a2 e2 b.
    expect(formBars(c).map((x) => x.at)).toEqual([0, 1, 2, 0, 1, 3, 4]);
    expect(chordTimeline(c).map((x) => x.q)).toEqual(['a1', 'a2', 'e1', 'a1', 'a2', 'e2', 'b']);
  });
});

describe('names and keys', () => {
  it('spells chords for the key', () => {
    expect(chordName({ root: 10, q: 'm7b5' })).toBe('B♭ø7');
    expect(chordName({ root: 6, q: '7' }, { sharps: true })).toBe('F♯7');
    expect(chordName({ root: 0, q: '07' }, { shift: 2 })).toBe('D°7');
    expect(qualityName('m/maj7')).toBe('m(maj7)');
    expect(usesSharps(4)).toBe(true); // E
    expect(usesSharps(16)).toBe(true); // E minor
    expect(usesSharps(5)).toBe(false); // F
    expect(usesSharps(0)).toBe(false); // C: flats for B♭7 etc.
  });
  it('shifts a chart into a key, written for an instrument', () => {
    const c = chart('Autumn Leaves'); // G minor
    expect(chartShift(c, 19, 'c')).toBe(0);
    expect(chartShift(c, 16, 'c')).toBe(9); // E minor: up a 6th (or down a 3rd)
    expect(chartShift(c, 19, 'bb')).toBe(2); // written a step up on a B♭ instrument
  });
});

describe('editing as text', () => {
  it('round-trips a chart, in another key', () => {
    const c = chart('Alone Together');
    const text = chartToText(c, { shift: 2, sharps: true });
    expect(text.split('\n')[0].startsWith('A: Em6 | F#m7b5 B7b9 | Em6')).toBe(true);
    const back = chartFromText(text, { key: c.key, shift: 2 }).chart;
    expect(chordTimeline(back).map((x) => [x.root, x.q])).toEqual(chordTimeline(c).map((x) => [x.root, x.q]));
    expect(back.sections[0].endings).toHaveLength(2);
  });
  it('keeps a section’s repeats (A ×2)', () => {
    const text = chartToText(chart('Autumn Leaves'));
    expect(text.split('\n')[0]).toMatch(/^A ×2: Cm7 \| F7/);
    expect(chartFromText(text).chart.sections.map((s) => s.repeats)).toEqual([1, 0, 0]);
    expect(chartFromText('A x3: C7').chart.sections[0]).toMatchObject({ label: 'A', repeats: 2 });
  });
  it('reads typed charts, with % for a continuing chord', () => {
    const { chart: c } = chartFromText('A: Cmaj7 | % | Dm7 G7 | Cmaj7\nB: Fm7 | Bb7');
    expect(c.sections).toHaveLength(2);
    expect(c.sections[0].bars[1].chords).toEqual([]);
    expect(chordTimeline(c)[0]).toMatchObject({ root: 0, beats: 8 });
    expect(chartFromText('A: Cmaj7 | Xyz7').error).toMatch(/Xyz7/);
  });
});

describe('what’s in a chart', () => {
  it('sorts chords into families that are chord types, and picks scales that exist', () => {
    const qs = ['7', 'm7', 'maj7', '6', '7b9', 'm7b5', '', 'm', '07', 'm6', '7sus', '7#11', '7#9', '7#5', 'maj7#11', '7b13', '9', 'm9', '13', 'm11', 'm/maj7', '7alt', '69', '9sus', 'aug'];
    for (const q of qs) {
      expect(CHORDS[chordFamily(q)], q).toBeTruthy();
      expect(SCALES[scaleFor({ root: 0, q })], q).toBeTruthy();
    }
    expect(chordFamily('m7b5')).toBe('m7b5');
    expect(chordFamily('07')).toBe('dim7');
    expect(scaleFor({ q: '7alt' })).toBe('altered');
    expect(scaleFor({ q: '7b9' })).toBe('dimHW');
    expect(scaleFor({ q: 'm7' })).toBe('dorian');
    // Colours stay: half-diminished, ♭9, ♯9 / altered.
    expect(chordFamily('7b9')).toBe('dom7b9');
    expect(chordFamily('7b9b13')).toBe('dom7b9');
    expect(chordFamily('7#9')).toBe('dom7s9');
    expect(chordFamily('7alt')).toBe('dom7s9');
    expect(chordFamily('7b13')).toBe('dom7');
    expect(scaleFor({ q: '7b9b13' })).toBe('altered');
  });
  it('finds the main chords and the ii–Vs', () => {
    const c = chart('Autumn Leaves');
    const main = mainChords(c, 3);
    expect(main[0]).toMatchObject({ root: 7, family: 'm6' }); // Gm6
    const iiv = twoFives(c);
    expect(iiv[0]).toMatchObject({ target: 7, minor: true }); // Am7b5 D7 → Gm
    expect(iiv.some((x) => x.target === 10 && !x.minor)).toBe(true); // Cm7 F7 → B♭
  });
  it('counts a ii–V at the very end with the same one elsewhere', () => {
    const { chart: c } = chartFromText('A: Dm7 G7 | Cmaj7 | Dm7 | G7');
    expect(twoFives(c)).toEqual([{ target: 0, minor: false, count: 2 }]);
  });
});

it('doesn’t mistake maj for minor', async () => {
  const { chordFamily } = await import('../src/chords.js');
  expect(chordFamily('maj7')).toBe('maj7');
  expect(chordFamily('maj9')).toBe('maj7');
  expect(chordFamily('m9')).toBe('m7');
});

describe('progressions', async () => {
  const { progressions, roman } = await import('../src/chords.js');
  it('names chords against a key centre', () => {
    expect(roman(2, 'm7')).toBe('ii');
    expect(roman(7, 'dom7b9')).toBe('V7');
    expect(roman(2, 'm7b5')).toBe('iiø');
    expect(roman(11, 'dim7')).toBe('vii°');
    expect(roman(1, 'dom7')).toBe('♭II7');
  });
  it('finds chains round the cycle, turnarounds and tritone subs', () => {
    const { chart: c } = chartFromText('A: Em7 | A7 | Dm7 | G7 | Cmaj7 | Am7 | Dm7 | G7 | Cmaj7 | Dm7 Db7 | Cmaj7');
    const names = progressions(c).map((p) => `${p.name}@${p.target}`);
    expect(names).toContain('iii–VI7–ii–V7–I@0');
    expect(names).toContain('I–vi–ii–V7@0');
    expect(names).toContain('ii–♭II7–I@0');
    expect(names).toContain('ii–V7–I@0');
  });
  it('a held chord counts once', () => {
    const { chart: c } = chartFromText('A: Dm7 | % | G7 | G7 | Cmaj7');
    expect(progressions(c)[0]).toMatchObject({ name: 'ii–V7–I', target: 0, count: 1 });
  });
});

describe('a warm-up’s chord, for the instrument shown', () => {
  it('is named in written pitch, like the keys beside it; roman numerals stay as they are', () => {
    expect(overName('Fmaj7', 'bb')).toBe('Gmaj7');
    expect(overName('ii–V–I', 'bb')).toBe('ii–V–I');
    expect(overName('Cm7', 'eb')).toBe('Am7');
    expect(overName('Gbmaj7')).toBe('G♭maj7'); // (G♭: flats, as the key is named)
  });
});
