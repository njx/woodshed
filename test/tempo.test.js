import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../src/store.js';
import { stepUp, stepDown, tempoSuggestion, setTempo, tapBpm } from '../src/tempo.js';
import { markPlayed, rate } from '../src/practice.js';
import { freezeToday, tune, setState, entry } from './helpers.js';

beforeEach(() => freezeToday());
afterEach(() => vi.useRealTimers());

describe('tempo steps', () => {
  it('goes up about 5% and down about 10%, within limits', () => {
    expect(stepUp(120)).toBe(126);
    expect(stepUp(40)).toBe(42);
    expect(stepUp(150, 152)).toBe(152); // not past the goal
    expect(stepDown(120)).toBe(108);
    expect(stepDown(32)).toBe(30);
  });
});

describe('tempo suggestions', () => {
  const at = (t, date, rating, bpm = t.tempo) => entry(t.id, date, { rating, bpm });

  it('speeds up after two solid sessions at the working tempo', () => {
    const t = tune({ tempo: 120 });
    setState([t], { log: [at(t, '2026-10-03', 'solid'), at(t, '2026-10-05', 'solid')] });
    expect(tempoSuggestion(t)).toMatchObject({ to: 126, up: true });
  });

  it('waits for a second solid one, and OK keeps the tempo', () => {
    const t = tune({ tempo: 120 });
    setState([t], { log: [at(t, '2026-10-03', 'ok'), at(t, '2026-10-05', 'solid')] });
    expect(tempoSuggestion(t)).toBe(null);
  });

  it('slows down after a rough session', () => {
    const t = tune({ tempo: 120 });
    setState([t], { log: [at(t, '2026-10-03', 'solid'), at(t, '2026-10-05', 'rough')] });
    expect(tempoSuggestion(t)).toMatchObject({ to: 108, up: false });
  });

  it('only counts sessions at the current tempo, since it was last changed', () => {
    const t = tune({ tempo: 120 });
    setState([t], { log: [at(t, '2026-10-03', 'solid', 112), at(t, '2026-10-05', 'solid')] });
    expect(tempoSuggestion(t)).toBe(null);
    const u = tune({ tempo: 100 });
    setState([u], { log: [at(u, '2026-10-03', 'solid'), at(u, '2026-10-04', 'solid')] });
    setTempo(u, 100);
    expect(tempoSuggestion(u)).toBe(null);
  });

  it('celebrates reaching the goal', () => {
    const t = tune({ tempo: 160, goalTempo: 160 });
    setState([t], { log: [at(t, '2026-10-03', 'solid'), at(t, '2026-10-05', 'solid')] });
    expect(tempoSuggestion(t)).toMatchObject({ done: true, to: null });
  });

  it('records the working tempo when a session is logged, and follows changes made today', () => {
    const t = tune({ tempo: 96 });
    setState([t]);
    markPlayed(t.id);
    rate(t.id, 'solid');
    expect(store.state.log[0].bpm).toBe(96);
    setTempo(t, 104);
    expect(store.state.log[0].bpm).toBe(104);
    setTempo(t, 110, { nextTime: true }); // accepting a suggestion is for next time
    expect(store.state.log[0].bpm).toBe(104);
    expect(t.tempo).toBe(110);
  });

  it('still suggests from today’s session after adjusting the tempo mid-practice', () => {
    const t = tune({ tempo: 96 });
    setState([t]);
    markPlayed(t.id);
    setTempo(t, 100); // nudged on the metronome while playing
    rate(t.id, 'rough');
    expect(tempoSuggestion(t)).toMatchObject({ to: 90, up: false });
  });
});

describe('tap tempo', () => {
  it('averages the last few taps and restarts after a pause', () => {
    expect(tapBpm([0])).toBe(null);
    expect(tapBpm([0, 500, 1000, 1500])).toBe(120);
    expect(tapBpm([0, 500, 4000, 4600])).toBe(100);
  });
});
