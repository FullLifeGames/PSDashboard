# PS Dashboard

[![Deploy GitHub Pages](https://github.com/FullLifeGames/PSDashboard/actions/workflows/pages.yml/badge.svg)](https://github.com/FullLifeGames/PSDashboard/actions/workflows/pages.yml) [![Release](https://img.shields.io/github/v/release/FullLifeGames/PSDashboard)](https://github.com/FullLifeGames/PSDashboard/releases/latest)

Chess-style analysis for Pokémon Showdown replays. Load a replay, scrub to any turn, read the engine's evaluation, and play out your own line from there.

- **Use it:** [release](https://fulllifegames.com/Tools/PSDashboard/) · [nightly](https://fulllifegames.github.io/PSDashboard/) · [all hosted builds](https://fulllifegames.github.io/PSDashboard/versions/)
- **Read more:** [ARCHITECTURE.md](./ARCHITECTURE.md) for how the code is layered · [EVALUATION.md](./EVALUATION.md) for what the engine computes and how far to trust it

## What it does

- **Load any replay.** A Showdown URL or id (private `-…pw` links and smogtours ids included), or a downloaded replay `.html` or raw protocol log dropped onto the page.
- **See both teams.** The app reads what the protocol reveals, fills the rest from usage stats and Smogon sets, fits EV spreads to the damage the replay showed, and labels every field as revealed, sheet, guessed, or manual.
- **Read the position like a chess engine.** A sim-backed search plays out every legal choice pair, solves the result as a matrix game, and reports a win probability calibrated on real game outcomes. Singles and doubles, VGC bring-four included.
- **Grade the whole game.** `Analyze game` draws the win-probability graph, bands every turn as inaccuracy, mistake, or blunder, splits each swing into decision and luck, and writes a report with accuracy scores, key moments, and paid-off reads.
- **Play your own line.** Execute a different move at any turn, turn 0 included, and the variation opens right there. Step back, try another move, or let the engine finish the game for both sides.
- **Fix the hidden information.** Edit sets in place or import both teams as text; edits rebuild the variation and persist per replay.
- **Embed it.** A deep link loads a replay on startup, embed mode hides the chrome, and a `postMessage` handoff feeds in replays you host yourself.

## Quick start

1. Paste a replay URL or id, or drop an exported replay file onto the loader.
2. Scrub to a turn. Pause there for a second and the app rebuilds the exact position: PP, disabled moves, doubles targets.
3. Read the evaluation column: the score, the ranked lines, the safe line, and the punishing reply.
4. Click an engine line, or pick a move for each side and execute. The variation opens and the timeline marks it in gold.
5. `Analyze game` grades every turn. Click a graph point to jump to that turn's analysis.
6. `Import/Export Sets`, `Edit Player`, and `Edit Opp` fix the hidden information when a guess is wrong.

The score is an estimate for spotting swings and blunders, not an oracle. [EVALUATION.md](./EVALUATION.md) lists what the engine knows, what it guesses, and where it goes wrong.

## Embedding

- **Deep link:** `?replay=gen3customgame-2115579570` loads that replay on startup, standalone or inside an iframe.
- **Embed mode:** `?embed=1` hides the header and the loader. Combine both: `?embed=1&replay=<id>`.
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

## Development

Node.js 24 and npm. One install covers the npm workspace: the app at the root and two library packages under [packages/](./packages/). [@fulllifegames/replay-core](./packages/replay-core/) turns a replay log into snapshots, revealed teams, and simulator sets; [@fulllifegames/eval-engine](./packages/eval-engine/) rebuilds positions, searches them, grades the played turns, and writes the report. Each package README carries its install line and a worked Node example.

```bash
npm install
npx playwright install   # once, for the browser suites
npm run dev              # local Vite server
```

| Command | What it checks |
| --- | --- |
| `npm run lint` | ESLint with size and complexity ceilings and import zones |
| `npm run build` | the production bundle |
| `npm run test:regression` | unit and reconstruction pins in three Vitest projects: app, replay-core, eval-engine (`npx vitest` for watch mode, `--changed` for the tests behind your edits) |
| `npm run test:e2e` | browser flows against fixture replays |
| `npm run test:build` | the minified bundle, driven in a browser |
| `npm run test:feedback` | the expert-feedback drift report, on demand |
| `npm run knip` | unused files, exports, and dependencies |
| `npm test -w packages/<name>` | one package's own suite (replay-core or eval-engine) |
| `npm run pack:smoke` | packs both packages and runs their README examples from the tarballs |

### Contributing

- New files stay under the lint ceilings: 300 lines per file, 60 per function, complexity 15. Older files sit on shrink-only pins in `eslint.ratchet.mjs`; `node scripts/update-lint-ratchet.mjs` re-measures them and refuses to raise a pin.
- `eslint.zones.mjs` makes the layering a lint error: a package never reaches `src/`, replay-core never imports the engine, the app imports the packages by name (dynamic imports go through `src/lib/lazy/`), and nothing under `src/lib` imports the UI.
- Keep the knip report empty; internal helpers stay unexported.
- Package barrels (`packages/*/src/index.ts`) are the public API. Widening one is a one-line edit followed by `UPDATE_API_SNAPSHOT=1 npm run test:regression -- regression/package-api.spec.ts`; package sources import each other with `.ts` specifiers.
- A new package behavior gets its spec under `packages/<name>/test/` (imports `../src/<module>`); a spec that needs app code stays under `regression/`.
- Direct dependencies track their latest registry versions (`npm outdated`), with two exceptions: TypeScript stays on 6.x until typescript-eslint admits the 7.x compiler, and `@types/node` follows the Node major the workflows run.

## Releases and hosting

Bumping `version` in `package.json` on `master` cuts a release. The [release workflow](./.github/workflows/release.yml) builds the app, tags `v<version>`, and publishes a GitHub Release with `ps-dashboard-<version>.zip`.

```bash
npm version patch --no-git-tag-version
git commit -am "<version> release bump"
git push
```

The same release publishes the changed library packages: [scripts/publish-packages.mjs](./scripts/publish-packages.mjs) writes the root version into both manifests, selects the packages whose files changed since the previous tag, and runs `npm publish`. The job needs the `NPM_TOKEN` secret and otherwise ends green with a notice; `node scripts/publish-packages.mjs --dry-run` prints the plan locally.

The [pages workflow](./.github/workflows/pages.yml) deploys on every push to `master` and on every release:

| URL | Channel |
| --- | --- |
| `/` | nightly, current `master` |
| `/latest/` | the newest release |
| `/v<version>/` | that release, frozen; the ten most recent stay hosted |
| `/versions/` | index of every hosted build |

The workflow unpacks frozen builds from the release zip and never rebuilds them from old source; [scripts/build-versions-index.mjs](./scripts/build-versions-index.mjs) renders the `/versions/` index from the manifest of unpacked releases. `vite.config.ts` keeps `base: "./"` so a build runs from any subdirectory; an absolute base would break every versioned copy. A maintainer copies a release to fulllifegames.com by hand; no workflow deploys there.

## License

[MIT](./LICENSE)
