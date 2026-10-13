import { store } from '../store.js';
import { itemById } from '../practice.js';
import { addEntry, entryById, deleteEntry, FLAGS } from '../diary.js';
import { dateStr } from '../dates.js';
import { command, f, CommandError } from './core.js';
import type { Clip, DiaryEntry, Id } from '../types.js';

// The practice diary: notes, to-dos ("remember", "for teacher"), and recordings.

type Flag = keyof typeof FLAGS;
const FLAG_IDS = Object.keys(FLAGS) as Flag[];
const short = (s: string) => `“${s.slice(0, 60)}${s.length > 60 ? '…' : ''}”`;
const noteOf = (id: Id): DiaryEntry => entryById(id) ?? (() => { throw new CommandError('That note isn’t there any more.'); })();

interface AddInput { text: string; flag?: Flag; item?: Id; media?: Clip[]; take?: boolean }
export const addNote = command<AddInput>({
  name: 'add_diary_note',
  description: 'Add a note to the practice diary, optionally flagged as a to-do ("remember" shows on the Today screen; "teacher" collects questions for lessons) and optionally about a tune or exercise.',
  fields: { text: f.text(), flag: f.opt(f.oneOf(FLAG_IDS)), item: f.opt(f.item()), media: f.opt(f.app()), take: f.opt(f.app()) },
  run({ text, flag, item, media, take }, { note }) {
    if (!text.trim() && !media?.length) throw new CommandError('A note needs some text.');
    const e = addEntry({ text, flag: flag ?? null, itemId: item && itemById(item) ? item : null, media: media ?? [], take: !!take });
    note(take ? 'Recording saved to your diary' : `Diary note${e.flag ? ` (${e.flag === 'teacher' ? 'for teacher' : 'to remember'})` : ''}: ${short(e.text)}`);
    return { added: e.id };
  },
});

// A note changed: its text, flag, what it's about, whether its to-do is done, its recordings.
interface UpdateInput { note: Id; text?: string; flag?: Flag | 'none'; item?: Id | null; done?: boolean; media?: Clip[] }
export const updateNote = command<UpdateInput>({
  name: 'update_diary_note',
  description: 'Change a diary note: its text, its flag (none takes it off), or mark its to-do done (or not).',
  fields: { note: f.note(), text: f.opt(f.text()), flag: f.opt(f.oneOf([...FLAG_IDS, 'none'] as const)), item: f.opt(f.app()), done: f.opt(f.bool()), media: f.opt(f.app()) },
  run({ note: id, text, flag, item, done, media }, { note }) {
    const e = noteOf(id);
    const did: string[] = [];
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
  description: "Call this when the user asks for something the app or these tools can't do, so it can be added later. Then tell the user it isn't possible yet.",
  fields: { request: f.str('What they wanted, in a sentence', 500) },
  run({ request }) {
    (store.state.assistantWishes ||= []).push({ date: dateStr(), request });
    return { noted: true };
  },
});
