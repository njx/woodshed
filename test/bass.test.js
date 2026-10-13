import { describe, it, expect } from 'vitest';
import { walkingLine } from '../src/bass.js';

// A seeded random, so a line can be made again.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pc = (m) => ((m % 12) + 12) % 12;
const chord = (root, family, beats) => ({ root, family, beats });
const iiVI = [chord(2, 'm7', 4), chord(7, 'dom7', 4), chord(0, 'maj7', 8), chord(9, 'dom7', 2), chord(2, 'm7', 2)];
const blues = [[10, 4], [3, 4], [10, 8], [3, 8], [10, 8], [5, 4], [3, 4], [10, 4], [5, 4]].map(([r, b]) => chord(r, 'dom7', b));
// Lines played round and round, each carrying on from the last.
function rounds(chords, n, rand) {
  const out = [];
  for (let i = 0, after = null; i < n; i++) out.push((after = walkingLine(chords, { after, rand })));
  return out;
}

describe('walking bass', () => {
  it('a note a beat, the first of each chord (and each bar of one held on) its root', () => {
    for (const l of rounds(iiVI, 20, seeded(1))) {
      expect(l).toHaveLength(20);
      expect(l.map((n) => n.chord)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 4, 4]);
      for (const i of [0, 4, 8, 12, 16, 18]) expect(pc(l[i].midi)).toBe(iiVI[l[i].chord].root);
      for (const i of [0, 4, 8, 12, 16, 18]) expect(l[i].shape).toBeTruthy();
    }
  });
  it('leads into each next root by a half step or a step (or from the 5th, on a chord of two beats)', () => {
    for (const chords of [iiVI, blues]) {
      for (const l of rounds(chords, 30, seeded(2))) {
        const all = [...l, { midi: l.next, shape: 'next' }];
        let shape;
        for (let i = 1; i < all.length; i++) {
          shape = l[i - 1].shape ?? shape; // (the shape of the bar the note before is in)
          if (!all[i].shape) continue;
          const d = Math.abs(all[i].midi - all[i - 1].midi);
          expect(d <= 2 || (shape === '1 5' && (d === 5 || d === 7)), `${l.map((n) => n.midi)} at ${i}`).toBe(true);
        }
      }
    }
  });
  it('stays between E1 and E3, in every key and on every kind of chord', () => {
    const families = ['maj7', 'maj6', 'm7', 'm6', 'mMaj7', 'm7b5', 'dim7', 'dom7', 'dom7sus', 'dom7s5', 'maj7s5'];
    const rand = seeded(3);
    for (let r = 0; r < 12; r++) {
      for (const f of families) {
        const chords = [chord(r, f, 4), chord((r + 5) % 12, f, 8), chord((r + 1) % 12, f, 2), chord((r + 7) % 12, f, 3), chord(r, f, 1)];
        for (const l of rounds(chords, 4, rand)) for (const n of l) expect(n.midi >= 28 && n.midi <= 52, `${r} ${f}: ${n.midi}`).toBe(true);
      }
    }
  });
  it('keeps the beats adding up when they don’t divide evenly', () => {
    expect(walkingLine([chord(0, 'maj7', 4 / 3), chord(2, 'm7', 4 / 3), chord(7, 'dom7', 4 / 3)])).toHaveLength(4);
    expect(walkingLine([chord(0, 'maj7', 6)]).map((n) => n.chord)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it('the same random, the same line; carried on from where the last one led', () => {
    expect(rounds(iiVI, 3, seeded(4))).toEqual(rounds(iiVI, 3, seeded(4)));
    const [a, b] = rounds(iiVI, 2, seeded(5));
    expect(b[0].midi).toBe(a.next);
    expect(walkingLine(iiVI)[0].midi % 12).toBe(2); // (the first time, from a D)
  });
  it('varies: a new line each time round, many shapes, not the same one twice running much', () => {
    const lines = rounds(iiVI, 40, seeded(6));
    expect(new Set(lines.map((l) => l.map((n) => n.midi).join())).size).toBeGreaterThan(25);
    const shapes = lines.flatMap((l) => l.filter((n) => n.shape).map((n) => n.shape));
    expect(new Set(shapes).size).toBeGreaterThan(12);
    const again = shapes.filter((s, i) => i && s === shapes[i - 1]).length;
    expect(again / shapes.length).toBeLessThan(0.15);
  });
  it('walks the shapes a bass player does: 1 2 ♭3 3 into a 4th up, 1 2 3 5, 1 3 5 3, 1 3 5 ♭5, 8 1 2 3, 1 1 2 3', () => {
    // A bar of D minor, into G: the steps above D, seen over many times.
    const seen = new Set();
    for (const l of rounds([chord(2, 'm7', 4), chord(7, 'dom7', 4)], 300, seeded(7))) seen.add(l.slice(0, 4).map((n) => n.midi - l[0].midi).join(' '));
    for (const want of ['0 2 3 4', '0 2 3 7', '0 3 7 3', '0 3 7 6', '0 -12 -10 -9', '0 0 2 3']) expect([...seen]).toContain(want);
  });
  it('plays the first beat of each bar firmest, the rest a little softer and not all alike', () => {
    const l = walkingLine(iiVI, { rand: seeded(8) });
    for (const n of l) expect(n.vel).toBe(n.shape ? 1 : n.vel);
    const rest = l.filter((n) => !n.shape).map((n) => n.vel);
    for (const v of rest) expect(v >= 0.82 && v <= 0.96).toBe(true);
    expect(new Set(rest).size).toBeGreaterThan(5);
  });
});

describe('looping part of a chart', () => {
  it('numbers bars in playing order, sections as ranges (repeated labels numbered)', async () => {
    const { chartBars } = await import('../src/bass.js');
    const bar = (root) => ({ chords: [{ root, q: 'maj7' }], alts: [] });
    const chart = { key: 0, meter: '4/4', sections: [
      { label: 'A', repeats: 0, bars: [bar(0), bar(5)], endings: [] },
      { label: 'B', repeats: 0, bars: [bar(7), { chords: [], alts: [] }], endings: [] },
      { label: 'A', repeats: 0, bars: [bar(0)], endings: [[bar(2)], [bar(4)]] },
    ] };
    const { bars, sections } = chartBars(chart);
    expect(bars).toHaveLength(7);
    expect(sections.map((s) => [s.name, s.from, s.to])).toEqual([['A1', 0, 1], ['B', 2, 3], ['A2', 4, 6]]);
  });
});
