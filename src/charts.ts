// Chord charts for tunes. Each tune keeps its own chart (`chart`, see chords.js). The starting
// tune list's charts come from mikeoliphant/JazzStandards (iReal Pro's playlists), built into
// the app (see vite.config.js). They're only needed to seed tunes (first run, the upgrade that
// added charts, a reset or an old backup), so they're a separate download: loadSeedCharts().
// After that a tune's chart is its own: it can be edited, or added for tunes that have none.

import type { Chart, Item, Tune } from './types.js';

let SEED: Record<string, Chart> | null = null;
export async function loadSeedCharts(): Promise<Record<string, Chart>> {
  SEED ||= (await import('virtual:seed-charts')).default;
  return SEED;
}

// The chart a tune started with (once loadSeedCharts() has run), if JazzStandards has it.
export function seedChart(t: Pick<Tune, 'name' | 'seedName'>): Chart | null {
  const c = SEED?.[t?.seedName || t?.name];
  return c ? structuredClone(c) : null;
}

export function chartFor(t: Item | null | undefined): Chart | null {
  return t?.type === 'tune' && t.chart?.sections?.length ? t.chart : null;
}

// 'mine' (typed or edited in the app), 'standards' (as it came), or null.
export const chartSource = (t: Tune): 'mine' | 'standards' | null => (!chartFor(t) ? null : t.chartEdited ? 'mine' : 'standards');
