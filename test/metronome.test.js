import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('../src/audiosession.js', () => ({ holdAudio: () => () => {} }));
vi.mock('../src/keepawake.js', () => ({ keepAwake: () => () => {} }));
vi.mock('../src/sounds.js', async (orig) => ({ ...(await orig()), loadSamples: () => Promise.reject(new Error('offline')) })); // (the synth bass)

// The metronome's scheduler, against a fake audio clock: what it schedules, and when.
const clicks = []; // [time, frequency]
const plucks = []; // times
let now = 0;
function node() {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const n = { gain: param(), frequency: param(), Q: param(), playbackRate: param(), connect: (x) => x, start() {}, stop() {} };
  return n;
}
class FakeContext {
  state = 'running';
  destination = {};
  get currentTime() { return now; }
  createGain() { return node(); }
  createBiquadFilter() { return node(); }
  createOscillator() {
    const o = node();
    o.start = (t) => { (o.type === 'square' ? clicks : plucks).push([Math.round(t * 1000) / 1000, o.frequency.value]); };
    return o;
  }
  createBufferSource() { return node(); }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

let metronome;
beforeAll(async () => {
  vi.useFakeTimers();
  globalThis.document ??= { addEventListener() {}, visibilityState: 'visible' };
  globalThis.AudioContext = FakeContext;
  ({ metronome } = await import('../src/metronome.js'));
});
afterEach(() => { metronome.stop(); clicks.length = 0; plucks.length = 0; now = 0; });

// Runs the clock on, the timer firing every 25 ms as it would.
async function run(seconds) {
  const end = now + seconds;
  while (now < end) { now += 0.025; await vi.advanceTimersByTimeAsync(25); }
}

describe('metronome', () => {
  it('clicks on the beat, accenting the first of the bar', async () => {
    metronome.start({ bpm: 120, beats: 4 });
    await run(2.1);
    const times = clicks.map(([t]) => t);
    expect(times.slice(0, 5)).toEqual([0.06, 0.56, 1.06, 1.56, 2.06]);
    expect(clicks.map(([, f]) => f).slice(0, 5)).toEqual([1760, 1100, 1100, 1100, 1760]);
  });

  it('after a stall, carries on on the beat it would have been on (not late, not starting the bar again)', async () => {
    metronome.start({ bpm: 120, beats: 4 });
    await run(1.0); // clicks at 0.06, 0.56, 1.06 (scheduled ahead)
    now += 0.7; // the page is busy: no timer for 0.7 s
    await run(1.5);
    const times = clicks.map(([t]) => t);
    // Still on the 0.06 + n/2 grid, missed ones skipped…
    for (const t of times) expect(((t - 0.06) * 2) % 1).toBeCloseTo(0, 5);
    // …and the accent still every four beats from the start.
    for (const [t, f] of clicks) expect(f).toBe(Math.round((t - 0.06) * 2) % 4 === 0 ? 1760 : 1100);
  });

  const bass = (owner, root = 0) => ({ owner, label: owner, chords: [{ root, family: 'maj7', beats: 4 }, { root: (root + 5) % 12, family: 'dom7', beats: 4 }] });
  // The bass's notes (the synth: a sawtooth and a sine each), by time.
  const bassTimes = () => [...new Set(plucks.map(([t]) => t))];

  it('a walking bass comes in after a bar of clicks; another tune’s bass counts in again, the same one in a new key doesn’t', async () => {
    metronome.start({ bpm: 120, beats: 4, bass: bass('a') });
    await run(2.6);
    expect(bassTimes()[0] - clicks[0][0]).toBeCloseTo(2); // after 4 clicks
    plucks.length = 0;
    metronome.start({ bpm: 120, beats: 4, bass: bass('a', 2) }); // the same, in D
    const t = now;
    await run(1);
    expect(bassTimes()[0] - t).toBeLessThan(0.6); // (on the next beat)
    plucks.length = 0;
    metronome.start({ bpm: 120, beats: 4, bass: bass('b') }); // another tune
    const u = now;
    await run(2.6);
    expect(bassTimes()[0] - u).toBeGreaterThan(1.9);
  });

  it('keeps the bass going round, a new line each time', async () => {
    metronome.start({ bpm: 240, beats: 4, bass: bass('a') }); // a beat each 0.25 s
    await run(1 + 8 * 0.25 * 6); // the count-in, then six times round
    expect(bassTimes().length).toBeGreaterThanOrEqual(8 * 5);
  });
});
