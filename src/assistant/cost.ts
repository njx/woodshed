import { kvGet, kvSet } from '../db.js';
import { dateStr } from '../dates.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { DateStr } from '../types.js';

// What the assistant costs. The API is billed per token at list prices, separately from any
// claude.ai subscription (Pro/Max don't cover API use), so the same prices apply to everyone.
// Dollars per million tokens. Cache writes use the 5-minute rate (the app's default TTL).
interface Price { input: number; output: number; cacheWrite: number; cacheRead: number }
export const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};
// A model we don't know (e.g. a future fallback) is priced at the highest rates above, so the
// figure errs high rather than low.
const UNKNOWN = PRICES['claude-opus-5'];

// The token counts that are billed (a message's usage, or one of its iterations).
type TokenCounts = Pick<Anthropic.Beta.BetaUsage, 'input_tokens' | 'output_tokens' | 'cache_creation_input_tokens' | 'cache_read_input_tokens'>;
// An entry in usage.iterations (compaction entries have no model).
type Iteration = TokenCounts & { type: string; model?: string | null };

const priceFor = (model: string): Price => PRICES[model] || PRICES[String(model || '').replace(/-\d{8}$/, '')] || UNKNOWN;

function usageCost(u: TokenCounts, model: string): number {
  const p = priceFor(model);
  return (
    (u.input_tokens || 0) * p.input +
    (u.output_tokens || 0) * p.output +
    (u.cache_creation_input_tokens || 0) * p.cacheWrite +
    (u.cache_read_input_tokens || 0) * p.cacheRead
  ) / 1e6;
}

// Cost in dollars of one API response. With server-side fallbacks, usage.iterations itemizes each
// attempt: the requested model's attempts, then fallback_message attempts on the model that served.
export function messageCost(message: Anthropic.Beta.BetaMessage, requestedModel: string): number {
  const u = message?.usage;
  if (!u) return 0;
  const its: Iteration[] = Array.isArray(u.iterations) ? u.iterations : [];
  if (!its.length) return usageCost(u, message.model || requestedModel);
  return its.reduce((sum, it) => {
    const model = it.model || (it.type === 'fallback_message' ? message.model : requestedModel);
    return sum + usageCost(it, model);
  }, 0);
}

export interface Tokens { input: number; output: number }
export function tokensOf(message: Anthropic.Beta.BetaMessage): Tokens {
  const u: Partial<TokenCounts> = message?.usage || {};
  return {
    input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    output: u.output_tokens || 0,
  };
}

// Running totals, kept outside the practice state so Undo and restoring a backup don't touch them.
export interface DayUsage { cost: number; requests: number; input: number; output: number }
export interface Usage { days: Record<string, DayUsage>; since: string }
const KEY = 'assistantUsage';
const empty = (): Usage => ({ days: {}, since: dateStr() });

export async function getUsage(): Promise<Usage> {
  return ((await kvGet(KEY)) as Usage | undefined) || empty();
}

export async function recordUsage(cost: number, tokens: Tokens, date: DateStr = dateStr()): Promise<Usage> {
  const usage = await getUsage();
  const d = (usage.days[date] ||= { cost: 0, requests: 0, input: 0, output: 0 });
  d.cost += cost;
  d.requests += 1;
  d.input += tokens.input;
  d.output += tokens.output;
  await kvSet(KEY, usage);
  return usage;
}

export async function resetUsage(): Promise<void> {
  await kvSet(KEY, empty());
}

export function summarize(usage: Usage, today: DateStr = dateStr()) {
  const month = today.slice(0, 7);
  const sum = (pred: (d: DateStr) => boolean) => Object.entries(usage.days).filter(([d]) => pred(d)).reduce((s, [, v]) => s + v.cost, 0);
  return {
    today: sum((d) => d === today),
    month: sum((d) => d.startsWith(month)),
    total: sum(() => true),
    since: usage.since,
  };
}

// "0.4¢", "3¢", "$1.25"
export function fmtCost(dollars: number): string {
  if (dollars < 0.01) return `${(dollars * 100).toFixed(1).replace(/\.0$/, '')}¢`;
  if (dollars < 1) return `${Math.round(dollars * 100)}¢`;
  return `$${dollars.toFixed(2)}`;
}
