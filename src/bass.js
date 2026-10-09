import { chartFor } from './charts.js';
import { chordTimeline, chordFamily, chartShift } from './chords.js';

// A simple walking bass for a chord progression, to play against and loop over. It's a mode of
// the metronome (metronome.js plays it, on the same clock as the click).
//
// The line: on each chord, a beat at a time, 1-2-3-5 (the 3rd and 5th the chord's own: minor,
// flat 5 and so on); a chord held longer walks back down from the octave (8-7-5-3), then up
// again. Two beats: 1-5; three: 1-3-5.

const MINOR = ['m7', 'm6', 'mMaj7', 'm7b5', 'dim7'];
function degrees(family) {
  const third = family === 'dom7sus' ? 5 : MINOR.includes(family) ? 3 : 4;
  const fifth = ['m7b5', 'dim7'].includes(family) ? 6 : ['dom7s5', 'maj7s5'].includes(family) ? 8 : 7;
  const seventh = family === 'dim7' ? 9 : ['maj7', 'maj6', 'maj7s5', 'mMaj7'].includes(family) ? 11 : family === 'm6' ? 9 : 10;
  return { third, fifth, seventh };
}

// Lowest root: A1 (MIDI 33) up to G♯2, so the line stays in the bass's range.
const rootMidi = (pc) => 33 + ((((pc - 9) % 12) + 12) % 12);

// chords: [{ root (concert pitch class), family, beats }] → [{ midi, chord (its index) }], one a beat.
// (Beats are rounded so the total stays the same: three chords in a 4/4 bar get 1, 2 and 1.)
export function walkingLine(chords) {
  const out = [];
  let at = 0;
  chords.forEach((c, ci) => {
    const n = Math.max(1, Math.round(at + c.beats) - Math.round(at));
    at += c.beats;
    const r = rootMidi(c.root);
    const { third, fifth, seventh } = degrees(c.family);
    const up = [0, 2, third, fifth];
    const down = [12, seventh, fifth, third];
    const short = { 1: [0], 2: [0, fifth], 3: [0, third, fifth] }[n];
    const steps = short || [...Array(n).keys()].map((i) => (Math.floor(i / 4) % 2 ? down : up)[i % 4]);
    for (const s of steps) out.push({ midi: r + s, chord: ci });
  });
  return out;
}


// The chords of a tune's chart in playing order, in concert `key` (null: the chart's own), for
// walkingLine; and its beats per bar.
export function chartChords(t, key = null) {
  const chart = chartFor(t);
  if (!chart) return null;
  const up = chartShift(chart, key ?? chart.key ?? 0, 'c');
  return {
    chords: chordTimeline(chart).map((c) => ({ root: (c.root + up) % 12, family: chordFamily(c.q), beats: c.beats })),
    beats: Number(String(chart.meter || '4/4').split('/')[0]) || 4,
  };
}

// A plucked bass note: a sawtooth (whose overtones carry the pitch on a phone's small speaker,
// which can't play the low notes themselves) with a sine for the low end, through a low-pass
// that closes after the attack. Held most of the beat, a little detached.
export function pluck(ctx, midi, time, beat) {
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
  for (const [type, mult, level] of [['sawtooth', 1, 0.5], ['sine', 1, 0.8]]) {
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
