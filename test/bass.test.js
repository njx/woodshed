import { describe, it, expect } from 'vitest';
import { walkingLine } from '../src/bass.js';

const names = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const line = (chords) => walkingLine(chords).map((n) => names[n.midi % 12]);

describe('walking bass', () => {
  it('walks 1-2-3-5 on each chord, with its own 3rd and 5th', () => {
    expect(line([{ root: 2, family: 'm7', beats: 4 }, { root: 7, family: 'dom7', beats: 4 }, { root: 0, family: 'maj7', beats: 4 }]))
      .toEqual(['D', 'E', 'F', 'A', 'G', 'A', 'B', 'D', 'C', 'D', 'E', 'G']);
    expect(line([{ root: 9, family: 'm7b5', beats: 4 }])).toEqual(['A', 'B', 'C', 'E♭']);
  });
  it('comes back down from the octave on a chord held longer, and keeps short ones short', () => {
    expect(line([{ root: 0, family: 'maj7', beats: 8 }])).toEqual(['C', 'D', 'E', 'G', 'C', 'B', 'G', 'E']);
    expect(line([{ root: 0, family: 'dom7', beats: 2 }, { root: 5, family: 'dom7', beats: 2 }])).toEqual(['C', 'G', 'F', 'C']);
  });
  it('keeps the beats adding up when they don’t divide evenly, in the bass’s range', () => {
    const l = walkingLine([{ root: 0, family: 'maj7', beats: 4 / 3 }, { root: 2, family: 'm7', beats: 4 / 3 }, { root: 7, family: 'dom7', beats: 4 / 3 }]);
    expect(l).toHaveLength(4);
    for (const r of [...Array(12).keys()]) {
      for (const n of walkingLine([{ root: r, family: 'maj7', beats: 8 }])) {
        expect(n.midi).toBeGreaterThanOrEqual(33);
        expect(n.midi).toBeLessThanOrEqual(56);
      }
    }
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
