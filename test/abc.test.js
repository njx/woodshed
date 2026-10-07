import { describe, it, expect } from 'vitest';
import { noteToken, restToken, lengthSuffix, buildAbc, writtenShift, soundingShift } from '../src/abc.js';

describe('note lengths', () => {
  it('writes lengths relative to an eighth note', () => {
    expect(lengthSuffix(1)).toBe('');
    expect(lengthSuffix(2)).toBe('2');
    expect(lengthSuffix(0.5)).toBe('/');
    expect(lengthSuffix(1.5)).toBe('3/2');
    expect(lengthSuffix(0.75)).toBe('3/4');
    expect(lengthSuffix(3)).toBe('3');
  });

  it('builds notes from keypad choices', () => {
    expect(noteToken({ letter: 'C' })).toBe('C');
    expect(noteToken({ letter: 'B', accidental: '_', duration: 'quarter' })).toBe('_B2');
    expect(noteToken({ letter: 'F', accidental: '^', octave: 5, duration: 'quarter', dotted: true })).toBe('^f3');
    expect(noteToken({ letter: 'A', octave: 3, duration: 'sixteenth' })).toBe('A,/');
    expect(noteToken({ letter: 'D', octave: 6, duration: 'whole' })).toBe("d'8");
    expect(restToken('half')).toBe('z4');
  });
});

describe('notation', () => {
  it('wraps the notes in a header', () => {
    expect(buildAbc('C D E F |', { meter: '3/4', tempo: 90 })).toBe('X:1\nM:3/4\nL:1/8\nQ:1/4=90\nK:C\nC D E F |');
  });

  it('shifts written-in-C notation up into the key, for the instrument', () => {
    expect(writtenShift(3, 'c')).toBe(3); // concert E♭
    expect(writtenShift(3, 'bb')).toBe(5); // E♭ concert = F on tenor
    expect(writtenShift(3, 'eb')).toBe(0); // E♭ concert = C on alto
    expect(writtenShift(10, 'bb')).toBe(0);
    expect(soundingShift('bb')).toBe(-2);
  });
});

describe('one bar per line', async () => {
  const { barPerLine } = await import('../src/abc.js');
  it('breaks after each bar line, keeping repeat signs together', () => {
    expect(barPerLine('C D E F | G A B c | C8 |')).toBe('C D E F |\nG A B c |\nC8 |');
    expect(barPerLine('|: C D :| E F |] ')).toBe('|: C D :|\nE F |] ');
    expect(barPerLine('A B || c d')).toBe('A B ||\nc d');
  });
});
