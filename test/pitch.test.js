import { describe, it, expect } from 'vitest';
import { detectPitch, noteOf, concertName, writtenName } from '../src/pitch.js';

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
    expect(writtenName(58, 'bb')).toBe('C'); // concert B♭ is a written C on tenor
    expect(writtenName(58, 'eb')).toBe('G');
    expect(writtenName(58, 'f')).toBe('F');
    expect(writtenName(58, 'c')).toBe('B♭');
  });
});
