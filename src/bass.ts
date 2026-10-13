import { chartFor } from './charts.js';
import { nearestSample } from './sounds.js';
import { chordTimeline, chordFamily, chartShift } from './chords.js';
import type { Samples } from './sounds.js';
import type { Bar, Chart, Chord, Key, Tune } from './types.js';

/** A chord for the walking bass: its root (concert pitch class), family (a chord type in theory.ts) and beats. */
export interface BassChord { root: number; family: string; beats: number }
/**
 * A note of the line: MIDI, the index of the chord it's on, how hard it's played (0–1), and on the
 * first note of each bar's shape, which shape it is (see SHAPES).
 */
export interface BassNote { midi: number; chord: number; vel: number; shape?: string }
/** A chart's section as a range of its bars (see chartBars); name: its label, numbered if repeated. */
export interface BarSection { label: string; from: number; to: number; name: string }

// A walking bass for a chord progression, to play against and loop over. It's a mode of the
// metronome (metronome.ts plays it, on the same clock as the click).
//
// Each chord starts on its root, and its last beat leads into the next chord's root: a half step
// below or above it, or a step. In between, a few shapes a bass player uses (in a bar of four:
// 1 2 3 5, 1 2 ♭3 3 into a root a 4th up, 1 3 5 ♭5, 1 3 5 3, 8 1 2 3, 1 1 2 3, 1 ♭7 6 5 on a
// dominant…), each one only where it leads where the line is going, picked at random but not the
// same twice running. The next root goes in the octave the line leads to, so it moves like one
// line, between E1 and E3. A chord held longer walks to its own octave and on. Played round and
// round, it's made again each time (from where the last time left off), so it doesn't repeat.

const LOW = 28; // E1
const HIGH = 52; // E3 (so a held chord always has its root an octave up or down to walk to)
const MID = 40; // E2

const MINOR = ['m7', 'm6', 'mMaj7', 'm7b5', 'dim7'];
interface Tones { third: number; fifth: number; seventh: number; dominant: boolean }
function degrees(family: string): Tones {
  const third = family === 'dom7sus' ? 5 : MINOR.includes(family) ? 3 : 4;
  const fifth = ['m7b5', 'dim7'].includes(family) ? 6 : ['dom7s5', 'maj7s5'].includes(family) ? 8 : 7;
  const seventh = family === 'dim7' ? 9 : ['maj7', 'maj7s5', 'mMaj7'].includes(family) ? 11 : ['maj6', 'm6'].includes(family) ? 9 : 10; // (the 6th, on a 6 chord)
  return { third, fifth, seventh, dominant: family.startsWith('dom7') };
}

// A half step or a whole step from x into t.
const leads = (x: number, t: number) => { const d = Math.abs(t - x); return d === 1 || d === 2; };
const inRange = (notes: number[]) => notes.every((m) => m >= LOW && m <= HIGH);

// The shapes, by how many beats they fill: from root r toward t (the next root, or this chord's
// own octave), with the chord's tones; the notes, or null where it doesn't lead to t.
type Make = (r: number, c: Tones, t: number) => number[] | null;
const SHAPES: Record<number, Record<string, Make>> = {
  4: {
    '1 2 3 5': (r, c, t) => (leads(r + c.fifth, t) ? [r, r + 2, r + c.third, r + c.fifth] : null),
    // Up a step, then chromatically into a root a 4th or 5th up (1 2 ♭3 3 into a 4th up), or the
    // same down into one a 4th or 5th below (1 ♭7 5 ♭5 into a 4th below).
    'chromatic up': (r, _c, t) => (t - r >= 5 && t - r <= 7 ? [r, r + 2, t - 2, t - 1] : null),
    'chromatic down': (r, _c, t) => (r - t >= 5 && r - t <= 7 ? [r, r - 2, t + 2, t + 1] : null),
    '1 3 5 ♭5': (r, c, t) => (Math.abs(r + c.fifth - (t + 1)) <= 2 && r + c.fifth !== t + 1 ? [r, r + c.third, r + c.fifth, t + 1] : null),
    '1 3 5 ♯5': (r, c, t) => (Math.abs(r + c.fifth - (t - 1)) <= 2 && r + c.fifth !== t - 1 ? [r, r + c.third, r + c.fifth, t - 1] : null),
    '1 3 5 3': (r, c, t) => (leads(r + c.third, t) ? [r, r + c.third, r + c.fifth, r + c.third] : null),
    '8 1 2 3': (r, c, t) => (leads(r + c.third - 12, t) ? [r, r - 12, r - 10, r + c.third - 12] : null), // (from the octave, down)
    '1 1 2 3': (r, c, t) => (leads(r + c.third, t) ? [r, r, r + 2, r + c.third] : null),
    '1 ♭7 6 5': (r, c, t) => (c.dominant && leads(r - 5, t) ? [r, r - 2, r - 3, r - 5] : null),
    '1 3 5 7': (r, c, t) => (leads(r + c.seventh, t) ? [r, r + c.third, r + c.fifth, r + c.seventh] : null), // on up to the octave
    '1 5 6 7': (r, c, t) => (leads(r + c.seventh, t) && c.fifth === 7 && c.seventh > 9 ? [r, r + 7, r + 9, r + c.seventh] : null),
    '8 5 3 2': (r, c, t) => (leads(r - 10, t) ? [r, r + c.fifth - 12, r + c.third - 12, r - 10] : null), // down to the octave below
    // Round and back to the same root (a chord held on): 1 2 3 2, 1 5 3 2, 1 3 2 ♭2.
    '1 2 3 2': (r, c, t) => (t === r ? [r, r + 2, r + c.third, r + 2] : null),
    '1 5 3 2': (r, c, t) => (t === r ? [r, r + c.fifth, r + c.third, r + 2] : null),
    '1 3 2 ♭2': (r, c, t) => (t === r ? [r, r + c.third, r + 2, r + 1] : null),
    '8 5 3 (lead)': (r, c, t) => { const x = [t - 1, t + 1].find((y) => Math.abs(y - (r + c.third - 12)) <= 2 && y !== r + c.third - 12); return x == null ? null : [r, r + c.fifth - 12, r + c.third - 12, x]; },
    '1 5 8 (lead)': (r, c, t) => { const x = [t - 1, t + 1].find((y) => Math.abs(y - (r + 12)) <= 2 && y !== r + 12); return x == null ? null : [r, r + c.fifth, r + 12, x]; },
  },
  3: {
    '1 3 (lead)': (r, c, t) => { const x = [t - 1, t + 1].find((y) => Math.abs(y - (r + c.third)) <= 2); return x == null ? null : [r, r + c.third, x]; },
    '1 2 (lead)': (r, _c, t) => { const x = [t - 1, t + 1, t - 2].find((y) => Math.abs(y - (r + 2)) <= 2 && y !== r + 2); return x == null ? null : [r, r + 2, x]; },
    '1 5 (lead)': (r, c, t) => { const x = [t - 1, t + 1].find((y) => Math.abs(y - (r + c.fifth)) <= 2); return x == null ? null : [r, r + c.fifth, x]; },
  },
  2: {
    '1 (half step below)': (r, _c, t) => (Math.abs(t - 1 - r) <= 7 && t - 1 !== r ? [r, t - 1] : null),
    '1 (half step above)': (r, _c, t) => (Math.abs(t + 1 - r) <= 7 && t + 1 !== r ? [r, t + 1] : null),
    '1 (step)': (r, _c, t) => (Math.abs(t - 2 - r) <= 7 && t - 2 !== r ? [r, t - 2] : null),
    '1 5': (r, c, t) => ([5, 7].includes(Math.abs(t - (r + c.fifth))) || leads(r + c.fifth, t) ? [r, r + c.fifth] : null), // the 5th, into the next root
  },
};

// The octaves of pitch class pc in the bass's range.
const octaves = (pc: number) => [...Array(HIGH - LOW + 1).keys()].map((i) => LOW + i).filter((m) => ((m % 12) + 12) % 12 === ((pc % 12) + 12) % 12);
// The lowest root at or above A1 (where the line starts, with nothing before it).
const rootMidi = (pc: number) => 33 + ((((pc - 9) % 12) + 12) % 12);

// One stretch of a chord (1–4 beats) from root r: the notes, its shape, and where it leads (t).
function stretch(n: number, r: number, c: Tones, targets: number[], last: string | undefined, rand: () => number) {
  if (n === 1) return { notes: [r], shape: '1', t: nearest(targets, r) };
  // First which octave to head for: smaller moves sound more like one line, and the middle of the
  // range (E2) more like a bass. Then a shape that gets there: the same one twice running, less often.
  const ways = targets.map((t) => ({
    t,
    w: 1 / (1 + Math.abs(t - r) / 5) / (1 + Math.abs(t - MID) / 8),
    shapes: Object.entries(SHAPES[n]).flatMap(([shape, make]) => {
      const notes = make(r, c, t);
      return notes && inRange(notes) ? [{ notes, shape, t, w: shape === last ? 0.15 : 1 }] : [];
    }),
  })).filter((x) => x.shapes.length);
  if (ways.length) return pick(pick(ways, rand).shapes, rand);
  // Nothing fits: up 1 3 5, or down 1 5 3 if that's too high, into the nearest by a half step.
  const arp = r + c.fifth <= HIGH ? [r, r + c.third, r + c.fifth] : [r, r + c.fifth - 12, r + c.third - 12];
  const from = arp[Math.min(n - 2, 2)];
  const t = nearest(targets, from);
  const x = Math.abs(t - 1 - from) < Math.abs(t + 1 - from) ? t - 1 : t + 1;
  return { notes: [...arp.slice(0, n - 1), x], shape: 'arpeggio (lead)', t };
}
// One of the options, at random by their weights.
function pick<T extends { w: number }>(options: T[], rand: () => number): T {
  let x = rand() * options.reduce((s, o) => s + o.w, 0);
  for (const o of options) if ((x -= o.w) <= 0) return o;
  return options[options.length - 1];
}
const nearest = (list: number[], x: number) => list.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));

// chords: [{ root (concert pitch class), family, beats }] → [{ midi, chord (its index), vel,
// shape }], one a beat, looping back to the first chord. after: the line the last time round, to
// carry on from (where it led, and not the same shape again). (Beats are rounded so the total
// stays the same: three chords in a 4/4 bar get 1, 2 and 1.) The result's `next`: where it leads.
export type WalkingLine = BassNote[] & { next: number; last?: string };
export function walkingLine(chords: BassChord[], { after = null, rand = Math.random }: { after?: WalkingLine | null; rand?: () => number } = {}): WalkingLine {
  const out: BassNote[] = [];
  let at = 0;
  let r = after?.next ?? (chords.length ? rootMidi(chords[0].root) : LOW);
  let last = after?.last;
  chords.forEach((c, ci) => {
    let n = Math.max(1, Math.round(at + c.beats) - Math.round(at));
    at += c.beats;
    const tones = degrees(c.family);
    const next = chords[(ci + 1) % chords.length];
    // In bars of four (any left over at the start); within the chord, each bar walks to its own
    // root (in this octave or another), then the last leads into the next chord.
    while (n > 0) {
      const len = n % 4 || 4;
      n -= len;
      const own = [r - 12, r, r + 12].filter((m) => m >= LOW && m <= HIGH);
      const targets = n > 0 && own.length ? own : octaves(next.root);
      const s = stretch(len, r, tones, targets, last, rand);
      s.notes.forEach((midi, i) => out.push({
        midi, chord: ci,
        // A little life: the first beat firmest, the rest a touch softer, not all alike.
        vel: i === 0 ? 1 : 0.82 + rand() * 0.14,
        ...(i === 0 ? { shape: s.shape } : {}),
      }));
      last = s.shape;
      r = s.t;
    }
  });
  return Object.assign(out, { next: r, last });
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

// A recorded bass note (an upright, plucked: see scripts/make-samples.sh): the nearest sample,
// shifted to the pitch, held right into the next beat (a walking line is legato) and then damped
// as the next note starts. samples: { midi: AudioBuffer }; vel: how hard (0–1).
export function pluckSample(ctx: BaseAudioContext, samples: Samples | null, midi: number, time: number, beat: number, vel = 1): void {
  const m = nearestSample('bass', midi);
  const buf = m == null ? undefined : samples?.[m]; // (no sample note: none loaded either)
  if (m == null || !buf) return pluck(ctx, midi, time, beat, vel);
  const end = time + beat; // the next note
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 2 ** ((midi - m) / 12);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.9 * vel, time);
  gain.gain.setValueAtTime(0.9 * vel, end);
  gain.gain.exponentialRampToValueAtTime(0.0008, end + 0.07);
  src.connect(gain).connect(ctx.destination);
  src.start(time);
  src.stop(end + 0.09);
}

// The synth, until the samples are loaded (or offline before they ever were). A plucked bass note: a sawtooth (whose overtones carry the pitch on a phone's small speaker,
// which can't play the low notes themselves) with a sine for the low end, through a low-pass
// that closes after the attack. Held most of the beat, a little detached.
export function pluck(ctx: BaseAudioContext, midi: number, time: number, beat: number, vel = 1): void {
  const f = 440 * 2 ** ((midi - 69) / 12);
  const len = beat * 0.9;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.55 * vel, time + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.28 * vel, time + 0.18);
  gain.gain.setValueAtTime(0.28 * vel, time + len - 0.04);
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
