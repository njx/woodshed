import { store, save, flush, seedState, migrate, SCHEMA_VERSION, keepCopy, listCopies, restoreCopy, type CopyInfo } from '../store.js';
import { TRANSPOSITIONS, LISTEN_SERVICES } from '../constants.js';
import { dateStr, niceDate } from '../dates.js';
import { clone } from '../util.js';
import { loadSeedCharts } from '../charts.js';
import { mediaStats, fmtSize, strayClips, restoreStrayClips } from '../media.js';
import { addEntry } from '../diary.js';
import { getApiKey, setApiKey } from '../assistant/agent.js';
import { getUsage, summarize, resetUsage, fmtCost, type Usage } from '../assistant/cost.js';
import { openKeySetup, openAssistant } from './assistant.js';
import { openMicTest } from './mictest.js';
import { ICON, render, toast, goTo, closeSheet, perform } from './shell.js';
import * as cmd from '../commands/index.js';
import { customElement, state } from 'lit/decorators.js';
import { View, mount, html, nothing, live, raw, settingRows, segButtons, stepperButtons, openSheetView } from './lit.js';
import type { ListenService, Settings, Transposition } from '../types.js';

// The settings changed with a stepper, with a choice in a sheet, and with a segmented control.
type CountKey = 'exercises' | 'hone' | 'learn' | 'fresh' | 'focusTunes' | 'focusExercises';
type ChoiceKey = 'exerciseFocus' | 'priority' | 'newKeys';
type SegKey = 'tuneOrder' | 'listen';
// Their names in change_settings (see commands/settings.ts).
const SNAKE: Record<CountKey | ChoiceKey | SegKey, string> = {
  exercises: 'exercises', hone: 'hone', learn: 'learn', fresh: 'fresh', focusTunes: 'focus_tunes', focusExercises: 'focus_exercises',
  exerciseFocus: 'exercise_focus', priority: 'priority', newKeys: 'new_keys', tuneOrder: 'tune_order', listen: 'listen',
};
interface Choice<K extends ChoiceKey> {
  setting: K; label: string; title: string; help?: string;
  options: [value: Settings[K], label: string, hint?: string][];
  after?: () => void;
}

const EX_FOCUS_HINTS = {
  own: 'Each exercise picks its own keys (and scale or chord types).',
  day: 'One or two keys of the day — weak keys come up more — for every exercise that picks keys by weak keys or at random.',
};

// Less-used choices: a row each in Settings, picked in a sheet.
const CHOICES: { [K in ChoiceKey]: Choice<K> } = {
  exerciseFocus: {
    setting: 'exerciseFocus', label: 'Exercises on a day', title: 'Exercises on a day',
    options: [['own', 'Each its own', EX_FOCUS_HINTS.own], ['day', 'Key of the day', EX_FOCUS_HINTS.day]],
    after: () => toast('Today’s exercises picked again'), // (see change_settings)
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

// A sheet to pick one option, with what the setting does. Picking closes it.
interface ChoiceOpts {
  title: string;
  help?: string;
  options: [value: string, label: string, hint?: string][];
  value: string | null | undefined;
  onPick: (value: string) => void;
}
function openChoice(opts: ChoiceOpts): void {
  const el = document.createElement('ws-choice') as ChoiceSheet;
  el.opts = opts;
  openSheetView(el);
}
@customElement('ws-choice')
export class ChoiceSheet extends View {
  opts!: ChoiceOpts;
  render() {
    const { title, help, options, value, onPick } = this.opts;
    return html`
      <p class="eyebrow">Settings</p>
      <h2 class="sheet-title">${title}</h2>
      ${help ? html`<p class="fine">${raw(help)}</p>` : nothing}
      <div class="set-list choice-list" role="radiogroup">${options.map(([v, label, hint]) => html`
        <button class="set-row ${v === value ? 'on' : ''}" role="radio" aria-checked=${String(v === value)} data-pick=${v} @click=${() => { closeSheet(); onPick(v); }}>
          <span class="set-label">${label}${hint ? html`<small>${hint}</small>` : nothing}</span><span class="set-check" aria-hidden="true">${v === value ? '✓' : ''}</span></button>`)}</div>`;
  }
}

export function renderSettings(root: HTMLElement): void {
  mount(root, 'ws-settings');
}

// The Settings screen.
@customElement('ws-settings')
export class SettingsView extends View {
  @state() key: string | null = null; // the assistant's API key (null: still checking)
  @state() usage: Usage | null = null; // what the assistant has cost
  @state() stray: string[] = []; // recordings in no note
  @state() copies: CopyInfo[] = []; // earlier copies of the data (see keepCopy)
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
    listCopies().then((c) => (this.copies = c)).catch(() => {});
  }

  render() {
    const s = store.state.settings;
    // A change to a setting: saved, and shown.
    const set = <K extends CountKey | SegKey>(k: K, v: Settings[K]) => { perform(cmd.changeSettings, { [SNAKE[k]]: v }); this.requestUpdate(); };
    const stepper = (key: CountKey, label: string, hint: string) => html`
      <div class="setting">
        <div><b>${label}</b><span>${hint}</span></div>
        <div class="stepper" data-key=${key}>${stepperButtons(s[key], (v) => set(key, v), 0, 8)}</div>
      </div>`;
    const seg = <K extends SegKey>(key: K, opts: [Settings[K], string][], after?: () => void) =>
      html`<div class="seg" data-setting=${key}>${segButtons(opts, s[key], (v) => { set(key, v); after?.(); })}</div>`;
    const m = mediaStats(store.state);
    const wishes = store.state.assistantWishes || [];
    const spent = this.usage && Object.keys(this.usage.days).length ? summarize(this.usage) : null;

    return html`
      <header class="top"><div><p class="eyebrow">Woodshed</p><h1>Settings</h1></div></header>

      <section class="panel">
        <ws-heading label="Instruments you play" help="Keys are shown for these. With more than one, tap the key circle (B♭, E♭…) at the top of Today, or <b>Keys in …</b> on Tunes, to switch."></ws-heading>
        <ul class="instruments">${(Object.entries(TRANSPOSITIONS) as [Transposition, (typeof TRANSPOSITIONS)[Transposition]][]).map(([id, tr]) => html`
          <li><label>
            <input type="checkbox" data-ins=${id} .checked=${live(s.instruments.includes(id))} @change=${(e: Event) => this.toggleInstrument(id, (e.target as HTMLInputElement).checked)}>
            <span class="ins-name">${tr.label}${id === 'c' ? '' : ' instruments'}</span>
            <span class="ins-hint">${tr.hint}</span>
          </label></li>`)}</ul>
      </section>

      <section class="panel">
        <ws-heading label="Daily mix" help="Focus tunes and exercises come first, on top of this mix: up to these numbers a day, the ones played least recently first. Changes apply to tomorrow’s set, or tap <b>Rebuild today’s set</b>."></ws-heading>
        ${stepper('exercises', 'Exercises', 'Scales, arpeggios, patterns, licks')}
        ${stepper('hone', 'Hone', 'Proficient & mastered tunes')}
        ${stepper('learn', 'Learn', 'Tunes you’re familiar with')}
        ${stepper('fresh', 'New', 'Tunes you don’t know yet')}
        ${stepper('focusTunes', 'Focus tunes', 'At most, a day; they take turns')}
        ${stepper('focusExercises', 'Focus exercises', 'At most, a day; they take turns')}
        <div class="setting"><div><b>Tune order</b><span>Mixed up each day, or hone, then learn, then new</span></div>
          ${seg('tuneOrder', [['mixed', 'Mixed'], ['group', 'By group']])}</div>
        <button class="ghost-btn" id="rebuild" @click=${() => { if (perform(cmd.newSet, {}, { quiet: true })) { goTo('today'); toast('Today’s set rebuilt'); } }}>${raw(ICON.shuffle)}<span>Rebuild today’s set</span></button>
      </section>

      <section class="panel">
        <h3 class="section-label">Picking</h3>
        ${settingRows(Object.entries(CHOICES).map(([key, c]) => ({ key, label: c.label, value: c.options.find(([v]) => v === s[c.setting])?.[1] })), (key) => this.choose(key as ChoiceKey))}
      </section>

      <section class="panel">
        <ws-heading label="Open recordings in" help="Recording links in a tune’s details search this service for that recording."></ws-heading>
        ${seg('listen', (Object.entries(LISTEN_SERVICES) as [ListenService, { label: string }][]).map(([v, x]) => [v, x.label]))}
      </section>

      <section class="panel">
        <ws-heading label="Assistant" help="The assistant (Ask, on the Today screen) is Claude using your own key, which stays on this device and isn’t included in backups. API use is billed by Anthropic at standard per-token prices, separately from any Claude Pro or Max plan. Costs shown are worked out from the token counts each reply reports; your Anthropic console has the official figures."></ws-heading>
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
        <ws-heading label="Microphone" help="If an external mic (a USB mic, say) misbehaves when the tuner or recorder listens — its own headphone monitoring stops, or it isn’t heard — the mic test opens it in different ways to find out why."></ws-heading>
        <button class="ghost-btn" id="mic-test" @click=${() => openMicTest()}>Mic test</button>
      </section>

      <section class="panel">
        <h3 class="section-label">Your data</h3>
        <p class="fine">Everything is stored on this device only. Export a backup now and then — and before switching phones.</p>
        ${m.count ? html`<p class="fine">Recordings: ${m.count} (${fmtSize(m.bytes)}). They aren’t included in backups — save the ones you want to keep from their diary notes.</p>` : nothing}
        ${this.stray.length ? html`
          <div id="stray">
            <p class="fine" id="stray-text">${this.stray.length} recording${this.stray.length > 1 ? 's aren’t' : ' isn’t'} in any note (from a deleted note, or one that didn’t get saved). ${this.stray.length > 1 ? 'They’re' : 'It’s'} kept for 30 days.</p>
            <button class="ghost-btn" id="stray-restore" @click=${(e: Event) => this.restoreStray(e.currentTarget as HTMLButtonElement)}>Restore them as notes</button>
          </div>` : nothing}
        <div class="btn-row">
          <button class="ghost-btn" id="export" @click=${exportData}>Export backup</button>
          <label class="ghost-btn file-btn">Import backup<input type="file" id="import" accept="application/json,.json" @change=${importData}></label>
        </div>
        ${this.copies.length ? html`
          <div class="field-label">Earlier copies</div>
          <p class="fine">Kept on this device before the data was replaced or upgraded, in case something went wrong.</p>
          <ul class="copies" id="copies">${this.copies.map((c) => html`
            <li><span><b>${c.reason}</b><small>${new Date(c.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${c.items} tunes and exercises, ${c.log} sessions</small></span>
              <button class="link-btn" data-copy=${c.at} @click=${() => this.putBack(c)}>Put back</button></li>`)}</ul>` : nothing}
        <button class="danger-btn" id="reset" @click=${resetAll}>Reset everything</button>
      </section>
    `;
  }

  toggleInstrument(id: Transposition, on: boolean) {
    const s = store.state.settings;
    const picked = (Object.keys(TRANSPOSITIONS) as Transposition[]).filter((x) => (x === id ? on : s.instruments.includes(x)));
    if (perform(cmd.changeSettings, { instruments: picked })) { s.instrumentsChosen = true; save(); } // (none: it says so, and stays on)
    this.requestUpdate();
  }
  // A less-used choice, picked in a sheet with what each option does.
  choose<K extends ChoiceKey>(key: K) {
    const s = store.state.settings;
    const c: Choice<K> = CHOICES[key];
    openChoice({
      title: c.title, help: c.help, options: c.options, value: s[c.setting],
      onPick: (v) => {
        if (s[c.setting] === v) return;
        if (perform(cmd.changeSettings, { [SNAKE[key]]: v })) c.after?.(); // (one of its options)
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
  async putBack(c: CopyInfo) {
    if (!confirm(`Put back this copy (${c.reason.toLowerCase()})? What’s here now is kept as a copy too.`)) return;
    try {
      await loadSeedCharts(); // (an old copy's tunes may need their charts)
      if (!(await restoreCopy(c.at))) return toast('That copy isn’t there any more');
    } catch (err) {
      return toast((err as Error).message === 'newer' ? 'That copy is from a newer Woodshed: close and reopen the app to update it, then put it back' : 'Couldn’t put that copy back');
    }
    cmd.invalidateUndo();
    await flush();
    render();
    this.load();
    toast('Earlier copy put back');
  }
  // Recordings not in any note (kept 30 days before they're deleted): offered back.
  async restoreStray(btn: HTMLButtonElement) {
    btn.disabled = true; // (once)
    const n = await restoreStrayClips(addEntry);
    cmd.dataChanged();
    await flush();
    render();
    toast(`Restored ${n} recording${n === 1 ? '' : 's'} — they’re in the Diary`);
  }
}

async function resetAll() {
  if (!confirm('Erase all practice history and edits, and start over from the original list?')) return;
  if (!confirm('Really? (A copy of what’s here now is kept, under Earlier copies.)')) return;
  await loadSeedCharts();
  await keepCopy('Before reset').catch(() => {});
  store.state = seedState();
  save();
  cmd.invalidateUndo();
  render();
  toast('Reset to the original list');
}

async function exportData() {
  await flush();
  const json = JSON.stringify({ app: 'woodshed', exported: new Date().toISOString(), ...store.state }, null, 1);
  const name = `woodshed-backup-${dateStr()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Woodshed backup' }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text()); // (any: checked below, and by migrate)
    const items = data.items || data.tunes; // backups from the first version have "tunes"
    if (!Array.isArray(items) || !Array.isArray(data.log)) throw new Error('not a backup');
    if ((data.version || 1) > SCHEMA_VERSION) return toast('That backup is from a newer Woodshed: close and reopen the app to update it, then restore');
    if (!confirm(`Replace current data with this backup (${items.length} tunes, ${data.log.length} log entries)?`)) return;
    delete data.app;
    delete data.exported;
    // Recordings aren't in backups, and clips nothing refers to are deleted at startup: keep the
    // notes that hold this phone's recordings unless the backup has them too.
    const backupIds = new Set((data.diary || []).map((e: any) => e?.id)); // (the backup's notes, unchecked)
    const keep = store.state.diary.filter((e) => e.media?.length && !backupIds.has(e.id));
    data.diary = [...(data.diary || []), ...clone(keep)];
    await loadSeedCharts(); // older backups' tunes get charts
    await keepCopy('Before restoring a backup').catch(() => {});
    store.state = migrate(data);
    save();
    cmd.invalidateUndo();
    render();
    toast(keep.length ? `Backup restored — kept ${keep.length} note${keep.length > 1 ? 's' : ''} with recordings` : 'Backup restored');
  } catch {
    toast('That file doesn’t look like a Woodshed backup');
  }
}
