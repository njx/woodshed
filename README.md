# Woodshed

A phone-friendly practice planner for working through a list of jazz tunes. It started as an
interactive version of a "300 Tunes" spreadsheet.

Each day it hands you a short set of tunes to play:

- **Hone**: tunes you're proficient at or have mastered, to keep them sharp
- **Learn**: tunes you're familiar with, to get them under your fingers
- **New**: one tune you don't know yet

Turn on **Focus** for a tune (in its detail sheet) and it's in your set every day, on top of the
regular mix, until you turn it off. Swipe a Focus card left to skip it for just today.

Swipe a card **right** (or tap ✓) when you've played it, and **left** to swap in a different
suggestion. After you play a tune, rate how it went (Rough / OK / Solid).

## How tunes are picked

- **Spaced repetition.** Every tune has a review interval. Playing it pushes the next review
  further out: "OK" stretches the interval by about 1.6×, "Solid" by 2.5×, and "Rough" brings it
  back tomorrow. Starting intervals depend on familiarity (Familiar 2 days, Proficient 4,
  Mastered 7). Tunes that are most overdue are the most likely picks.
- **Familiarity changes.** You set how well you know a tune in its detail sheet. After you play a
  tune, its card suggests a change when your ratings point that way: up a level after 3 Solid
  sessions in a row, down after 2 Rough ones (counting only sessions since the level last
  changed).
- **Priority** (Critical / High / Medium / Low) tips the balance among tunes that are due. You can
  set how much it matters, or turn it off.
- **Keys.** Each tune stores its usual concert key(s). Tunes that are commonly played in more than
  one key (Autumn Leaves in Gm/Em, Summertime in Am/Dm…) rotate through them. Mastered tunes (or
  Proficient and up, if you choose) are suggested in a *different* key, with less-practiced keys
  coming up first.
- **Transposition.** Pick the instruments you play (Concert, B♭, E♭, F). Keys are shown for
  whichever one is active; tap **Keys in …** to switch.

## Data

- The starting list (`tunes.js`) was imported from the spreadsheet: the "My List" column (A–D)
  became the familiarity level, and the priority column became the priority. The usual keys come
  from the iReal Pro jazz collection via
  [mikeoliphant/JazzStandards](https://github.com/mikeoliphant/JazzStandards), with a few hand
  edits for tunes that are often called in more than one key.
- All your data (edits, practice log, settings) lives in the browser's local storage on your
  device. Use **Settings → Export backup** now and then, and before switching phones.

## Running it

It's a static site with no build step: plain HTML, CSS and ES modules, plus a service worker so
it works offline.

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

**On your phone:** host it anywhere static. This repo includes a GitHub Pages workflow
(`.github/workflows/pages.yml`) that deploys on every push to `main`. Enable it under *Settings →
Pages → Source: GitHub Actions*. Then open the site and choose **Share → Add to Home Screen** on
iOS, or **Install app** on Android. Installing matters on iOS: Safari can clear storage for sites
you haven't visited in a while, but installed home-screen apps are exempt.
