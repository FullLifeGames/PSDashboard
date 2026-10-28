# PS Dashboard

[![Deploy GitHub Pages](https://github.com/FullLifeGames/PSDashboard/actions/workflows/pages.yml/badge.svg)](https://github.com/FullLifeGames/PSDashboard/actions/workflows/pages.yml) [![Tests](https://github.com/FullLifeGames/PSDashboard/actions/workflows/test.yml/badge.svg)](https://github.com/FullLifeGames/PSDashboard/actions/workflows/test.yml) [![Release](https://img.shields.io/github/v/release/FullLifeGames/PSDashboard)](https://github.com/FullLifeGames/PSDashboard/releases/latest)

Chess-style analysis for Pokémon Showdown replays. Load a replay, scrub to any turn, read the engine's evaluation, and play out your own line from there.

![PS Dashboard at turn 12 of a Gen 8 OU tournament game: the replay on the left, the evaluation and the turn's analysis on the right](./.github/images/ps-dashboard.png)

- **Use it:** [release](https://fulllifegames.com/Tools/PSDashboard/) · [nightly](https://fulllifegames.github.io/PSDashboard/) · [all hosted builds](https://fulllifegames.github.io/PSDashboard/versions/)
- **Read more:** [ARCHITECTURE.md](./ARCHITECTURE.md) for how the code works · [EVALUATION.md](./EVALUATION.md) for what the engine computes and how far to trust it · [ENGINES.md](./ENGINES.md) for plugging in an engine of your own

## What it does

- **Load any replay.** A Showdown URL, a `psim.us/r/<id>` short link, or an id (private `-…pw` links and smogtours ids included), or a downloaded replay `.html` or raw protocol log dropped onto the page.
- **See both teams.** Revealed facts come from the protocol, the rest from usage stats and Smogon sets, and EV spreads are fitted to the damage the replay showed. Every field is labeled revealed, sheet, guessed, or manual.
- **Read the position like a chess engine.** A search on the real simulator plays out every legal choice pair, solves the result as a matrix game, and reports a win probability calibrated on real game outcomes. It covers singles, doubles, VGC bring-four, and Pokémon Champions.
- **Grade the whole game.** `Analyze game` draws the win-probability graph, bands every turn as inaccuracy, mistake, or blunder, splits each swing into decision and luck, and writes a report with accuracy scores, key moments, and paid-off reads.
- **Play your own line.** Execute a different move at any turn, turn 0 included, and the variation opens right there. Step back, try another move, or let the engine finish the game for both sides.
- **Fix the hidden information.** Edit sets in place or import both teams as text; edits rebuild the variation and persist per replay.
- **Embed it.** A deep link loads a replay on startup, embed mode hides the chrome, and a `postMessage` handoff feeds in replays you host yourself.
- **Bring your own engine.** A bot or model of yours evaluates in place of the built-in search: it answers the engine protocol over HTTP ([ENGINES.md](./ENGINES.md)), and `+ engine` in the Evaluation panel adds it.
- **Report a problem.** `Report issue` in the header opens a dialog: download the app's state as a file, then open a prefilled GitHub issue and attach the file.

## Quick start

1. Paste a replay URL or id, or drop an exported replay file onto the loader.
2. Scrub to a turn. Pause there for a second and the app rebuilds the exact position: PP, disabled moves, doubles targets.
3. Read the evaluation column: the score, the ranked lines, the safe line, and the punishing reply.
4. Click an engine line, or pick a move for each side and execute. The variation opens and the timeline marks it in gold.
5. `Analyze game` grades every turn. Click a graph point to jump to that turn's analysis.
6. The `Setup` menu in the top bar holds `Edit Player`, `Edit Opp`, and `Import/Export Sets`, which fix the hidden information when a guess is wrong, and the switch for animating branch turns.

The score is an estimate for spotting swings and blunders, not an oracle. The app needs the network: replays come from replay.pokemonshowdown.com (file drops work offline), the viewer script and sprites from play.pokemonshowdown.com, and usage stats from data.pkmn.cc with a GitHub Pages mirror.

## Reporting a problem

The header names the app, marks it as a beta, and carries `Report issue` and the creator link. `Report issue` opens a dialog with two steps: download `ps-dashboard-state-<replay>-<time>.json`, then open the GitHub issue form, which comes with the app version, the replay, the position and the message on screen filled in. Drag the file into the issue: it holds the replay log, the sets the app played with, the variation and its choices, the position on screen, unsent drafts, the messages, the engine settings and the window size, enough to replay the report exactly. A GitHub issue is public, and the file shows the replay and any team you pasted.

To reproduce a report, run `REPRO_STATE=<state file> npm run test:e2e -- test/e2e/repro-state.spec.ts`: the test loads the file's replay, restores the state, prints what the reporter saw, and stops with a screenshot. In the browser console, `await window.__psState.capture()` returns the current state, and `await window.__psState.restore(state)` restores one onto the loaded replay.

## Embedding

- **Deep link:** `?replay=gen3customgame-2115579570` loads that replay on startup, standalone or inside an iframe.
- **Embed mode:** `?embed=1` hides the header and the loader; the top bar keeps `Report issue` and leaves the creator link to the host page. Combine both: `?embed=1&replay=<id>`.
- **postMessage** for replays you host yourself (exported HTML files, raw logs):

```html
<iframe id="dashboard" src="https://…/?embed=1"></iframe>
<script>
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'ps-embed-ready') {
      // A replay id/URL, a raw protocol log, or a full exported replay HTML document:
      document.getElementById('dashboard').contentWindow
        .postMessage({ type: 'ps-load-replay', replay: 'gen3customgame-2115579570' }, '*');
    }
    if (event.data?.type === 'ps-replay-loaded') console.log('loaded', event.data.id);
    if (event.data?.type === 'ps-replay-error') console.warn(event.data.message);
  });
</script>
```

The app posts `ps-embed-ready` once it accepts replays and answers every `ps-load-replay` with `ps-replay-loaded` (`id`, `format`) or `ps-replay-error` (`message`). [examples/embed-host.html](./examples/embed-host.html) is a runnable host page: start `npm run dev` and open `http://localhost:5173/examples/embed-host.html`.

## Repository layout

- `src/`: the React app (Vite, TypeScript): components, controller hooks, `lib/`, and the worker that runs searches and replay jobs off the main thread.
- [packages/replay-core](./packages/replay-core/): `@fulllifegames/replay-core`, replay logs to snapshots, revealed teams, simulator sets, and fitted spreads. No network, no DOM.
- [packages/eval-engine](./packages/eval-engine/): `@fulllifegames/eval-engine`, position reconstruction, search, grading, and the game report.
- `test/regression/`: Vitest specs for the app code and the measurement harnesses; `test/ui/`: component and hook specs under jsdom.
- `test/e2e/`: Playwright browser flows, one file per theme; `test/e2e-build/`: a smoke test of the minified bundle; `test/e2e-feedback/`: the expert-feedback drift suite.
- `scripts/`: release, pack, lint-ratchet, and calibration tooling; `examples/`: the embed host page; `packages/eval-engine/examples/engine-python/`: a sample engine; `public/`: static assets.
- [NextSteps.md](./NextSteps.md) lists the open work, [docs/backlog.md](./docs/backlog.md) the detail behind each item, and [docs/completed/](./docs/completed/) the finished rounds. [AGENTS.md](./AGENTS.md) holds the working rules for agents and contributors.

## Development

Node.js 24 and npm. One install covers the npm workspace (the app and the two packages).

```bash
npm install
npx playwright install   # once, for the browser suites
npm run dev              # local Vite server
```

| Command | What it checks |
| --- | --- |
| `npm run lint` | ESLint with size and complexity ceilings and import zones |
| `npm run build` | the production bundle |
| `npm run build:packages` | compiles both packages to their `dist/` |
| `npm run test:regression` | the Vitest suite in four projects: app, replay-core, eval-engine, ui (`npx vitest` for watch mode, `--changed` for the tests behind your edits) |
| `npm run test:ui` | the app suite alone: components and hooks under jsdom with Testing Library |
| `npm run test:e2e` | browser flows against fixture replays |
| `npm run test:build` | the minified bundle, driven in a browser |
| `npm run test:feedback` | the expert-feedback drift report, on demand; it writes its report to `docs/reports/`, which stays local |
| `npm run knip` | unused files, exports, and dependencies |
| `npm test -w packages/<name>` | one package's own suite |
| `npm run pack:smoke` | packs both packages and runs their README examples from the tarballs |
| `npx @fulllifegames/eval-engine check-engine <url>` | an engine endpoint against the engine protocol ([ENGINES.md](./ENGINES.md)) |

CI ([test.yml](./.github/workflows/test.yml)) runs three jobs: the Node suites, the browser flows, and a smoke test of the production build. The Node job also runs the eval-engine project twice more with the simulator speed layer forced off and on (`EVAL_SIM_FAST=0` and `1`), and the pages workflow lints before it deploys.

### Contributing

- New files stay under the lint ceilings of 300 lines per file, 60 per function, and complexity 15. Older files sit on shrink-only pins in `eslint.ratchet.mjs`; `node scripts/update-lint-ratchet.mjs` re-measures them and refuses to raise a pin.
- `eslint.zones.mjs` makes the layering a lint error: a package never reaches `src/`, replay-core never imports the engine, the app imports the packages by name (dynamic imports go through `src/lib/lazy/`), and nothing under `src/lib` imports the UI.
- Keep the knip report empty; internal helpers stay unexported.
- Package barrels (`packages/*/src/index.ts`) are the public API. After widening one, run `UPDATE_API_SNAPSHOT=1 npm run test:regression -- test/regression/package-api.spec.ts`.
- A package behavior gets its spec under `packages/<name>/test/`. A spec that needs app code goes under `test/regression/`, a component or hook spec under `test/ui/`, and a browser flow into the matching theme file under `test/e2e/`.

## Releases and hosting

Bumping `version` in `package.json` on `master` cuts a release (`npm version patch --no-git-tag-version`, commit, push). The [release workflow](./.github/workflows/release.yml) builds the app, tags `v<version>`, and publishes a GitHub Release with `ps-dashboard-<version>.zip`.

The same release publishes the library packages whose files changed since the previous tag ([scripts/publish-packages.mjs](./scripts/publish-packages.mjs), `--dry-run` prints the plan). Each package names this repository and `release.yml` as its npm trusted publisher, so there is no npm secret and every published version carries a provenance attestation.

The [pages workflow](./.github/workflows/pages.yml) deploys on every push to `master` and on every release:

| URL | Channel |
| --- | --- |
| `/` | nightly, current `master` |
| `/latest/` | the newest release |
| `/v<version>/` | that release, frozen; the ten most recent stay hosted |
| `/versions/` | index of every hosted build |

Frozen builds come from the release zip and never rebuild from old source. `vite.config.ts` keeps `base: "./"` so a build runs from any subdirectory. A maintainer copies a release to fulllifegames.com by hand; no workflow deploys there.

## License

[MIT](./LICENSE)
