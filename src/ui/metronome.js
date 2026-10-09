import { store, save } from '../store.js';
import { esc } from '../util.js';
import { itemById } from '../practice.js';
import { metronome, takeAwayStop } from '../metronome.js';
import { setTempo, clampBpm, tapBpm, MIN_BPM, MAX_BPM } from '../tempo.js';
import { $, $$, ICON, render, toast, openSheet } from './shell.js';

// Metronome sheet. Opened for a tune or exercise (opts.itemId), its tempo is that item's working
// tempo: changing it here changes the item's.
export function openMetronome(opts = {}) {
  const settings = store.state.settings;
  const ms = metronome.state;
  // Opened without an item (the Today circle) while it's running for one: that's the metronome
  // that's on, so it opens as that item's (and can be stopped).
  const itemId = opts.itemId ?? (ms.running ? ms.itemId : null);
  const item = itemId ? itemById(itemId) : null;
  const sameItem = ms.running && ms.itemId === (item?.id ?? null);
  let bpm = sameItem ? ms.bpm : item?.tempo || (ms.running ? ms.bpm : settings.metroBpm || 100);
  let beats = settings.metroBeats || 4;
  let taps = [];
  let raf = null;

  const beatDots = () => Array.from({ length: beats }, (_, i) => `<i class="${i === 0 && beats > 1 ? 'accent' : ''}"></i>`).join('');
  const sheet = openSheet(`
    <p class="eyebrow">Metronome${item ? ` · ${esc(item.name)}` : ''}</p>
    <div class="metro-dots" id="m-dots">${beatDots()}</div>
    <div class="metro-bpm">
      <button data-step="-5" aria-label="5 slower">−5</button>
      <button data-step="-1" aria-label="1 slower">−1</button>
      <div class="bpm-readout"><output id="m-bpm">${bpm}</output><small>BPM</small></div>
      <button data-step="1" aria-label="1 faster">+1</button>
      <button data-step="5" aria-label="5 faster">+5</button>
    </div>
    <input type="range" id="m-slider" min="${MIN_BPM}" max="${MAX_BPM}" value="${bpm}" aria-label="Tempo">
    <div class="metro-beats">
      <span class="field-label">Beats per bar</span>
      <div class="chips wrap">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<button class="chip ${n === beats ? 'on' : ''}" data-beats="${n}">${n === 1 ? 'No accent' : n}</button>`).join('')}</div>
    </div>
    <div class="metro-actions">
      <button class="ghost-btn" id="m-tap">Tap tempo</button>
      <button class="primary-btn metro-go" id="m-go">${ICON.play}<span>Start</span></button>
    </div>
    ${item ? `
      <div class="setting">
        <div><b>Goal tempo</b><span>Optional. Suggestions to speed up stop here.</span></div>
        <input class="goal-input" id="m-goal" type="number" inputmode="numeric" min="${MIN_BPM}" max="${MAX_BPM}" placeholder="—" value="${item.goalTempo || ''}">
      </div>
      <p class="fine">This is the working tempo for ${esc(item.name)}: when you log it, this tempo is saved with the session.</p>`
      : '<p class="fine">Tip: open the metronome from a tune or exercise (the tempo button on its card) to save its tempo with your practice.</p>'}
  `, () => {
    cancelAnimationFrame(raf);
    unsubscribe();
    render();
    opts.back?.();
  });

  const out = $('#m-bpm', sheet);
  const slider = $('#m-slider', sheet);
  const go = $('#m-go', sheet);

  function setBpm(b, { fromSlider = false } = {}) {
    bpm = clampBpm(b);
    out.textContent = bpm;
    if (!fromSlider) slider.value = bpm;
    settings.metroBpm = bpm;
    if (metronome.state.running) metronome.setBpm(bpm);
    if (item) setTempo(item, bpm);
    save();
  }
  function showRunning(s) {
    const running = s.running && s.itemId === (item?.id ?? null);
    go.classList.toggle('on', running);
    go.innerHTML = running ? `${ICON.skip}<span>Stop</span>` : `${ICON.play}<span>Start</span>`;
  }
  const unsubscribe = metronome.subscribe(showRunning);
  showRunning(metronome.state);

  $$('[data-step]', sheet).forEach((b) => (b.onclick = () => setBpm(bpm + Number(b.dataset.step))));
  slider.oninput = () => setBpm(Number(slider.value), { fromSlider: true });
  $$('[data-beats]', sheet).forEach((b) => (b.onclick = () => {
    beats = Number(b.dataset.beats);
    settings.metroBeats = beats;
    save();
    metronome.setBeats(beats);
    $$('[data-beats]', sheet).forEach((x) => x.classList.toggle('on', x === b));
    $('#m-dots', sheet).innerHTML = beatDots();
  }));
  $('#m-tap', sheet).onclick = () => {
    const now = performance.now();
    taps = [...taps.filter((t) => now - t < 8000), now].slice(-6);
    const b = tapBpm(taps);
    if (b) setBpm(b);
  };
  go.onclick = () => {
    const s = metronome.state;
    if (s.running && s.itemId === (item?.id ?? null)) return metronome.stop();
    if (item && !item.tempo) setTempo(item, bpm);
    save();
    metronome.stop();
    metronome.start({ bpm, beats, itemId: item?.id ?? null });
  };
  const goal = $('#m-goal', sheet);
  if (goal) goal.onchange = () => {
    const g = Number(goal.value);
    item.goalTempo = g ? clampBpm(g) : null;
    goal.value = item.goalTempo || '';
    save();
  };

  // Light up the beat that's sounding.
  const dots = () => $$('#m-dots i', sheet);
  const pulse = () => {
    const c = metronome.state.running && metronome.state.itemId === (item?.id ?? null) ? metronome.lastClick() : null;
    dots().forEach((d, i) => d.classList.toggle('on', !!c && i === c.beat && c.since < 0.15));
    raf = requestAnimationFrame(pulse);
  };
  raf = requestAnimationFrame(pulse);
}

// While the metronome runs, a small pill shows on every screen: tap to open, ■ to stop.
// (Also: back in the app after it was stopped in the background, an offer to start it again.)
export function mountMetronomePill() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const was = takeAwayStop();
    if (was) toast(`Metronome stopped while the app was in the background`, { label: 'Start again', fn: () => metronome.start(was) });
  });
  const pill = document.createElement('div');
  pill.className = 'metro-pill';
  pill.hidden = true;
  document.body.appendChild(pill);
  let raf = null;
  metronome.subscribe((s) => {
    pill.hidden = !s.running;
    cancelAnimationFrame(raf);
    if (!s.running) return;
    const item = s.itemId ? itemById(s.itemId) : null;
    pill.innerHTML = `
      <button class="mp-open" aria-label="Open metronome"><i class="mp-dot"></i><b>${s.bpm}</b>${item ? `<span>${esc(item.name)}</span>` : '<span>bpm</span>'}</button>
      <button class="mp-stop" aria-label="Stop metronome">${ICON.skip}</button>`;
    $('.mp-open', pill).onclick = () => openMetronome({ itemId: s.itemId });
    $('.mp-stop', pill).onclick = () => metronome.stop();
    const dot = $('.mp-dot', pill);
    const tick = () => {
      const c = metronome.lastClick();
      dot.classList.toggle('on', !!c && c.since < 0.1);
      dot.classList.toggle('accent', !!c && c.beat === 0 && s.beats > 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}

// ---------- Shared pieces for cards and detail sheets ----------

export function tempoChip(t) {
  return t.tempo
    ? `<button class="tempo-chip" data-metro="${t.id}" aria-label="Tempo ${t.tempo} bpm, open metronome">${ICON.quarter}<span>${t.tempo}</span></button>`
    : `<button class="tempo-chip empty" data-metro="${t.id}" aria-label="Set a tempo">${ICON.metro}</button>`;
}

export function tempoSuggestionHtml(sug) {
  if (!sug) return '';
  return `<div class="suggest tempo ${sug.up ? 'up' : 'down'}"><span>${esc(sug.text)}</span>
    ${sug.to ? `<button class="pill-btn" data-tempo-to="${sug.to}">${ICON.quarter}${sug.to}</button>` : ''}</div>`;
}

export function tempoRowHtml(t) {
  return `
    <div class="field-label row-label"><span>Tempo</span></div>
    <button class="tempo-row" data-metro="${t.id}">
      <span class="tr-main">${t.tempo ? `<b>${t.tempo} bpm</b> working tempo` : 'No tempo yet'}${t.goalTempo ? ` · goal ${t.goalTempo}` : ''}</span>
      <span class="tr-open">${ICON.metro}Metronome</span>
    </button>`;
}

// Wires up tempo chips/rows ([data-metro]) and tempo suggestions ([data-tempo-to]) in root.
export function bindTempo(root, { back, onChange } = {}) {
  $$('[data-metro]', root).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    openMetronome({ itemId: b.dataset.metro, back });
  }));
  $$('[data-tempo-to]', root).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const id = b.closest('[data-item-id]')?.dataset.itemId;
    const t = id && itemById(id);
    if (!t) return;
    setTempo(t, Number(b.dataset.tempoTo), { nextTime: true });
    save();
    onChange?.();
  }));
}
