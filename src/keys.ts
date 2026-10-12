import { TRANSPOSITIONS } from './constants.js';

// Keys are stored as concert pitch: 0–11 = C..B major, 12–23 = C..B minor.
export const MAJOR = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export const MINOR = ['Cm', 'C♯m', 'Dm', 'E♭m', 'Em', 'Fm', 'F♯m', 'Gm', 'G♯m', 'Am', 'B♭m', 'Bm'];
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseKey(name) {
  const m = /^([A-G])([b#♭♯]?)(m?)$/.exec(name.trim());
  if (!m) return null;
  let root = NOTE_INDEX[m[1]] + (m[2] === 'b' || m[2] === '♭' ? -1 : m[2] ? 1 : 0);
  root = (root + 12) % 12;
  return root + (m[3] ? 12 : 0);
}
export function isMinor(k) {
  return k >= 12;
}
// Name of a concert key as written for a transposition ('c', 'bb', 'eb', 'f').
export function keyName(k, view = 'c') {
  if (k == null) return '';
  const root = ((k % 12) + TRANSPOSITIONS[view].offset) % 12;
  return isMinor(k) ? MINOR[root] : MAJOR[root];
}
// Concert key for a written root in a transposition.
export function writtenToConcert(written, view) {
  return (written - TRANSPOSITIONS[view].offset + 12) % 12;
}
