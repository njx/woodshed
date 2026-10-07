import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { messageCost, tokensOf, recordUsage, getUsage, summarize, resetUsage, fmtCost } from '../src/assistant/cost.js';
import { _resetDb } from '../src/db.js';

describe('message cost', () => {
  it('prices Opus 5.5 usage, including cache reads and writes', () => {
    const m = { model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 4000, cache_read_input_tokens: 10000 } };
    // 1000*4 + 500*20 + 4000*5 + 10000*0.2 = 4000 + 10000 + 20000 + 2000 = 36000 / 1e6
    expect(messageCost(m, 'claude-opus-5-5')).toBeCloseTo(0.036, 6);
    expect(tokensOf(m)).toEqual({ input: 15000, output: 500 });
  });

  it('prices each attempt when a fallback served the reply', () => {
    const m = {
      model: 'claude-opus-5',
      usage: {
        input_tokens: 1000, output_tokens: 100,
        iterations: [
          { type: 'message', input_tokens: 1000, output_tokens: 50 },
          { type: 'fallback_message', input_tokens: 1000, output_tokens: 100 },
        ],
      },
    };
    // Opus 5.5: 1000*4 + 50*20 = 5000; Opus 5: 1000*5 + 100*25 = 7500
    expect(messageCost(m, 'claude-opus-5-5')).toBeCloseTo(0.0125, 6);
  });

  it('prices unknown models high rather than low', () => {
    const m = { model: 'claude-something-new', usage: { input_tokens: 1e6, output_tokens: 0 } };
    expect(messageCost(m, 'claude-something-new')).toBe(5);
  });
});

describe('running totals', () => {
  beforeEach(async () => { await _resetDb(); });

  it('adds up by day and month', async () => {
    await recordUsage(0.02, { input: 10, output: 5 }, '2026-10-06');
    await recordUsage(0.03, { input: 10, output: 5 }, '2026-10-07');
    await recordUsage(0.01, { input: 10, output: 5 }, '2026-10-07');
    await recordUsage(0.5, { input: 10, output: 5 }, '2026-09-30');
    const t = summarize(await getUsage(), '2026-10-07');
    expect(t.today).toBeCloseTo(0.04);
    expect(t.month).toBeCloseTo(0.06);
    expect(t.total).toBeCloseTo(0.56);
    await resetUsage();
    expect(summarize(await getUsage(), '2026-10-07').total).toBe(0);
  });
});

it('formats costs', () => {
  expect(fmtCost(0.004)).toBe('0.4¢');
  expect(fmtCost(0.034)).toBe('3¢');
  expect(fmtCost(1.256)).toBe('$1.26');
});
