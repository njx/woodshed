import { describe, it, expect } from 'vitest';
import { SOUNDS, nearestSample, sampleNotes, swingTime } from '../src/sounds.js';

describe('sounds', () => {
  it('every recorded sound has samples, a few semitones apart', () => {
    for (const id of Object.keys(SOUNDS).filter((x) => x !== 'synth')) {
      const notes = sampleNotes(id);
      expect(notes.length).toBeGreaterThan(5);
      for (let i = 1; i < notes.length; i++) expect(notes[i] - notes[i - 1]).toBeLessThanOrEqual(7);
    }
  });
  it('plays each pitch from the nearest sample', () => {
    expect(nearestSample('piano', 60)).toBe(60);
    expect(nearestSample('piano', 61)).toBe(60);
    expect(nearestSample('piano', 62)).toBe(63);
    expect(nearestSample('sax', 30)).toBe(49); // below the range: the lowest
  });
});

describe('swing', () => {
  it('leaves beats in place and delays off-beats', () => {
    expect(swingTime(1, 2 / 3)).toBe(1);
    expect(swingTime(1.5, 2 / 3)).toBeCloseTo(1 + 2 / 3);
    expect(swingTime(2.5, 0.6)).toBeCloseTo(2.6);
    expect(swingTime(0.5, 0.5)).toBe(0.5); // straight
    // 16ths stretch with the beat: the second 16th lands a third of the way through.
    expect(swingTime(0.25, 2 / 3)).toBeCloseTo(1 / 3);
  });
});
