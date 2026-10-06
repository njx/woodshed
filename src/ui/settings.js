import { store, save, flush, seedState, migrate } from '../store.js';
import { TRANSPOSITIONS, LISTEN_SERVICES } from '../constants.js';
import { dateStr } from '../dates.js';
import { esc } from '../util.js';
import { buildPlan } from '../plan.js';
import { mediaStats, fmtSize } from '../media.js';
import { $, $$, ICON, render, toast, goTo } from './shell.js';

export function renderSettings(root) {
  const s = store.state.settings;
  const stepper = (key, label, hint) => `
    <div class="setting">
      <div><b>${label}</b><span>${hint}</span></div>
      <div class="stepper" data-key="${key}">
        <button data-d="-1" aria-label="Fewer">−</button><output>${s[key]}</output><button data-d="1" aria-label="More">+</button>
      </div>
    </div>`;
  const seg = (key, opts) => `<div class="seg" data-setting="${key}">${opts.map(([v, l]) => `<button class="${s[key] === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;

  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Woodshed</p><h1>Settings</h1></div></header>

    <section class="panel">
      <h3 class="section-label">Instruments you play</h3>
      <p class="fine">Keys are shown for these. With more than one, tap <b>Keys in …</b> on the Today screen to switch.</p>
      <ul class="instruments">${Object.entries(TRANSPOSITIONS).map(([id, tr]) => `
        <li><label>
          <input type="checkbox" data-ins="${id}" ${s.instruments.includes(id) ? 'checked' : ''}>
          <span class="ins-name">${esc(tr.label)}${id === 'c' ? '' : ' instruments'}</span>
          <span class="ins-hint">${esc(tr.hint)}</span>
        </label></li>`).join('')}</ul>
    </section>

    <section class="panel">
      <h3 class="section-label">Daily mix</h3>
      ${stepper('hone', 'Hone', 'Proficient & mastered tunes')}
      ${stepper('learn', 'Learn', 'Tunes you’re familiar with')}
      ${stepper('fresh', 'New', 'Tunes you don’t know yet')}
      <p class="fine">Focus tunes come on top of this mix, every day. Changes apply to tomorrow’s set, or tap <b>Rebuild today’s set</b>.</p>
      <button class="ghost-btn" id="rebuild">${ICON.shuffle}<span>Rebuild today’s set</span></button>
    </section>

    <section class="panel">
      <h3 class="section-label">How much should priority matter?</h3>
      ${seg('priority', [['off', 'Not at all'], ['some', 'Some'], ['strong', 'A lot']])}
      <p class="fine">Tunes are picked mostly by when they’re due for review. Each time you play one and rate it, its next review is pushed further out — “Solid” pushes it further, “Rough” brings it back tomorrow. Priority tips the balance among tunes that are due.</p>
    </section>

    <section class="panel">
      <h3 class="section-label">Practice in other keys for</h3>
      ${seg('newKeys', [['mastered', 'Mastered'], ['proficient', 'Proficient +'], ['never', 'Never']])}
      <p class="fine">Other tunes rotate through their usual keys. Keys you’ve practiced less come up first.</p>
    </section>

    <section class="panel">
      <h3 class="section-label">Open recordings in</h3>
      ${seg('listen', Object.entries(LISTEN_SERVICES).map(([v, x]) => [v, x.label]))}
      <p class="fine">Recording links in a tune’s details search this service for that recording.</p>
    </section>

    <section class="panel">
      <h3 class="section-label">Your data</h3>
      <p class="fine">Everything is stored on this device only. Export a backup now and then — and before switching phones.</p>
      ${(() => {
        const m = mediaStats(store.state);
        return m.count ? `<p class="fine">Recordings: ${m.count} (${fmtSize(m.bytes)}). They aren’t included in backups — save the ones you want to keep from their diary notes.</p>` : '';
      })()}
      <div class="btn-row">
        <button class="ghost-btn" id="export">Export backup</button>
        <label class="ghost-btn file-btn">Import backup<input type="file" id="import" accept="application/json,.json"></label>
      </div>
      <button class="danger-btn" id="reset">Reset everything</button>
    </section>
  `;

  $$('[data-ins]', root).forEach((cb) => (cb.onchange = () => {
    const picked = $$('[data-ins]', root).filter((x) => x.checked).map((x) => x.dataset.ins);
    if (!picked.length) { cb.checked = true; return toast('Pick at least one'); }
    s.instruments = picked;
    s.instrumentsChosen = true;
    if (!picked.includes(s.view)) s.view = picked[0];
    save();
  }));
  $$('.stepper', root).forEach((st) => {
    st.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const k = st.dataset.key;
      s[k] = Math.max(0, Math.min(8, s[k] + Number(b.dataset.d)));
      $('output', st).textContent = s[k];
      save();
    };
  });
  $$('.seg[data-setting]', root).forEach((sg) => {
    sg.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      s[sg.dataset.setting] = b.dataset.v;
      $$('button', sg).forEach((x) => x.classList.toggle('on', x === b));
      save();
    };
  });
  $('#rebuild').onclick = () => {
    buildPlan(true);
    goTo('today');
    toast('Today’s set rebuilt');
  };
  $('#export').onclick = exportData;
  $('#import').onchange = importData;
  $('#reset').onclick = () => {
    if (!confirm('Erase all practice history and edits, and start over from the original list?')) return;
    if (!confirm('Really? This can’t be undone (unless you have a backup).')) return;
    store.state = seedState();
    save();
    render();
    toast('Reset to the original list');
  };
}

async function exportData() {
  await flush();
  const json = JSON.stringify({ app: 'woodshed', exported: new Date().toISOString(), ...store.state }, null, 1);
  const name = `woodshed-backup-${dateStr()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Woodshed backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const items = data.items || data.tunes; // backups from the first version have "tunes"
    if (!Array.isArray(items) || !Array.isArray(data.log)) throw new Error('not a backup');
    if (!confirm(`Replace current data with this backup (${items.length} tunes, ${data.log.length} log entries)?`)) return;
    delete data.app;
    delete data.exported;
    store.state = migrate(data);
    save();
    render();
    toast('Backup restored');
  } catch {
    toast('That file doesn’t look like a Woodshed backup');
  }
}
