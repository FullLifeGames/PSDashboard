# AGENTS.md

Rules for agents working on PS Dashboard. Claude Code reads this file through `CLAUDE.md`. What comes next is in `NextSteps.md`; the details of every open TODO are in `docs/backlog.md`; finished rounds are in `docs/completed/`.

## The project

PS Dashboard analyzes Pokémon Showdown replays: it replays a game turn by turn, branches at any turn ("what if"), and grades moves with its own evaluation engine.

- `src/`: the React app (Vite, TypeScript), published on GitHub Pages.
- `packages/replay-core` (`@fulllifegames/replay-core`): parser, snapshots, team building, spread solver.
- `packages/eval-engine` (`@fulllifegames/eval-engine`): static evaluation, MCTS trees, verify round, prover, report.
- `regression/`: Node tests of the app and the calibration bank (`eval-calibration.spec.ts`, which also holds the ledger of every round); `e2e/`: Playwright; `e2e-feedback/`: the feedback corpus with the expert pins (`corpus.ts`).
- Keep the three layers apart: ingestion and inference, deterministic reconstruction with `@pkmn/sim`, user interface.
- Branches: work happens on `v1` (pushed to origin). Each round runs on its own branch from `v1`, deleted after the push. `master` stays at 94c88d9 unless the user says otherwise; GitHub Pages builds from `master`.

## Working with the user

- Plain language: every summary, gate and report starts with the problem in one game scene, the idea with an everyday comparison, what changes for the user, and how success is measured. Project terms (pin, gate, golden, bank) are fine; new coinages are not.
- Gates: numbered questions in plain text, two sentences of scene per question, options a/b/c in one or two sentences each, the recommendation marked, answer format "1a 2a 3a".
- Tracked documents and every user-facing string go through the `stop-slop` skill: no dashes as separators, no filler adverbs, active voice, specific claims. Exceptions: verbatim quotes of app output, technical invariants with "never" or "always", placeholder glyphs. The engine's prose (`summary.ts`, `report.ts`) is pinned by the feedback corpus and changes only in a round of its own.
- Commits: English, imperative, release style, no attribution lines (no Co-Authored-By). Write messages with quotes to a file and use `git commit -F <file>`.
- No push, and no deleting branches, worktrees or files you did not create, without the user's okay. An okay covers the named state only.
- The user reports library bugs upstream himself; collect them as an upstream list with a scene and evidence.
- Re-pins (a test or pin whose expected verdict changes) happen only at the user gate.

## Rules for the code

- Game rules come from the simulator and the Dex (`@pkmn/sim`, `@pkmn/dex`, `@pkmn/mods`, `@pkmn/client`, `@pkmn/protocol`). Our code translates and reads library data, never species or move names. Where our code must know a rule, a test checks it against the simulator. Moving logic into the libraries is welcome.
- A rule that is right by the game stays, even when the bank reads it worse: then the weights are wrong, and a refit becomes a TODO. Published Smogon sets are read as published.
- Pokémon Champions and Scarlet/Violet differ in rules: that is a question of the battle's mode, not a bug.
- A Custom Game (draft leagues) plays with each species' own abilities; only Hackmons formats are free. Before recommending anything that rests on a game rule, check that the species can really have it.
- PP and heal fractions come live from the simulator (`moveSlots[].pp`, `move.heal`), never derived from Dex base values.
- Singles and doubles are equal citizens, and VGC (Scarlet/Violet and Champions) counts on its own: every feature covers both game types in the same step, every measurement counts doubles and VGC separately.
- React: state that follows a prop is reconciled during render, never in an effect (lint rule `react-hooks/set-state-in-effect`).
- Dependencies: direct dependencies track their latest registry versions (`npm outdated`). Two exceptions: TypeScript stays on 6.x until typescript-eslint admits the 7.x compiler, and `@types/node` follows the Node major the workflows run.

## Checks before commit and push

- `npx tsc -b` (`tsc --noEmit` checks nothing in this solution setup) and `npm run lint` before every push; the Pages workflow has its own lint gate. The lint ratchet (`eslint.ratchet.mjs`) only shrinks: split a file instead of raising its limit, and run `node scripts/update-lint-ratchet.mjs` after a refactor.
- Tests: `npx vitest run --project <eval-engine|replay-core|ui|app>` or single files; the full suite with `npx vitest run`; e2e with `npm run test:e2e` (a separate port via `PS_DEV_PORT`).
- Package exports: a barrel change shows as a diff under `regression/fixtures/api/` (`UPDATE_API_SNAPSHOT=1` only on purpose), then `npm run pack:smoke`.
- Test first: a red test that fails for the right reason, then the code.

## Measuring and judging

- Score-touching changes (D3): bump the cache version once per round (`EVAL_ENGINE_CACHE_VERSION` in `src/lib/eval-cache-store.ts`), run the paired bank against a fresh base of the same day, run the feedback corpus three times byte-identical, and read the tier census (`node scripts/tier-census.mjs`, with `--moved` for every moved turn). A batch of small fixes uses its batch check instead (see Change classes).
- Bank verdicts (`scripts/paired-calibration.mjs`, tables full and hq, fixed K and own K per phase): pooled rows decide, phase cells warn. Harm means a pooled row at least 5 bp worse with its band wholly on the bad side; a warning is the same in a phase cell.
- Doubles verdicts read the bank together with the Doubles OU and VGC holdouts (D26); the Champions families have their own holdouts.
- Lossless changes (D4): three byte-identical feedback runs, the bank digit-identical, regression, e2e, lint, `tsc -b`.
- Order for tree and verify changes: the play-out pin first (`e2e/branch.spec.ts`, draft t56), then the golden replay 655336, then the bank.
- Set and solver changes: set diffs on every build path before the bank (the bank builds like the app, through `buildAppTeams`).
- Monte-Carlo references of scene pins price their leaves with the engine's static evaluation: recompute them after every weight change before calling a pin wrong.
- Wall-clock timing only interleaved with the base on a quiet machine; no tests, probes or agents meanwhile.
- Feedback dumps (`feedback-full-*.json`) exist only with `FEEDBACK_DUMP=1`; check their mtime before reading them.

## Tools and pitfalls

- Bank: `node scripts/run-calibration.mjs --slices 4 --out .calibration/<name>`; a holdout adds `--env EVAL_CALIBRATION_SOURCE=holdout --env EVAL_CALIBRATION_TRANCHE=holdout-<doublesou|vgc|championsou|championsvgc>`. At most four slices and never two heavy runs at once: the machine crashed several times under six slices.
- Base reuse: `node scripts/run-calibration.mjs --reuse ...` prints the folder of a finished run under `.calibration/` whose fingerprint matches (git tree ids of the inputs at HEAD, content hash of `.smogon-cache` and `.fit-corpus`, lever env, Node version, slice count) and starts nothing; a dirty tree never reuses, `--dry-run` shows the decision without a run, and runs from before round 70 have no fingerprint.
- Quick tier: `--env EVAL_CALIBRATION_FRACTION=0.25` keeps a quarter of the universe (the same replays every time, each tranche and family in proportion) for about a quarter of the machine time; `paired-calibration.mjs` pairs a quick run against a full base on the shared rows and names the fraction and the pairing count in its header. A quick pair screens, and a resolved row can flip in the full pair, so gates read the full pair.
- Crash protection (D23): commit before every heavy run and force freshly written files to disk; do not write to `.git` while the run is going. The repair recipe for zeroed `.git` files is in `docs/completed/` (incident of 20.09.2026).
- Worktrees: remove the junctions (`node_modules`, `.calibration`, `.smogon-cache`, `.fit-corpus`) one by one with `[System.IO.Directory]::Delete('<path>')` and check with a reparse-point scan before `git worktree remove`; otherwise git follows the junctions and deletes their targets (incident of 12.09.2026).
- Line endings: the repository checks out with `core.autocrlf`. Scripts match `\r?\n`; count conflict markers before `git add`. Test logs stay LF through `.gitattributes`.
- Probes never go under `regression/` (the suite collects them); they are `.vt.ts` files under `docs/perf/probes/<date>/` with their own Vitest config and `PROBE_ROOT`.
- The replay iframe's own `Config` stub (`PS_CONFIG_DEFAULTS` in `src/lib/replay-html.ts`) must carry Showdown's routes: the client reads `Config.routes` while it loads, and its scripts load in no fixed order.
- Feedback runs use port 5176; an orphaned dev server there makes every run fail at once. Do not edit root Markdown files during feedback, e2e or bank runs (Vite reloads).
- `docs/` is local (gitignored) except `docs/completed/` and `docs/backlog.md`; `.claude/` is local except `.claude/agents/`. `deploy.ps1` and `FeedbackEval.xlsx` stay untracked.

## Change classes

Every change gets a class before work starts: the integrator proposes it, the user can move it. The class sets the process, so delivery stays fast and machine time goes where a measurement decides something.

| Class | What it is | Process | Measurement |
| --- | --- | --- | --- |
| Small fix | A bug or a small TODO with a known cause and a local fix: one function or a few files, no new weight, no re-fit, no change to the package API | Red test, fix, green, straight into the batch branch; no spec | None per fix; the batch check at the end |
| Larger bug | The cause is unclear or spans several modules, or the fix changes a rule many paths read | Diagnosis first (a probe with the scene and its numbers, written down), then a TODO in `docs/backlog.md`, then the fix test-first | By its score class: lossless (D4) or score-touching (D3) |
| Feature | New behaviour for the user in the app, the engine or the package API | A round: brainstorming, spec with success criteria, plan, build with tests, measurement, user gate, booking | D3 or D4, as the change touches scores |
| Epic | A programme of several features (the Showdown Companion in `docs/backlog.md`) | Its own spec and plan with ordered steps; each step runs as a feature round with its own gate | Per step |

- Small fixes collect in a batch on one branch, score-touching ones included. The batch ends with one check: the checks before push, the cache version bumped once, one feedback run with the tier census, the paired bank only when the user asks for it. Every pin the batch moves waits for one gate at the end; each fix gets its own commit.
- A small fix that grows (a second cause, a re-fit, more than a few files) becomes a larger bug and gets its TODO.
- A bank or feedback run costs an hour of machine time, so it runs once per batch or round, never per fix.

## Working in rounds

- Rounds are numbered in one series across the project (the ledger calls them "improvement round N"). Each round: brainstorming and spec, build with tests, measurement, user gate, booking, push after the okay. A batch of small fixes is a round too: it gets a number and a short booking, without a spec and with its one check at the end.
- `NextSteps.md` holds only open work, as packages; a package is a round. TODOs carry fixed T-numbers; the next free number is in `NextSteps.md`.
- Booking at the end of a round: a ledger block in `regression/eval-calibration.spec.ts`, an entry in `docs/completed/<area>.md` (goal, delivered, evidence, measurement, gate, lessons, rests), rests as new TODOs in `docs/backlog.md` and as a line in their package, the header line of `NextSteps.md`. A fresh reviewer checks new TODOs against the code before they are booked.
- Waves: several lanes in parallel, one branch and worktree per lane, no shared file, measurements through the integrator's queue (one heavy run at a time), the merge in a separate clone, then a wave run with all holdouts and one gate with a table over all lanes.

## Agents

- Roles in `.claude/agents/`: `wave-builder` (Sonnet, builds one step), `wave-reviewer` (Sonnet, checks claims against the code), `wave-scout` (Haiku, finds and counts), `wave-reader` (Haiku, reads measurements by the rules above). The main session stays on Opus; sub-agents never run on Opus (`.claude/settings.local.json` lifts the global Opus setting).
- One fresh agent per step, starting from the brief, the plan, the ledger and `git log`, and writing its step into the ledger before it stops. After a pause of more than five minutes do not resume an old agent. A monitor reports the end of a measurement, never a sleep.
