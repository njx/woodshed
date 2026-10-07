import { kvGet, kvSet } from '../db.js';
import { apiTools, runTool, isWriteTool, appSnapshot, takeChanges } from './tools.js';

// The practice assistant: Claude with tools over the app's data. Runs entirely in the browser
// with the user's own API key (kept on this device only, never in backups).

export const MODEL = 'claude-opus-5-5';
const MAX_STEPS = 15; // tool round-trips per message

const SYSTEM = `You are the practice assistant inside Woodshed, a phone app a jazz musician uses to plan daily practice. They play tenor sax and piano and are working through a list of about 300 jazz tunes plus technical exercises.

How the app works:
- Each day the app builds a practice set: exercises, then tunes grouped as hone (proficient/mastered), learn (familiar) and fresh (not known yet). Focus items are in every day's set until turned off.
- After playing something the user rates it rough, OK or solid. Spaced repetition schedules the next review from that; tunes are "due" when their review date arrives.
- Tunes rotate through their usual keys; mastered tunes get suggested in other keys. Exercises are practiced in a few keys per session (chosen by weak keys, cycle of 4ths, chromatic, random, or fixed keys).
- Items have a working tempo; the app suggests speeding up after two solid sessions and slowing down after a rough one.
- There is a practice diary with to-dos flagged "remember" or "teacher".

How to help:
- Use the tools to look things up rather than guessing, and to make changes the user asks for. Look up ids with search_library before using them.
- When asked for a set or suggestions, offer generously — the user likes a longer list to pick from and will ask for more if they want. Add what they ask for to today's set rather than just listing it, unless they only asked a question.
- Give musical reasons briefly when choosing (e.g. contrasting keys, a tune that shares changes with one they know, something neglected or due).
- Key names in tool inputs and outputs are as written for the instrument the user is viewing (stated in the app state). Use the same names when you talk about keys.
- After making changes, say what you changed in a sentence or two; the app also shows a summary with an Undo button.
- If the user asks for something the tools can't do, call report_unsupported and tell them it isn't possible yet.
- You can answer general music questions (theory, harmony, history, practice advice) from your own knowledge. Say so when you're unsure, especially about specific recordings.
- Keep replies short and easy to read on a phone: a few sentences or a short list. Use **bold** sparingly and "- " for lists; no headings or tables.`;

export async function getApiKey() {
  return (await kvGet('anthropicKey')) || '';
}
export async function setApiKey(key) {
  await kvSet('anthropicKey', key || '');
}

let clientPromise = null;
let clientKey = null;
async function getClient() {
  const key = await getApiKey();
  if (!key) throw Object.assign(new Error('No API key'), { code: 'no_key' });
  if (!clientPromise || clientKey !== key) {
    clientKey = key;
    clientPromise = import('@anthropic-ai/sdk').then(({ default: Anthropic }) => ({
      Anthropic,
      // A personal app calling the API straight from the browser with the user's own key.
      client: new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }),
    }));
  }
  return clientPromise;
}

export function newConversation() {
  return { messages: [] };
}

// Sends one user message and runs the tool loop until Claude is done.
// Callbacks: onText(delta), onTool({ name, input, result }), onStep() between model calls.
// Returns { changes: [summaries of what was changed], stop: 'done' | 'stopped' | 'refusal' | 'max_tokens' | 'too_many_steps' }.
export async function send(conv, text, { onText, onTool, onStep, signal } = {}) {
  const { Anthropic, client } = await getClient();
  takeChanges(); // start this turn's change list fresh
  // The history is append-only: each message starts with a snapshot of the app's state.
  conv.messages.push({
    role: 'user',
    content: [
      { type: 'text', text: `<app_state>\n${appSnapshot()}\n</app_state>` },
      { type: 'text', text },
    ],
  });

  let jsonRetries = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (step) onStep?.();
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // if a request is declined, retry on a fallback model
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM,
        tools: apiTools(),
        messages: conv.messages,
      },
      { signal },
    );
    stream.on('text', (delta) => onText?.(delta));

    let message;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError || signal?.aborted) return { changes: takeChanges(), stop: 'stopped' };
      // With streamed tool inputs, an unparseable input rejects here; retry that turn a couple of times.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      continue;
    }

    conv.messages.push({ role: 'assistant', content: message.content });
    if (message.stop_reason === 'refusal') return { changes: takeChanges(), stop: 'refusal' };
    if (message.stop_reason === 'max_tokens') return { changes: takeChanges(), stop: 'max_tokens' };
    if (message.stop_reason === 'pause_turn') continue;

    const uses = message.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) return { changes: takeChanges(), stop: 'done' };

    const results = uses.map((u) => {
      const result = runTool(u.name, u.input);
      onTool?.({ name: u.name, input: u.input, result, write: isWriteTool(u.name) });
      return {
        type: 'tool_result',
        tool_use_id: u.id,
        content: JSON.stringify(result),
        ...(result?.error ? { is_error: true } : {}),
      };
    });
    conv.messages.push({ role: 'user', content: results });
  }
  return { changes: takeChanges(), stop: 'too_many_steps' };
}

// Friendly text for API errors.
export async function describeError(err) {
  if (err?.code === 'no_key') return 'Add your Anthropic API key to use the assistant.';
  const { Anthropic } = await getClient().catch(() => ({}));
  if (Anthropic) {
    if (err instanceof Anthropic.AuthenticationError) return 'That API key wasn’t accepted. Check it in Settings → Assistant.';
    if (err instanceof Anthropic.PermissionDeniedError) return 'This API key doesn’t have access to that model.';
    if (err instanceof Anthropic.RateLimitError) return 'Too many requests right now — try again in a minute.';
    if (err instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the assistant. Are you online?';
    if (err instanceof Anthropic.APIError) return `The assistant had a problem (${err.status ?? 'error'}). Try again.`;
  }
  return 'Something went wrong. Try again.';
}
