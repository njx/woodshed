import { store } from '../store.js';
import { RATINGS } from '../constants.js';
import { randomOf } from '../util.js';
import { VARY, chooseTypes } from '../theory.js';
import { itemStats, itemById, isPlanItemPlayed, planEntry, markPlayed as logPlayed, unmarkPlayed as unlog, rate, todaysEntry } from '../practice.js';
import {
  ensurePlan, addToToday as addItem, todayItem, setTodayKeys, setTodayKey, refreshTypes, typeCounts, makePlanItem, pickItem, pickFocus,
  excludedIds, swapWarmup, dropOrphanWarmups, buildPlan, addWarmups as addTuneWarmups, addWarmup as addOneWarmup, tryWithTune as tryThrough,
} from '../plan.js';
import { command, f, CommandError } from './core.js';
import type { Exercise, Id, Item, Key, PlanItem, Rating, Tune } from '../types.js';

// Today's set: what's in it, in which keys, and what's been played.

const RATING_IDS = RATINGS.map((r) => r.v) as Rating[];

// The item (and its place in today's set) for an entry id.
function entryOf(pid: Id): { it: PlanItem; t: Item } {
  const it = store.state.plan?.items.find((i) => i.pid === pid);
  const t = it && itemById(it.itemId);
  if (!it || !t) throw new CommandError('That isn’t in today’s set any more.');
  return { it, t };
}
// The entry, checked to be that item's (the assistant gives both).
function entryFor(pid: Id, t: Item): PlanItem {
  const { it } = entryOf(pid);
  if (it.itemId !== t.id) throw new CommandError(`That entry in today’s set isn’t ${t.name}.`);
  return it;
}
const tuneOf = (id: Id) => itemById(id) as Tune; // (checked by its field, or by the app)
const exerciseOf = (id: Id) => itemById(id) as Exercise;

// Keys for an exercise today, with a type for each if it varies them: the ones asked for, else the
// type a key already had, else one played least.
function typesFor(t: Exercise, it: PlanItem, roots: number[], asked: string[] | undefined): string[] | null {
  if (!t.vary) return null;
  const known = Object.keys(VARY[t.vary.kind].types);
  const was = Object.fromEntries((it.keys || []).map((k, i) => [k, it.types?.[i]]));
  return roots.map((k, i) => (asked?.[i] && known.includes(asked[i]) ? asked[i]
    : was[k] || chooseTypes(t.vary!, 1, itemStats().get(t.id)?.types || [], Math.random, typeCounts())[0] || t.vary!.types[0]));
}

interface AddInput { item: Id; keys?: Key[]; types?: string[] }
export const addToToday = command<AddInput>({
  name: 'add_to_today',
  description: "Add a tune or exercise to today's set (call it once for each). Optionally the keys: for a tune, the one key to play it in; for an exercise, the keys to play it in. For exercises that vary the scale or chord type, optionally the type for each key, in the same order (type ids as in create_exercise). Leave keys and types null to let the app choose (usual keys rotate; weak keys for exercises; least-played types).",
  fields: { item: f.item(), keys: f.opt(f.list(f.key())), types: f.opt(f.list(f.str())) },
  run({ item, keys, types }, { note }) {
    const t = itemById(item)!; // (checked by its field, or by the app)
    if (!addItem(t)) throw new CommandError(`${t.name} is already in today's set.`);
    const it = todayItem(t)!; // (just added)
    if (keys?.length) {
      if (t.type === 'exercise') it.keys = [...new Set(keys.map((k) => k % 12))];
      else { it.key = keys[0]; it.alt = !t.keys.includes(keys[0]); it.shift = null; }
    }
    // Types to go with the keys (asked-for ones first).
    const vary = t.type === 'exercise' ? t.vary : null;
    if (t.type === 'exercise' && vary && (keys?.length || types?.length)) refreshTypes(t, types ?? null);
    const unknown = (types || []).filter((id) => !vary?.types.includes(id));
    note(`Added ${t.name} to today’s set`);
    return { added: t.name, entry_id: it.pid, ...(unknown.length ? { note: `${unknown.join(', ')} isn't turned on for it, so the app chose instead (turn types on with update_item).` } : {}) };
  },
});

// Its place in today's set goes: a focus item for today, a warm-up, or a pick (not suggested
// again today). A tune's warm-ups go with it.
export const removeFromToday = command<{ entry: Id }>({
  name: 'remove_from_today',
  description: "Take something out of today's set (it won't be suggested again today). Not once it's been played.",
  fields: { entry: f.entry() },
  undoToast: true,
  run({ entry }, { note }) {
    const { it, t } = entryOf(entry);
    if (isPlanItemPlayed(it)) throw new CommandError(`${t.name} has been played today, so it stays.`);
    const plan = store.state.plan!;
    if (it.bucket === 'focus') plan.focusSkipped.push(it.itemId);
    else if (!it.warmup) plan.skipped.push(it.itemId);
    plan.items = plan.items.filter((i) => i !== it);
    dropOrphanWarmups();
    note(it.warmup ? `Took out the ${t.name} warm-up` : `Took ${t.name} out of today’s set`);
    return { removed: t.name };
  },
});

// Another in its place: a warm-up for another warm-up for the same tune, a focus item for another
// focus one, anything else for a pick from its group.
export const swapInToday = command<{ entry: Id }>({
  name: 'swap_in_today',
  description: "Swap something in today's set for another, picked by the app: a warm-up for another warm-up for the same tune, a focus item for another focus one, a tune or exercise for another from its group. Not once it's been played.",
  fields: { entry: f.entry() },
  undoToast: true,
  run({ entry }, { note }) {
    const { it, t } = entryOf(entry);
    if (isPlanItemPlayed(it)) throw new CommandError(`${t.name} has been played today, so it stays.`);
    const plan = store.state.plan!;
    const i = plan.items.indexOf(it);
    if (it.warmup) {
      if (!swapWarmup(i)) throw new CommandError('No other warm-up for this tune');
      note(`Swapped the ${t.name} warm-up`);
      return { swapped: t.name, for: itemById(plan.items[i].itemId)?.name };
    }
    const focus = it.bucket === 'focus';
    const other = focus ? pickFocus(t) : pickItem(it.bucket, excludedIds(), itemStats());
    if (!other) {
      throw new CommandError(focus ? `No other focus ${t.type === 'exercise' ? 'exercises' : 'tunes'} to swap in`
        : it.bucket === 'exercise' ? 'No other exercises to suggest' : 'No other tunes to suggest');
    }
    (focus ? plan.focusSkipped : plan.skipped).push(it.itemId);
    plan.items[i] = makePlanItem(other, itemStats(), it.bucket);
    dropOrphanWarmups();
    note(`Swapped out ${t.name}`);
    return { swapped: t.name, for: other.name };
  },
});

// What it's played in today: a tune's key; an exercise's keys (and a type for each, if it varies
// them). Before or after it's played: the logged session changes too.
interface ChangeInput { entry: Id; key?: Key; keys?: number[]; types?: string[] }
export const changeToday = command<ChangeInput>({
  name: 'change_today',
  description: "Change what something in today's set is played in — before or after it's been played (if played, the logged session changes too, e.g. \"I also did it in B\"). A tune: `key`, the one key. An exercise: `keys`, all of them in order, and for exercises that vary the scale or chord type, optionally `types`, the type for each key (type ids as in create_exercise; null keeps the types of keys already there and has the app pick for new ones). Not for warm-ups.",
  fields: { entry: f.entry(), key: f.opt(f.key('For a tune: the key, as written for the instrument being viewed')), keys: f.opt(f.list(f.root(), 'For an exercise: its keys today, in order')), types: f.opt(f.list(f.str())) },
  run({ entry, key, keys, types }, { note }) {
    const { it, t } = entryOf(entry);
    if (it.warmup) throw new CommandError('A warm-up is played in its tune’s keys.');
    if (t.type === 'tune') {
      if (key == null) throw new CommandError('Give the key, like "F" or "Gm".');
      setTodayKey(it, key);
    } else {
      const roots = [...new Set((keys || []).map((k) => k % 12))];
      if (!roots.length) throw new CommandError('Keep at least one key');
      setTodayKeys(it, roots, typesFor(t, it, roots, types));
    }
    note(`Changed today’s ${t.name}`);
    return { changed: t.name };
  },
});

// Played: logged for today (in today's keys, or as given), rated OK unless said.
interface PlayedInput { item: Id; entry?: Id; keys?: number[]; rating?: Rating }
export const markPlayed = command<PlayedInput>({
  name: 'mark_played',
  description: "Log that the user played a tune or exercise today (as the ✓ on its card does), optionally with how it went: rough, ok (the default) or solid — this schedules its next review. Give entry_id for the one in today's set (a warm-up is logged as a warm-up for its tune).",
  fields: { item: f.item(), entry: f.opt(f.entry()), keys: f.opt(f.app()), rating: f.opt(f.oneOf(RATING_IDS)) },
  run({ item, entry, keys, rating }, { note }) {
    const t = itemById(item)!; // (checked by its field, or by the app)
    const it = entry ? entryFor(entry, t) : todayItem(t);
    if (it ? isPlanItemPlayed(it) : todaysEntry(t.id) && !keys) throw new CommandError(`${t.name} is already logged for today.`);
    logPlayed(t.id, it || (t.type === 'tune' ? { key: t.keys[0] ?? null } : { keys: keys ?? [] }));
    if (rating && rating !== 'ok') rate(t.id, rating, it);
    note(`Played ${t.name}${rating && rating !== 'ok' ? ` (${rating})` : ''}`);
    return { logged: t.name, rating: rating || 'ok' };
  },
});

export const unmarkPlayed = command<{ item: Id; entry?: Id }>({
  name: 'unmark_played',
  description: "Take back that something was played today (its session is removed from the log, and its review goes back to how it was).",
  fields: { item: f.item(), entry: f.opt(f.entry()) },
  run({ item, entry }, { note }) {
    const t = itemById(item)!;
    const it = entry ? entryFor(entry, t) : null;
    if (!(it ? planEntry(it) : todaysEntry(t.id))) throw new CommandError(`${t.name} isn’t logged for today.`);
    unlog(t.id, it);
    note(`Unmarked ${t.name}`);
    return { unmarked: t.name };
  },
});

export const rateToday = command<{ item: Id; entry?: Id; rating: Rating }>({
  name: 'rate_today',
  description: "How something played today went: rough, ok or solid (schedules its next review).",
  fields: { item: f.item(), entry: f.opt(f.entry()), rating: f.oneOf(RATING_IDS) },
  run({ item, entry, rating }, { note }) {
    const t = itemById(item)!;
    const it = entry ? entryFor(entry, t) : null;
    if (!(it ? planEntry(it) : todaysEntry(t.id))) throw new CommandError(`${t.name} isn’t logged for today: mark it played first.`);
    rate(t.id, rating, it);
    note(`${t.name}: ${rating}`);
    return { rated: t.name, rating };
  },
});

export const newSet = command<Record<string, never>>({
  name: 'new_set',
  description: "Pick today's set again (what's been played stays).",
  fields: {},
  undoToast: true,
  run(_, { note }) {
    buildPlan(true);
    note('New set picked');
    return {};
  },
});

export const oneMoreTune = command<Record<string, never>>({
  name: 'one_more_tune',
  description: "Add one more tune to today's set, picked by the app from any group.",
  fields: {},
  run(_, { note }) {
    ensurePlan();
    const t = pickItem(randomOf(['fresh', 'learn', 'hone'] as const), excludedIds(), itemStats());
    if (!t) throw new CommandError('No more tunes to suggest');
    store.state.plan!.items.push(makePlanItem(t, itemStats()));
    dropOrphanWarmups();
    note(`Added ${t.name} to today’s set`);
    return { added: t.name };
  },
});

export const addWarmups = command<{ tune: Id; count?: number }, { added: (string | undefined)[]; tune_added_to_today: boolean }>({
  name: 'add_warmups',
  description: "Add warm-ups for a tune to today's set, just before it (and the tune too, if it isn't there), from its chord chart in the key it's played in today. They take turns between (1) a lick or pattern whose chords fit part of one of its progressions — a ii–V lick can go over the ii–V of a iii–VI–ii–V–I, or be played up a step for the iii–VI then on the ii–V — or else its progression arpeggiated through the changes, and (2) something on its chords: arpeggios, scales, or a one-chord exercise. Each call adds `count` more (default 1), never ones it already has.",
  fields: { tune: f.item('tune'), count: f.opt(f.int()) },
  run({ tune, count }, { note }) {
    const t = tuneOf(tune);
    const warmups = () => store.state.plan?.items.filter((i) => i.warmup === t.id) ?? [];
    const before = new Set(warmups().map((i) => i.pid));
    const had = !!todayItem(t);
    if (!addTuneWarmups(t, Math.max(1, Math.min(4, count || 1)))) throw new CommandError(`No more warm-ups to add for ${t.name}.`);
    const added = warmups().filter((i) => !before.has(i.pid)).map((i) => itemById(i.itemId)?.name);
    note(`Warm-ups for ${t.name}: ${added.join(', ')}${had ? '' : ` (and ${t.name} added to today)`}`);
    return { added, tune_added_to_today: !had };
  },
});

// One warm-up the app offered (see warmups.ts warmupChoices), before its tune.
export const addWarmup = command<{ tune: Id; warmup: PlanItem }>({
  name: 'add_warmup',
  fields: { tune: f.item('tune'), warmup: f.app() },
  run({ tune, warmup }, { note }) {
    const t = tuneOf(tune);
    addOneWarmup(t, warmup);
    note(`Added a warm-up for ${t.name}: ${itemById(warmup.itemId)?.name}`);
    return {};
  },
});

// An exercise through a tune: the tune into today's set (if it isn't there), with the exercise as a
// warm-up just before it. Without a tune, one is suggested.
export const tryWithTune = command<{ exercise: Id; tune?: Id }>({
  name: 'try_with_tune',
  description: "Try an exercise through a tune: the tune goes into today's set (if it isn't there) with the exercise as a warm-up just before it, in the tune's chords and key. Leave tune null to have one suggested (one of today's, else one whose chords it fits, else one they know).",
  fields: { exercise: f.item('exercise'), tune: f.opt(f.item('tune')) },
  run({ exercise, tune }, { note }) {
    const x = exerciseOf(exercise);
    const t = tryThrough(x, tune ? tuneOf(tune) : null);
    if (!t) throw new CommandError(`No tune to try ${x.name} with.`);
    note(`${x.name} through ${t.name}`);
    return { tune: t.name };
  },
});
