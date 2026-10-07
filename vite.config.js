import { defineConfig } from 'vite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

export default defineConfig({
  base: './',
  // abcjs (notation) is ~500 KB, loaded separately and only when notation is shown.
  build: { target: 'es2020', chunkSizeWarningLimit: 600 },
  plugins: [serviceWorker()],
  test: { environment: 'node', include: ['test/**/*.test.js'] },
});
