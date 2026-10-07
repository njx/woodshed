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

mountMetronomePill();
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
  if (document.visibilityState === 'hidden') flush();
  // Roll over to a new day's set if the app stays open past the end of the practice day.
  else if (store.state.plan?.date !== dateStr()) render();
});
window.addEventListener('pagehide', () => flush());

loadState().then(
  () => {
    render();
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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
