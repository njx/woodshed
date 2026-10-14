# Woodshed

A jazz-practice PWA, used mainly on an iPhone from the home screen (iOS Safari). Everything lives on
the device (IndexedDB); the only network use is the assistant (the user's own Anthropic key),
samples, and the app itself. The README has the user-facing tour and the code layout.

## Working on it

- `npm run typecheck`, `npm test` (Vitest, `test/`), `npx playwright test` (`e2e/`, a phone-sized
  Chromium; ~5 min for all; `-g <name>` and `--project=iphone-13` for one). Run all three before a
  push: CI runs the same, and a red push blocks the deploy.
- `e2e/visual.spec.js` compares screenshots locally only (skipped in CI: fonts differ). After a
  change that's meant to look different: `npx playwright test visual --update-snapshots`, then look
  at the new images before committing them.
- Tests seed `Math.random` (`e2e/app.js`); anything that changes how many random numbers are drawn
  before the first render (even importing a library first) shifts what's picked and the snapshots.
- Pushing to `main` deploys (GitHub Pages, `.github/workflows/pages.yml`). Changes go on the working
  branch and to `main`.
- A new behaviour gets a test that fails without it; check that it does.

## How it's built

- Strict TypeScript; Lit components with decorators, rendered into the light DOM (`View` in
  `src/ui/lit.ts`); `styles.css` styles everything. `src/types.ts` is the data model.
- **Every change to the data is a command** (`src/commands/`): fields plus a `run` that makes the
  change and its follow-ups. The UI runs them with `perform()` (`src/ui/shell.ts`), which renders,
  and shows Undo for `undoToast` ones; `exec()` is the bare version. Don't mutate `store.state` from
  the UI. Commands run all or nothing and go on one undo stack (`commands/core.ts`); typing into a
  field coalesces into one undo. Preferences that aren't the practice data (metronome's last tempo,
  recorder's mic, hints seen) are saved directly.
- **The assistant's tools are the commands**: every command with a `description` is a tool, its
  schema made from its fields (`f.key()` reads written key names, `f.item()` checks ids, `f.app()`
  is app-only). Its read-only queries are in `src/assistant/tools.ts`. A command with `ask` waits
  for the user's tap before the assistant can do it.
- Data safety: `src/validate.ts` checks everything loaded or imported; schema migrations are in
  `src/store.ts` (bump `SCHEMA_VERSION`); a copy is kept before an upgrade, import or reset
  (`keepCopy`).
- Audio: one shared AudioContext (`src/audio.ts`: `acquireAudio`, each user's own `output()`,
  `release`); the iPhone's audio session in `src/audiosession.ts`. Things that play must start from a
  tap. Settings → Mic test opens the mic each way, for external-mic trouble.
- Music: keys are concert pitch, 0–23 (12+ minor); shown written for the chosen instrument (`kn`,
  `keyName`). Charts in `src/chords.ts` (`formBars` for the played form), notation is ABC
  (`src/abc.ts`, abcjs), the walking bass in `src/bass.ts`.

## Style

- Comments and UI text are plain English, short, in sentence case; curly quotes and apostrophes
  (’) in UI text. Comments say what something is for, as the existing ones do.
- Match the surrounding code; no new dependencies without a good reason.
- `IDEAS.md` keeps feature ideas and parked follow-ups.
