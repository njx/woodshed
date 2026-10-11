import { describe, it, expect } from 'vitest';
import { rekey, abcKey, homeShift, buildAbc } from '../src/abc.js';

describe('a lick written in its own key', () => {
  it('names keys for ABC, with the key signature', () => {
    expect([0, 10, 21, 18, 13].map(abcKey)).toEqual(['C', 'Bb', 'Am', 'F#m', 'C#m']);
    expect(buildAbc('A2', { key: 10 })).toContain('K:Bb');
  });
  it('keeps every note’s pitch when the key signature changes', () => {
    expect(rekey('B c d e | B2', 0, 5)).toBe('=B c d e | =B2'); // C → F: B natural stays natural
    expect(rekey('_B c ^F B | F', 0, 5)).toBe('B c ^F B | F'); // B♭ written into F's signature
    expect(rekey('B F', 5, 0)).toBe('_B F'); // F → C: B was B♭
    expect(rekey('"Bb7"B A', 0, 21)).toBe('"Bb7"B A'); // C → A minor: same signature, untouched
  });
  it('shifts from its own key to the key shown', () => {
    expect(homeShift(2, 21)).toBe(5); // A minor → D minor: up a 4th
    expect(homeShift(0, 0)).toBe(0);
  });
});

describe('the notation editor: notes nearest the one before', async () => {
  const { lastNote, nearestOctave, moveLastNote } = await import('../src/abc.js');
  it('puts a note in the octave nearest the last one', () => {
    expect(nearestOctave('C', lastNote('A B'))).toBe(5); // B up to C
    expect(nearestOctave('B', lastNote('c'))).toBe(4); // C down to B
    expect(nearestOctave('G', lastNote('"Dm7"d2 ^f'))).toBe(5);
    expect(nearestOctave('E', null)).toBe(4);
    expect(nearestOctave('F', lastNote("b'"))).toBe(6);
  });
  it('moves the last note up or down an octave', () => {
    expect(moveLastNote('C D E2', 1)).toEqual({ text: 'C D e2', delta: 0, octave: 5 });
    expect(moveLastNote('^c', 1).text).toBe("^c'");
    expect(moveLastNote('C', -1).text).toBe('C,');
    expect(moveLastNote('"Cmaj7"', 1)).toBe(null); // no note
  });
});
