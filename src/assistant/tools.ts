import { running, practicedMs, timeByDay, practiceDays, streak, lessonsByDay } from '../practicetime.js';
import { store } from '../store.js';
import { LEVELS, PRIORITIES, TRANSPOSITIONS, CATEGORIES, KEY_MODES } from '../constants.js';
import { dateStr, daysBetween } from '../dates.js';
import { keyName } from '../keys.js';
import { itemStats, itemById, isDue, planEntry, playTempo } from '../practice.js';
import { ensurePlan } from '../plan.js';
import { chartFor } from '../charts.js';
import { chartToText, chartShift, usesSharps, progressions, noteName } from '../chords.js';
import { SHAPES, typeInfo } from '../theory.js';
import { keyFamiliarity, keySessions, entryKeys } from '../keystats.js';
import { openTodos, entriesFor, FLAGS } from '../diary.js';
import { recordingsFor } from '../listen.js';
import { COMMANDS, exec, type Done } from '../commands/index.js';
import { command, f, toolSchema, forAssistant, readInput, CommandError, type Command } from '../commands/core.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { DateStr, Exercise, Id, Item, Key, Level, Tune, Vary } from '../types.js';

// The practice assistant's tools: a few queries (below) that look things up, and every command in
// the registry (commands/) that has a description — the same ones the app's buttons run, so the
// assistant does exactly what a tap would. Each one's input schema is made from its fields (strict
// in the sense that every property is listed; optional ones accept null). Key names going in and
// out are as written for the instrument the user is viewing, which is what they see in the app.

export { validate, concertKey } from '../commands/core.js';

// What a tool returns, sent back to the model as JSON (an object, or a list): `error` is set when
// it couldn't do what was asked.
export interface ToolResult { error?: string }

// An item, as the tools read it: `vary`, `style` and `category` on either type (undefined on the
// type that doesn't have it).
type AnyItem = (Tune & { vary?: undefined; category?: undefined }) | (Exercise & { style?: undefined });

const view = () => store.state.settings.view;
const levelLabel = (l: Level) => LEVELS[l ?? 0].label.toLowerCase();
const writtenName = (k: Key) => keyName(k, view());
const rootName = (r: number) => keyName(r % 12, view());
const typeLabel = (kind: Vary['kind'], id: string) => typeInfo(kind, id)?.label || id;
const varySummary = (t: { vary: Vary | null }) => (t.vary ? {
  varies: t.vary.kind,
  types: t.vary.types.map((id) => typeLabel(t.vary!.kind, id)),
  shape: SHAPES[t.vary.shape]?.label,
  ...(t.vary.shape === 'custom' ? { pattern: t.vary.pattern } : {}),
} : {});

function itemSummary(t: Item, stats: ReturnType<typeof itemStats>) {
  const s = stats.get(t.id);
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    ...(t.type === 'tune' ? { style: t.style, keys: t.keys.map(writtenName) } : {
      category: CATEGORIES[t.category],
      key_mode: KEY_MODES[t.keyMode]?.label,
      keys_per_session: t.keyMode === 'none' ? 0 : t.keysPerSession,
      has_notation: !!(t.abc || t.vary),
      ...varySummary(t),
      use: t.solo ? 'own' : t.tunesOnly || t.fromTune ? 'tunes' : 'either',
    }),
    level: levelLabel(t.level),
    priority: PRIORITIES[(t.priority || 3) - 1].label.toLowerCase(),
    status: t.focus ? 'focus' : t.off ? 'off' : 'on',
    last_played: s?.last || null,
    times_played: s?.count || 0,
    due: isDue(t, stats),
    tempo: t.tempo || null,
  };
}

// A tune's chart as text, in its first usual key, written for the instrument being viewed.
function chartText(t: Tune) {
  const chart = chartFor(t);
  if (!chart) return null;
  const key = t.keys?.[0] ?? chart.key ?? 0;
  const written = (((key % 12) + TRANSPOSITIONS[view()].offset) % 12) + (key >= 12 ? 12 : 0);
  return `In ${writtenName(key)}, ${chart.meter}:\n${chartToText(chart, { shift: chartShift(chart, key, view()), sharps: usesSharps(written) })}`;
}

// A tune's main progressions, named by Roman numeral, in its first usual key (written).
function progressionList(t: Tune) {
  const chart = chartFor(t);
  if (!chart) return null;
  const key = t.keys?.[0] ?? chart.key ?? 0;
  const shift = chartShift(chart, key, view());
  const sharps = usesSharps((((key % 12) + TRANSPOSITIONS[view()].offset) % 12) + (key >= 12 ? 12 : 0));
  return progressions(chart).slice(0, 6).map((p) => `${p.name} in ${noteName(p.target + shift, sharps).replace('♭', 'b').replace('♯', '#')}${p.minor ? 'm' : ''} (×${p.count})`);
}

function planSummary() {
  ensurePlan();
  const stats = itemStats();
  return store.state.plan!.items.map((it) => { // (ensurePlan made it)
    const t: AnyItem | undefined = itemById(it.itemId);
    if (!t) return null;
    const e = planEntry(it);
    return {
      entry_id: it.pid,
      item_id: t.id,
      name: t.name,
      type: t.type,
      group: it.bucket,
      key: it.key != null ? writtenName(it.key) : null,
      new_key: !!it.alt,
      keys: it.keys?.map(rootName),
      ...(it.types?.length && t.vary ? { types: it.types.map((id) => typeLabel(t.vary!.kind, id)) } : {}),
      tempo: playTempo(t, it), // (a warm-up's own)
      ...(it.warmup ? { warm_up_for: itemById(it.warmup)?.name } : {}),
      ...(it.prog ? { progression: it.prog.name } : {}),
      played: !!e,
      rating: e?.rating || null,
      level: levelLabel(t.level),
      last_played: stats.get(t.id)?.last || null,
    };
  }).filter((p) => p !== null);
}

// A short snapshot added to each message so the assistant starts with the basics.
export function appSnapshot(): string {
  const s = store.state.settings;
  const stats = itemStats();
  const today = dateStr();
  const plan = planSummary();
  const tunes = store.state.items.filter((t) => t.type === 'tune');
  return [
    `Today is ${today}. Keys are shown for ${TRANSPOSITIONS[s.view].label} instruments (${s.instruments.map((i) => TRANSPOSITIONS[i].label).join(' and ')} enabled).`,
    `Library: ${tunes.length} tunes (${tunes.filter((t) => isDue(t, stats)).length} due for review), ${store.state.items.length - tunes.length} exercises.`,
    `Today's set: ${plan.map((p) => `${p.name}${p.played ? ' (played)' : ''}`).join('; ') || 'empty'}.`,
    `Open to-dos: ${openTodos().length}.`,
  ].join('\n');
}

// ---------- Queries ----------
// Looking things up: commands that change nothing (run straight, not saved or undone).

const query = <I>(c: Omit<Command<I, object>, 'query'>): Command<I, object> => command<I, object>({ ...c, query: true });

interface SearchInput {
  query?: string; type?: Item['type']; levels?: Level[]; style?: string; key?: Key;
  due_only?: boolean; focus_only?: boolean; not_played_in_days?: number;
  sort?: 'priority' | 'longest_ago' | 'recent' | 'most_played' | 'name'; limit?: number;
}
export const QUERIES: Command[] = [
  query<Record<string, never>>({
    name: 'get_today',
    description: "Today's practice set: each item with its entry_id (for the commands that change today's set), its group (focus, exercise, hone = proficient/mastered, learn = familiar, fresh = new), suggested key(s), working tempo, and whether it's been played and how it was rated.",
    fields: {},
    run: () => ({ items: planSummary(), minutes_practiced_today: Math.round(practicedMs() / 60000), timer_running: !!running() }),
  }),
  query<SearchInput>({
    name: 'search_library',
    description: 'Search tunes and exercises. All filters are optional (null = any). Returns compact summaries with ids to use in other tools.',
    fields: {
      query: f.opt(f.str('Words in the name, style or category')),
      type: f.opt(f.oneOf(['tune', 'exercise'] as const)),
      levels: f.opt(f.list(f.level())),
      style: f.opt(f.str('Tune style, e.g. Ballad, Latin, Blues, Standard')),
      key: f.opt(f.key('Only tunes usually played in this key (as written for the current instrument), e.g. "F" or "Gm"')),
      due_only: f.opt(f.bool()),
      focus_only: f.opt(f.bool()),
      not_played_in_days: f.opt(f.int('Only items not played in at least this many days (never played counts)')),
      sort: f.opt(f.oneOf(['priority', 'longest_ago', 'recent', 'most_played', 'name'] as const)),
      limit: f.opt(f.int('Default 25, max 100')),
    },
    run: (a) => {
      const stats = itemStats();
      const q = a.query?.toLowerCase().trim();
      const today = dateStr();
      let list = store.state.items.filter((t: AnyItem) => {
        if (a.type && t.type !== a.type) return false;
        if (q && !`${t.name} ${t.style || ''} ${(t.category && CATEGORIES[t.category]) || ''}`.toLowerCase().includes(q)) return false;
        if (a.levels && !a.levels.includes(t.level ?? 0)) return false;
        if (a.style && (t.style || '').toLowerCase() !== a.style.toLowerCase()) return false;
        if (a.key != null && !(t.type === 'tune' && t.keys.includes(a.key))) return false;
        if (a.due_only && !isDue(t, stats)) return false;
        if (a.focus_only && !t.focus) return false;
        if (a.not_played_in_days) {
          const last = stats.get(t.id)?.last;
          if (last && daysBetween(last, today) < a.not_played_in_days) return false;
        }
        return true;
      });
      const last = (t: Item) => stats.get(t.id)?.last || '';
      const sorts = {
        priority: (x: Item, y: Item) => x.priority - y.priority || x.name.localeCompare(y.name),
        longest_ago: (x: Item, y: Item) => last(x).localeCompare(last(y)) || x.priority - y.priority,
        recent: (x: Item, y: Item) => last(y).localeCompare(last(x)),
        most_played: (x: Item, y: Item) => (stats.get(y.id)?.count || 0) - (stats.get(x.id)?.count || 0),
        name: (x: Item, y: Item) => x.name.localeCompare(y.name),
      };
      list = list.sort(sorts[a.sort || 'priority']);
      const limit = Math.max(1, Math.min(100, a.limit || 25));
      return { total: list.length, items: list.slice(0, limit).map((t) => itemSummary(t, stats)) };
    },
  }),
  query<{ item: Id }>({
    name: 'get_item',
    description: 'Everything about one tune or exercise: details, notes, notation (exercises), the chord chart (tunes, in its first usual key, written for the instrument being viewed: one section per line, bars separated by |, % = the chord carries on, A ×2 = played twice, A 1. / A 2. = endings), recent practice history with keys, ratings and tempos, diary notes, and recordings to listen to (tunes).',
    fields: { item: f.item() },
    run: ({ item }) => {
      const t = itemById(item)!; // (checked by its field)
      const stats = itemStats();
      const history = store.state.log
        .filter((e) => e.itemId === t.id)
        .sort((x, y) => y.date.localeCompare(x.date))
        .slice(0, 12)
        .map((e) => ({ date: e.date, keys: entryKeys(e).map(t.type === 'tune' ? writtenName : rootName), rating: e.rating, tempo: e.bpm || null }));
      return {
        ...itemSummary(t, stats),
        goal_tempo: t.goalTempo || null,
        next_review: t.due || null,
        notes: t.notes || '',
        ...(t.type === 'exercise' ? { notation_abc: t.abc || null, meter: t.meter, ...(t.harmony ? { harmony: t.harmony } : {}) } : {
          recordings: recordingsFor(t).map((r) => [r.artist, r.album, r.year].filter(Boolean).join(', ')),
          chords: chartText(t),
          progressions: progressionList(t),
        }),
        history,
        diary: entriesFor(t.id).slice(0, 8).map((e) => ({ id: e.id, date: e.date, text: e.text, flag: e.flag, done: e.done })),
      };
    },
  }),
  query<Record<string, never>>({
    name: 'get_practice_stats',
    description: 'Overall practice picture: streak and days practiced (days with something played, the timer run, or a lesson), recent days, practice time (minutes per day: the practice timer plus lessons), lessons (minutes, by day), sessions per key in the last 30 days (keys as written for the current instrument) and how familiar each key is, repertoire by level, and what was played in the last week.',
    fields: {},
    run: () => {
      const log = store.state.log;
      const today = dateStr();
      const days = practiceDays();
      const fam = keyFamiliarity();
      const sess = keySessions(30);
      const tunes = store.state.items.filter((t) => t.type === 'tune');
      const lastWeek: Record<DateStr, (string | undefined)[]> = {};
      for (const e of log) {
        if (daysBetween(e.date, today) >= 7) continue;
        (lastWeek[e.date] ||= []).push(itemById(e.itemId)?.name);
      }
      return {
        streak_days: streak(),
        days_practiced_last_30: [...days].filter((d) => daysBetween(d, today) < 30).length,
        keys: [...Array(12).keys()].map((r) => ({ key: rootName(r), sessions_30d: sess[r], familiarity: Math.round(fam[r] * 10) / 10 })),
        tunes_by_level: Object.fromEntries(([3, 2, 1, 0] as const).map((l) => [levelLabel(l), tunes.filter((t) => (t.level ?? 0) === l).length])),
        last_7_days: lastWeek,
        minutes_practiced_by_day: Object.fromEntries([...timeByDay()].filter(([d]) => daysBetween(d, today) < 30).sort().map(([d, ms]) => [d, Math.round(ms / 60000)])),
        lessons_by_day: Object.fromEntries([...lessonsByDay()].filter(([d]) => daysBetween(d, today) < 30).sort().map(([d, ms]) => [d, Math.round(ms / 60000)])),
      };
    },
  }),
  query<{ open_todos_only?: boolean; flag?: keyof typeof FLAGS; limit?: number }>({
    name: 'get_diary',
    description: 'Practice diary notes, newest first, with their ids. Flags: "remember" (things to remember while practicing) and "teacher" (questions for the teacher).',
    fields: {
      open_todos_only: f.opt(f.bool()),
      flag: f.opt(f.oneOf(Object.keys(FLAGS) as (keyof typeof FLAGS)[])),
      limit: f.opt(f.int()),
    },
    run: (a) => {
      let list = [...store.state.diary].sort((x, y) => y.date.localeCompare(x.date) || y.at - x.at);
      if (a.flag) list = list.filter((e) => e.flag === a.flag);
      if (a.open_todos_only) list = list.filter((e) => e.flag && !e.done);
      return list.slice(0, a.limit || 30).map((e) => ({
        id: e.id, date: e.date, text: e.text || (e.lesson ? '(lesson)' : '(recording)'), flag: e.flag, done: e.done,
        about: e.itemId ? itemById(e.itemId)?.name : null, recordings: e.media?.length || 0,
        ...(e.lesson ? { lesson: true, lesson_minutes: e.lessonMs ? Math.round(e.lessonMs / 60000) : null } : {}),
      }));
    },
  }),
];

// ---------- The tools ----------

// Every query, and every command the assistant can use (see forAssistant).
export const TOOLS: Command[] = [...QUERIES, ...COMMANDS.filter(forAssistant)];
const byName = new Map(TOOLS.map((t) => [t.name, t]));

// A change the assistant asked for that the user confirms with a tap (see Command.ask): shown
// under its reply; run() does it (as a command of its own, with its own undo).
export interface Confirm { question: string; run(): Done<unknown> }
let confirms: Confirm[] = [];
export const takeConfirms = (): Confirm[] => confirms.splice(0);

export function runTool(name: string, raw: unknown): ToolResult {
  const c = byName.get(name);
  if (!c) return { error: `Unknown tool ${name}` };
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CommandError('Invalid input: input should be object');
    const input = readInput(c, raw as Record<string, unknown>);
    if (c.query) return c.run(input, { note() {} }) as ToolResult;
    const question = c.ask?.(input);
    if (question) {
      confirms.push({ question, run: () => exec(c, input) });
      return { needs_confirmation: question, note: 'Not done yet: the app shows the user a button to confirm it. Tell them so; don’t ask again or try another way.' } as ToolResult;
    }
    return exec(c, input).result as ToolResult;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export const isWriteTool = (name: string): boolean => !!byName.get(name) && !byName.get(name)!.query;

// Tool definitions for the API (without the run functions).
// Not strict: the API's strict mode allows at most 16 optional (nullable) fields across all tools,
// and these tools have more. Inputs are checked here instead (readInput, before any tool runs).
export const apiTools = (): Anthropic.Beta.BetaTool[] => TOOLS.map((c) => ({
  name: c.name, description: c.description!, input_schema: toolSchema(c), eager_input_streaming: true,
}));
