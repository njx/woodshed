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

## Diary

The **Diary** tab keeps notes about your practice, typed or dictated: the editor's mic button uses
the browser's speech recognition where it's available, and the keyboard's mic works everywhere. A
note can be about a specific tune, and then it also shows in that tune's details. Each day in the
diary also lists what you played.

Flag a note **Remember** or **Ask teacher** and it becomes a to-do until you tick it off:

- **Remember** items show at the top of the Today screen.
- **Ask teacher** items collect under the diary's "For teacher" filter, where **Share list** sends
  the open ones as plain text (or copies them) before a lesson.

Notes save automatically when you close the editor, however you close it.

### Recordings

Record audio or video of your practice from Today, the Diary, a tune's details, or a note. The
recorder shows a live level meter (or camera preview) and a timer; when you stop, play it back
and **Keep** it (with an optional note and tune) or **Discard** it. Kept recordings attach to a
diary note: audio plays right from the list, and the note shows players for each clip, with
**Save** to put a copy in Files/Photos or send it somewhere.

- Audio is recorded with the phone's voice processing turned off (echo cancellation, noise
  suppression, automatic gain), which otherwise mangles the sound of an instrument.
- Closing the recorder mid-take keeps what you recorded; Discard is the only way to throw it away.
- Recordings are stored on the device (in IndexedDB) and are **not** part of the JSON backup —
  they're too big. Save the ones you want to keep. Settings shows how much space they use.
- iOS may ask for microphone/camera permission again after the app has been closed for a while.

## Listening

Each tune's detail sheet has a **Listen** section with classic recordings of it: 277 of the
301 tunes have at least one (207 with a specific album), and you can add your own. The rest get a
plain search link. Tapping a recording searches Apple Music, Spotify or YouTube (your choice in
Settings) for that tune by that artist. Links are searches rather than direct track links, because
linking to exact tracks would need each service's developer API (and for Spotify, logging in). The
list is in `src/data/recordings.js`. It was compiled from well-known discographies, with a sample
of album track lists checked online.

## Data

- The starting list (`src/data/tunes.js`) was imported from the spreadsheet: the "My List" column
  (A–D) became the familiarity level, and the priority column became the priority. The usual keys
  come from the iReal Pro jazz collection via
  [mikeoliphant/JazzStandards](https://github.com/mikeoliphant/JazzStandards), with a few hand
  edits for tunes that are often called in more than one key.
- All your data (edits, practice log, settings) is stored in IndexedDB on your device. Data saved
  by the first version (in `localStorage`) is picked up automatically. Use **Settings → Export
  backup** now and then, and before switching phones.

## Development

It's a small Vite project in plain JavaScript (no framework), with Vitest for tests.

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run build    # production build in dist/
```

Layout:

- `src/practice.js`: practice log, spaced-repetition scheduling, level suggestions
- `src/plan.js`: picking the daily set and the key for each item
- `src/store.js`, `src/db.js`: app state, schema migrations, IndexedDB persistence
- `src/keys.js`, `src/dates.js`: key names and transposition, calendar-day helpers
- `src/diary.js`: practice notes and flagged to-dos
- `src/media.js`: recorded clips (formats, storage, cleanup)
- `src/listen.js`, `src/data/`: recordings and search links; the seed tune list
- `src/ui/`: one module per screen (`today`, `tunes`, `diary`, `progress`, `settings`), the tune detail
  sheet (`item`), the recorder (`recorder`), and shared pieces (`shell`)
- `src/sw.js`: service worker template. The build fills in the list of files to cache, so the
  app works offline.
- `test/`: unit tests for scheduling, planning, keys, storage, the diary and the recordings data

## Deploying

`.github/workflows/pages.yml` runs the tests, builds, and deploys `dist/` to GitHub Pages on
every push to `main` (*Settings → Pages → Source: GitHub Actions*). On your phone, open the site
and choose **Share → Add to Home Screen** on iOS, or **Install app** on Android. Installing
matters on iOS: Safari can clear storage for sites you haven't visited in a while, but installed
home-screen apps are exempt.
