import { kvGet, kvSet } from '../db.js';
import { apiTools, runTool, isWriteTool, appSnapshot, takeConfirms, type ToolResult, type Confirm } from './tools.js';
import { beginGroup, endGroup, type UndoEntry } from '../commands/index.js';
import { messageCost, tokensOf, recordUsage } from './cost.js';
import type Anthropic from '@anthropic-ai/sdk';

// The practice assistant: Claude with tools over the app's data. Runs entirely in the browser
// with the user's own API key (kept on this device only, never in backups).

export const MODEL = 'claude-opus-5-5';
const MAX_STEPS = 15; // tool round-trips per message

const SYSTEM = `You are the practice assistant inside Woodshed, a phone app a jazz musician uses to plan daily practice. They play tenor sax and piano and are working through a list of about 300 jazz tunes plus technical exercises.

How the app works:
- Each day the app builds a practice set: exercises, then a number of tunes (4 by default), grouped as hone (proficient/mastered), learn (familiar) and fresh (not known yet). A tune or exercise is Focus, On or Off (top of its details): focus ones come first, taking turns, up to half the day's tunes or exercises (counted in them); Off ones are left out of the pool. The rest go by priority and how overdue they are, mixing the groups (for exercises, their kinds) across the day and from day to day (a group with a critical tune that's due pulls harder). On a Today card, swipe left for Swap/Remove (a focus card swaps for another focus one).
- After playing something the user rates it rough, OK or solid. Spaced repetition schedules the next review from that; tunes are "due" when their review date arrives.
- Tunes rotate through their usual keys; mastered tunes get suggested in other keys. Exercises are practiced in a few keys per session (chosen by weak keys, cycle of 4ths, chromatic, random, or fixed keys).
- Exercises can vary the scale or chord type each session (e.g. major, dorian, harmonic minor… or maj7, m7, 7…): each key comes with one of the types turned on for that exercise, and the notation is written out for each.
- Most tunes have a chord chart (get_item shows it). Exercises can warm up for a tune in its chords and key (add_warmups), added only when asked for: in the app, + Warm-up on a tune's card (or Add a warm-up under its chart) lists warm-ups to pick from — licks and patterns whose chords fit part of its progressions, Through the changes, arpeggios or scales on its chords, or any exercise through the whole form. From an exercise, "Try it through a tune" lists tunes to take it through. Technical exercises can have "Use with tunes" turned off. Settings can also give exercises one or two keys of the day.
- Walking bass: a bass line to play along with, looping: each chord from its root, leading into the next by a half step or a step, through varied shapes (1 2 3 5, 1 2 ♭3 3, 1 3 5 ♭5, 8 1 2 3…), a new line each time round. Start it with the Bass button under a tune's chart (in the tune's details, or under a warm-up's notation), with Bass next to Play on any exercise with chords (chord symbols in its notation, chords typed for it, or a Through the changes progression), or with the Walking bass switch in a tune's metronome. It's a mode of the metronome: same tempo (the tune's, or a warm-up's own), with the click on 2 and 4, every beat or off; it keeps playing on other screens (the metronome pill stops it). Under a chart, Loop picks a section (A, B…) or tap one bar then another to loop just those; the current bar lights up.
- Written exercises (licks) have notation written in any key ("Written in" in the notation editor) and are transposed from there; chord symbols are added with the editor's Chord button (root, then type: Δ7, m7, 7, ø7, °7…). "Only as written" shows a lick untransposed, to transpose in your head.
- Items have a working tempo; the app suggests speeding up after two solid sessions and slowing down after a rough one. A warm-up has its own tempo (set_warmup_tempo): it starts at its tune's, then changing one doesn't change the other, and the tune's later warm-ups start at the last one set.
- There is a practice diary with to-dos flagged "remember" or "teacher".

How to help:
- Use the tools to look things up rather than guessing, and to make changes the user asks for. Look up ids with search_library (items), get_today (entry_id: an item's place in today's set) or get_diary (notes) before using them. The tools that change things are the same as the app's own buttons.
- When asked for a set or suggestions, offer generously — the user likes a longer list to pick from and will ask for more if they want. Add what they ask for to today's set rather than just listing it, unless they only asked a question.
- Give musical reasons briefly when choosing (e.g. contrasting keys, a tune that shares changes with one they know, something neglected or due).
- Key names in tool inputs and outputs are as written for the instrument the user is viewing (stated in the app state). Use the same names when you talk about keys.
- After making changes, say what you changed in a sentence or two; the app also shows a summary with an Undo button.
- Delete tunes, exercises or notes only when the user asks. Deleting one with practice history (or a note with recordings) waits for the user to confirm with a button the app shows under your reply.
- If the user asks for something the tools can't do, call report_unsupported and tell them it isn't possible yet.
- You can answer general music questions (theory, harmony, history, practice advice) from your own knowledge. Say so when you're unsure, especially about specific recordings.
- Keep replies short and easy to read on a phone: a few sentences or a short list. Use **bold** sparingly and "- " for lists; no headings or tables.`;

export async function getApiKey(): Promise<string> {
  return ((await kvGet('anthropicKey')) as string | undefined) || '';
}
export async function setApiKey(key: string): Promise<void> {
  await kvSet('anthropicKey', key || '');
}

// The SDK (loaded when first needed) and a client for the current key.
interface Sdk { Anthropic: typeof Anthropic; client: Anthropic }
let clientPromise: Promise<Sdk> | null = null;
let clientKey: string | null = null;
async function getClient(): Promise<Sdk> {
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

// A chat: the messages so far, and what it has cost (dollars).
export interface Conversation { messages: Anthropic.Beta.BetaMessageParam[]; cost: number }

export function newConversation(): Conversation {
  return { messages: [], cost: 0 };
}

export interface ToolCall { name: string; input: unknown; result: ToolResult; write: boolean }
export interface SendOptions {
  onText?: (delta: string) => void;
  onTool?: (call: ToolCall) => void;
  onStep?: () => void;
  /** A step is being tried again: the text it streamed is to be dropped. */
  onRetry?: () => void;
  signal?: AbortSignal;
}
export type Stop = 'done' | 'stopped' | 'refusal' | 'max_tokens' | 'too_many_steps';
// What a turn changed (in words), its undo (all of it together; null if nothing changed), and any
// changes waiting for the user to confirm with a tap.
export interface TurnChanges { changes: string[]; cost: number; undo: UndoEntry | null; confirms: Confirm[] }
export interface TurnResult extends TurnChanges { stop: Stop }
// What send() throws: the error, with what had already been changed (and code 'no_key' with no key).
export type AssistantError = Error & { code?: 'no_key'; partial?: TurnChanges };

// Sends one user message and runs the tool loop until Claude is done.
// Callbacks: onText(delta), onTool({ name, input, result }), onStep() between model calls,
// onRetry() when a step's streamed text is to be dropped (it's being tried again).
// Returns { changes: [summaries of what was changed], cost (dollars, this message), undo, confirms,
//   stop: 'done' | 'stopped' | 'refusal' | 'max_tokens' | 'too_many_steps' }.
// On failure the thrown error has .partial = { changes, cost, undo, confirms }.
export async function send(conv: Conversation, text: string, { onText, onTool, onStep, onRetry, signal }: SendOptions = {}): Promise<TurnResult> {
  const { Anthropic, client } = await getClient();
  takeConfirms(); // (none left from before)
  // The history is append-only: each message starts with a snapshot of the app's state.
  conv.messages.push({
    role: 'user',
    content: [
      { type: 'text', text: `<app_state>\n${appSnapshot()}\n</app_state>` },
      { type: 'text', text },
    ],
  });

  let cost = 0;
  // The turn's changes are one undo (see commands/core.ts).
  const finish = (): TurnChanges => { const { undo, notes } = endGroup(); return { changes: notes, cost, undo, confirms: takeConfirms() }; };
  const done = (stop: Stop): TurnResult => ({ ...finish(), stop });
  // If a later step fails, earlier steps may already have changed things: the error carries them
  // (err.partial) so the app can still show them with an Undo.
  beginGroup();
  try {
    return await loop();
  } catch (err) {
    const partial = finish();
    if (err && typeof err === 'object') (err as AssistantError).partial = partial;
    throw err;
  }

  async function loop(): Promise<TurnResult> {
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
        if (err instanceof Anthropic.APIUserAbortError || signal?.aborted) return done('stopped');
        // With streamed tool inputs, an unparseable input rejects here; retry that turn a couple of
        // times. (Anything else, e.g. the connection dropping mid-reply, is an error.)
        if (!isBadToolJson(err) || jsonRetries++ >= 2) throw err;
        onRetry?.();
        continue;
      }

      const stepCost = messageCost(message, MODEL);
      cost += stepCost;
      conv.cost = (conv.cost || 0) + stepCost;
      await recordUsage(stepCost, tokensOf(message)).catch(() => {});

      // Cut off (or declined), a reply can end in a tool call that never runs; the API wants every
      // tool call in the history answered, so it's kept without them.
      const cut = message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens';
      const content = cut ? message.content.filter((b) => b.type !== 'tool_use') : message.content;
      conv.messages.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(cut off)' }] });
      if (message.stop_reason === 'refusal') return done('refusal');
      if (message.stop_reason === 'max_tokens') return done('max_tokens');
      if (message.stop_reason === 'pause_turn') continue;

      const uses = message.content.filter((b) => b.type === 'tool_use');
      if (!uses.length) return done('done');

      const results = uses.map((u): Anthropic.Beta.BetaToolResultBlockParam => {
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
    return done('too_many_steps');
  }
}

// The SDK's error for a streamed tool input that isn't valid JSON (worth trying again).
const isBadToolJson = (err: unknown) => err instanceof Error && /Unable to parse tool parameter JSON/.test(err.message);

// Friendly text for API errors.
export async function describeError(err: unknown): Promise<string> {
  if ((err as AssistantError | null)?.code === 'no_key') return 'Add your Anthropic API key to use the assistant.';
  const { Anthropic } = await getClient().catch((): Partial<Sdk> => ({}));
  if (Anthropic) {
    if (err instanceof Anthropic.AuthenticationError) return 'That API key wasn’t accepted. Check it in Settings → Assistant.';
    if (err instanceof Anthropic.PermissionDeniedError) return 'This API key doesn’t have access to that model.';
    if (err instanceof Anthropic.RateLimitError) return 'Too many requests right now — try again in a minute.';
    if (err instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the assistant. Are you online?';
    if (err instanceof Anthropic.APIError) {
      // The API's own explanation, e.g. "Your credit balance is too low…".
      const detail = err.error?.error?.message || '';
      console.warn('Assistant API error', err.status, err.error || err.message);
      if (/credit balance/i.test(detail)) {
        return 'Your Anthropic account is out of credit. Add some under Plans & Billing at console.anthropic.com, then try again.';
      }
      if (err.status === 400) return `Anthropic didn’t accept the request${detail ? `: “${detail}”` : '.'}`;
      if (err.status === 529 || err.status >= 500) return 'Anthropic’s servers are busy or having trouble — try again in a moment.';
      return `The assistant had a problem (${err.status ?? 'error'}${detail ? `: ${detail}` : ''}). Try again.`;
    }
    // The SDK's other errors: mostly the connection dropping partway through a reply.
    if (err instanceof Anthropic.AnthropicError) return 'Lost the connection to the assistant. Are you online? Try again.';
  }
  return 'Something went wrong. Try again.';
}
