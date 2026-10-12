// Chord charts for tunes. Each tune keeps its own chart (`chart`, see chords.js). The starting
// tune list's charts come from mikeoliphant/JazzStandards (iReal Pro's playlists), built into
// the app (see vite.config.js). They're only needed to seed tunes (first run, the upgrade that
// added charts, a reset or an old backup), so they're a separate download: loadSeedCharts().
// After that a tune's chart is its own: it can be edited, or added for tunes that have none.

let SEED = null;
export async function loadSeedCharts() {
  SEED ||= (await import('virtual:seed-charts')).default;
  return SEED;
}

// The chart a tune started with (once loadSeedCharts() has run), if JazzStandards has it.
export function seedChart(t) {
  const c = SEED?.[t?.seedName || t?.name];
  return c ? structuredClone(c) : null;
}

export function chartFor(t) {
  return t?.type === 'tune' && t.chart?.sections?.length ? t.chart : null;
}

// 'mine' (typed or edited in the app), 'standards' (as it came), or null.
export const chartSource = (t) => (!chartFor(t) ? null : t.chartEdited ? 'mine' : 'standards');
