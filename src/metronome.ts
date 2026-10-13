import { clampBpm } from './tempo.js';
import { holdAudio } from './audiosession.js';
import { keepAwake } from './keepawake.js';
import { walkingLine, pluckSample } from './bass.js';
import type { WalkingLine } from './bass.js';
import { loadSamples } from './sounds.js';
import type { BassChord, BassNote } from './bass.js';
import type { Samples } from './sounds.js';
import type { Id, Settings } from './types.js';

/** With the bass: which beats click. */
export type Click = NonNullable<Settings['bassClick']>;
/** A loop of part of a chart, in bar numbers (see ui/chart.ts). */
export interface BassLoop { from: number; to: number; name: string }
/** A walking bass: its chords, who started it (e.g. 'chart:<id>'), what it's through, and any loop. */
export interface Bass { chords: BassChord[]; owner: string; label: string; loop?: BassLoop | null }
export interface MetronomeState { running: boolean; bpm: number; beats: number; beat: number; itemId: Id | null; bass: Bass | null; click: Click }
export interface MetronomeStart { bpm?: number; beats?: number; itemId?: Id | null; bass?: Bass | null; click?: Click }
/** A click scheduled, for the visuals: its audio time, beat in the bar, and beat in the bass line (or null). */
interface Scheduled { time: number; beat: number; at: number | null }

// A metronome on the Web Audio clock. A timer wakes every 25 ms and schedules any clicks due in
// the next 120 ms at exact audio times, so the beat stays steady even if the page is busy.
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

const listeners = new Set<(s: MetronomeState) => void>();
// bass: a walking bass with the click (see bass.js): { chords, owner (who started it), label },
// played round and round; click: with the bass, 'all' beats, 'twofour' (2 and 4) or 'off'.
const state: MetronomeState = { running: false, bpm: 100, beats: 4, beat: 0, itemId: null, bass: null, click: 'twofour' };
let line: WalkingLine | BassNote[] = [];
let lineAt = 0;
let countIn = 0; // beats of clicks still to come before the bass comes in
let bassSamples: Samples | null = null; // the recorded bass, once loaded (the synth until then)
let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextTime = 0;
let nextBeat = 0;
let queue: Scheduled[] = []; // scheduled beats [{ time, beat }] for the visuals
let releaseAwake: (() => void) | null = null;
let releaseAudio: (() => void) | null = null;

export const metronome = {
  get state(): MetronomeState { return { ...state }; },
  subscribe(fn: (s: MetronomeState) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  // Must be called from a tap, so the phone allows audio.
  start({ bpm, beats, itemId, bass = null, click }: MetronomeStart = {}) {
    if (bpm) state.bpm = clampBpm(bpm);
    if (beats) state.beats = beats;
    if (itemId !== undefined) state.itemId = itemId; // null: not for an item
    if (click) state.click = click;
    // A bass starting (not just the same one changing key or loop) comes in after a bar of clicks.
    countIn = bass && !(state.running && state.bass?.owner === bass.owner) ? state.beats : 0;
    state.bass = bass;
    line = bass ? walkingLine(bass.chords) : [];
    lineAt = 0;
    if (state.running) { // (from the top of the bar, and the line)
      nextBeat = 0;
      loadBass();
      return emit();
    }
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    ctx = new Ctx();
    ctx.resume?.();
    // iOS pauses ("interrupts") the audio when the mic starts (recorder, tuner) or a call comes
    // in; pick up again rather than go quiet while it still says it's running.
    const mine = ctx;
    ctx.onstatechange = () => {
      if (ctx === mine && state.running && mine.state !== 'running' && mine.state !== 'closed') mine.resume?.().catch(() => {});
    };
    // Play through the iPhone's silent switch, like a music app.
    releaseAudio = holdAudio('playback');
    state.running = true;
    nextBeat = 0;
    queue = [];
    // The first time with the bass, wait a moment for its samples (the synth if they're slow).
    const go = () => {
      if (ctx !== mine || !state.running) return;
      nextTime = ctx.currentTime + 0.06;
      timer = setInterval(schedule, LOOKAHEAD_MS);
      schedule();
    };
    const waiting = loadBass();
    if (waiting) Promise.race([waiting, new Promise((r) => setTimeout(r, 2500))]).then(go);
    else go();
    releaseAwake = keepAwake();
    emit();
  },
  stop() {
    if (!state.running) return;
    state.running = false;
    state.bass = null;
    line = [];
    clearInterval(timer ?? undefined);
    ctx?.close?.().catch(() => {});
    ctx = null;
    queue = [];
    releaseAudio?.();
    releaseAudio = null;
    releaseAwake?.();
    releaseAwake = null;
    emit();
  },
  toggle(opts?: MetronomeStart) {
    if (state.running) this.stop();
    else this.start(opts);
  },
  setBpm(bpm: number) {
    state.bpm = clampBpm(bpm);
    emit();
  },
  setBeats(beats: number) {
    state.beats = beats;
    nextBeat = 0;
    emit();
  },
  setItem(itemId: Id | null) {
    state.itemId = itemId;
  },
  setClick(click: Click) {
    state.click = click;
    emit();
  },
  // The latest click that has sounded, for the visuals: { beat, since (seconds ago) } or null.
  lastClick(): { beat: number; since: number; at: number | null } | null {
    if (!ctx) return null;
    const now = ctx.currentTime;
    while (queue.length > 1 && queue[1].time <= now) queue.shift();
    return queue.length && queue[0].time <= now ? { beat: queue[0].beat, since: now - queue[0].time, at: queue[0].at } : null;
  },
  // With the bass: the beat of its line sounding now (counted from the top of its chords), or -1.
  bassBeat(): number {
    const c = state.bass ? this.lastClick() : null;
    return c?.at ?? -1;
  },
};

// Loads the recorded bass, when there's a bass line and it isn't loaded yet: the promise, or null.
function loadBass(): Promise<void> | null {
  if (!state.bass || bassSamples || !ctx) return null;
  return loadSamples(ctx, 'bass').then((s) => { bassSamples = s; }).catch(() => { /* the synth, then */ });
}

function emit() {
  for (const fn of listeners) fn(metronome.state);
}

function schedule() {
  if (!ctx) return;
  // After the timer was throttled (screen off, app in background, a busy moment), skip the missed
  // clicks rather than playing them all at once: by whole beats, so the beat (and the bass line,
  // and where it is in the bar) carries on where it would have been.
  while (nextTime < ctx.currentTime) {
    if (countIn > 0) countIn--;
    else if (line.length) advanceLine();
    nextTime += 60 / state.bpm;
    nextBeat = (nextBeat + 1) % state.beats;
  }
  while (nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
    const accent = nextBeat === 0 && state.beats > 1;
    let at = null;
    if (countIn > 0) {
      countIn--;
      click(nextTime, accent); // (every beat, whatever the click's set to with the bass)
    } else if (line.length) {
      at = lineAt;
      pluckSample(ctx, bassSamples, line[at].midi, nextTime, 60 / state.bpm, line[at].vel);
      advanceLine();
      if (state.click === 'all') click(nextTime, accent);
      else if (state.click === 'twofour' && nextBeat % 2 === 1) click(nextTime, false);
    } else click(nextTime, accent);
    queue.push({ time: nextTime, beat: nextBeat, at });
    nextTime += 60 / state.bpm;
    nextBeat = (nextBeat + 1) % state.beats;
  }
}

// On to the bass line's next beat; round again, a new line, carrying on from this one (so it
// doesn't repeat).
function advanceLine() {
  lineAt = (lineAt + 1) % line.length;
  if (lineAt === 0 && state.bass && 'next' in line) line = walkingLine(state.bass.chords, { after: line });
}

// A short woodblock-ish click; higher and louder on the downbeat.
function click(time: number, accent: boolean) {
  // (ctx!: only called from schedule, which has a context)
  const osc = ctx!.createOscillator();
  const gain = ctx!.createGain();
  osc.type = 'square';
  osc.frequency.value = accent ? 1760 : 1100;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
  const tone = ctx!.createBiquadFilter();
  tone.type = 'bandpass';
  tone.frequency.value = accent ? 1760 : 1100;
  tone.Q.value = 4;
  osc.connect(tone).connect(gain).connect(ctx!.destination);
  osc.start(time);
  osc.stop(time + 0.06);
}

// In the background the phone slows the timer down, so the clicks would drift: stop, and keep
// what it was doing so the app can offer to start it again (takeAwayStop).
let stoppedAway: Pick<MetronomeState, 'bpm' | 'beats' | 'itemId' | 'bass' | 'click'> | null = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state.running) {
    stoppedAway = { bpm: state.bpm, beats: state.beats, itemId: state.itemId, bass: state.bass, click: state.click };
    metronome.stop();
  }
});
// What was stopped when the app went into the background (once), or null.
export function takeAwayStop(): typeof stoppedAway {
  const s = stoppedAway;
  stoppedAway = null;
  return s;
}
