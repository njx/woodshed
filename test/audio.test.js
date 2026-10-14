import { describe, it, expect, vi, beforeAll } from 'vitest';

// The shared audio: one context, kept running while anything holds it.
vi.mock('../src/audiosession.js', () => ({ holdAudio: () => () => {} }));
const made = [];
class FakeContext {
  constructor() { this.state = 'running'; this.sampleRate = 48000; this.destination = {}; made.push(this); }
  get currentTime() { return 0; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  resume() { this.state = 'running'; this.onstatechange?.(); return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
let audio;
const visibility = [];
beforeAll(async () => {
  globalThis.document ??= { visibilityState: 'visible', addEventListener: (t, fn) => visibility.push(fn) };
  globalThis.AudioContext = FakeContext;
  audio = await import('../src/audio.js');
});

describe('the shared audio', () => {
  it('is one context for everyone, suspended once nothing holds it', () => {
    const a = audio.acquireAudio('playback');
    const b = audio.acquireAudio('record');
    expect(a.ctx).toBe(b.ctx);
    expect(made).toHaveLength(1);
    a.release();
    a.release(); // (twice: counted once)
    expect(b.ctx.state).toBe('running');
    b.release();
    expect(b.ctx.state).toBe('suspended');
    const c = audio.acquireAudio();
    expect(c.ctx.state).toBe('running');
    expect(made).toHaveLength(1);
    c.release();
  });

  it('is woken when the phone interrupts it, while held', () => {
    const a = audio.acquireAudio();
    a.ctx.state = 'interrupted';
    a.ctx.onstatechange();
    expect(a.ctx.state).toBe('running');
    a.release();
  });

  it('starts again at the mic’s sample rate, and its users build their part again', () => {
    const a = audio.acquireAudio();
    const old = a.ctx;
    const seen = [];
    const off = audio.onAudioReset((c) => seen.push(c));
    audio.matchSampleRate(48000); // (the same: nothing to do)
    expect(seen).toHaveLength(0);
    old.sampleRate = 44100;
    audio.matchSampleRate(48000);
    expect(seen).toEqual([a.ctx]);
    expect(a.ctx).not.toBe(old);
    expect(old.state).toBe('closed');
    off();
    a.release();
  });
});
