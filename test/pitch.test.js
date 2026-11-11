import { describe, it, expect } from 'vitest';
import { detectPitch, noteOf, concertName, writtenName, writtenNote, PitchTrace } from '../src/pitch.js';

const SR = 48000;
const N = 2048;

function tone(hz, { harmonics = [1], noise = 0, amp = 0.3 } = {}) {
  const buf = new Float32Array(N);
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < N; i++) {
    let v = 0;
    harmonics.forEach((h, k) => { v += h * Math.sin((2 * Math.PI * hz * (k + 1) * i) / SR); });
    buf[i] = amp * v + noise * rand();
  }
  return buf;
}
const cents = (a, b) => 1200 * Math.log2(a / b);

describe('pitch detection', () => {
  it('finds a pure tone to within a cent', () => {
    for (const hz of [110, 233.08, 440, 987.77]) {
      expect(Math.abs(cents(detectPitch(tone(hz), SR).hz, hz))).toBeLessThan(1);
    }
  });

  it('finds the fundamental of a sax-like tone with strong overtones', () => {
    // Weak fundamental, loud 2nd and 3rd harmonics: the loudest frequency is not the note.
    const hz = 146.83; // concert D3
    const r = detectPitch(tone(hz, { harmonics: [0.4, 1, 0.8, 0.5, 0.3, 0.2] }), SR);
    expect(Math.abs(cents(r.hz, hz))).toBeLessThan(2);
  });

  it('copes with some background noise', () => {
    const hz = 220;
    const r = detectPitch(tone(hz, { harmonics: [1, 0.5, 0.3], noise: 0.05 }), SR);
    expect(Math.abs(cents(r.hz, hz))).toBeLessThan(3);
  });

  it('finds the low end of a tenor (concert A♭2)', () => {
    const hz = 103.83;
    expect(Math.abs(cents(detectPitch(tone(hz, { harmonics: [0.5, 1, 0.6] }), SR).hz, hz))).toBeLessThan(2);
  });

  it('reports nothing for silence or noise', () => {
    expect(detectPitch(new Float32Array(N), SR)).toBe(null);
    expect(detectPitch(tone(440, { harmonics: [0], noise: 0.3 }), SR)).toBe(null);
  });
});

describe('notes', () => {
  it('names the nearest note and the cents off', () => {
    expect(noteOf(440)).toEqual({ midi: 69, cents: 0 });
    const sharp = noteOf(440 * 2 ** (10 / 1200));
    expect(sharp.midi).toBe(69);
    expect(sharp.cents).toBeCloseTo(10, 5);
    expect(noteOf(442, 442).cents).toBeCloseTo(0, 5); // A = 442
    expect(noteOf(233.08).midi).toBe(58);
  });

  it('names notes for each transposition', () => {
    expect(concertName(58)).toBe('B♭3');
    expect(concertName(60)).toBe('C4');
    expect(writtenName(58, 'tenor')).toBe('C'); // concert B♭ is a written C on tenor
    expect(writtenName(58, 'alto')).toBe('G');
    expect(writtenName(58, 'horn')).toBe('F');
    expect(writtenName(58, 'c')).toBe('B♭');
  });

  it('names notes with the written octave for each instrument', () => {
    expect(writtenNote(58, 'c')).toBe('B♭3');
    expect(writtenNote(58, 'tenor')).toBe('C5'); // a tenor reads a 9th above
    expect(writtenNote(58, 'soprano')).toBe('C4'); // a soprano, a step above
    expect(writtenNote(58, 'trumpet')).toBe('C4');
    expect(writtenNote(58, 'alto')).toBe('G4'); // a major 6th
    expect(writtenNote(58, 'bari')).toBe('G5'); // an octave and a 6th
    expect(writtenNote(58, 'horn')).toBe('F4');
    expect(writtenName(58, 'tenor')).toBe('C');
  });
});

describe('the pitch trace', () => {
  const A = { midi: 69, cents: 0 };
  it('moves on only while a note sounds: in a silence it stops, then leaves a small gap', () => {
    const tr = new PitchTrace();
    for (let t = 0; t <= 1000; t += 30) tr.add(t, A); // a second of a note
    const sounded = tr.now;
    expect(sounded).toBeGreaterThan(950);
    for (let t = 1030; t <= 4000; t += 30) tr.add(t, null); // three seconds of silence
    expect(tr.now).toBe(sounded); // (stopped)
    expect(tr.points.at(-1)).toMatchObject({ cents: null }); // (the line breaks there, once)
    expect(tr.points.filter((p) => p.cents == null)).toHaveLength(1);
    tr.add(4030, A);
    expect(tr.now - sounded).toBeGreaterThan(PitchTrace.GAP_MS - 1);
    expect(tr.now - sounded).toBeLessThan(PitchTrace.GAP_MS + 100);
  });
  it('a moment’s dropout in a long note breaks the line but leaves no gap', () => {
    const tr = new PitchTrace();
    for (let t = 0; t <= 600; t += 30) tr.add(t, A);
    tr.add(630, null);
    tr.add(660, A);
    expect(tr.now).toBeLessThan(700);
  });
  it('keeps the last few seconds of sounding', () => {
    const tr = new PitchTrace(2);
    for (let t = 0; t <= 5000; t += 30) tr.add(t, A);
    expect(tr.now - tr.points[0].t).toBeLessThanOrEqual(2000);
  });
});
