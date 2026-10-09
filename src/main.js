import './styles.css';
import { store, loadState, flush, setSaveErrorHandler } from './store.js';
import { dateStr } from './dates.js';
import { $, $$, ui, registerViews, render, goTo, toast, closeSheet } from './ui/shell.js';
import { renderToday } from './ui/today.js';
import { renderTunes } from './ui/tunes.js';
import { renderProgress } from './ui/progress.js';
import { renderSettings } from './ui/settings.js';
import { renderDiary } from './ui/diary.js';
import { cleanupMedia } from './media.js';
import { mountMetronomePill } from './ui/metronome.js';
import { mountTunerPill } from './ui/tuner.js';
import { heartbeat, HEARTBEAT_MS } from './practicetime.js';
import { metronome } from './metronome.js';
import { tuner } from './tuning.js';
import { maybeGreet } from './ui/greet.js';

mountMetronomePill();
mountTunerPill();
registerViews({ today: renderToday, tunes: renderTunes, diary: renderDiary, progress: renderProgress, settings: renderSettings });
setSaveErrorHandler(() => toast('Could not save — storage is full or blocked'));

// Ask the browser not to evict our data (matters most on iOS).
navigator.storage?.persist?.().catch(() => {});

$$('.tab').forEach((b) => (b.onclick = () => {
  if (ui.tab === b.dataset.tab) return window.scrollTo({ top: 0, behavior: 'smooth' });
  goTo(b.dataset.tab);
}));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

document.addEventListener('visibilitychange', () => {
  if (!store.state) return; // still loading
  if (document.visibilityState === 'hidden') {
    heartbeat(); // the practice timer's end, in case the app doesn't come back
    flush();
  } else {
    // The timer stopped while away, or the app stayed open past the end of the practice day.
    if (heartbeat() === 'stopped' || store.state.plan?.date !== dateStr()) render();
    maybeGreet();
  }
});
// Shrinks the sticky header once the page is scrolled. Shrinking moves the page up, so it only
// grows back nearer the top (otherwise it could flicker between the two around one point).
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  const on = document.body.classList.contains('scrolled');
  if (!on && y > 60) document.body.classList.add('scrolled');
  else if (on && y < 4) document.body.classList.remove('scrolled');
}, { passive: true });
window.addEventListener('pagehide', () => { if (store.state) heartbeat(); flush(); });
setInterval(() => {
  if (store.state && document.visibilityState === 'visible' && heartbeat() === 'stopped') render();
}, HEARTBEAT_MS);

loadState().then(
  () => {
    heartbeat(); // carries on a running timer, or stops it if the app was closed a while
    render();
    maybeGreet();
    cleanupMedia();
  },
  (err) => {
    // Don't start over from the seed list: the saved data is probably still there.
    console.error('Could not load saved data', err);
    $('#view').innerHTML = `
      <div class="load-error">
        <h2>Couldn’t open your practice data</h2>
        <p>Your saved data couldn’t be read just now. It’s usually still there — try again.</p>
        <button class="primary-btn" onclick="location.reload()">Try again</button>
      </div>`;
  },
);

// Updates: a home-screen app restored from memory keeps running the old version, so check for a
// new one whenever the app comes back, and when it's installed reload — straight away if nothing
// is going on (no sheet open, metronome and tuner off), otherwise offer it and do it the next time
// the app comes back.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let hadController = !!navigator.serviceWorker.controller;
  let pendingReload = false;
  const idle = () => !document.querySelector('#sheet-root.open') && !metronome.state.running && !tuner.state.running;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (pendingReload && idle()) return location.reload();
      reg.update().catch(() => {});
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; } // the first install: nothing to replace
    if (idle()) return location.reload();
    pendingReload = true;
    toast('A new version of Woodshed is ready', { label: 'Reload', fn: () => location.reload() });
  });
}
