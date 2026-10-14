// The iPhone's audio session (Safari 17+), shared by everything that plays or listens:
//   - 'playback' while something plays (the metronome), so it sounds even with the silent switch on;
//   - while the mic is in use (recorder, tuner), left to Safari ('auto'), which sets itself up to
//     record and play (so the metronome still clicks). 'playback' would block the mic; and setting
//     'play-and-record' ourselves stopped a USB mic's own headphone monitoring (a Blue Yeti's, found
//     with the mic test) for as long as the mic was on, where Safari's own setup doesn't;
//   - 'auto' otherwise.
// Each user holds what it needs and releases it when done.

// iOS Safari's navigator.audioSession, which TypeScript's DOM types don't have yet.
type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';
declare global {
  interface Navigator { audioSession?: { type: AudioSessionType } }
}

const held = { playback: 0, record: 0 };

function apply() {
  const type: AudioSessionType = held.record ? 'auto' : held.playback ? 'playback' : 'auto';
  try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch { /* not supported */ }
}

// Returns a function that releases it (safe to call more than once).
export function holdAudio(kind: keyof typeof held): () => void {
  held[kind]++;
  apply();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    held[kind]--;
    apply();
  };
}
