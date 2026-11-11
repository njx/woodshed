import { MAJOR } from './keys.js';
import { TRANSPOSITIONS } from './constants.js';
import type { Transposition } from './types.js';

// Pitch detection for the tuner: the YIN algorithm (de Cheveigné & Kawahara, 2002) on a block of
// mic samples. Works well for single-line instruments like sax, including notes with strong
// overtones, where picking the loudest frequency would often land on a harmonic.

export const MIN_HZ = 50; // below a tenor's low B♭ (concert A♭2, 104 Hz) and a bari's (55 Hz)
export const MAX_HZ = 2000;

// Returns { hz, clarity 0–1 } or null when there's no clear note (silence, noise, chords).
export function detectPitch(buf: Float32Array, sampleRate: number, { minHz = MIN_HZ, maxHz = MAX_HZ, threshold = 0.15, minRms = 0.01 } = {}): { hz: number; clarity: number } | null {
  const n = buf.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += buf[i] * buf[i];
  if (Math.sqrt(sum / n) < minRms) return null;

  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const w = n - maxTau;
  // Difference function, then cumulative-mean-normalized (d'[0] = 1).
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let j = 0; j < w; j++) {
      const diff = buf[j] - buf[j + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    d[tau] = running ? (d[tau] * tau) / running : 1;
  }

  // The first dip below the threshold, followed down to its minimum.
  let tau = -1;
  for (let t = minTau; t < maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 < maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // Parabolic interpolation between neighbouring lags for sub-sample precision.
  const a = d[tau - 1], b = d[tau], c = d[tau + 1] ?? b;
  const den = a - 2 * b + c;
  const shift = den ? (a - c) / (2 * den) : 0;
  const hz = sampleRate / (tau + (Math.abs(shift) < 1 ? shift : 0));
  if (hz < minHz || hz > maxHz) return null;
  return { hz, clarity: Math.max(0, Math.min(1, 1 - b)) };
}

// The nearest note to a frequency, and how far off it is.
// midi: concert MIDI note number; cents: −50…+50 from it.
export function noteOf(hz: number, a4 = 440): { midi: number; cents: number } {
  const exact = 69 + 12 * Math.log2(hz / a4);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100 };
}

// "B♭3": concert name with octave (scientific pitch: middle C = C4).
export function concertName(midi: number): string {
  return `${MAJOR[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

// The note name as written for an instrument (no octave).
export function writtenName(midi: number, view: Transposition = 'c'): string {
  return MAJOR[(((midi + TRANSPOSITIONS[view].offset) % 12) + 12) % 12];
}
// …with the octave it's written in for that instrument ("C5" for a concert B♭3 on tenor sax).
export function writtenNote(midi: number, view: Transposition = 'c'): string {
  return `${writtenName(midi, view)}${Math.floor((midi + TRANSPOSITIONS[view].written) / 12) - 1}`;
}

/** A point of the trace: when (on its clock), and the note and cents (both null: a break). */
export interface TracePoint { t: number; cents: number | null; midi: number | null }
// The tuner's trace of the last few seconds of pitch. Its clock runs only while a note sounds, so
// a silence doesn't scroll what you played away: the line breaks there, and after a real pause
// (not a moment's dropout in a long note) the next note starts a little gap along.
export class PitchTrace {
  static GAP_MS = 400; // between phrases
  static PAUSE_MS = 250; // silent this long: a pause
  points: TracePoint[] = [];
  now = 0; // the clock: milliseconds of sound (and gaps)
  private at: number | null = null; // when (in real time) the last reading came
  private silentSince: number | null = null;
  constructor(private seconds = 10) {}
  add(t: number, reading: { midi: number; cents: number } | null): void {
    const dt = this.at == null ? 0 : Math.min(t - this.at, 200); // (a stall isn't sound)
    this.at = t;
    if (!reading) {
      if (this.silentSince == null) {
        this.silentSince = t;
        if (this.points.length) this.points.push({ t: this.now, cents: null, midi: null });
      }
      return;
    }
    if (this.silentSince != null) {
      if (t - this.silentSince >= PitchTrace.PAUSE_MS && this.points.length) this.now += PitchTrace.GAP_MS;
      else this.now += dt;
      this.silentSince = null;
    } else this.now += dt;
    this.points.push({ t: this.now, cents: reading.cents, midi: reading.midi });
    while (this.points.length && this.now - this.points[0].t > this.seconds * 1000) this.points.shift();
  }
  clear(): void {
    this.points = [];
    this.now = 0;
    this.at = this.silentSince = null;
  }
}
