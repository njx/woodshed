import { store } from './store.js';
import { dateStr, niceDate } from './dates.js';
import { uid } from './util.js';
import { itemById } from './practice.js';

// Practice diary. Entries:
//   { id, date, at, text, flag: null | 'remember' | 'teacher', done, itemId?, media? }
// media: recorded clips (see media.js). A note with a recording doesn't need text.
// Flagged entries work as a to-do list until marked done.

// The item a note is about, from the name typed in its "which tune" field. Matches tunes and
// exercises (a tune wins if both have the name).
export function findItemByName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  const hits = store.state.items.filter((t) => t.name.trim().toLowerCase() === n);
  return hits.find((t) => t.type === 'tune') || hits[0] || null;
}

// Names to suggest in that field: tunes, then exercises.
export function linkableItems() {
  const items = store.state.items;
  return [...items.filter((t) => t.type === 'tune'), ...items.filter((t) => t.type !== 'tune')];
}

export const FLAGS = {
  remember: { label: 'Remember', long: 'To remember' },
  teacher: { label: 'Ask teacher', long: 'For my teacher' },
};

// take: made by the recorder (its text is just a label), so deleting the recording deletes it.
export function addEntry({ text = '', flag = null, itemId = null, date = dateStr(), media = [], take = false }) {
  const e = { id: uid(), date, at: Date.now(), text: text.trim(), flag, done: false, itemId, media, ...(take ? { take: true } : {}) };
  store.state.diary.push(e);
  return e;
}

export function entryById(id) {
  return store.state.diary.find((e) => e.id === id);
}

export function deleteEntry(id) {
  store.state.diary = store.state.diary.filter((e) => e.id !== id);
}

const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.at - a.at;

// Open flagged entries, newest first. flag: 'remember' | 'teacher' | undefined for both.
export function openTodos(flag) {
  return store.state.diary.filter((e) => e.flag && !e.done && (!flag || e.flag === flag)).sort(newestFirst);
}

// Entries for one tune, newest first.
export function entriesFor(itemId) {
  return store.state.diary.filter((e) => e.itemId === itemId).sort(newestFirst);
}

// Days that have notes or practice, newest first: [{ date, entries, played: [names] }].
// filter narrows the notes ('remember' | 'teacher'); filtered views only list days with notes.
export function diaryDays(filter) {
  const days = new Map();
  const day = (date) => {
    if (!days.has(date)) days.set(date, { date, entries: [], played: [] });
    return days.get(date);
  };
  for (const e of store.state.diary) {
    if (!filter || e.flag === filter) day(e.date).entries.push(e);
  }
  if (!filter) {
    for (const e of store.state.log) {
      const name = itemById(e.itemId)?.name;
      if (name) day(e.date).played.push(name);
    }
  }
  return [...days.values()]
    .map((d) => ({ ...d, entries: d.entries.sort(newestFirst) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Plain-text list of open items, for sharing (e.g. with your teacher before a lesson).
export function todoText(flag) {
  const items = openTodos(flag);
  const head = flag ? FLAGS[flag].long : 'Practice notes';
  return [
    `${head} (${niceDate(dateStr(), { month: 'short', day: 'numeric' })})`,
    ...items.map((e) => {
      const tune = e.itemId ? itemById(e.itemId)?.name : null;
      const text = e.text || (e.media?.length ? '(recording)' : '');
      return `• ${tune ? `${tune}: ` : ''}${text.replace(/\s*\n\s*/g, ' ')}`;
    }),
  ].join('\n');
}
