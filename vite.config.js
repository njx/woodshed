import { defineConfig } from 'vite';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Lists every file in a directory, as paths relative to it.
function filesIn(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesIn(p).map((f) => join(name, f)) : [name];
  });
}

// Emits sw.js with the full list of built files to precache, and a version that changes
// whenever any of them change (so phones pick up new releases).
function serviceWorker() {
  return {
    name: 'woodshed-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      // Instrument samples are cached when first used (see sw.js), not at install.
      const publicFiles = filesIn('public').filter((f) => !f.startsWith('samples'));
      const assets = ['./', ...Object.keys(bundle), ...publicFiles];
      const hash = createHash('sha256');
      for (const out of Object.values(bundle)) hash.update(out.code ?? out.source ?? '');
      for (const f of publicFiles) hash.update(readFileSync(join('public', f)));
      const version = hash.digest('hex').slice(0, 10);
      const source = readFileSync('src/sw.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__ASSETS__', JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// virtual:seed-charts — chord charts for the starting tune list, from the JazzStandards git
// submodule (vendor/JazzStandards), matched by title and converted at build time. They seed
// each tune's chart; after that the chart is the tune's own.
function seedCharts() {
  const id = 'virtual:seed-charts';
  const file = 'vendor/JazzStandards/JazzStandards.json';
  return {
    name: 'woodshed-seed-charts',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    async load(resolved) {
      if (resolved !== `\0${id}`) return null;
      if (!existsSync(file)) this.error(`Chord charts are missing (${file}). Run: git submodule update --init`);
      this.addWatchFile(file);
      const { SEED_TUNES } = await import('./src/data/tunes.js');
      const { indexStandards, findStandard } = await import('./src/standards.js');
      const { chartFromStandard } = await import('./src/chords.js');
      const index = indexStandards(JSON.parse(readFileSync(file, 'utf8')));
      const charts = {};
      for (const t of SEED_TUNES) {
        const x = findStandard(index, t.name);
        if (x) charts[t.name] = chartFromStandard(x);
      }
      return `export default ${JSON.stringify(charts)};`;
    },
  };
}

export default defineConfig({
  base: './',
  // abcjs (notation) is ~500 KB, loaded separately and only when notation is shown.
  build: { target: 'es2020', chunkSizeWarningLimit: 600 },
  plugins: [seedCharts(), serviceWorker()],
  test: { environment: 'node', include: ['test/**/*.test.js'] },
});
