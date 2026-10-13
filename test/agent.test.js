import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store } from '../src/store.js';
import { _resetDb, kvSet } from '../src/db.js';
import { tune, setState } from './helpers.js';

// A stand-in for the Anthropic SDK: each stream() call plays the next scripted response.
const script = [];
const requests = [];
vi.mock('@anthropic-ai/sdk', () => {
  class AnthropicError extends Error {}
  class APIError extends AnthropicError {}
  class APIUserAbortError extends AnthropicError {}
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
  const sub = () => class extends APIError {};
  Object.assign(Anthropic, {
    AnthropicError, APIError, APIUserAbortError,
    AuthenticationError: sub(), PermissionDeniedError: sub(), RateLimitError: sub(), APIConnectionError: sub(),
  });
  return { default: Anthropic };
});

const { send, newConversation } = await import('../src/assistant/agent.js');
const { default: Anthropic } = await import('@anthropic-ai/sdk');

const usage = { input_tokens: 1000, output_tokens: 100 };
const reply = (content, stop_reason) => ({ model: 'claude-opus-5-5', content, stop_reason, usage });
const note = (id, text) => reply([{ type: 'tool_use', id, name: 'add_diary_note', input: { text, flag: null, item: null } }], 'tool_use');

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

  it('makes the turn’s changes one undo, offered only while nothing else has changed', async () => {
    const { undo, canUndo } = await import('../src/commands/core.js');
    script.push(note('t1', 'One'), note('t2', 'Two'), reply([{ type: 'text', text: 'Noted.' }], 'end_turn'));
    const r = await send(newConversation(), 'two notes');
    expect(r.changes).toHaveLength(2);
    expect(store.state.diary).toHaveLength(2);
    store.state.hintsSeen.push('swipe'); // (not a change to the data: Undo stays on offer)
    expect(canUndo(r.undo)).toBe(true);
    expect(undo(r.undo)).toBe(true);
    expect(store.state.diary).toHaveLength(0);
    expect(store.state.hintsSeen).toContain('swipe');
    expect(canUndo(r.undo)).toBe(false);
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

  it('keeps a reply cut off in a tool call answerable: the unrun call is left out of the history', async () => {
    script.push(
      reply([{ type: 'text', text: 'Adding' }, { type: 'tool_use', id: 't1', name: 'get_today', input: {} }], 'max_tokens'),
      reply([{ type: 'text', text: 'Hi.' }], 'end_turn'),
    );
    const conv = newConversation();
    expect((await send(conv, 'add lots')).stop).toBe('max_tokens');
    await send(conv, 'and?');
    const sent = requests[1].messages;
    expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent[1].content.map((b) => b.type)).toEqual(['text']);
  });

  it('tries a reply with unreadable tool input again, dropping its text; a dropped connection is an error', async () => {
    const bad = () => { throw new Anthropic.AnthropicError('Unable to parse tool parameter JSON from model. JSON: {"a'); };
    script.push(bad, reply([{ type: 'text', text: 'OK.' }], 'end_turn'));
    const retries = [];
    expect((await send(newConversation(), 'hi', { onRetry: () => retries.push(1) })).stop).toBe('done');
    expect(retries).toHaveLength(1);

    script.length = 0;
    requests.length = 0;
    script.push(() => { throw new Anthropic.AnthropicError('network error'); }, reply([{ type: 'text', text: 'again' }], 'end_turn'));
    const err = await send(newConversation(), 'hi').catch((e) => e);
    expect(err.message).toBe('network error');
    expect(requests).toHaveLength(1);
    const { describeError } = await import('../src/assistant/agent.js');
    expect(await describeError(err)).toMatch(/online/);
  });

  it('gives up after too many steps', async () => {
    for (let i = 0; i < 20; i++) script.push(reply([{ type: 'tool_use', id: `t${i}`, name: 'get_today', input: {} }], 'tool_use'));
    const r = await send(newConversation(), 'loop forever');
    expect(r.stop).toBe('too_many_steps');
    expect(requests).toHaveLength(15);
  });
});
