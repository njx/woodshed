import { chartFor } from './charts.js';
import { nearestSample } from './sounds.js';
import { chordTimeline, chordFamily, chartShift } from './chords.js';
import type { Samples } from './sounds.js';
import type { Bar, Chart, Chord, Key, Tune } from './types.js';

/** A chord for the walking bass: its root (concert pitch class), family (a chord type in theory.ts) and beats. */
export interface BassChord { root: number; family: string; beats: number }
/** A note of the line: MIDI, and the index of the chord it's on. */
export interface BassNote { midi: number; chord: number }
/** A chart's section as a range of its bars (see chartBars); name: its label, numbered if repeated. */
export interface BarSection { label: string; from: number; to: number; name: string }

// A simple walking bass for a chord progression, to play against and loop over. It's a mode of
// the metronome (metronome.js plays it, on the same clock as the click).
//
// The line: on each chord, a beat at a time, 1-2-3-5 (the 3rd and 5th the chord's own: minor,
// flat 5 and so on); a chord held longer walks back down from the octave (8-7-5-3), then up
// again. Two beats: 1-5; three: 1-3-5.

const MINOR = ['m7', 'm6', 'mMaj7', 'm7b5', 'dim7'];
function degrees(family: string) {
  const third = family === 'dom7sus' ? 5 : MINOR.includes(family) ? 3 : 4;
  const fifth = ['m7b5', 'dim7'].includes(family) ? 6 : ['dom7s5', 'maj7s5'].includes(family) ? 8 : 7;
  const seventh = family === 'dim7' ? 9 : ['maj7', 'maj6', 'maj7s5', 'mMaj7'].includes(family) ? 11 : family === 'm6' ? 9 : 10;
  return { third, fifth, seventh };
}

// Lowest root: A1 (MIDI 33) up to G♯2, so the line stays in the bass's range.
const rootMidi = (pc: number) => 33 + ((((pc - 9) % 12) + 12) % 12);

// chords: [{ root (concert pitch class), family, beats }] → [{ midi, chord (its index) }], one a beat.
// (Beats are rounded so the total stays the same: three chords in a 4/4 bar get 1, 2 and 1.)
export function walkingLine(chords: BassChord[]): BassNote[] {
  const out: BassNote[] = [];
  let at = 0;
  chords.forEach((c, ci) => {
    const n = Math.max(1, Math.round(at + c.beats) - Math.round(at));
    at += c.beats;
    const r = rootMidi(c.root);
    const { third, fifth, seventh } = degrees(c.family);
    const up = [0, 2, third, fifth];
    const down = [12, seventh, fifth, third];
    const short = ({ 1: [0], 2: [0, fifth], 3: [0, third, fifth] } as Partial<Record<number, number[]>>)[n];
    const steps = short || [...Array(n).keys()].map((i) => (Math.floor(i / 4) % 2 ? down : up)[i % 4]);
    for (const s of steps) out.push({ midi: r + s, chord: ci });
  });
  return out;
}


// A chart's bars in playing order (each section's bars, then its endings), numbered as the chart
// shows them (data-b in ui/chart.js); and its sections, as ranges of those bars, for looping one.
export function chartBars(chart: Chart): { bars: Bar[]; sections: BarSection[] } {
  const bars: Bar[] = [];
  const sections: (Omit<BarSection, 'name'> & { name?: string })[] = [];
  for (const s of chart.sections) {
    const from = bars.length;
    bars.push(...s.bars, ...s.endings.flat());
    sections.push({ label: s.label || '', from, to: bars.length - 1 });
  }
  // The same label twice (A, A, B, A): numbered, A1, A2, B, A3.
  const total = (l: string) => sections.filter((x) => x.label === l).length;
  const seen: Record<string, number> = {};
  for (const x of sections) x.name = total(x.label) > 1 ? `${x.label}${(seen[x.label] = (seen[x.label] || 0) + 1)}` : x.label || '–';
  return { bars, sections: sections as BarSection[] }; // (all named just above)
}

// The chords of a tune's chart in playing order, in concert `key` (null: the chart's own), for
// walkingLine, with its beats per bar. from/to: just those bars (a loop); a bar that carries the
// chord on (%) at the start of them takes the chord from before.
export function chartChords(t: Tune, key: Key | null = null, { from = null, to = null }: { from?: number | null; to?: number | null } = {}): { chords: BassChord[]; beats: number } | null {
  const chart = chartFor(t);
  if (!chart) return null;
  const up = chartShift(chart, key ?? chart.key ?? 0, 'c');
  const beats = Number(String(chart.meter || '4/4').split('/')[0]) || 4;
  const chord = (c: Chord, n: number): BassChord => ({ root: (c.root + up) % 12, family: chordFamily(c.q), beats: n });
  if (from == null) return { chords: chordTimeline(chart).map((c) => chord(c, c.beats)), beats };
  const { bars } = chartBars(chart);
  const out: BassChord[] = [];
  for (let i = from; i <= Math.min(to ?? bars.length - 1, bars.length - 1); i++) {
    const b = bars[i];
    if (b.chords.length) { for (const c of b.chords) out.push(chord(c, beats / b.chords.length)); continue; }
    if (out.length) { out.at(-1)!.beats += beats; continue; }
    const before = bars.slice(0, i).reverse().find((x) => x.chords.length);
    if (before) out.push(chord(before.chords.at(-1)!, beats)); // (found as one with chords)
  }
  return { chords: out, beats };
}

// A recorded bass note (electric bass, see scripts/make-samples.sh): the nearest sample, shifted
// to the pitch, held most of the beat and then damped. samples: { midi: AudioBuffer }.
export function pluckSample(ctx: BaseAudioContext, samples: Samples | null, midi: number, time: number, beat: number): void {
  const m = nearestSample('bass', midi);
  const buf = m == null ? undefined : samples?.[m]; // (no sample note: none loaded either)
  if (m == null || !buf) return pluck(ctx, midi, time, beat);
  const len = beat * 0.92;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 2 ** ((midi - m) / 12);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.9, time);
  gain.gain.setValueAtTime(0.9, time + len - 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0008, time + len);
  src.connect(gain).connect(ctx.destination);
  src.start(time);
  src.stop(time + len + 0.02);
}

// The synth, until the samples are loaded (or offline before they ever were). A plucked bass note: a sawtooth (whose overtones carry the pitch on a phone's small speaker,
// which can't play the low notes themselves) with a sine for the low end, through a low-pass
// that closes after the attack. Held most of the beat, a little detached.
export function pluck(ctx: BaseAudioContext, midi: number, time: number, beat: number): void {
  const f = 440 * 2 ** ((midi - 69) / 12);
  const len = beat * 0.9;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.55, time + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.28, time + 0.18);
  gain.gain.setValueAtTime(0.28, time + len - 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0008, time + len);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(2200, time);
  lp.frequency.exponentialRampToValueAtTime(750, time + 0.25);
  lp.connect(gain).connect(ctx.destination);
  for (const [type, mult, level] of [['sawtooth', 1, 0.5], ['sine', 1, 0.8]] as const) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = f * mult;
    g.gain.value = level;
    osc.connect(g).connect(lp);
    osc.start(time);
    osc.stop(time + len + 0.02);
  }
}
