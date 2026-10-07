import { store, save } from '../store.js';
import { TRANSPOSITIONS } from '../constants.js';
import { dateStr } from '../dates.js';
import { esc } from '../util.js';
import { isMinor } from '../keys.js';
import { chartFor, chartSource, loadCharts, chartsStatus, onChartsChange, standardFor } from '../charts.js';
import { chordName, chartShift, usesSharps, chartToText, chartFromText } from '../chords.js';
import { addWarmups } from '../plan.js';
import { $, ICON, render, toast, openSheet, kn } from './shell.js';

// The chord chart in a tune's details: shown in the key it's played in today (or its usual
// key), written for the instrument; another key can be picked. Editable.

const view = () => store.state.settings.view;

// The concert key a tune is played in today, or its usual key.
function todaysKey(t) {
  const plan = store.state.plan;
  const it = plan?.date === dateStr() && plan.items.find((i) => i.itemId === t.id);
  return it?.key ?? t.keys?.[0] ?? null;
}

function barHtml(b, opts) {
  if (!b.chords.length) return '<div class="bar same">%</div>';
  const alts = b.alts.length ? `<small>(${b.alts.map((c) => esc(chordName(c, opts))).join(' ')})</small>` : '';
  return `<div class="bar n${b.chords.length}">${b.chords.map((c) => `<span>${esc(chordName(c, opts))}</span>`).join('')}${alts}</div>`;
}

function chartHtml(chart, opts) {
  return chart.sections.map((s) => `
    <div class="chart-section">
      <span class="chart-label">${esc(s.label || '')}</span>
      <div class="bars">${s.bars.map((b) => barHtml(b, opts)).join('')}</div>
      ${s.endings.map((e, i) => `
        <span class="chart-label ending">${i + 1}.</span>
        <div class="bars">${e.map((b) => barHtml(b, opts)).join('')}</div>`).join('')}
    </div>`).join('');
}

// Fills `box` with the chart for tune `t`, and keeps it up to date while charts download.
// back: reopens the tune's details after the chart editor.
export function mountChart(box, t, { back } = {}) {
  let key = null; // the concert key shown; null = today's / usual
  const draw = () => {
    const chart = chartFor(t);
    const status = chartsStatus();
    if (!chart) {
      box.innerHTML = `
        <div class="field-label row-label"><span>Chords</span>${status === 'ready' || t.chart ? '<button class="link-btn" id="chart-add">Add a chart</button>' : ''}</div>
        <p class="fine">${status === 'loading' ? 'Downloading chord charts…'
          : status === 'failed' ? 'Couldn’t download chord charts. <button class="link-btn" id="chart-retry">Try again</button>'
            : status === 'ready' ? 'There’s no chart for this tune in the downloaded set. You can add one.' : 'Loading…'}</p>`;
    } else {
      const shown = key ?? todaysKey(t) ?? chart.key ?? 0;
      const minor = isMinor(shown);
      const shift = chartShift(chart, shown, view());
      const written = (((shown % 12) + TRANSPOSITIONS[view()].offset) % 12) + (minor ? 12 : 0);
      const opts = { shift, sharps: usesSharps(written) };
      const keys = [...Array(12).keys()].map((r) => r + (minor ? 12 : 0));
      box.innerHTML = `
        <div class="field-label row-label"><span>Chords</span><span class="row-links">
          <select class="chart-key" id="chart-key" aria-label="Key">${keys.map((k) => `<option value="${k}" ${k === shown ? 'selected' : ''}>in ${esc(kn(k))}</option>`).join('')}</select>
          <button class="link-btn" id="chart-edit">Edit</button></span></div>
        <div class="chart">${chartHtml(chart, opts)}</div>
        <div class="chart-foot">
          <button class="pill-btn" id="chart-warmup">${ICON.plus}Warm up for this tune</button>
          <span class="fine">${chartSource(t) === 'mine' ? 'Your chart' : 'From iReal Pro’s playlists, via JazzStandards'}</span>
        </div>`;
      $('#chart-key', box).onchange = (e) => { key = Number(e.target.value); draw(); };
      $('#chart-edit', box).onclick = () => openChartEditor(t, { key: shown, back });
      $('#chart-warmup', box).onclick = () => {
        const n = addWarmups(t);
        if (!n) return toast('No warm-up exercises to add (they may all be played already today)');
        render();
        toast(`Added ${n} warm-up${n > 1 ? 's' : ''} for ${t.name} to today`);
      };
    }
    const add = $('#chart-add', box);
    if (add) add.onclick = () => openChartEditor(t, { key: todaysKey(t) ?? 0, back });
    const retry = $('#chart-retry', box);
    if (retry) retry.onclick = () => loadCharts();
  };
  // Redraws when charts finish loading (or fail), while the details are open.
  const off = onChartsChange(() => (box.isConnected ? draw() : off()));
  draw();
  loadCharts();
}

// Edit (or add) a tune's chart as text, in the key and transposition it's shown in.
export function openChartEditor(t, { key = 0, back } = {}) {
  const existing = chartFor(t);
  const base = existing?.key ?? key;
  const minor = isMinor(key);
  const shift = existing ? chartShift(existing, key, view()) : TRANSPOSITIONS[view()].offset;
  const written = (((key % 12) + TRANSPOSITIONS[view()].offset) % 12) + (minor ? 12 : 0);
  const text = existing ? chartToText(existing, { shift, sharps: usesSharps(written) }) : 'A: ';
  let saved = false;
  const sheet = openSheet(`
    <p class="eyebrow">Chords · ${esc(t.name)} · in ${esc(kn(key))}</p>
    <label class="field">
      <textarea id="ce-text" rows="10" spellcheck="false" autocapitalize="off" autocomplete="off" class="mono">${esc(text)}</textarea>
    </label>
    <p class="fine" id="ce-msg">One section per line, like <code>A: Cm7 | F7 | Bbmaj7 Ebmaj7 | %</code>. Bars are separated by <code>|</code>, chords in a bar by spaces; <code>%</code> means the chord carries on. Endings: <code>A 1.:</code> and <code>A 2.:</code>.</p>
    <button class="primary-btn" id="ce-save">Save chart</button>
    ${t.chart && standardFor(t) ? '<button class="ghost-btn" id="ce-reset">Go back to the downloaded chart</button>' : ''}
  `, () => { if (!saved) back?.(); });
  $('#ce-save', sheet).onclick = () => {
    const meter = existing?.meter || '4/4';
    const r = chartFromText($('#ce-text', sheet).value, { key: base, meter, shift });
    if (r.error) {
      $('#ce-msg', sheet).textContent = r.error;
      $('#ce-msg', sheet).classList.add('error');
      return;
    }
    t.chart = r.chart;
    save();
    saved = true;
    toast('Chart saved');
    back?.();
  };
  const reset = $('#ce-reset', sheet);
  if (reset) reset.onclick = () => {
    delete t.chart;
    save();
    saved = true;
    toast('Using the downloaded chart');
    back?.();
  };
}
