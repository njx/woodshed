import { store, save, flush, seedState, migrate } from '../store.js';
import { TRANSPOSITIONS, LISTEN_SERVICES } from '../constants.js';
import { dateStr, niceDate } from '../dates.js';
import { esc, clone } from '../util.js';
import { buildPlan, refreshExercises, orderPlan } from '../plan.js';
import { loadSeedCharts } from '../charts.js';
import { mediaStats, fmtSize, strayClips, restoreStrayClips } from '../media.js';
import { addEntry } from '../diary.js';
import { getApiKey, setApiKey } from '../assistant/agent.js';
import { getUsage, summarize, resetUsage, fmtCost } from '../assistant/cost.js';
import { openKeySetup, openAssistant } from './assistant.js';
import { $, $$, ICON, render, toast, goTo, info, settingRowsHtml, openChoice } from './shell.js';

const EX_FOCUS_HINTS = {
  own: 'Each exercise picks its own keys (and scale or chord types).',
  day: 'One or two keys of the day — weak keys come up more — for every exercise that picks keys by weak keys or at random.',
};

// Less-used choices: a row each in Settings, picked in a sheet.
const CHOICES = {
  exerciseFocus: {
    setting: 'exerciseFocus', label: 'Exercises on a day', title: 'Exercises on a day',
    options: [['own', 'Each its own', EX_FOCUS_HINTS.own], ['day', 'Key of the day', EX_FOCUS_HINTS.day]],
    after: () => { refreshExercises(); toast('Today’s exercises picked again'); },
  },
  priority: {
    setting: 'priority', label: 'Priority matters', title: 'How much should priority matter?',
    help: 'Tunes are picked mostly by when they’re due for review. Each time you play one and rate it, its next review is pushed further out — “Solid” pushes it further, “Rough” brings it back tomorrow. Priority tips the balance among tunes that are due.',
    options: [['off', 'Not at all'], ['some', 'Some'], ['strong', 'A lot']],
  },
  newKeys: {
    setting: 'newKeys', label: 'Other keys for', title: 'Practice in other keys for',
    help: 'Other tunes rotate through their usual keys. Keys you’ve practiced less come up first.',
    options: [['mastered', 'Mastered tunes'], ['proficient', 'Proficient and mastered'], ['never', 'Never']],
  },
};

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

  // A section's heading, with what it's about behind an ⓘ.
  const heading = (label, help) => {
    const h = info(help);
    return `<h3 class="section-label">${label}${h.btn}</h3>${h.text}`;
  };

  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Woodshed</p><h1>Settings</h1></div></header>

    <section class="panel">
      ${heading('Instruments you play', 'Keys are shown for these. With more than one, tap the key circle (B♭, E♭…) at the top of Today, or <b>Keys in …</b> on Tunes, to switch.')}
      <ul class="instruments">${Object.entries(TRANSPOSITIONS).map(([id, tr]) => `
        <li><label>
          <input type="checkbox" data-ins="${id}" ${s.instruments.includes(id) ? 'checked' : ''}>
          <span class="ins-name">${esc(tr.label)}${id === 'c' ? '' : ' instruments'}</span>
          <span class="ins-hint">${esc(tr.hint)}</span>
        </label></li>`).join('')}</ul>
    </section>

    <section class="panel">
      ${heading('Daily mix', 'Focus tunes and exercises come first, on top of this mix: up to these numbers a day, the ones played least recently first. Changes apply to tomorrow’s set, or tap <b>Rebuild today’s set</b>.')}
      ${stepper('exercises', 'Exercises', 'Scales, arpeggios, patterns, licks')}
      ${stepper('hone', 'Hone', 'Proficient & mastered tunes')}
      ${stepper('learn', 'Learn', 'Tunes you’re familiar with')}
      ${stepper('fresh', 'New', 'Tunes you don’t know yet')}
      ${stepper('focusTunes', 'Focus tunes', 'At most, a day; they take turns')}
      ${stepper('focusExercises', 'Focus exercises', 'At most, a day; they take turns')}
      <div class="setting"><div><b>Tune order</b><span>Mixed up each day, or hone, then learn, then new</span></div>
        ${seg('tuneOrder', [['mixed', 'Mixed'], ['group', 'By group']])}</div>
      <button class="ghost-btn" id="rebuild">${ICON.shuffle}<span>Rebuild today’s set</span></button>
    </section>

    <section class="panel">
      <h3 class="section-label">Picking</h3>
      ${settingRowsHtml(Object.entries(CHOICES).map(([key, c]) => ({ key, label: c.label, value: c.options.find(([v]) => v === s[c.setting])?.[1] })))}
    </section>

    <section class="panel">
      ${heading('Open recordings in', 'Recording links in a tune’s details search this service for that recording.')}
      ${seg('listen', Object.entries(LISTEN_SERVICES).map(([v, x]) => [v, x.label]))}
    </section>

    <section class="panel">
      ${heading('Assistant', 'The assistant (Ask, on the Today screen) is Claude using your own key, which stays on this device and isn’t included in backups. API use is billed by Anthropic at standard per-token prices, separately from any Claude Pro or Max plan. Costs shown are worked out from the token counts each reply reports; your Anthropic console has the official figures.')}
      <div class="setting">
        <div><b>Anthropic API key</b><span id="key-status">Checking…</span></div>
        <button class="pill-btn" id="key-btn">Set</button>
      </div>
      <div class="setting" id="spend" hidden>
        <div><b>Spent</b><span id="spend-text"></span></div>
        <button class="pill-btn" id="spend-reset">Reset</button>
      </div>
      ${(store.state.assistantWishes || []).length ? `
        <div class="field-label">Things it couldn’t do yet</div>
        <ul class="wishes">${store.state.assistantWishes.slice(-10).reverse().map((w) => `<li><span>${esc(w.request)}</span><small>${esc(w.date)}</small></li>`).join('')}</ul>` : ''}
    </section>

    <section class="panel">
      <h3 class="section-label">Your data</h3>
      <p class="fine">Everything is stored on this device only. Export a backup now and then — and before switching phones.</p>
      ${(() => {
        const m = mediaStats(store.state);
        return m.count ? `<p class="fine">Recordings: ${m.count} (${fmtSize(m.bytes)}). They aren’t included in backups — save the ones you want to keep from their diary notes.</p>` : '';
      })()}
      <div id="stray" hidden><p class="fine" id="stray-text"></p><button class="ghost-btn" id="stray-restore">Restore them as notes</button></div>
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
      // The tune order applies to today's set straight away.
      if (sg.dataset.setting === 'tuneOrder' && store.state.plan?.date === dateStr()) orderPlan(store.state.plan);
      save();
    };
  });
  // Rows for the less-used choices, each picked in a sheet with what it does.
  $$('[data-open]', root).forEach((row) => (row.onclick = () => {
    const c = CHOICES[row.dataset.open];
    openChoice({
      title: c.title, help: c.help, options: c.options, value: s[c.setting],
      onPick: (v) => {
        if (s[c.setting] === v) return;
        s[c.setting] = v;
        save();
        c.after?.();
        render();
      },
    });
  }));
  $('#rebuild').onclick = () => {
    buildPlan(true);
    goTo('today');
    toast('Today’s set rebuilt');
  };
  getApiKey().then((k) => {
    const status = $('#key-status', root);
    const btn = $('#key-btn', root);
    if (!status) return;
    status.textContent = k ? `Set (…${k.slice(-4)})` : 'Not set';
    btn.textContent = k ? 'Remove' : 'Set';
    btn.onclick = async () => {
      if (!k) return openKeySetup(() => openAssistant());
      if (!confirm('Remove the API key from this device?')) return;
      await setApiKey('');
      render();
      toast('Key removed');
    };
  });
  getUsage().then((u) => {
    const box = $('#spend', root);
    if (!box || !Object.keys(u.days).length) return;
    const t = summarize(u);
    box.hidden = false;
    $('#spend-text', root).textContent = `Today ${fmtCost(t.today)} · this month ${fmtCost(t.month)} · ${fmtCost(t.total)} since ${niceDate(t.since, { month: 'short', day: 'numeric' })}`;
    $('#spend-reset', root).onclick = async () => {
      if (!confirm('Reset the assistant spending totals?')) return;
      await resetUsage();
      render();
    };
  });
  // Recordings not in any note (kept 30 days before they're deleted): offered back.
  strayClips().then((ids) => {
    const box = $('#stray', root);
    if (!box || !ids.length) return;
    box.hidden = false;
    $('#stray-text', root).textContent = `${ids.length} recording${ids.length > 1 ? 's aren’t' : ' isn’t'} in any note (from a deleted note, or one that didn’t get saved). ${ids.length > 1 ? 'They’re' : 'It’s'} kept for 30 days.`;
    $('#stray-restore', root).onclick = async (e) => {
      e.currentTarget.disabled = true; // (once)
      const n = await restoreStrayClips(addEntry);
      await flush();
      render();
      toast(`Restored ${n} recording${n === 1 ? '' : 's'} — they’re in the Diary`);
    };
  });
  $('#export').onclick = exportData;
  $('#import').onchange = importData;
  $('#reset').onclick = async () => {
    if (!confirm('Erase all practice history and edits, and start over from the original list?')) return;
    if (!confirm('Really? This can’t be undone (unless you have a backup).')) return;
    await loadSeedCharts();
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
    // Recordings aren't in backups, and clips nothing refers to are deleted at startup: keep the
    // notes that hold this phone's recordings unless the backup has them too.
    const backupIds = new Set((data.diary || []).map((e) => e?.id));
    const keep = store.state.diary.filter((e) => e.media?.length && !backupIds.has(e.id));
    data.diary = [...(data.diary || []), ...clone(keep)];
    await loadSeedCharts(); // older backups' tunes get charts
    store.state = migrate(data);
    save();
    render();
    toast(keep.length ? `Backup restored — kept ${keep.length} note${keep.length > 1 ? 's' : ''} with recordings` : 'Backup restored');
  } catch {
    toast('That file doesn’t look like a Woodshed backup');
  }
}
