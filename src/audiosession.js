// The iPhone's audio session (Safari 17+), shared by everything that plays or listens:
//   - 'playback' while something plays (the metronome), so it sounds even with the silent switch on;
//   - 'play-and-record' while the mic is in use (recorder, tuner), which still lets the metronome
//     click — 'playback' alone blocks the mic;
//   - 'auto' otherwise.
// Each user holds what it needs and releases it when done.

const held = { playback: 0, record: 0 };

function apply() {
  const type = held.record ? 'play-and-record' : held.playback ? 'playback' : 'auto';
  try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch { /* not supported */ }
}

// Returns a function that releases it (safe to call more than once).
export function holdAudio(kind) {
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
