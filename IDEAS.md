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

- **Chord charts for tunes** (M). The changes for ~290 of the 301 tunes are in
  mikeoliphant/JazzStandards (from iReal Pro's playlists; the same source as the tunes' keys —
  no licence file, so maybe fetch on first use rather than bundle). Show them by section with
  endings, written for your instrument and transposed into the key you're practicing; editable,
  and addable for tunes that don't match.
- **Warm-ups from a tune's chords** (M–L, needs charts). Find a tune's main chord qualities and
  its ii–Vs (major and minor), and pick exercises in those roots and types as a warm-up for it
  (e.g. Autumn Leaves: arpeggios on Am7♭5 and D7, harmonic minor in G, 1-2-3-5 on Cm7–F7).
- **Same key or chord across a day's exercises** (S). A setting: each exercise picks its own (now)
  / key of the day (one or two keys for all exercises, weak keys favoured) / from today's tunes.
- **Scale and chord types by overall weakness** (S). Weight types by how little you've played
  them across all exercises, times how long since this exercise had them (as keys already work).

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

## Code health (from the review)

- **App updates while it's open** (S–M). A new deploy can break the notation player or assistant
  in an already-open app until it's reloaded. Fix: an "Update ready" prompt instead of switching
  immediately.
- **Double-tapping Play** on notation can start two playbacks.
- **Refactors** (M): merge the tune and exercise detail sheets; move the notation editor into its
  own file; share the name lookup, dictation, file-sharing and streak code; cache `itemStats()`;
  redraw only the latest chat message while the assistant streams; remove dead code and CSS.
