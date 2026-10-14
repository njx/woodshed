import { TRANSPOSITIONS } from './constants.js';
import type { Key, Transposition } from './types.js';

// Keys are stored as concert pitch: 0–11 = C..B major, 12–23 = C..B minor.
export const MAJOR = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export const MINOR = ['Cm', 'C♯m', 'Dm', 'E♭m', 'Em', 'Fm', 'F♯m', 'Gm', 'G♯m', 'Am', 'B♭m', 'Bm'];
// How many sharps (+) or flats (−) each key's signature has: the one place keys are spelled from
// (names above, notation's key signatures in abc.ts, chord roots in chords.ts), so they agree.
const SIG_COUNT = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5]; // major keys C…B
export const sigCount = (k: Key): number => SIG_COUNT[(isMinor(k) ? k + 3 : k) % 12]; // a minor key: its relative major's
const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseKey(name: string): Key | null {
  const m = /^([A-G])([b#♭♯]?)(m?)$/.exec(name.trim());
  if (!m) return null;
  let root = NOTE_INDEX[m[1]] + (m[2] === 'b' || m[2] === '♭' ? -1 : m[2] ? 1 : 0);
  root = (root + 12) % 12;
  return root + (m[3] ? 12 : 0);
}
export function isMinor(k: Key): boolean {
  return k >= 12;
}
// Name of a concert key as written for a transposition ('c', 'bb', 'eb', 'f').
export function keyName(k: Key | null | undefined, view: Transposition = 'c'): string {
  if (k == null) return '';
  const root = ((k % 12) + TRANSPOSITIONS[view].offset) % 12;
  return isMinor(k) ? MINOR[root] : MAJOR[root];
}
// Concert key for a written root in a transposition.
export function writtenToConcert(written: number, view: Transposition): Key {
  return (written - TRANSPOSITIONS[view].offset + 12) % 12;
}
