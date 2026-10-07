import { MAJOR } from './keys.js';
import { TRANSPOSITIONS } from './constants.js';

// Pitch detection for the tuner: the YIN algorithm (de Cheveigné & Kawahara, 2002) on a block of
// mic samples. Works well for single-line instruments like sax, including notes with strong
// overtones, where picking the loudest frequency would often land on a harmonic.

export const MIN_HZ = 50; // below a tenor's low B♭ (concert A♭2, 104 Hz) and a bari's (55 Hz)
export const MAX_HZ = 2000;

// Returns { hz, clarity 0–1 } or null when there's no clear note (silence, noise, chords).
export function detectPitch(buf, sampleRate, { minHz = MIN_HZ, maxHz = MAX_HZ, threshold = 0.15, minRms = 0.01 } = {}) {
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
export function noteOf(hz, a4 = 440) {
  const exact = 69 + 12 * Math.log2(hz / a4);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100 };
}

// "B♭3": concert name with octave (scientific pitch: middle C = C4).
export function concertName(midi) {
  return `${MAJOR[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

// The note name as written for a transposing instrument (no octave: a B♭ part could be for
// soprano or tenor, which are an octave apart).
export function writtenName(midi, view = 'c') {
  return MAJOR[(((midi + TRANSPOSITIONS[view].offset) % 12) + 12) % 12];
}
