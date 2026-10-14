import { holdAudio } from './audiosession.js';

// The app's one AudioContext, shared by everything that plays or listens: the metronome and its
// walking bass, notation playing, the tuner, and the recorder's level meter. One clock for all of
// them, and one context (iOS allows only a few, and each new one starts silent until it's woken
// from a tap).
//
// Each user acquires it (the first time, from a tap, so the phone lets it start) and releases it
// when done. While anything holds it, it's kept running: woken when the phone suspends or
// interrupts it (a call, Siri, the mic starting) and when the app comes back to the front. With
// nothing holding it, it's suspended (to save the battery), not closed.
//
// A user's sound goes through its own output (a GainNode to the speakers), so stopping it can
// silence what it had already scheduled, without touching anyone else's.

export interface Audio {
  ctx: AudioContext;
  /** A new output to the speakers, for this user's sound: disconnect it to stop it all. */
  output(): GainNode;
  release(): void;
}

let ctx: AudioContext | null = null;
let holders = 0;
const resets = new Set<(ctx: AudioContext) => void>();

function make(): AudioContext {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) throw new Error('no audio');
  const c = new Ctx();
  c.onstatechange = () => {
    if (c === ctx && holders && c.state !== 'running' && (c.state as string) !== 'closed') c.resume().catch(() => {});
  };
  return c;
}

// Back in front: whatever was playing or listening goes on.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && holders && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
});

/**
 * Hold the shared context (made the first time: call from a tap). session: the iPhone's audio
 * session to hold with it (see audiosession.ts) — 'playback' to sound with the silent switch on,
 * 'record' to use the mic alongside playback.
 */
export function acquireAudio(session?: 'playback' | 'record'): Audio {
  ctx ||= make();
  holders++;
  const releaseSession = session ? holdAudio(session) : null;
  ctx.resume().catch(() => {});
  let done = false;
  return {
    get ctx() { return ctx!; }, // (the current one: see matchSampleRate)
    output() {
      const out = ctx!.createGain();
      out.connect(ctx!.destination);
      return out;
    },
    release() {
      if (done) return;
      done = true;
      releaseSession?.();
      if (--holders === 0) ctx?.suspend().catch(() => {});
    },
  };
}

/** The shared context's clock, if there is one (for showing what's playing). */
export const audioTime = (): number | null => ctx?.currentTime ?? null;

/**
 * A new context replaced the old one (see matchSampleRate): whatever was built on the old one
 * (outputs, scheduled sound, the mic's input) is gone, and is built again on this one.
 * Returns a function to stop listening.
 */
export function onAudioReset(fn: (ctx: AudioContext) => void): () => void {
  resets.add(fn);
  return () => resets.delete(fn);
}

/**
 * The mic runs at this sample rate (earbuds can switch to another when their mic comes on), and a
 * context left at the old one hears silence: a new one at the device's rate replaces it, and its
 * users build their part again (onAudioReset).
 */
export function matchSampleRate(rate: number | undefined): void {
  if (!ctx || !rate || ctx.sampleRate === rate) return;
  const old = ctx;
  ctx = make();
  ctx.resume().catch(() => {});
  old.close().catch(() => {});
  for (const fn of [...resets]) fn(ctx);
}
