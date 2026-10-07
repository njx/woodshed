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
  it('breaks after each full bar, keeping repeat signs together', () => {
    expect(barPerLine('CDEF GABc | BAGF ED C2 |')).toBe('CDEF GABc |\nBAGF ED C2 |');
    expect(barPerLine('|: CDEF :| GABc |]')).toBe('|: CDEF :|\nGABc |]');
    expect(barPerLine('CDEF || GABc')).toBe('CDEF ||\nGABc');
  });
  it('keeps a pickup and a last note on the 1 with their neighbours', () => {
    // A lick: pickup, two full bars, a last note.
    expect(barPerLine('z6 GA | _BAGF E2 D2 | CDEF G2 z2 | c8 |')).toBe('z6 GA | _BAGF E2 D2 |\nCDEF G2 z2 | c8 |');
    // Chord symbols and decorations don't count as notes.
    expect(barPerLine('"G7"z6 G2 | "C"CDEF GABc |')).toBe('"G7"z6 G2 | "C"CDEF GABc |');
  });
  it('puts at most 4 sparse bars on a line', () => {
    expect(barPerLine('C8 | D8 | E8 | F8 | G8 | A8 |')).toBe('C8 | D8 | E8 | F8 |\nG8 | A8 |');
  });
});
