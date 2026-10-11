import { store, save } from '../store.js';
import { TRANSPOSITIONS } from '../constants.js';
import { dateStr } from '../dates.js';
import { esc } from '../util.js';
import { isMinor } from '../keys.js';
import { chartFor, chartSource, seedChart, loadSeedCharts } from '../charts.js';
import { chordName, chartShift, usesSharps, chartToText, chartFromText, progressions, noteName } from '../chords.js';
import { chartChords, chartBars } from '../bass.js';
import { metronome } from '../metronome.js';
import { pickWarmup } from './pickers.js';
import { $, $$, ICON, render, toast, openSheet, closeSheet, kn } from './shell.js';

// The chord chart in a tune's details: shown in the key it's played in today (or its usual
// key), written for the instrument; another key can be picked. Editable.

const view = () => store.state.settings.view;

// The concert key a tune is played in today, or its usual key.
function todaysKey(t) {
  const plan = store.state.plan;
  const it = plan?.date === dateStr() && plan.items.find((i) => i.itemId === t.id);
  return it?.key ?? t.keys?.[0] ?? null;
}

// Bars are numbered (data-b) in playing order, as chordTimeline goes, for the bass to follow.
function barHtml(b, opts, n) {
  if (!b.chords.length) return `<div class="bar same" data-b="${n}">%</div>`;
  const alts = b.alts.length ? `<small>(${b.alts.map((c) => esc(chordName(c, opts))).join(' ')})</small>` : '';
  return `<div class="bar n${b.chords.length}" data-b="${n}">${b.chords.map((c) => `<span>${esc(chordName(c, opts))}</span>`).join('')}${alts}</div>`;
}

function chartHtml(chart, opts) {
  let n = 0;
  const barHtml_ = (b) => barHtml(b, opts, n++);
  return chart.sections.map((s) => `
    <div class="chart-section">
      <span class="chart-label">${esc(s.label || '')}</span>
      <div class="bars">${s.bars.map(barHtml_).join('')}</div>
      ${s.endings.map((e, i) => `
        <span class="chart-label ending">${i + 1}.</span>
        <div class="bars">${e.map(barHtml_).join('')}</div>`).join('')}
    </div>`).join('');
}

// The chart's main progressions, named by Roman numeral, in the key shown.
function progsHtml(chart, { shift, sharps }) {
  const ps = progressions(chart).filter((p) => p.chords.length >= 3).slice(0, 4);
  if (!ps.length) return '';
  return `<p class="progs"><span>Progressions</span> ${ps.map((p) => `<b>${esc(p.name)}</b> in ${esc(noteName(p.target + shift, sharps))}${p.minor ? 'm' : ''}${p.count > 1 ? ` ×${p.count}` : ''}`).join(' · ')}</p>`;
}

// Fills `box` with the chart for tune `t`. back: reopens the tune's details after the editor.
// compact: just the chart, its key and the bass (shown with an exercise taken through the tune).
export function mountChart(box, t, { back, key: startKey = null, compact = false } = {}) {
  let key = startKey; // the concert key shown; null = today's / usual
  // A walking bass through the chart (a mode of the metronome), round and round, at the tune's
  // tempo, in the key shown; the bar it's on lights up while the chart is showing.
  const owner = `chart:${t.id}`;
  const bassMine = () => metronome.state.running && metronome.state.bass?.owner === owner;
  // A loop of part of the chart (a section, or bars tapped: first then last): { from, to, name }
  // in bar numbers (data-b), or null for the whole tune. `pick`: the first bar tapped.
  let loop = bassMine() ? metronome.state.bass.loop || null : null;
  let pick = null;
  const loopHtml = (chart) => {
    const { sections } = chartBars(chart);
    const chip = (v, label, on) => `<button class="chip ${on ? 'on' : ''}" data-loop="${v}">${esc(label)}</button>`;
    const isSection = (s) => loop && loop.from === s.from && loop.to === s.to;
    return `<div class="loop-row"><span class="field-label">Loop</span><div class="chips">
      ${chip('all', 'Whole tune', !loop)}${sections.length > 1 ? sections.map((s, i) => chip(i, s.name, isSection(s))).join('') : ''}
      ${loop && !sections.some(isSection) ? chip('all', `${loop.name} ×`, true) : ''}</div></div>
      <p class="fine loop-hint">${pick != null ? `From bar ${pick + 1}: now tap the last bar to loop.` : 'Or tap a bar, then another, to loop just those.'}</p>`;
  };
  let gen = 0; // (one bar-follower at a time)
  const follow = () => {
    const mine = ++gen;
    let lit = null;
    const step = () => {
      if (mine !== gen || !box.isConnected) return;
      if (!bassMine()) {
        lit?.classList.remove('now');
        const b = $('#chart-bass', box);
        if (b?.classList.contains('on')) draw(); // stopped elsewhere (the pill, the metronome)
        return;
      }
      const i = metronome.bassBeat();
      const from = metronome.state.bass.loop?.from ?? 0;
      const bar = i < 0 ? null : box.querySelector(`[data-b="${from + Math.floor(i / metronome.state.beats)}"]`);
      if (bar !== lit) { lit?.classList.remove('now'); bar?.classList.add('now'); lit = bar; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const startBass = () => {
    const chart = chartFor(t);
    const { chords, beats } = chartChords(t, key ?? todaysKey(t) ?? chart.key ?? 0, loop || {});
    if (!chords.length) return;
    const label = loop ? `${t.name} · ${loop.name}` : t.name;
    metronome.start({ bpm: t.tempo || store.state.settings.metroBpm || 120, beats, itemId: t.id, bass: { chords, owner, label, loop }, click: store.state.settings.bassClick });
  };
  const draw = () => {
    const chart = chartFor(t);
    if (!chart) {
      box.innerHTML = `
        <div class="field-label row-label"><span>Chords</span><button class="link-btn" id="chart-add">Add a chart</button></div>
        <p class="fine">No chord chart for this tune yet.</p>`;
    } else {
      const shown = key ?? todaysKey(t) ?? chart.key ?? 0;
      const minor = isMinor(shown);
      const shift = chartShift(chart, shown, view());
      const written = (((shown % 12) + TRANSPOSITIONS[view()].offset) % 12) + (minor ? 12 : 0);
      const opts = { shift, sharps: usesSharps(written) };
      const keys = [...Array(12).keys()].map((r) => r + (minor ? 12 : 0));
      box.innerHTML = `
        <div class="field-label row-label"><span>${compact ? `${esc(t.name)}’s chords` : 'Chords'}</span><span class="row-links">
          <select class="chart-key" id="chart-key" aria-label="Key">${keys.map((k) => `<option value="${k}" ${k === shown ? 'selected' : ''}>in ${esc(kn(k))}</option>`).join('')}</select>
          ${compact ? '' : '<button class="link-btn" id="chart-edit">Edit</button>'}</span></div>
        <div class="chart ${loop ? 'looping' : ''}">${chartHtml(chart, opts)}</div>
        ${loopHtml(chart)}
        ${progsHtml(chart, opts)}
        <div class="chart-foot">
          <span class="chart-btns">
            ${compact ? '' : `<button class="pill-btn" id="chart-warmup">${ICON.plus}Add a warm-up</button>`}
            <button class="pill-btn bass-btn ${bassMine() ? 'on' : ''}" id="chart-bass">${bassMine() ? ICON.stop : ICON.play}Bass</button>
          </span>
          ${compact ? '' : `<span class="fine">${chartSource(t) === 'mine' ? 'Your chart' : 'From iReal Pro’s playlists (via JazzStandards)'}</span>`}
        </div>`;
      $('#chart-key', box).onchange = (e) => {
        key = Number(e.target.value);
        if (bassMine()) startBass(); // on in the new key
        draw();
      };
      // Looping: a section's chip, or tap a bar then another; the bass goes round just those.
      $$('.chart [data-b]', box).forEach((el) => {
        const n = Number(el.dataset.b);
        el.classList.toggle('in-loop', !!loop && n >= loop.from && n <= loop.to);
        el.classList.toggle('pick', n === pick);
      });
      const setLoop = (l) => {
        loop = l;
        pick = null;
        if (bassMine()) startBass();
        draw();
      };
      $$('[data-loop]', box).forEach((b) => (b.onclick = () => {
        const v = b.dataset.loop;
        if (v === 'all') return setLoop(null);
        const s = chartBars(chart).sections[Number(v)];
        setLoop({ from: s.from, to: s.to, name: s.name });
      }));
      $$('.chart [data-b]', box).forEach((el) => (el.onclick = () => {
        const n = Number(el.dataset.b);
        if (pick == null) { pick = n; draw(); return; }
        const [from, to] = [Math.min(pick, n), Math.max(pick, n)];
        setLoop({ from, to, name: from === to ? `bar ${from + 1}` : `bars ${from + 1}–${to + 1}` });
      }));
      $('#chart-bass', box).onclick = () => {
        if (bassMine()) metronome.stop();
        else startBass();
        draw();
      };
      if (bassMine()) follow();
      if (!compact) $('#chart-edit', box).onclick = () => openChartEditor(t, { key: shown, back });
      if (!compact) $('#chart-warmup', box).onclick = () => pickWarmup(t, { back }); // (in place of this sheet; back reopens it)
    }
    const add = $('#chart-add', box);
    if (add) add.onclick = () => openChartEditor(t, { key: todaysKey(t) ?? 0, back });
  };
  draw();
}

// Edit (or add) a tune's chart as text, in the key and transposition it's shown in.
export async function openChartEditor(t, { key = 0, back } = {}) {
  if (t.chartEdited) await loadSeedCharts(); // to offer going back to the original
  const existing = chartFor(t);
  const base = existing?.key ?? key;
  const minor = isMinor(key);
  const shift = existing ? chartShift(existing, key, view()) : TRANSPOSITIONS[view()].offset;
  const written = (((key % 12) + TRANSPOSITIONS[view()].offset) % 12) + (minor ? 12 : 0);
  const text = existing ? chartToText(existing, { shift, sharps: usesSharps(written) }) : 'A: ';
  const original = { chart: t.chart ? structuredClone(t.chart) : null, edited: !!t.chartEdited };
  let pending = null; // the last edit, if it didn't read as a chart
  const sheet = openSheet(`
    <p class="eyebrow">Chords · ${esc(t.name)} · in ${esc(kn(key))}</p>
    <label class="field">
      <textarea id="ce-text" rows="10" spellcheck="false" autocapitalize="off" autocomplete="off" class="mono">${esc(text)}</textarea>
    </label>
    <p class="fine" id="ce-msg" data-help="1">One section per line, like <code>A: Cm7 | F7 | Bbmaj7 Ebmaj7 | %</code>. Bars are separated by <code>|</code>, chords in a bar by spaces; <code>%</code> means the chord carries on. Endings: <code>A 1.:</code> and <code>A 2.:</code>.</p>
    <button class="primary-btn" id="ce-save">Done</button>
    <button class="link-btn" id="ce-revert" hidden>Undo changes</button>
    ${t.chartEdited && seedChart(t) ? '<button class="ghost-btn" id="ce-reset">Go back to the original chart</button>' : ''}
  `, () => {
    if (pending) toast(`Your last change to the chart wasn’t kept: ${pending}`);
    back?.();
  });
  const msg = $('#ce-msg', sheet);
  const help = msg.innerHTML;
  // Each edit is saved once the text reads as a chart; until then the last good one stays.
  let timer = null;
  const keep = () => {
    const r = chartFromText($('#ce-text', sheet).value, { key: base, meter: existing?.meter || '4/4', shift });
    pending = r.error || null;
    msg.classList.toggle('error', !!r.error);
    if (r.error) { msg.textContent = r.error; return; }
    msg.innerHTML = help;
    t.chart = r.chart;
    t.chartEdited = true;
    save();
  };
  $('#ce-text', sheet).oninput = () => {
    $('#ce-revert', sheet).hidden = false;
    clearTimeout(timer);
    timer = setTimeout(keep, 400);
  };
  // Done: stays open to show what's wrong if the text doesn't read as a chart.
  $('#ce-save', sheet).onclick = () => { clearTimeout(timer); keep(); if (!pending) closeSheet(); };
  $('#ce-revert', sheet).onclick = () => {
    clearTimeout(timer);
    t.chart = original.chart ? structuredClone(original.chart) : null;
    t.chartEdited = original.edited;
    pending = null;
    save();
    closeSheet();
    toast('Chart back to how it was');
  };
  const reset = $('#ce-reset', sheet);
  if (reset) reset.onclick = () => {
    clearTimeout(timer);
    t.chart = seedChart(t);
    t.chartEdited = false;
    pending = null;
    save();
    closeSheet();
    toast('Back to the original chart');
  };
}
