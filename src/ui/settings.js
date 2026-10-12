import { store, save, flush, seedState, migrate } from '../store.js';
import { TRANSPOSITIONS, LISTEN_SERVICES } from '../constants.js';
import { dateStr, niceDate } from '../dates.js';
import { clone } from '../util.js';
import { buildPlan, refreshExercises, orderPlan } from '../plan.js';
import { loadSeedCharts } from '../charts.js';
import { mediaStats, fmtSize, strayClips, restoreStrayClips } from '../media.js';
import { addEntry } from '../diary.js';
import { getApiKey, setApiKey } from '../assistant/agent.js';
import { getUsage, summarize, resetUsage, fmtCost } from '../assistant/cost.js';
import { openKeySetup, openAssistant } from './assistant.js';
import { ICON, render, toast, goTo, openChoice } from './shell.js';
import { View, mount, html, nothing, live, raw, infoParts, settingRows } from './lit.js';

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
  mount(root, 'ws-settings');
}

// The Settings screen.
class SettingsView extends View {
  static properties = { key: { state: true }, usage: { state: true }, stray: { state: true } };

  constructor() {
    super();
    this.key = null; // the assistant's API key (null: still checking)
    this.usage = null; // what the assistant has cost
    this.stray = []; // recordings in no note
  }
  connectedCallback() {
    super.connectedCallback();
    this.load();
  }
  refresh() {
    super.refresh();
    this.load();
  }
  // What's kept outside the app's state.
  load() {
    getApiKey().then((k) => (this.key = k || ''));
    getUsage().then((u) => (this.usage = u));
    strayClips().then((ids) => (this.stray = ids));
  }

  render() {
    const s = store.state.settings;
    // A change to a setting: saved, and shown.
    const set = (k, v) => { s[k] = v; save(); this.requestUpdate(); };
    const stepper = (key, label, hint) => html`
      <div class="setting">
        <div><b>${label}</b><span>${hint}</span></div>
        <div class="stepper" data-key=${key}>
          <button data-d="-1" aria-label="Fewer" @click=${() => set(key, Math.max(0, s[key] - 1))}>−</button><output>${s[key]}</output><button data-d="1" aria-label="More" @click=${() => set(key, Math.min(8, s[key] + 1))}>+</button>
        </div>
      </div>`;
    const seg = (key, opts, after) => html`<div class="seg" data-setting=${key}>${opts.map(([v, l]) => html`
      <button class=${s[key] === v ? 'on' : ''} data-v=${v} @click=${() => { set(key, v); after?.(); }}>${l}</button>`)}</div>`;
    // A section's heading, with what it's about behind an ⓘ.
    const heading = (id, label, help) => {
      const h = infoParts(`info-settings-${id}`, help);
      return html`<h3 class="section-label">${label}${h.btn}</h3>${h.text}`;
    };
    const m = mediaStats(store.state);
    const wishes = store.state.assistantWishes || [];
    const spent = this.usage && Object.keys(this.usage.days).length ? summarize(this.usage) : null;

    return html`
      <header class="top"><div><p class="eyebrow">Woodshed</p><h1>Settings</h1></div></header>

      <section class="panel">
        ${heading('instruments', 'Instruments you play', 'Keys are shown for these. With more than one, tap the key circle (B♭, E♭…) at the top of Today, or <b>Keys in …</b> on Tunes, to switch.')}
        <ul class="instruments">${Object.entries(TRANSPOSITIONS).map(([id, tr]) => html`
          <li><label>
            <input type="checkbox" data-ins=${id} .checked=${live(s.instruments.includes(id))} @change=${(e) => this.toggleInstrument(id, e.target.checked)}>
            <span class="ins-name">${tr.label}${id === 'c' ? '' : ' instruments'}</span>
            <span class="ins-hint">${tr.hint}</span>
          </label></li>`)}</ul>
      </section>

      <section class="panel">
        ${heading('mix', 'Daily mix', 'Focus tunes and exercises come first, on top of this mix: up to these numbers a day, the ones played least recently first. Changes apply to tomorrow’s set, or tap <b>Rebuild today’s set</b>.')}
        ${stepper('exercises', 'Exercises', 'Scales, arpeggios, patterns, licks')}
        ${stepper('hone', 'Hone', 'Proficient & mastered tunes')}
        ${stepper('learn', 'Learn', 'Tunes you’re familiar with')}
        ${stepper('fresh', 'New', 'Tunes you don’t know yet')}
        ${stepper('focusTunes', 'Focus tunes', 'At most, a day; they take turns')}
        ${stepper('focusExercises', 'Focus exercises', 'At most, a day; they take turns')}
        <div class="setting"><div><b>Tune order</b><span>Mixed up each day, or hone, then learn, then new</span></div>
          ${seg('tuneOrder', [['mixed', 'Mixed'], ['group', 'By group']], () => {
            // The tune order applies to today's set straight away.
            if (store.state.plan?.date === dateStr()) { orderPlan(store.state.plan); save(); }
          })}</div>
        <button class="ghost-btn" id="rebuild" @click=${() => { buildPlan(true); goTo('today'); toast('Today’s set rebuilt'); }}>${raw(ICON.shuffle)}<span>Rebuild today’s set</span></button>
      </section>

      <section class="panel">
        <h3 class="section-label">Picking</h3>
        ${settingRows(Object.entries(CHOICES).map(([key, c]) => ({ key, label: c.label, value: c.options.find(([v]) => v === s[c.setting])?.[1] })), (key) => this.choose(key))}
      </section>

      <section class="panel">
        ${heading('listen', 'Open recordings in', 'Recording links in a tune’s details search this service for that recording.')}
        ${seg('listen', Object.entries(LISTEN_SERVICES).map(([v, x]) => [v, x.label]))}
      </section>

      <section class="panel">
        ${heading('assistant', 'Assistant', 'The assistant (Ask, on the Today screen) is Claude using your own key, which stays on this device and isn’t included in backups. API use is billed by Anthropic at standard per-token prices, separately from any Claude Pro or Max plan. Costs shown are worked out from the token counts each reply reports; your Anthropic console has the official figures.')}
        <div class="setting">
          <div><b>Anthropic API key</b><span id="key-status">${this.key == null ? 'Checking…' : this.key ? `Set (…${this.key.slice(-4)})` : 'Not set'}</span></div>
          <button class="pill-btn" id="key-btn" @click=${() => this.keyButton()}>${this.key ? 'Remove' : 'Set'}</button>
        </div>
        ${spent ? html`
          <div class="setting" id="spend">
            <div><b>Spent</b><span id="spend-text">Today ${fmtCost(spent.today)} · this month ${fmtCost(spent.month)} · ${fmtCost(spent.total)} since ${niceDate(spent.since, { month: 'short', day: 'numeric' })}</span></div>
            <button class="pill-btn" id="spend-reset" @click=${() => this.resetSpend()}>Reset</button>
          </div>` : nothing}
        ${wishes.length ? html`
          <div class="field-label">Things it couldn’t do yet</div>
          <ul class="wishes">${wishes.slice(-10).reverse().map((w) => html`<li><span>${w.request}</span><small>${w.date}</small></li>`)}</ul>` : nothing}
      </section>

      <section class="panel">
        <h3 class="section-label">Your data</h3>
        <p class="fine">Everything is stored on this device only. Export a backup now and then — and before switching phones.</p>
        ${m.count ? html`<p class="fine">Recordings: ${m.count} (${fmtSize(m.bytes)}). They aren’t included in backups — save the ones you want to keep from their diary notes.</p>` : nothing}
        ${this.stray.length ? html`
          <div id="stray">
            <p class="fine" id="stray-text">${this.stray.length} recording${this.stray.length > 1 ? 's aren’t' : ' isn’t'} in any note (from a deleted note, or one that didn’t get saved). ${this.stray.length > 1 ? 'They’re' : 'It’s'} kept for 30 days.</p>
            <button class="ghost-btn" id="stray-restore" @click=${(e) => this.restoreStray(e.currentTarget)}>Restore them as notes</button>
          </div>` : nothing}
        <div class="btn-row">
          <button class="ghost-btn" id="export" @click=${exportData}>Export backup</button>
          <label class="ghost-btn file-btn">Import backup<input type="file" id="import" accept="application/json,.json" @change=${importData}></label>
        </div>
        <button class="danger-btn" id="reset" @click=${resetAll}>Reset everything</button>
      </section>
    `;
  }

  toggleInstrument(id, on) {
    const s = store.state.settings;
    const picked = Object.keys(TRANSPOSITIONS).filter((x) => (x === id ? on : s.instruments.includes(x)));
    if (!picked.length) { toast('Pick at least one'); return this.requestUpdate(); } // (stays on)
    s.instruments = picked;
    s.instrumentsChosen = true;
    if (!picked.includes(s.view)) s.view = picked[0];
    save();
    this.requestUpdate();
  }
  // A less-used choice, picked in a sheet with what each option does.
  choose(key) {
    const s = store.state.settings;
    const c = CHOICES[key];
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
  }
  async keyButton() {
    if (!this.key) return openKeySetup(() => openAssistant());
    if (!confirm('Remove the API key from this device?')) return;
    await setApiKey('');
    this.load();
    toast('Key removed');
  }
  async resetSpend() {
    if (!confirm('Reset the assistant spending totals?')) return;
    await resetUsage();
    this.load();
  }
  // Recordings not in any note (kept 30 days before they're deleted): offered back.
  async restoreStray(btn) {
    btn.disabled = true; // (once)
    const n = await restoreStrayClips(addEntry);
    await flush();
    render();
    toast(`Restored ${n} recording${n === 1 ? '' : 's'} — they’re in the Diary`);
  }
}
customElements.define('ws-settings', SettingsView);

async function resetAll() {
  if (!confirm('Erase all practice history and edits, and start over from the original list?')) return;
  if (!confirm('Really? This can’t be undone (unless you have a backup).')) return;
  await loadSeedCharts();
  store.state = seedState();
  save();
  render();
  toast('Reset to the original list');
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
