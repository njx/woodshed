import { store } from '../store.js';
import { itemById } from '../practice.js';
import { warmupChoices } from '../warmups.js';
import { todayItem, addWarmup, addWarmups, tryWithTune, tunesToTry } from '../plan.js';
import { ICON, render, toast, closeSheet, kn, overLabel } from './shell.js';
import { exerciseKeysText, rootName } from './exercise.js';
import { customElement, property, state } from 'lit/decorators.js';
import { View, html, nothing, raw, openSheetView, type TemplateResult } from './lit.js';
import type { Exercise, PlanItem, Tune } from '../types.js';

// Picking what goes with what: a warm-up for a tune, or a tune to take an exercise through.

interface Row { name: string; sub?: string; hidden?: boolean; pick: () => void }
const row = (r: Row, i: number) => html`<li class="row" data-pick=${i} role="button" tabindex="0" ?hidden=${r.hidden} @click=${r.pick}>
  <div class="row-main"><b>${r.name}</b>${r.sub ? html`<span class="row-sub">${r.sub}</span>` : nothing}</div></li>`;
// Groups of rows under their headings (numbered across groups); an empty group isn't shown.
function groups(list: { label: string; rows: Row[] }[], { labels = true } = {}): TemplateResult[] {
  let n = 0;
  return list.filter((g) => g.rows.length).map((g) => html`
    <h3 class="section-label" ?hidden=${!labels}>${g.label}</h3><ul class="list pick-list">${g.rows.map((r) => row(r, n++))}</ul>`);
}

// How a warm-up goes: "Over ii–V7–I in B♭", "iiø–V7–i in G", "Gm6 · Aø7 · D7", "Through the form".
// (A warm-up has its keys, see warmupChoices.)
function how(it: PlanItem, x: Exercise) {
  if (it.form) return 'Through the form';
  if (it.prog) return `${it.prog.name} in ${rootName(it.keys![0])}`;
  if (it.over) return `Over ${overLabel(it.over)}${it.overKey != null ? ` in ${kn(it.overKey)}` : ''}${it.keys!.length > 1 ? ` — in ${it.keys!.map(rootName).join(', then ')}` : ''}`;
  return exerciseKeysText(it.keys!, x, it.types);
}

// A warm-up for tune t, picked from all that could go before it (+ Warm-up, Add a warm-up).
export function pickWarmup(t: Tune, { back }: { back?: () => void } = {}): void {
  const plan = store.state.plan;
  const key = todayItem(t)?.key ?? null;
  const have = plan?.date ? plan.items.filter((i) => i.warmup === t.id) : [];
  const choices = warmupChoices(t, { key, have });
  if (!choices.changes.length && !choices.chords.length && !choices.form.length) return toast(`No more warm-ups for ${t.name}`);
  const el = document.createElement('ws-pick-warmup') as PickWarmup;
  Object.assign(el, { tune: t, choices });
  openSheetView(el, () => back?.());
}

@customElement('ws-pick-warmup')
export class PickWarmup extends View {
  @property({ attribute: false }) tune!: Tune;
  @property({ attribute: false }) choices!: ReturnType<typeof warmupChoices>;

  render() {
    const t = this.tune;
    const rows = (list: PlanItem[]): Row[] => list.map((it) => {
      const x = itemById(it.itemId) as Exercise; // (warm-ups are exercises)
      return { name: x.name, sub: how(it, x), pick: () => {
        addWarmup(t, it);
        closeSheet();
        render();
        toast(`Added ${x.name} before ${t.name}`);
      } };
    });
    return html`
      <p class="eyebrow">Warm up for ${t.name}</p>
      <h2 class="sheet-title">Pick a warm-up</h2>
      <button class="ghost-btn" id="pick-for-me" @click=${() => this.pickForMe()}>${raw(ICON.shuffle)}<span>Pick for me</span></button>
      ${groups([
        { label: 'Over its changes', rows: rows(this.choices.changes) },
        { label: 'On its chords', rows: rows(this.choices.chords) },
        { label: 'Through the form — bend it to the changes', rows: rows(this.choices.form) },
      ])}`;
  }
  // The next one, as + Warm-up used to add straight away: taking turns between something over
  // its changes and something on its chords.
  pickForMe() {
    const t = this.tune;
    const before = new Set(store.state.plan?.items.map((i) => i.pid));
    const n = addWarmups(t);
    closeSheet();
    render();
    const added = store.state.plan!.items.find((i) => !before.has(i.pid) && i.warmup === t.id);
    if (!n || !added) return toast(`No more warm-ups for ${t.name}`);
    toast(`Added ${itemById(added.itemId)?.name} before ${t.name}`);
  }
}

// A tune to take exercise x through (Try it through a tune), with a search.
export function pickTune(x: Exercise, { back }: { back?: () => void } = {}): void {
  const tunes = tunesToTry(x);
  if (!Object.values(tunes).some((l) => l.length)) { toast('No tune with a chart to try it with'); return back?.(); }
  const el = document.createElement('ws-pick-tune') as PickTune;
  Object.assign(el, { exercise: x, tunes });
  openSheetView(el, () => back?.());
}

@customElement('ws-pick-tune')
export class PickTune extends View {
  @property({ attribute: false }) exercise!: Exercise;
  @property({ attribute: false }) tunes!: ReturnType<typeof tunesToTry>;
  @state() query = '';

  render() {
    const x = this.exercise;
    const q = this.query.trim().toLowerCase();
    const rows = (list: Tune[]): Row[] => list.map((t) => ({
      name: t.name, sub: t.style || '', hidden: !!q && !t.name.toLowerCase().includes(q),
      pick: () => {
        const added = tryWithTune(x, t);
        closeSheet();
        render();
        if (added) toast(`Added ${added.name} to today’s set, with ${x.name} before it`);
      },
    }));
    const { today, fit, known, other } = this.tunes;
    return html`
      <p class="eyebrow">Try ${x.name} through a tune</p>
      <h2 class="sheet-title">Pick a tune</h2>
      <input class="pick-search" id="pick-q" type="search" placeholder="Search tunes" autocomplete="off" aria-label="Search tunes"
        @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}>
      <div id="pick-groups">${groups([
        { label: 'In today’s set', rows: rows(today) },
        { label: 'Its chords fit', rows: rows(fit) },
        { label: 'Tunes you know', rows: rows(known) },
        { label: 'Others', rows: rows(other) },
      ], { labels: !q })}</div>`;
  }
}
