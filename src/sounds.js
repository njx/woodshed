import SAMPLE_NOTES from './data/sounds.json';

// Sounds for notation playback: recorded instruments (one sample every few semitones, shifted to
// the notes in between; see scripts/make-samples.sh), or a synth that needs no download.
export const SOUNDS = {
  piano: { label: 'Piano', release: 0.25 },
  sax: { label: 'Sax', release: 0.08 },
  trumpet: { label: 'Trumpet', release: 0.08 },
  flute: { label: 'Flute', release: 0.08 },
  clarinet: { label: 'Clarinet', release: 0.08 },
  guitar: { label: 'Guitar', release: 0.2 },
  synth: { label: 'Synth', release: 0.03 },
};

export const SWING = {
  straight: { label: 'Straight', ratio: 0.5 },
  light: { label: 'Light', ratio: 0.6 },
  swing: { label: 'Swing', ratio: 2 / 3 },
};

export const sampleNotes = (id) => SAMPLE_NOTES[id] || [];

// The recorded note to play a pitch from: the nearest one (ties go to the one below, so samples
// are mostly shifted up a little, which sounds more natural than down).
export function nearestSample(id, pitch) {
  let best = null;
  for (const m of sampleNotes(id)) {
    if (best == null || Math.abs(m - pitch) < Math.abs(best - pitch) || (Math.abs(m - pitch) === Math.abs(best - pitch) && m < best)) best = m;
  }
  return best;
}

// Swing: each beat's first half is stretched to `ratio` of the beat and the second half squeezed
// into the rest, so off-beat eighths land late (2:1 is triplet swing). Times are in beats.
export function swingTime(t, ratio = 0.5) {
  if (ratio === 0.5) return t;
  const beat = Math.floor(t);
  const f = t - beat;
  return beat + (f < 0.5 ? (f / 0.5) * ratio : ratio + ((f - 0.5) / 0.5) * (1 - ratio));
}

// Decoded samples, per sound: { midi: AudioBuffer }. Loaded the first time a sound is used; the
// service worker keeps the files for offline use. (Also the walking bass's: 'bass'.)
// Decoded on a context of their own that's never closed (a player's is closed when it stops, and
// a decode left on a closed one may never finish); the buffers play in any context.
const loaded = new Map();
let decoder = null;
export function loadSamples(ctx, id) {
  if (!loaded.has(id)) {
    const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    decoder ||= Offline ? new Offline(1, 1, 44100) : ctx;
    const p = Promise.race([
      Promise.all(sampleNotes(id).map(async (m) => {
        const res = await fetch(`samples/${id}/${m}.mp3`);
        if (!res.ok) throw new Error(`sample ${id}/${m}: ${res.status}`);
        const data = await res.arrayBuffer();
        return [m, await new Promise((resolve, reject) => decoder.decodeAudioData(data, resolve, reject))];
      })),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`sounds ${id}: too slow`)), 20000)),
    ]).then(Object.fromEntries);
    p.catch(() => loaded.delete(id)); // try again next time
    loaded.set(id, p);
  }
  return loaded.get(id);
}
