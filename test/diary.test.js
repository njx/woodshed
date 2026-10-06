import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../src/store.js';
import { addEntry, openTodos, diaryDays, entriesFor, deleteEntry, todoText } from '../src/diary.js';
import { freezeToday, tune, setState, entry, TODAY } from './helpers.js';

let solar;
beforeEach(() => {
  freezeToday();
  solar = tune({ name: 'Solar' });
  setState([solar], { log: [entry(solar.id, '2026-10-05')] });
});
afterEach(() => vi.useRealTimers());

describe('diary', () => {
  it('adds notes dated today, trimmed', () => {
    const e = addEntry({ text: '  Slow practice on the bridge  ' });
    expect(e).toMatchObject({ date: TODAY, text: 'Slow practice on the bridge', flag: null, done: false });
    expect(store.state.diary).toHaveLength(1);
  });

  it('lists open flagged notes as to-dos, by flag, until done', () => {
    const a = addEntry({ text: 'Breath support', flag: 'teacher' });
    addEntry({ text: 'Practice with metronome on 2 and 4', flag: 'remember' });
    addEntry({ text: 'Felt good today' });
    expect(openTodos().map((e) => e.text)).toHaveLength(2);
    expect(openTodos('teacher').map((e) => e.text)).toEqual(['Breath support']);
    a.done = true;
    expect(openTodos('teacher')).toEqual([]);
  });

  it('groups notes and practice by day, newest first', () => {
    addEntry({ text: 'Bridge is getting there', itemId: solar.id });
    addEntry({ text: 'Older note', date: '2026-10-03' });
    const days = diaryDays();
    expect(days.map((d) => d.date)).toEqual([TODAY, '2026-10-05', '2026-10-03']);
    expect(days[1]).toMatchObject({ played: ['Solar'], entries: [] });
    expect(entriesFor(solar.id).map((e) => e.text)).toEqual(['Bridge is getting there']);
  });

  it('filtered views only include days with matching notes', () => {
    addEntry({ text: 'Ask about altissimo', flag: 'teacher' });
    const days = diaryDays('teacher');
    expect(days).toHaveLength(1);
    expect(days[0].played).toEqual([]);
  });

  it('shares open items as a plain-text list', () => {
    addEntry({ text: 'Ask about\nalternate fingerings', flag: 'teacher', itemId: solar.id });
    addEntry({ text: 'Not for the teacher', flag: 'remember' });
    expect(todoText('teacher')).toBe('For my teacher (Oct 6)\n• Solar: Ask about alternate fingerings');
  });

  it('deletes notes', () => {
    const e = addEntry({ text: 'oops' });
    deleteEntry(e.id);
    expect(store.state.diary).toEqual([]);
  });
});
