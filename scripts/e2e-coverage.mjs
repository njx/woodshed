// Which app code the end-to-end tests never run: reads the coverage written by the tests
// (COVERAGE_DIR) and maps it through the build's source maps to lines in src/.
//   npx vite build --sourcemap --minify false && npx vite preview --port 4173 &
//   COVERAGE_DIR=/tmp/cov npx playwright test --project=iphone-13
//   node scripts/e2e-coverage.mjs /tmp/cov [src/ui]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SourceMapConsumer } from 'source-map-js';

const [dir, only = 'src/'] = process.argv.slice(2);
const runs = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const covered = new Map(); // bundle file → Uint8Array (1: ran in some test)
for (const run of runs) {
  for (const { url, functions } of run) {
    const file = new URL(url).pathname.replace(/^.*\/assets\//, 'dist/assets/');
    const code = readFileSync(file, 'utf8');
    const paint = new Uint8Array(code.length);
    const ranges = functions.flatMap((f) => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    for (const r of ranges) paint.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
    const all = covered.get(file) || new Uint8Array(code.length);
    for (let i = 0; i < paint.length; i++) all[i] |= paint[i];
    covered.set(file, all);
  }
}

const lines = new Map(); // source → Map(line → covered?)
for (const [file, all] of covered) {
  const code = readFileSync(file, 'utf8');
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  if (!existsSync(`${file}.map`)) continue; // (generated data, no source)
  const map = new SourceMapConsumer(JSON.parse(readFileSync(`${file}.map`, 'utf8')));
  map.eachMapping((m) => {
    if (!m.source) return;
    const src = m.source.replace(/^(\.\.\/)+/, '');
    if (!src.startsWith(only)) return;
    const off = starts[m.generatedLine - 1] + m.generatedColumn;
    const ls = lines.get(src) || new Map();
    ls.set(m.originalLine, (ls.get(m.originalLine) || false) || all[off] === 1);
    lines.set(src, ls);
  });
}

const rows = [...lines].map(([src, ls]) => {
  const miss = [...ls].filter(([, c]) => !c).map(([l]) => l).sort((a, b) => a - b);
  return { src, total: ls.size, miss };
}).sort((a, b) => b.miss.length - a.miss.length);
const ranges = (ns) => ns.reduce((out, n) => {
  const last = out.at(-1);
  if (last && n <= last[1] + 1) last[1] = n; else out.push([n, n]);
  return out;
}, []).map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(' ');
for (const r of rows) console.log(`${r.src}  ${(100 * (1 - r.miss.length / r.total)).toFixed(0)}% of ${r.total} lines\n  not run: ${ranges(r.miss)}`);
