import { describe, it, expect } from 'vitest';
import { parseKey, keyName, writtenToConcert } from '../src/keys.js';
import { addDays, daysBetween } from '../src/dates.js';

describe('keys', () => {
  it('parses key names', () => {
    expect(parseKey('C')).toBe(0);
    expect(parseKey('Eb')).toBe(3);
    expect(parseKey('B♭')).toBe(10);
    expect(parseKey('F#m')).toBe(18);
    expect(parseKey('Gm')).toBe(19);
    expect(parseKey('H')).toBe(null);
  });

  it('names keys for each transposition', () => {
    const eb = parseKey('Eb');
    expect(keyName(eb, 'c')).toBe('E♭');
    expect(keyName(eb, 'bb')).toBe('F'); // tenor reads a whole step up
    expect(keyName(eb, 'eb')).toBe('C'); // alto reads a major 6th up
    expect(keyName(eb, 'f')).toBe('B♭');
    expect(keyName(parseKey('Cm'), 'bb')).toBe('Dm');
  });

  it('maps written roots back to concert', () => {
    expect(writtenToConcert(5, 'bb')).toBe(3); // written F on tenor = concert E♭
    expect(writtenToConcert(0, 'eb')).toBe(3); // written C on alto = concert E♭
  });
});

describe('dates', () => {
  it('adds days across months and counts between dates', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(daysBetween('2026-10-01', '2026-10-06')).toBe(5);
  });
});

describe('practice day', () => {
  it('runs until 4am', async () => {
    const { today } = await import('../src/dates.js');
    expect(today(new Date(2026, 9, 7, 23, 50))).toBe('2026-10-07');
    expect(today(new Date(2026, 9, 8, 0, 30))).toBe('2026-10-07');
    expect(today(new Date(2026, 9, 8, 3, 59))).toBe('2026-10-07');
    expect(today(new Date(2026, 9, 8, 4, 0))).toBe('2026-10-08');
    expect(today(new Date(2026, 9, 1, 1, 0))).toBe('2026-09-30'); // across a month
    expect(today(new Date(2027, 0, 1, 2, 0))).toBe('2026-12-31'); // and a year
  });
});
