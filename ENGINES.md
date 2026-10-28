# Engines

PS Dashboard evaluates positions with its own search on the simulator. Your engine can take its place: a Showdown bot, a trained model, or a search of your own. It answers the PS Dashboard engine protocol (`ps-dashboard-engine/1`) over HTTP, and a user picks it in the Evaluation panel.

## Try it in three steps

1. Start the example engine, one Python file without dependencies: `python packages/eval-engine/examples/engine-python/engine.py`. It answers on `http://localhost:8765/`.
2. Check it: `npx @fulllifegames/eval-engine check-engine http://localhost:8765/`. The check sends three shipped positions (singles, doubles, VGC) and reads every answer the way the dashboard reads it.
3. Add it in the app: load a replay, click `+ engine` in the Evaluation panel, and enter a name and the address. The panel now shows an `Engine` dropdown with your engine selected, and `Evaluate`, `Analyze game` and `Let it play out` ask it instead of the built-in search.

The example has no judgment of its own: it rates every attack a little above every switch. Your engine replaces its `judge` function.

The app keeps added engines in your browser. Switching engines clears the evaluation and the game graph, and the cache keeps each engine's results apart. Every position you evaluate goes to the engine's address.

## The request

For each position the dashboard sends one `POST` with a JSON body:

| Field | What it holds |
| --- | --- |
| `protocol` | `"ps-dashboard-engine/1"` |
| `format` | the game's format as Showdown names it: `gen9ou`, `gen9vgc2026regi`, `gen9championsvgc2026regmb` |
| `simFormat` | the format the simulator state runs on: the dashboard rebuilds VGC and Doubles OU games as `genNdoublesou`, Champions games on the Champions formats, and an unknown singles format as a custom game |
| `gen`, `gameType` | the generation, and `singles` or `doubles` |
| `turn` | the turn about to be played |
| `log` | the battle log up to this position as a spectator sees it: protocol lines without hidden information |
| `requests` | each side's request as the simulator sends it to that player (the `\|request\|` JSON), under `p1` and `p2`; `null` for a side with nothing to choose |
| `options` | the legal options the dashboard ranks, under `p1` and `p2` |
| `state` | the whole battle as `@pkmn/sim` serializes it (`State.serialize`): both teams as the dashboard built them, the field, the PRNG |
| `budgetMs` | how long the engine may think, in milliseconds (5000 in the app) |

Each option has an `id`, a `label` for the screen and a `command`, the choice as a Showdown client sends it. Three options from three games:

```json
[
  { "id": "move psychicnoise terastallize", "label": "Tera + Psychic Noise", "command": "move psychicnoise terastallize" },
  { "id": "move uturn > switch 3", "label": "U-turn → Kyurem", "command": "move uturn", "then": "switch 3" },
  { "id": "move 1 1 terastallize, move 2 -1", "label": "Tera + Heat Wave → Rillaboom + Protect", "command": "move 1 1 terastallize, move 2 -1" }
]
```

A pivot move carries its switch-in in `then`, which a client sends when the simulator asks for it. In doubles one option covers both active Pokémon.

A bot finds what it reads in a live battle in `log` and `requests`. An engine on the simulator restores `state`. The teams in `state` hold what the replay revealed plus the dashboard's guesses for the rest (usage stats, Smogon sets, fitted spreads), and the user can correct them in the app.

## The response

| Field | What it holds |
| --- | --- |
| `protocol` | `"ps-dashboard-engine/1"` |
| `score` | the position's value from p1's side |
| `values` | a value for every option of both sides, each from its own side's view, keyed by option `id` |
| `matrix` | optional: the value of every pair of options from p1's side; `p1` and `p2` list the option ids, `values` holds one row per `p1` entry and one column per `p2` entry |
| `engine` | optional: `name` and `version` of the build that answered; the dashboard records the version with the result, and the panel names the engine as the user added it |

Every value is a win expectation from -1 (lost) to +1 (won). A minimal answer:

```json
{
  "protocol": "ps-dashboard-engine/1",
  "score": 0.1,
  "values": {
    "p1": { "move closecombat": 0.25, "switch 5": -0.05 },
    "p2": { "move shadowball": -0.1, "switch 6": -0.2 }
  },
  "engine": { "name": "My engine", "version": "1" }
}
```

With a matrix the dashboard solves the game with the ranking its own engine uses: each option's floor, the reply that punishes it, the equilibrium and the reads. Without one the dashboard takes `score` and `values` as given, and the analysis shows the values and the verdict tiers.

The dashboard refuses an answer that breaks the protocol and shows the reason in the panel: another protocol string, a value outside -1 to 1, a missing or unknown option id, a matrix that does not list every option once or lacks a cell. It gives up 5 seconds after the budget ends. `check-engine` runs the same checks.

## Checking an engine

```sh
npx @fulllifegames/eval-engine check-engine <url> [--budget <ms>] [--origin <origin>]...
```

The check sends the shipped positions, times each answer against the budget (5000 ms unless `--budget` sets another), and asks the browser's preflight question for each page that hosts the dashboard: `https://fulllifegames.github.io` and `https://fulllifegames.com`. `--origin` replaces that list, for example with `http://localhost:5173` for a local dev server. The command exits with 0 when everything passes.

## Hosting

The dashboard calls your engine from the browser, so the engine must allow the page's origin (CORS):

- answer the preflight (`OPTIONS`) and the `POST` with `Access-Control-Allow-Origin` (`*` or the page's origin);
- name `content-type` in `Access-Control-Allow-Headers` and `POST` in `Access-Control-Allow-Methods`.

The hosted dashboard runs on https, and browsers block its calls to plain http addresses other than localhost: a hosted engine needs https. An engine on your own machine works on `http://localhost`; the Python example also sends `Access-Control-Allow-Private-Network: true`, which Chrome asks for when a public page calls a local address.

## Building requests yourself

`@fulllifegames/eval-engine` ships the protocol for JavaScript and TypeScript authors:

- `ENGINE_PROTOCOL` and the types `EngineRequest`, `EngineResponse` and `EngineOption`;
- `engineRequestFor(serialized, budgetMs, tera, format)` builds the request the dashboard would send for any serialized position, with the options its own search ranks; `buildEngineRequest` takes options of your choice;
- `validateEngineResponse(request, answer)` runs the dashboard's checks, and `engineResponseToResult(request, response)` reads an answer into the `EvalResult` the analysis shows;
- `checkEngine(url, { positions })` is the check behind the command line, and `DASHBOARD_ORIGINS` lists the hosting pages.

The sample positions ship in the package's `samples/` folder: each holds the replay id, the turn, the game's format and the serialized battle.

## Contribute an engine

An engine in the repository shows in every user's dropdown. Open a pull request that adds an entry to `CONTRIBUTED_ENGINES` in [`src/lib/engines/registry.ts`](./src/lib/engines/registry.ts):

```ts
{ id: 'my-engine', name: 'My engine', url: 'https://engine.example.com/', author: 'Your name', homepage: 'https://example.com/my-engine', source: 'contributed' }
```

The address must be a hosted https endpoint that passes `check-engine` with the default origins. The `id` stays the same for the life of the engine, because results and cache keys carry it.

## Versions

The protocol string names the version. A change that breaks an engine gets a new version, and the dashboard keeps talking to engines that speak the old one.
