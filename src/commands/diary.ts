import { store, save } from '../store.js';
import { itemById } from '../practice.js';
import { addEntry, entryById, deleteEntry, FLAGS } from '../diary.js';
import { dateStr } from '../dates.js';
import { command, f, CommandError } from './core.js';
import type { Clip, DateStr, DiaryEntry, Id } from '../types.js';

// The practice diary: notes, to-dos ("remember", "for teacher"), and recordings.

type Flag = keyof typeof FLAGS;
const FLAG_IDS = Object.keys(FLAGS) as Flag[];
const short = (s: string) => `“${s.slice(0, 60)}${s.length > 60 ? '…' : ''}”`;
const noteOf = (id: Id): DiaryEntry => entryById(id) ?? (() => { throw new CommandError('That note isn’t there any more.'); })();

// A lesson's fields: whether it's one, and how long (0: not given).
const lessonFields = {
  lesson: f.opt(f.bool('A lesson: the day counts as a practice day (for the streak), with its time')),
  lesson_minutes: f.opt(f.int('How long the lesson was, in minutes (0: not given)')),
};
const minutes = (m: number) => Math.max(0, Math.min(12 * 60, Math.round(m))) * 60000;
const pastDay = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new CommandError('A day is written like 2026-10-24.');
  if (date > dateStr()) throw new CommandError('That day hasn’t happened yet.');
  return date as DateStr;
};

interface AddInput { text: string; flag?: Flag; item?: Id; media?: Clip[]; take?: boolean; lesson?: boolean; lesson_minutes?: number; date?: string }
export const addNote = command<AddInput>({
  name: 'add_diary_note',
  description: 'Add a note to the practice diary, optionally flagged as a to-do ("remember" shows on the Today screen; "teacher" collects questions for lessons), optionally about a tune or exercise. A lesson is a note marked as one (text optional: what was covered), on the day it was.',
  fields: {
    text: f.text(), flag: f.opt(f.oneOf(FLAG_IDS)), item: f.opt(f.item()), ...lessonFields,
    date: f.opt(f.str('The day, like 2026-10-24: today (the default) or earlier')), media: f.opt(f.app()), take: f.opt(f.app()),
  },
  run({ text, flag, item, media, take, lesson, lesson_minutes, date }, { note }) {
    if (!text.trim() && !media?.length && !lesson) throw new CommandError('A note needs some text.');
    const e = addEntry({
      text, flag: flag ?? null, itemId: item && itemById(item) ? item : null, media: media ?? [], take: !!take,
      ...(date ? { date: pastDay(date) } : {}), lesson: !!lesson, ...(lesson && lesson_minutes ? { lessonMs: minutes(lesson_minutes) } : {}),
    });
    note(take ? 'Recording saved to your diary'
      : e.lesson ? `Lesson${e.lessonMs ? ` (${Math.round(e.lessonMs / 60000)} min)` : ''} on ${e.date === dateStr() ? 'today' : e.date}${e.text ? `: ${short(e.text)}` : ''}`
      : `Diary note${e.flag ? ` (${e.flag === 'teacher' ? 'for teacher' : 'to remember'})` : ''}: ${short(e.text)}`);
    return { added: e.id };
  },
});

// A note changed: its text, flag, what it's about, whether its to-do is done, its recordings.
interface UpdateInput { note: Id; text?: string; flag?: Flag | 'none'; item?: Id | null; done?: boolean; media?: Clip[]; lesson?: boolean; lesson_minutes?: number; date?: string }
export const updateNote = command<UpdateInput>({
  name: 'update_diary_note',
  description: 'Change a diary note: its text, its flag (none takes it off), mark its to-do done (or not), whether it\'s a lesson and how long, or its day.',
  fields: {
    note: f.note(), text: f.opt(f.text()), flag: f.opt(f.oneOf([...FLAG_IDS, 'none'] as const)), done: f.opt(f.bool()), ...lessonFields,
    date: f.opt(f.str('The day, like 2026-10-24: today or earlier')), item: f.opt(f.app()), media: f.opt(f.app()),
  },
  run({ note: id, text, flag, item, done, media, lesson, lesson_minutes, date }, { note }) {
    const e = noteOf(id);
    const did: string[] = [];
    if (date && date !== e.date) { e.date = pastDay(date); did.push(`moved to ${e.date}`); }
    if (lesson === false && e.lesson) { delete e.lesson; delete e.lessonMs; did.push('not a lesson'); }
    if (lesson && !e.lesson) { e.lesson = true; did.push('a lesson'); }
    if (lesson_minutes != null && e.lesson) {
      const ms = minutes(lesson_minutes);
      if (ms) e.lessonMs = ms; else delete e.lessonMs;
      did.push(ms ? `${Math.round(ms / 60000)} min` : 'no time');
    }
    if (text != null) { e.text = text.trim(); did.push('text'); }
    if (flag) { e.flag = flag === 'none' ? null : flag; did.push(e.flag ? `flagged ${FLAGS[e.flag].label.toLowerCase()}` : 'no flag'); }
    if (item !== undefined) e.itemId = item && itemById(item) ? item : null;
    if (media) { e.media = media; did.push('recordings'); }
    if (done != null) { e.done = done; did.push(done ? 'done' : 'not done'); }
    if (!e.flag) e.done = false;
    note(done && did.length === 1 ? `Marked done: ${short(e.text)}` : `Note ${short(e.text)}: ${did.join(', ')}`);
    return { updated: e.id };
  },
});

export const deleteNote = command<{ note: Id }>({
  name: 'delete_diary_note',
  description: 'Delete a diary note. If it has recordings, the user is asked to confirm with a tap.',
  fields: { note: f.note() },
  undoToast: true,
  ask: ({ note }) => (entryById(note)?.media?.length ? 'Delete this note and its recordings?' : null),
  run({ note: id }, { note }) {
    const e = noteOf(id);
    deleteEntry(e.id);
    // (A clip in no note is kept 30 days, then deleted: see media.ts.)
    note(e.media?.length && (e.take || !e.text) ? (e.media.length > 1 ? 'Recordings deleted' : 'Recording deleted') : 'Note deleted');
    return { deleted: true };
  },
});

// Something the assistant was asked for that it (or the app) can't do yet, for later.
export const reportUnsupported = command<{ request: string }>({
  name: 'report_unsupported',
  query: true, // (a note for later, not a change to undo: saved straight away)
  description: "Call this when the user asks for something the app or these tools can't do, so it can be added later. Then tell the user it isn't possible yet.",
  fields: { request: f.str('What they wanted, in a sentence', 500) },
  run({ request }) {
    (store.state.assistantWishes ||= []).push({ date: dateStr(), request });
    save();
    return { noted: true };
  },
});
