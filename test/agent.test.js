import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../src/store.js';
import { _resetDb, kvSet } from '../src/db.js';
import { tune, setState } from './helpers.js';

// A stand-in for the Anthropic SDK: each stream() call plays the next scripted response.
const script = [];
const requests = [];
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class APIUserAbortError extends Error {}
  class Anthropic {
    constructor() {
      this.beta = {
        messages: {
          stream: (params) => {
            requests.push(structuredClone(params));
            const next = script.shift();
            return { on() {}, finalMessage: async () => (typeof next === 'function' ? next() : next) };
          },
        },
      };
    }
  }
  Object.assign(Anthropic, { APIError, APIUserAbortError, AuthenticationError: class extends APIError {} });
  return { default: Anthropic };
});

const { send, newConversation } = await import('../src/assistant/agent.js');
const { default: Anthropic } = await import('@anthropic-ai/sdk');

const usage = { input_tokens: 1000, output_tokens: 100 };
const reply = (content, stop_reason) => ({ model: 'claude-opus-5-5', content, stop_reason, usage });
const note = (id, text) => reply([{ type: 'tool_use', id, name: 'add_diary_note', input: { text, flag: null, item_id: null } }], 'tool_use');

beforeEach(async () => {
  await _resetDb();
  await kvSet('anthropicKey', 'sk-ant-test');
  script.length = 0;
  requests.length = 0;
  setState([tune({ id: 'a', name: 'Solar' })]);
});

describe('assistant conversation loop', () => {
  it('runs tools and returns what changed and what it cost', async () => {
    script.push(note('t1', 'Work on the bridge'), reply([{ type: 'text', text: 'Noted.' }], 'end_turn'));
    const conv = newConversation();
    const r = await send(conv, 'remind me about the bridge');
    expect(r.stop).toBe('done');
    expect(r.changes).toHaveLength(1);
    expect(store.state.diary[0].text).toBe('Work on the bridge');
    expect(r.cost).toBeCloseTo(2 * (1000 * 4 + 100 * 20) / 1e6);
    // The tool result goes back in the same conversation, which only ever grows.
    expect(requests[1].messages).toHaveLength(3);
    expect(requests[1].messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
  });

  it('keeps the changes made before an error, so they can be undone', async () => {
    script.push(note('t1', 'First'), () => { throw new Anthropic.APIError('overloaded'); });
    const err = await send(newConversation(), 'hi').catch((e) => e);
    expect(err).toBeInstanceOf(Anthropic.APIError);
    expect(err.partial.changes).toHaveLength(1);
    expect(err.partial.cost).toBeGreaterThan(0);
  });

  it('reports a tool error back to Claude instead of failing', async () => {
    script.push(
      reply([{ type: 'tool_use', id: 't1', name: 'get_item', input: { item_id: 'missing' } }], 'tool_use'),
      reply([{ type: 'text', text: 'Not found.' }], 'end_turn'),
    );
    await send(newConversation(), 'look up something');
    const result = requests[1].messages[2].content[0];
    expect(result.is_error).toBe(true);
  });

  it('continues after pause_turn and stops at refusal', async () => {
    script.push(reply([{ type: 'text', text: '…' }], 'pause_turn'), reply([], 'refusal'));
    const r = await send(newConversation(), 'hi');
    expect(requests).toHaveLength(2);
    expect(r.stop).toBe('refusal');
  });

  it('gives up after too many steps', async () => {
    for (let i = 0; i < 20; i++) script.push(reply([{ type: 'tool_use', id: `t${i}`, name: 'get_today', input: {} }], 'tool_use'));
    const r = await send(newConversation(), 'loop forever');
    expect(r.stop).toBe('too_many_steps');
    expect(requests).toHaveLength(15);
  });
});
