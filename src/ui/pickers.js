import { store } from '../store.js';
import { esc } from '../util.js';
import { itemById } from '../practice.js';
import { warmupChoices } from '../warmups.js';
import { todayItem, addWarmup, tryWithTune, tunesToTry } from '../plan.js';
import { $, $$, render, toast, openSheet, closeSheet, kn } from './shell.js';
import { exerciseKeysText, rootName } from './exercise.js';

// Picking what goes with what: a warm-up for a tune, or a tune to take an exercise through.

const row = (i, name, sub) => `<li class="row" data-pick="${i}" role="button" tabindex="0">
  <div class="row-main"><b>${esc(name)}</b>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</div></li>`;
const group = (label, rows) => (rows ? `<h3 class="section-label">${esc(label)}</h3><ul class="list pick-list">${rows}</ul>` : '');

// How a warm-up goes: "Over ii–V7–I in B♭", "iiø–V7–i in G", "Gm6 · Aø7 · D7", "Through the form".
function how(it, x) {
  if (it.form) return 'Through the form';
  if (it.prog) return `${it.prog.name} in ${rootName(it.keys[0])}`;
  if (it.over) return `Over ${it.over}${it.overKey != null ? ` in ${kn(it.overKey)}` : ''}${it.keys.length > 1 ? ` — in ${it.keys.map(rootName).join(', then ')}` : ''}`;
  return exerciseKeysText(it.keys, x, it.types);
}

// A warm-up for tune t, picked from all that could go before it (+ Warm-up, Add a warm-up).
export function pickWarmup(t, { back } = {}) {
  const plan = store.state.plan;
  const key = todayItem(t)?.key ?? null;
  const have = plan?.date ? plan.items.filter((i) => i.warmup === t.id) : [];
  const { changes, chords, form } = warmupChoices(t, { key, have });
  const all = [...changes, ...chords, ...form];
  if (!all.length) return toast(`No more warm-ups for ${t.name}`);
  let n = 0;
  const rows = (list) => list.map((it) => { const x = itemById(it.itemId); return row(n++, x.name, how(it, x)); }).join('');
  const sheet = openSheet(`
    <p class="eyebrow">Warm up for ${esc(t.name)}</p>
    <h2 class="sheet-title">Pick a warm-up</h2>
    ${group('Over its changes', rows(changes))}
    ${group('On its chords', rows(chords))}
    ${group('Through the form — bend it to the changes', rows(form))}
  `, () => back?.());
  $$('[data-pick]', sheet).forEach((li) => (li.onclick = () => {
    const it = all[Number(li.dataset.pick)];
    addWarmup(t, it);
    closeSheet();
    render();
    toast(`Added ${itemById(it.itemId).name} before ${t.name}`);
  }));
}

// A tune to take exercise x through (Try it through a tune), with a search.
export function pickTune(x, { back } = {}) {
  const { today, fit, known, other } = tunesToTry(x);
  const all = [...today, ...fit, ...known, ...other];
  if (!all.length) return toast('No tune with a chart to try it with');
  let n = 0;
  const rows = (list) => list.map((t) => row(n++, t.name, t.style || '')).join('');
  const sheet = openSheet(`
    <p class="eyebrow">Try ${esc(x.name)} through a tune</p>
    <h2 class="sheet-title">Pick a tune</h2>
    <input class="pick-search" id="pick-q" type="search" placeholder="Search tunes" autocomplete="off" aria-label="Search tunes">
    <div id="pick-groups">
      ${group('In today’s set', rows(today))}
      ${group('Its chords fit', rows(fit))}
      ${group('Tunes you know', rows(known))}
      ${group('Others', rows(other))}
    </div>
  `, () => back?.());
  $('#pick-q', sheet).oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('[data-pick]', sheet).forEach((li) => { li.hidden = !!q && !all[Number(li.dataset.pick)].name.toLowerCase().includes(q); });
    $$('#pick-groups .section-label', sheet).forEach((h) => { h.hidden = !!q; });
  };
  $$('[data-pick]', sheet).forEach((li) => (li.onclick = () => {
    const t = tryWithTune(x, all[Number(li.dataset.pick)]);
    closeSheet();
    render();
    if (t) toast(`Added ${t.name} to today’s set, with ${x.name} before it`);
  }));
}
