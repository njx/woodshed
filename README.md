# Woodshed

A phone-friendly practice planner for working through a list of jazz tunes. It started as an
interactive version of a "300 Tunes" spreadsheet. Ideas not built yet are in [IDEAS.md](IDEAS.md).

Each day it hands you a short set of tunes to play:

- **Hone**: tunes you're proficient at or have mastered, to keep them sharp
- **Learn**: tunes you're familiar with, to get them under your fingers
- **New**: one tune you don't know yet

Turn on **Focus** for a tune (in its detail sheet) and it's in your set every day, on top of the
regular mix, until you turn it off. Swipe a Focus card left to skip it for just today.

Swipe a card **right** (or tap ✓) when you've played it, and **left** to swap in a different
suggestion. After you play a tune, rate how it went (Rough / OK / Solid).

## Exercises

Alongside tunes, the **Library** tab has exercises: scales, arpeggios, patterns, licks, or
anything with a name ("cross-arpeggios"). A starter set is included. Exercises get their own
slots in the daily set (Settings → Daily mix), and each one says which keys to play it in today.

For each exercise you choose:

- **Keys per session**: how many keys to play it in each time (1–12).
- **How keys are chosen**: *weak keys* (the default: keys you've practiced least overall, and
  ones this exercise hasn't been played in lately), *cycle of 4ths* or *chromatic* (picking up
  where you left off), *random*, *chosen keys* only, or *no key* (long tones, the chromatic scale).

- **Vary the scale or chord type** (optional): each session, every key comes with one of the
  scale types (major, dorian, aeolian, harmonic minor, melodic minor, diminished H/W, and more) or
  chord types (maj7, m7, 7, ø7, °7, and more) you've turned on for that exercise, favouring the
  ones you've played least, e.g. "In C dorian · F♯ harm min · B♭ dim H/W". The notation is
  written out for each type, correctly spelled (harmonic minor in C has A♭ and B♮), from a pattern
  of note numbers (scale notes, or chord tones 1 3 5 7). Presets: up and down one or two octaves,
  in 3rds, groups of 4, 1-2-3-5 from each note, inversions (chords). Each shows its numbers, and
  tapping the number pad changes them into a custom pattern. The starter set has three of these: scales, 1-2-3-5 patterns,
  and seventh-chord arpeggios.

**Key familiarity** comes from everything you log, tunes and exercises alike: each session counts
toward its key, recent sessions count more (a session counts half as much after about three
weeks), and rough ones less. The Progress tab charts it around the circle of fifths.

Today's header stays on screen as you scroll (shrinking to the title and progress), with the tools
as circles at its top right: Ask, Note, Record, Metronome and Tuner. While the metronome runs its
circle shows the tempo and flashes on the beat; while the tuner listens (**Mini tuner** in the
tuner), its circle shows the note, green when in tune. On other tabs they show as small pills.

Swiping a card: right marks it played; a short swipe left shows **Swap** and **Remove** (out of
today's set; a focus item only has Remove), and a long one removes it.

### Exercises on a day

Settings → *Exercises on a day*:

- **Before tunes** (the default): your exercises (the *Exercises* count in the daily mix) come
  first, as general ones. Then each tune with a chord chart has two **warm-ups** just before it, in
  the key you're playing it in today: scales or arpeggios on its main chords (taking turns from
  tune to tune: e.g. Gm6, Aø7, D7 arpeggios for Autumn Leaves, or dorian on a m7 and altered on a
  7♭13), then **Through the changes** — one of its progressions (say iii–VI7–ii–V7–I or iiø–V7♭9–i)
  arpeggiated a bar per chord, in the key it leads to. So a set reads: exercises, then warm-ups →
  tune, warm-ups → tune… The same exercise can come up before several tunes, each set to that tune
  and ticked off on its own. A warm-up's **Swap** gives scales for arpeggios or the other way round, or the tune's next progression; a tune swapped in (or added with
  *One more tune*, or made a focus tune) gets its own.
- **Key of the day**: one or two keys (weak keys come up more) for every exercise that picks keys
  by weak keys or at random, so a day has a centre. Shown under *Today's set*.
- **Each its own**: every exercise picks its own keys and types.

Any tune's details also have **Warm up for this tune**, which adds a longer set of warm-ups (its
progression, arpeggios, scales and a ii–V–I pattern) just before it in today's set.

Scale and chord types are picked by how little you've played them on that exercise *and* across all
exercises, the way keys already were.

### Notation

An exercise can have notation, written once in C and shown in whichever key you pick, written for
your instrument (B♭, E♭…), with playback at a tempo you set. Playback can be piano, sax, trumpet,
flute, clarinet or guitar (recordings from [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments),
MIT; trimmed by `scripts/make-samples.sh`, about 300 KB per instrument, downloaded the first time
it's used and then kept for offline use), or a synth that needs no download. It can be straight,
lightly swung, or swung (2:1); 6/8 is never swung.

The notation editor has a tap keypad: pick a note length (whole to sixteenth, dotted, triplet),
an accidental (applies to the next note) and an octave (stays until you change it), then tap note
names. Under the hood it's [ABC notation](https://abcnotation.com) with an eighth note as the unit:
`C` eighth, `C2` quarter, `C3` dotted quarter, `C4` half, `C8` whole, `C/` sixteenth, `(3CDE`
triplet, `z2` quarter rest, `C2-C2` tie, `|` bar line; `^` sharp, `_` flat, `=` natural; lowercase
is the octave up and `,` / `'` go further down / up. Tap ⌨ to type ABC directly.

## Practice time

The first time you open the app on a practice day, it says hello with what's in today's set (focus
tunes, warm-ups, things to remember, your streak) and a big **Start practice**; **Not now** leaves
it until tomorrow. After that, the timer is at the top of Today's set: **Start practice**, and
**End practice** when you're done (with Undo). Marking the first thing played on a day starts it
too, if you haven't started it yourself.

While it runs, the app keeps moving the session's end up to now — every half minute it's open, and
when it's hidden. Switching to another app for a while (to play along in Quartet, say) carries on the
same session when you come back within 15 minutes, counting the time away. If you're away longer, or
the phone sleeps, the timer has stopped at the moment the app was last seen; **Count since then**
puts the time away back in, or **Start again** starts a new session. Sessions count toward the
practice day they started on (which runs until 4am).

Progress shows practice time for the last 7 and 30 days, and per day in *Recent sessions* and the
heatmap. The assistant sees it too.

## Metronome and tempo

Open the **metronome** from Today, or from the tempo button on any tune or exercise card (or its
details). It has ±1/±5 buttons, a slider, tap tempo, beats per bar with an accented downbeat, and
pulsing beat dots. Clicks are scheduled on the Web Audio clock so the beat stays steady. It keeps
running while you move around the app (a small pill shows the tempo; tap it to reopen, × to stop),
keeps the screen awake, and plays through the iPhone's silent switch where Safari allows it.

Each tune and exercise has a **working tempo** (and an optional goal). Opening the metronome from
an item sets its tempo, and logging a session saves the tempo you played at, shown in the item's
history. After you rate a session:

- **Solid twice in a row** at the working tempo → a suggestion to speed up about 5% (never past
  your goal; reaching the goal gets a 🎉).
- **Rough** → a suggestion to slow down 5 bpm (to the next multiple of 5: 120 → 115, 123 → 120).
- **OK** → keep going at the same tempo.

Accepting a suggestion changes the working tempo for next time; today's session keeps the tempo
you actually played. Nudging the metronome while you practice updates today's session too.

## Chord charts

Each tune's details show its chord chart, by section with endings, written for your instrument and in
the key you're playing it in today (pick another key from the menu). The starting tunes' charts come
from [mikeoliphant/JazzStandards](https://github.com/mikeoliphant/JazzStandards) (iReal Pro's jazz
playlists) — 293 of the 301 tunes match — pinned as a git submodule (`vendor/JazzStandards`) and
built into the app; they seed each tune once (first run, or the upgrade that added charts). After
that a chart is the tune's own: **Edit** it as text (`A: Cm7 | F7 | Bbmaj7 Ebmaj7 | %`, endings as
`A 1.:`), add one for a tune that has none, or put an edited one back to the original. Charts are in
backups.

Under the chart are its main **progressions**, named by Roman numeral and the key they lead to:
chains of chords moving by fourths (iii–VI7–ii–V7–I, a minor iiø–V7–i, back-door or extended
dominants), the I–vi–ii–V turnaround, and tritone subs (ii–♭II7–I). Chord colours are kept — half
diminished (ø7), 7♭9, 7♯9/alt, 7♯5 — and decide the arpeggio and scale a warm-up uses.

To update the charts: `git submodule update --remote vendor/JazzStandards` (existing tunes keep
theirs; new installs get the new ones).

## Tuner

Tap **Tuner** on Today. The dial shows the note you're playing and how many cents sharp or flat
it is (green within 5 cents); underneath, a trace of the last 10 seconds shows how your pitch moves
— useful for long tones, where it shows the pitch sagging as a breath runs out. Notes are named as
written for the transposition you're viewing (B♭, E♭, F), with concert pitch underneath. The
reference pitch (A = 440 Hz) can be changed. Pitch detection uses the YIN algorithm (`src/pitch.js`),
which finds the fundamental even when overtones are louder, as they often are on sax.

**Mini tuner** (in the tuner's top corner) keeps it listening while you go through today's set: the
Tuner circle at the top of Today shows the note — green when in tune, with an arc over the top
when you're sharp or under the bottom when you're flat (orange within 15 cents, red beyond), and on other tabs a small
pill shows the note and a dot that sits on the centre line when you're in tune. Tap either for the
full tuner; the pill's × stops it.

## Assistant

Tap **Ask** on the Today screen to chat with Claude about your practice. It can look things up and
make changes for you, for example:

- "Build me a set for tonight", "add a couple of ballads in flat keys", "drop the exercises today"
- "What have I been neglecting?", "Which keys am I weakest in?"
- "Make me an exercise: ii–V–I, 1-2-3-5, cycle of 4ths, at 90" (it can write the notation)
- "Note for my teacher: ask about altissimo", "Mark Solar proficient and set it to 140"
- general music questions

It works through a set of tools over the app's data (`src/assistant/tools.js`): search the library,
read today's set, an item's history, practice stats and the diary; add to or remove from today;
update, create or delete tunes and exercises; add diary notes. Every change it makes is listed under its
reply with an **Undo** button. When you ask for something the tools can't do, it says so and
records the request; those show under Settings → Assistant, as a list of what to add next.

**Setup:** it uses your own Anthropic API key (Settings → Assistant, or the prompt the first time
you tap Ask). The key is stored only on your device, in IndexedDB, and not in backups; the app calls
the API directly from the browser. Each message sends your question plus a short snapshot of the app's state
and whatever the tools look up. It uses Claude Opus 5.5 at medium effort, with prompt caching and
an automatic fallback model if a request is declined; a typical conversation costs a few cents.
Needs a connection; the rest of the app works offline.

**Cost:** each reply shows what it cost, the chat header shows the conversation's total, and
Settings → Assistant shows today, this month and all time. Figures are worked out from the token
counts each API response reports, at Anthropic's list prices (`src/assistant/cost.js`), including
cache reads/writes and any fallback model. API use is billed separately from Claude Pro/Max plans,
which don't cover it. The Anthropic console has the official numbers.

## How tunes are picked

- **A practice day runs until 4am,** so a late session that crosses midnight counts as one day: the
  set, ratings, tempos and diary notes all stay with the evening you started.

- **The daily mix** (Settings → Daily mix): by default 2 exercises and 4 tunes — 1 to hone
  (proficient or mastered), 2 you're learning, 1 new — plus any focus tunes. The tunes come in a
  **mixed-up order** each day (focus tunes first), or **by group** (hone, learn, new) if you prefer;
  either way you can play them in any order.

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
the browser's speech recognition where it's available (on iPhone the first use asks for permission
to use speech recognition, which can get stuck — if dictation doesn't start within a few seconds
it gives up, and it works the next time), and the keyboard's mic works everywhere. A
note can be about a specific tune, and then it also shows in that tune's details. Each day in the
diary also lists what you played.

Flag a note **Remember** or **Ask teacher** and it becomes a to-do until you tick it off:

- **Remember** items show at the top of the Today screen.
- **Ask teacher** items collect under the diary's "For teacher" filter, where **Share list** sends
  the open ones as plain text (or copies them) before a lesson.

Notes save automatically when you close the editor, however you close it.

### Recordings

Record audio or video of your practice from Today, the Diary, a tune's or exercise's details, or a
note. Each card in Today's set has a record button too (next to the tempo), which shows how many
takes of it you've recorded today; a take from there goes with that tune or exercise, labelled with
the key(s) it's in today. An exercise keeps its takes under **Recordings**, right below its notation, each labelled with
what you were playing (keys, scale or chord types, or the progression, and tempo). The
recorder shows a live level meter (or camera preview) and a timer; when you stop, play it back
and **Keep** it (with an optional note and tune) or **Discard** it. Kept recordings attach to a
diary note: audio plays right from the list, and the note shows players for each clip, with
**Save** to put a copy in Files/Photos or send it somewhere.

- Audio is recorded with the phone's voice processing turned off (echo cancellation, noise
  suppression, automatic gain), which otherwise mangles the sound of an instrument.
- Closing the recorder mid-take keeps what you recorded; Discard is the only way to throw it away.
- The screen stays on while the recorder is open (a phone that locks mid-take would end the take),
  and while the metronome or tuner runs.
- Delete a recording with the × on it wherever it's listed (Diary, a tune's or exercise's
  details), with Undo.
- The metronome keeps playing while you record (on iPhone the app switches its audio session to
  play-and-record while the recorder is open). With earbuds in, the click stays in your ears; the
  recorder offers a **Mic** choice when there's more than one, and starts with the phone's own mic
  (better for an instrument than an earbud's), remembering what you pick.
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
- Saved and imported data is checked on every load (`src/validate.js`): fields get the types the
  app expects, and unsafe ids or values are replaced. If saved data can't be read, the app says so
  and offers to retry rather than starting over. If a save fails (e.g. storage full), a copy is kept
  in `localStorage` and picked up next time.
- Restoring a backup keeps this phone's recordings: notes with recordings that aren't in the
  backup are kept alongside it.

## Development

It's a small Vite project in plain JavaScript (no framework), with Vitest for unit tests and Playwright for end-to-end tests.

```sh
git submodule update --init   # chord charts (vendor/JazzStandards)
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run coverage # unit tests with a coverage report
npm run test:e2e # end-to-end tests in a phone-sized Chromium (builds first)
npm run build    # production build in dist/
```

Layout:

- `src/practice.js`: practice log, spaced-repetition scheduling, level suggestions
- `src/plan.js`: picking the daily set and the key for each item
- `src/theory.js`: scale and chord types, generated notation for them, and choosing types
- `src/chords.js`: chord charts — reading, naming and transposing chords, editing as text, and
  what's in a chart (main chords, progressions, scales for chords); `src/standards.js` matches tune
  titles to JazzStandards at build time (`virtual:seed-charts` in `vite.config.js`), `src/charts.js`
  seeds tunes with them; `src/warmups.js` picks warm-ups from them
- `src/store.js`, `src/db.js`: app state, schema migrations, IndexedDB persistence
- `src/keys.js`, `src/dates.js`: key names and transposition, calendar-day helpers
- `src/keystats.js`: key familiarity and choosing exercise keys
- `src/tempo.js`, `src/metronome.js`: working tempos and suggestions; the metronome engine
- `src/assistant/`: the assistant's tools (`tools.js`), conversation loop (`agent.js`) and cost tracking (`cost.js`)
- `src/abc.js`: building notation (ABC), note lengths, transposition
- `src/diary.js`: practice notes and flagged to-dos
- `src/media.js`: recorded clips (formats, storage, cleanup)
- `src/listen.js`, `src/data/`: recordings and search links; the seed tunes and exercises
- `src/ui/`: one module per screen (`today`, `tunes`, `diary`, `progress`, `settings`), the tune detail
  sheet (`item`), exercises and the notation editor (`exercise`, `notation`), the recorder
  (`recorder`), the metronome (`metronome`), the assistant chat (`assistant`), and shared pieces
  (`shell`)
- `src/sw.js`: service worker template. The build fills in the list of files to cache, so the
  app works offline.
- `test/`: unit tests (Vitest) for scheduling, planning, keys, exercises, notation, tempo,
  storage, data checks, the diary, recordings, pitch detection, costs, and the assistant's tools
  and conversation loop
- `e2e/`: end-to-end tests (Playwright) that drive the built app on simulated iPhones: Today,
  the library, diary, recording (a fake mic and camera), exercises and notation, metronome and
  tempo suggestions, the tuner (a generated sax-like tone as the mic), the assistant (against a
  mock of the API), the 4am day rollover, offline use, and upgrading from the first version.
  `Math.random` is seeded, so each run sees the same set. They run before every deploy.

## Deploying

`.github/workflows/pages.yml` runs the tests, builds, and deploys `dist/` to GitHub Pages on
every push to `main` (*Settings → Pages → Source: GitHub Actions*). On your phone, open the site
and choose **Share → Add to Home Screen** on iOS, or **Install app** on Android. Installing
matters on iOS: Safari can clear storage for sites you haven't visited in a while, but installed
home-screen apps are exempt.
