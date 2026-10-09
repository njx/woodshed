# Ideas not built yet

A running list of feature ideas and known follow-ups. Rough size: S (an evening), M (a few
sessions), L (a big piece, or needs a native app).

## Backing tracks and other apps

- **Links on any tune or exercise** (S). A list of labelled links per item: Dropbox share links
  to backing tracks, Aebersold track pages, chart PDFs, lessons. Shown as buttons in the item's
  details, and maybe as a small icon on Today's cards when an item has a backing track.
- **Aebersold search link** (S). If their site has a search page that takes a query in the URL, a
  "Find in Aebersold" link per tune, like the existing Apple Music / Spotify recording links. Needs
  a look at how their site's URLs work. Playing their tracks inside the app isn't possible without
  an official API.
- **Connect a Dropbox folder** (M). Sign in to Dropbox once (works from the browser, no server),
  point at the backing-tracks folder, match file names to tunes ("Autumn Leaves - Gm - 140.mp3"),
  confirm the matches, and attach them as links automatically. Re-scan to pick up new files.
- **Open a track in another app** (S, after the Dropbox folder). Fetch the audio file and open the
  iOS share sheet with it, so it can go to Amazing Slow Downer, Anytune, Files, etc.
- **Open a tune in Quartet** (S, if possible). Quartet 1–6 can open each other with search across
  all volumes, so they have a URL scheme, but it isn't documented publicly. To find out:
  - Ask the developer: hello@quartetapp.com, quartetapp.com.
  - Or look at the app's settings / Shortcuts actions for a "copy link" or share option.

  If the scheme accepts a song title, each tune could get an "Open in Quartet" button, shown only
  for tunes on a list of Quartet's tracks.
- **iReal Pro export** (M). Export an exercise (or a set) as an iReal Pro chart via its documented
  `irealbook://` / `irealb://` link format, so the backing track and changes play in iReal Pro.
  (Building our own backing-track generator was discussed and set aside in favour of this.)

## Tunes and exercises together

- **More from the charts** (M). Play a chart's chords (a simple comping backing at the working tempo);
  ii–V written-pattern exercises for minor keys too; warm-ups on a tune's bridge or hardest bars;
  more progression shapes (Coltrane changes, rhythm-changes bridge, minor-key turnarounds);
  guide-tone lines through a progression.

- **Per-key rating and tempo** (M, parked — worried about complexity). An exercise's harder keys
  often want a slower tempo, and go less well. Latest thinking:
  - On a played card with several keys, "How did it go?" gets a line per key (E♭ Solid · A♭ OK ·
    D♭ Rough), one tap each; one overall rating stays as a shortcut that sets them all.
  - The metronome opened from an exercise offers "just for D♭": an offset from the exercise's
    working tempo for that key, which **carries over** to future days until changed; the log
    keeps each key's tempo.
  - Weak-key picking uses the per-key ratings (rough keys come back sooner, solid ones later), and
    speed-up / slow-down suggestions work per key ("Rough at 120 in D♭ — 115 there?").
  - The exercise's overall rating (for when it's due) comes from its keys: the worst one.
  The log already records each session's keys and tempo, so there's history to start from.
- **Comping under notation** (S). Notation with chord symbols could play a simple comp under the
  line (the notation library can, it's turned off for now), as a mini backing track.
- **Walking bass, next steps** (S–M). The basic loop is in (1-2-3-5 per chord, on a tune's chart
  and on Through the changes). Next: chromatic approach notes into the next chord, a hi-hat sound
  for the click, looping just a section or a few bars, and the bass
  under a lick over part of a progression.
- **Licks over related progressions** (M, to think about). A lick could also fit progressions that
  aren't the same chord kinds: a minor ii–V–i lick over its relative major, a ii–V lick starting a
  minor 3rd up, and so on. Not every lick works this way — maybe offered only for ones marked so.
- **Licks written in any key** (S–M, parked). Enter a lick in the key it was learned in (not only
  in C), so seeing it "as written" makes the transposing even more of a workout.

## Listening and slowing down

- **YouTube loop / slow-downer** (M). Play a recording's YouTube video inside the app with A–B
  looping and speed control (the YouTube player supports 0.25×–2× speed).
- **Local-file slow-downer** (M). Open an audio file (from Files or Dropbox) and loop / slow it
  down / change key in the browser.
- **Apple Music / iTunes Match tracks** (L). Needs a native app: web apps can't read the music
  library. The decision point for wrapping the app with Capacitor (which would also allow proper
  app-to-app links, background audio, and a home-screen widget).

## Practice tools

- **Transcription from the mic** (L). Play a phrase and get notation (sax first: one note at a
  time is far easier than piano). The tuner's pitch detection is the starting point.
- **Practice-day rollover as a setting** (S). It's fixed at 4am now.
- **Tuner with the metronome on iPhone** (check). Set up to work, but untested on a real device.

## Data

- **Sync between devices** (L). Everything lives on one phone; syncing would need a server or a
  sync service (or storing a backup in the connected Dropbox — M).

## A native app (parked)

Moving to a native iPhone app (or a native shell around this one, e.g. Capacitor) would get past
limits the web app keeps running into:
- **Stereo recording** with the iPhone's built-in mics (Safari only gives web apps one channel), and
  full control of which mic records and where sound plays (phone mic + metronome in earbuds).
- **Audio that keeps going in the background**: the metronome, tuner and recorder stop when the app
  is hidden or the phone locks; a native audio session can keep them running.
- **Launching other apps** (Quartet's URL scheme), the Files app, and share sheets more reliably.
- **Keeping the screen on** without workarounds, and notifications (practice reminders).
- **Storage** that iOS won't clear, and iCloud backup/sync instead of manual export.
The logic (plans, theory, charts, warm-ups) is plain JS with no DOM, so it could carry over to a
native shell largely as is; the UI and audio/recording layers are what would change.

## Code health (from the review)

- **App updates while it's open** (S–M). A new deploy can break the notation player or assistant
  in an already-open app until it's reloaded. Fix: an "Update ready" prompt instead of switching
  immediately.
- **Double-tapping Play** on notation can start two playbacks.
- **Refactors** (M): merge the tune and exercise detail sheets; move the notation editor into its
  own file; share the name lookup, dictation, file-sharing and streak code; cache `itemStats()`;
  redraw only the latest chat message while the assistant streams; remove dead code and CSS.
