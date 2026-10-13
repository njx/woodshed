import { store, save } from '../store.js';
import { LEVELS, PRIORITIES, TRANSPOSITIONS } from '../constants.js';
import { parseKey, isMinor } from '../keys.js';
import { itemById } from '../practice.js';
import type { Id, Item, Key, Level, Priority, State } from '../types.js';

// Commands: every change made to the practice data, by a tap in the app or by the assistant, is
// one of these, in one registry (see index.ts). A command has
//   - fields: its input. Each field knows its JSON schema for the assistant and how to read the
//     assistant's value (a written key name, a level's name, an id that must exist) into the
//     command's own (a concert key, a level number); the app passes the command's own values.
//   - run: makes the change, and everything that follows from it (today's keys picked again, the
//     set put in order…), noting what it did in a few words.
//   - a description, for the assistant: a command with one is one of its tools, with a schema made
//     from its fields (those without a schema are the app's own, left out).
// exec() runs one: all or nothing (put back if it fails), saved, and on the undo stack.

/**
 * A command that couldn't do what was asked: its message says why (shown, or told the assistant).
 * restored: it had changed things before it failed, so the state was put back (as a new object:
 * anything holding the old one, like an open sheet, has to let go of it).
 */
export class CommandError extends Error { restored = false; }

// ---------- Fields ----------

// JSON schemas for the assistant's tool inputs (the parts used here). Type aliases rather than
// interfaces, so they fit the API's input_schema type.
type SchemaType = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';
export type Schema = {
  type: SchemaType | SchemaType[];
  description?: string;
  enum?: (string | null)[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
};
export type ObjectSchema = Schema & { type: 'object'; properties: Record<string, Schema>; required: string[] };

/**
 * One input of a command. schema: how the assistant gives it (none: only the app sets it); read:
 * the assistant's value (checked against the schema) into the command's (throws CommandError).
 */
export interface Field<T> { schema?: Schema; read?: (raw: never) => T; optional?: boolean }
/** A command's fields, one for each property of its input. */
export type Fields<I> = { [K in keyof I]-?: Field<NonNullable<I[K]>> };

const fail = (msg: string): never => { throw new CommandError(msg); };
const view = () => store.state.settings.view;

export const f = {
  str: (description?: string, max = 200): Field<string> => ({
    schema: { type: 'string', ...(description ? { description } : {}) },
    read: (s: string) => (s.length > max ? fail(`Too long (${max} characters at most).`) : s),
  }),
  text: (description?: string): Field<string> => ({ schema: { type: 'string', ...(description ? { description } : {}) } }),
  int: (description?: string): Field<number> => ({ schema: { type: 'integer', ...(description ? { description } : {}) } }),
  bool: (description?: string): Field<boolean> => ({ schema: { type: 'boolean', ...(description ? { description } : {}) } }),
  oneOf: <T extends string>(values: readonly T[], description?: string): Field<T> => ({
    schema: { type: 'string', enum: [...values], ...(description ? { description } : {}) },
  }),
  list: <T>(of: Field<T>, description?: string): Field<T[]> => ({
    schema: of.schema && { type: 'array', items: of.schema, ...(description ? { description } : {}) },
    read: (xs: never[]) => xs.map((x) => (of.read ? of.read(x) : x) as T),
  }),
  /** A tune or exercise, by id. */
  item: (type?: Item['type'], description?: string): Field<Id> => ({
    schema: { type: 'string', ...(description ? { description } : {}) },
    read: (id: string) => {
      const t = itemById(id) ?? fail(`No item with id ${id}. Use search_library to find ids.`);
      return type && t.type !== type ? fail(`${t.name} isn't ${type === 'tune' ? 'a tune' : 'an exercise'}.`) : id;
    },
  }),
  /** An item's place in today's set (its entry_id in get_today). */
  entry: (): Field<Id> => ({
    schema: { type: 'string', description: "The item's entry_id in today's set (get_today)" },
    read: (pid: string) => (store.state.plan?.items.some((i) => i.pid === pid) ? pid : fail(`Nothing in today's set has entry_id ${pid}. Use get_today.`)),
  }),
  /** A diary note, by id. */
  note: (): Field<Id> => ({
    schema: { type: 'string', description: 'The note’s id (get_diary)' },
    read: (id: string) => (store.state.diary.some((e) => e.id === id) ? id : fail(`No diary note with id ${id}. Use get_diary.`)),
  }),
  /** A key (0–23, concert): the assistant names it as written for the instrument shown ("B♭", "Gm"). */
  key: (description?: string): Field<Key> => ({
    schema: { type: 'string', description: description ?? 'A key as written for the instrument being viewed, like F, Bb or Gm' },
    read: (name: string) => concertKey(name) ?? fail(`Couldn’t read the key name ${name}. Use names like C, Bb, F#, Ebm.`),
  }),
  /** A root (0–11, concert), named the same way. */
  root: (description?: string): Field<number> => ({
    schema: { type: 'string', description: description ?? 'A key as written for the instrument being viewed, like F or Bb' },
    read: (name: string) => (concertKey(name) ?? fail(`Couldn’t read the key name ${name}. Use names like C, Bb, F#.`)) % 12,
  }),
  level: (): Field<Level> => ({
    schema: { type: 'string', enum: LEVELS.map((l) => l.label.toLowerCase()) },
    read: (name: string) => LEVELS.findIndex((l) => l.label.toLowerCase() === name) as Level,
  }),
  priority: (): Field<Priority> => ({
    schema: { type: 'string', enum: PRIORITIES.map((p) => p.label.toLowerCase()) },
    read: (name: string) => (PRIORITIES.findIndex((p) => p.label.toLowerCase() === name) + 1) as Priority,
  }),
  /** Only the app gives it (what the assistant can't, like a recording or a chosen warm-up). */
  app: <T>(): Field<T> => ({}),
  /** May be left out (the assistant: or null). */
  opt: <T>(field: Field<T>): Field<T> => ({ ...field, optional: true }),
};

// A written key name ("F", "Gm", "B♭") → concert key (0–23), or null.
export function concertKey(name: string | null | undefined): Key | null {
  const k = parseKey(String(name ?? '').replace('♭', 'b').replace('♯', '#'));
  if (k == null) return null;
  const root = (k % 12 - TRANSPOSITIONS[view()].offset + 12) % 12;
  return root + (isMinor(k) ? 12 : 0);
}

// ---------- Commands ----------

/** What a command is given while it runs: note(text) says what it did (the undo toast, the assistant's change list). */
export interface Ctx { note(text: string): void }

export interface Command<I = unknown, R = unknown> {
  /** Also its tool name, for the assistant. */
  name: string;
  /** For the assistant: what it does and when to use it. Without one, it's the app's own. */
  description?: string;
  fields: Fields<I>;
  /**
   * Before the assistant does it, a question for the user, who confirms with a tap (e.g. deleting
   * something with practice history); null when it needn't ask. (In the app, Undo is enough.)
   */
  ask?(input: I): string | null;
  /** It only looks things up (the assistant's queries): run straight, nothing saved or undone. */
  query?: boolean;
  /** The app shows what it did, with Undo (it takes something away, or replaces it). */
  undoToast?: boolean;
  /** Changes that run together (typing into a field) are one undo: the same key, one after another. */
  coalesce?(input: I): string | undefined;
  run(input: I, ctx: Ctx): R;
}
// (Its methods are written as methods so that a command for some input is a Command, for the registry.)
export const command = <I, R = object>(c: Command<I, R>): Command<I, R> => c;

// The assistant's input to a command: its tool schema, made from the fields that have one.
export function toolSchema(c: Command): ObjectSchema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const [k, field] of Object.entries(c.fields as Record<string, Field<unknown>>)) {
    if (!field.schema) continue;
    if (field.optional) {
      const s = field.schema;
      properties[k] = { ...s, type: [s.type as SchemaType, 'null'], ...(s.enum ? { enum: [...s.enum, null] } : {}) };
    } else {
      properties[k] = field.schema;
      required.push(k);
    }
  }
  return { type: 'object', properties, required, additionalProperties: false };
}
/** Whether the assistant can use it (it has a description, and every field it needs has a schema). */
export const forAssistant = (c: Command): boolean => !!c.description
  && Object.values(c.fields as Record<string, Field<unknown>>).every((field) => field.schema || field.optional);

// The assistant's input (checked against the tool schema) → the command's: each field read, null
// and missing ones left out. Throws CommandError.
export function readInput<I>(c: Command<I>, raw: Record<string, unknown>): I {
  const err = validate(toolSchema(c as Command), raw);
  if (err) fail(`Invalid input: ${err}`);
  const out: Record<string, unknown> = {};
  for (const [k, field] of Object.entries(c.fields as Record<string, Field<unknown>>)) {
    const v = raw[k];
    if (v == null) continue;
    out[k] = field.read ? (field.read as (x: unknown) => unknown)(v) : v;
  }
  return out as I;
}

// Check a value against a schema (tool inputs stream in unvalidated). The model's JSON, untyped
// until it's been checked here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validate(schema: Schema, value: any, path = 'input'): string | null {
  const types = ([] as string[]).concat(schema.type);
  const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const actual = typeOf(value);
  if (!types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
    return `${path} should be ${types.join(' or ')}, got ${actual}`;
  }
  if (actual === 'null') return null;
  if (schema.enum && !schema.enum.includes(value)) return `${path} should be one of ${schema.enum.join(', ')}`;
  if (actual === 'object' && schema.properties) {
    for (const k of schema.required || []) if (!(k in value)) return `${path}.${k} is missing`;
    for (const [k, v] of Object.entries(value)) {
      if (!schema.properties[k]) return `${path}.${k} is not a known field`;
      const err = validate(schema.properties[k], v, `${path}.${k}`);
      if (err) return err;
    }
  }
  if (actual === 'array' && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const err = validate(schema.items, value[i], `${path}[${i}]`);
      if (err) return err;
    }
  }
  return null;
}

// ---------- Running them, and undo ----------
// Each command (or the assistant's turn, as a group) goes on the undo stack with a copy of the
// state from before it. Undo puts back the latest, if nothing else has changed since: `rev`
// changes with every command (and wherever the data changes on its own, see invalidateUndo), not
// with saves of things beside it (a hint seen, the practice timer ticking).

export interface UndoEntry { label: string; state: State; rev: number; key?: string }
export interface Done<R> { result: R; notes: string[]; undo: UndoEntry | null }

const MAX_UNDO = 10;
const stack: UndoEntry[] = [];
let revs = 0;
let rev = 0;
let group: { state: State; rev: number; notes: string[] } | null = null;

const copy = (): State => structuredClone(store.state);

export function exec<I, R>(c: Command<I, R>, input: I): Done<R> {
  const top = stack.at(-1);
  const key = c.coalesce?.(input);
  const joined = !group && key != null && top?.key === key && top.rev === rev; // (typing on: the same undo)
  const before = joined ? null : copy();
  const notes: string[] = [];
  let result: R;
  try {
    result = c.run(input, { note: (text) => notes.push(text) });
  } catch (err) {
    // All or nothing. (Most fail before changing anything: then the state stays the same object.)
    if (before && JSON.stringify(before) !== JSON.stringify(store.state)) {
      store.state = before;
      if (err instanceof CommandError) err.restored = true;
    }
    throw err;
  }
  rev = ++revs;
  save();
  if (group) {
    group.notes.push(...notes);
    return { result, notes, undo: null };
  }
  if (joined) {
    top!.rev = rev;
    return { result, notes, undo: top! };
  }
  const entry: UndoEntry = { label: notes.join(' · ') || c.name, state: before!, rev, ...(key != null ? { key } : {}) };
  stack.push(entry);
  if (stack.length > MAX_UNDO) stack.shift();
  return { result, notes, undo: entry };
}

// Several commands as one undo (the assistant's turn): begin, run them, end.
export function beginGroup(): void {
  group = { state: copy(), rev, notes: [] };
}
/** The group's undo (null if it changed nothing), and what it did. */
export function endGroup(): { undo: UndoEntry | null; notes: string[] } {
  const g = group;
  group = null;
  if (!g || g.rev === rev) return { undo: null, notes: g?.notes ?? [] };
  const entry: UndoEntry = { label: g.notes.join(' · '), state: g.state, rev };
  stack.push(entry);
  if (stack.length > MAX_UNDO) stack.shift();
  return { undo: entry, notes: g.notes };
}

export const canUndo = (entry: UndoEntry | null | undefined): boolean => !!entry && stack.at(-1) === entry && entry.rev === rev;

// Puts back the state from before it: only the latest, and only if nothing has changed since
// (false otherwise). What isn't the practice data (hints seen, the day's welcome) stays as it is.
export function undo(entry: UndoEntry): boolean {
  if (!canUndo(entry)) return false;
  stack.pop();
  const { hintsSeen, greetedOn } = store.state;
  store.state = { ...entry.state, hintsSeen, greetedOn };
  rev = stack.at(-1)?.rev ?? ++revs;
  save();
  return true;
}

// The data changed on its own (a new day's set, a backup restored): what's on the undo stack no
// longer applies.
export function invalidateUndo(): void {
  rev = ++revs;
}
