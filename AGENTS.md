# AGENTS.md

Rules for agents working on PS Dashboard. Claude Code reads this file through `CLAUDE.md`. What comes next is in `NextSteps.md`; the details of every open TODO are in `docs/backlog.md`; finished rounds are in `docs/completed/`.

## The project

PS Dashboard analyzes Pokémon Showdown replays: it replays a game turn by turn, branches at any turn ("what if"), and grades moves with its own evaluation engine.

- `src/`: the React app (Vite, TypeScript), published on GitHub Pages.
- `packages/replay-core` (`@fulllifegames/replay-core`): parser, snapshots, team building, spread solver.
- `packages/eval-engine` (`@fulllifegames/eval-engine`): static evaluation, MCTS trees, verify round, prover, report.
- `test/regression/`: Node tests of the app and the calibration bank (`eval-calibration.spec.ts`, which also holds the ledger of every round); `test/ui/`: component and hook specs under jsdom; `test/e2e/` and `test/e2e-build/`: Playwright; `test/e2e-feedback/`: the feedback corpus with the expert pins (`corpus.ts`). Each package keeps its specs in its own `test/`.
- Keep the three layers apart: ingestion and inference, deterministic reconstruction with `@pkmn/sim`, user interface.
- Branches: work happens on `dev` (pushed to origin; it was `v1` until the release of 1.0.0, user 29.10.2026). Each round runs on its own branch from `dev`, deleted after the push. `master` moves only with the user's okay; it carries the release v1.0.2 (tag `v1.0.2`, 30.10.2026), and GitHub Pages builds from it. The production copy on fulllifegames.com, which the README calls the release, changes only through the local `deploy.ps1` (the releases of 1.0.0 to 1.0.2 ran it after the master push).

## Working with the user

- Plain language: every summary, gate and report starts with the problem in one game scene, the idea with an everyday comparison, what changes for the user, and how success is measured. Project terms (pin, gate, golden, bank) are fine; new coinages are not.
- Gates: numbered questions in plain text, two sentences of scene per question, options a/b/c in one or two sentences each, the recommendation marked, answer format "1a 2a 3a".
- Tracked documents and every user-facing string go through the `stop-slop` skill: no dashes as separators, no filler adverbs, active voice, specific claims. Exceptions: verbatim quotes of app output, technical invariants with "never" or "always", placeholder glyphs. The engine's prose (`summary.ts`, `report.ts`) is pinned by the feedback corpus: a change to it moves pins, and they wait for the gate of its round or batch.
- Commits: English, imperative, release style, no attribution lines (no Co-Authored-By). Write messages with quotes to a file and use `git commit -F <file>`.
- No push, and no deleting branches, worktrees or files you did not create, without the user's okay. An okay covers the named state only.
- The user reports library bugs upstream himself; collect them as an upstream list with a scene and evidence.
- Re-pins (a test or pin whose expected verdict changes) happen only at the user gate.

## Rules for the code

- Game rules come from the simulator and the Dex (`@pkmn/sim`, `@pkmn/dex`, `@pkmn/mods`, `@pkmn/client`, `@pkmn/protocol`). Our code translates and reads library data, never species or move names. Where our code must know a rule, a test checks it against the simulator. Moving logic into the libraries is welcome.
- Every rule comes from the game's own Dex: the battle's `battle.dex`, else the resolver of generation and mod (`rulesDex` in `replay-core/src/rules-dex.ts`). The code of replay-core, eval-engine and the app reads the global Dex (Generation 9 without a mod) nowhere else, and the lint rule `dex/no-global-dex-read` holds it; specs read it as the oracle. Every realm that rebuilds a game (the main thread, a worker, a Node harness) loads the Champions mod itself before it asks the resolver (user 23.10.2026; round 75: the app's replay worker did not).
- A fix for a game rule starts with a sweep: a test that plays every Dex entry of that kind, in every generation and mod the corpus plays, and compares the simulator with our reading; the reported scene becomes one row of it (models: `pair-stall-guard.spec.ts`, `power-handlers-census.spec.ts`). A list in a hot path may stay while such a test holds it to the Dex.
- One rule lives in one module, and every other place imports it. A deliberate copy (a package that reaches the other only through its barrel) gets a spec that compares the two.
- A question to the simulator runs on a copy of the battle. A stand-in that calls a Dex handler gets a sweep over every Dex entry that can reach it, and the sweep proves the live battle unchanged (`fingerprint` in `packages/eval-engine/test/power-oracle.ts`).
- A rule that is right by the game stays, even when the bank reads it worse: then the weights are wrong, and a refit becomes a TODO. Published Smogon sets are read as published.
- Pokémon Champions and Scarlet/Violet differ in rules: that is a question of the battle's mode, not a bug.
- A Custom Game (draft leagues) plays with each species' own abilities; only Hackmons formats are free. Before recommending anything that rests on a game rule, check that the species can really have it.
- PP and heal fractions come live from the simulator (`moveSlots[].pp`, `move.heal`), never derived from Dex base values.
- Singles and doubles are equal citizens, and VGC (Scarlet/Violet and Champions) counts on its own: every feature covers both game types in the same step, every measurement counts doubles and VGC separately.
- React: state that follows a prop is reconciled during render, never in an effect (lint rule `react-hooks/set-state-in-effect`).
- Formats that leave the app carry a version: the engine protocol (`ENGINE_PROTOCOL` in `packages/eval-engine/src/engine-api/protocol.ts`), the state file of `Report issue` (`SUPPORT_STATE_VERSION` in `src/lib/support-state.ts`) and the shared-branch link (`version` in `src/lib/branch-share.ts`). A change that breaks a reader on the other side raises the version, and the app keeps reading the old one; a new optional field keeps it (round 77: the names in share links).
- Dependencies: direct dependencies track their latest registry versions (`npm outdated`). Three exceptions: TypeScript stays on 6.x until typescript-eslint admits the 7.x compiler, `@types/node` follows the Node major the workflows run, and `@pkmn/sim` and `@pkmn/mods` stay pinned to one exact version in every manifest, because the speed layer copies the simulator's classes and checks no hash in the browser (`test/regression/pkmn-pins.spec.ts`). `npm run upgrade:pkmn [version]` moves the whole @pkmn release train (sim, mods, dex, data) at once and prints the checks a new simulator needs before it ships (T103, the engine suite in all speed-layer modes, the batch check).

## Checks before commit and push

- `npx tsc -b` (`tsc --noEmit` checks nothing in this solution setup) and `npm run lint` before every push; the Pages workflow has its own lint gate. The lint ratchet (`eslint.ratchet.mjs`) only shrinks: split a file instead of raising its limit, and run `node scripts/update-lint-ratchet.mjs` after a refactor.
- Tests: `npx vitest run --project <eval-engine|replay-core|ui|app>` or single files; the full suite with `npx vitest run`; e2e with `npm run test:e2e` (a separate port via `PS_DEV_PORT`).
- The final suite of a round runs in the main checkout, where the local test data lives (the saved replay HTML of `reconstruction.spec.ts`); a clone or a worktree skips those tests. The report lists the skipped tests (`--reporter verbose` marks them). Round 74: a test that skipped in the merge clones stayed red for ten days (user 23.10.2026).
- Package exports: a barrel change shows as a diff under `test/regression/fixtures/api/` (`UPDATE_API_SNAPSHOT=1` only on purpose), then `npm run pack:smoke`.
- Test first: a red test that fails for the right reason, then the code.

## Measuring and judging

- Score-touching changes (D3): bump the cache version once per round (`EVAL_ENGINE_CACHE_VERSION` in `src/lib/eval-cache-store.ts`), run the paired bank against a fresh base of the same day, run the feedback corpus three times byte-identical, and read the tier census (`node scripts/tier-census.mjs`, with `--moved` for every moved turn). A batch of small fixes uses its batch check instead (see Change classes).
- Bank verdicts (`scripts/paired-calibration.mjs`, tables full and hq, fixed K and own K per phase): pooled rows decide, phase cells warn. Harm means a pooled row at least 5 bp worse with its band wholly on the bad side; a warning is the same in a phase cell.
- Doubles verdicts read the bank together with the Doubles OU and VGC holdouts (D26); the Champions families have their own holdouts.
- The bank guards against harm and does not prove a gain (user 22.10.2026). Dice and player errors make game outcomes noisy, so effects of a few bp rarely resolve (T52, T224 and T163 adopted nothing). The game's rules and the expert pins decide a feature or a rule fix; the bank and the holdouts check it for harm. A re-fit of a weight or a K runs only where the bank reads harm after a game-correct change, never to look for a gain.
- Lossless changes (D4): three byte-identical feedback runs, the bank digit-identical, regression, e2e, lint, `tsc -b`.
- Order for tree and verify changes: the play-out pin first (`test/e2e/branch.spec.ts`, draft t56), then the golden replay 655336, then the bank.
- Set and solver changes: set diffs on every build path before the bank (the bank builds like the app, through `buildAppTeams`).
- Monte-Carlo references of scene pins price their leaves with the engine's static evaluation: recompute them after every weight change before calling a pin wrong.
- Wall-clock timing only interleaved with the base on a quiet machine, both sides in one worktree that checks them out in turn (round 72: two checkouts of one commit read up to 2 % apart); no tests, probes or agents meanwhile. The feedback harness reads a test's duration in steps of about ten seconds (round 79), so the cost of a sweep needs a Node probe.
- Feedback dumps (`feedback-full-*.json`) exist only with `FEEDBACK_DUMP=1`; check their mtime before reading them.

## Tools and pitfalls

- Bank in CI (round 71, the default): `node scripts/bank-ci.mjs --name <name>`; a holdout adds `--env EVAL_CALIBRATION_SOURCE=holdout --tranche holdout-<doublesou|vgc|championsou|championsvgc>`, the quick tier `--env EVAL_CALIBRATION_FRACTION=0.25`. The script pushes the one branch `bank/<name>` (the measured commit plus `.bank-run.json`), `.github/workflows/bank.yml` runs 16 jobs of 4 slices, and the script downloads the merged run into `.calibration/<name>/` and deletes the branch. The user's standing okay covers pushing and deleting `bank/<name>` branches and nothing else. A bank run takes about five minutes there when it runs alone and the four holdouts together about 25, and CI rows are byte-identical to local rows of the same engine (bank 837 of 837, VGC holdout 1,121 of 1,121 in round 71), so a CI run pairs with a local base and the other way round. CI measures only commits that carry this tooling. CI runs have no slice limit and run side by side, but `bank-ci.mjs` writes to `.git` when it pushes and deletes, so it does not start while a local heavy run is going; `bank-ci.mjs --reuse` finds a downloaded run of the same commit and settings.
- Bank locally: `node scripts/run-calibration.mjs --slices 4 --out .calibration/<name>` with the same `--env` levers. At most four slices and never two heavy runs at once: the machine crashed several times under six slices.
- Base reuse: `node scripts/run-calibration.mjs --reuse ...` prints the folder of a finished run under `.calibration/` whose fingerprint matches (git tree ids of the inputs at HEAD, content hash of `.smogon-cache` and `.fit-corpus`, lever env, Node version, slice count) and starts nothing; a dirty tree never reuses, `--dry-run` shows the decision without a run, and runs from before round 70 have no fingerprint.
- Quick tier: `--env EVAL_CALIBRATION_FRACTION=0.25` keeps a quarter of the universe (the same replays every time, each tranche and family in proportion) for about a quarter of the machine time; `paired-calibration.mjs` pairs a quick run against a full base on the shared rows and names the fraction and the pairing count in its header. A quick pair screens, and a resolved row can flip in the full pair, so gates read the full pair.
- Bank data in CI: the tarball holds `.smogon-cache` and every replay of `.fit-corpus` that the fit source and the holdouts read (`scripts/bank-data-pack.mjs`; since round 74 CI captures the fit corpus with search: `--env EVAL_CALIBRATION_SOURCE=fit --env EVAL_CALIBRATION_FAMILY=<family> --env EVAL_CALIBRATION_TURNS=thirds --env EVAL_CALIBRATION_FEATURES=1`); the tracked `test/regression/fixtures/bank-data.json` names its sha256 and folder hashes, and a CI job unpacks it only after both checks. When the data changes, pack again; the upload (`--upload`, a pre-release that is never Latest) waits for the user's okay.
- Crash protection (D23): commit before every heavy run and force freshly written files to disk; do not write to `.git` while the run is going. The repair recipe for zeroed `.git` files is in `docs/completed/` (incident of 20.09.2026).
- Worktrees: remove the junctions (`node_modules`, `.calibration`, `.smogon-cache`, `.fit-corpus`) one by one with `[System.IO.Directory]::Delete('<path>')` and check with a reparse-point scan before `git worktree remove`; otherwise git follows the junctions and deletes their targets (incident of 12.09.2026).
- File encoding: a PowerShell write without `-Encoding utf8` uses the ANSI code page (round 79: an em dash became the byte 0x97, and only the production build refused it); `test/regression/source-encoding.spec.ts` holds every source file to UTF-8.
- Line endings: the repository checks out with `core.autocrlf`. Scripts match `\r?\n`; count conflict markers before `git add`. Test logs stay LF through `.gitattributes`.
- Probes never go under `test/regression/` (the suite collects them); they are `.vt.ts` files under `docs/perf/probes/<date>/` with their own Vitest config and `PROBE_ROOT`.
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

- Small fixes collect in a batch on one branch, score-touching ones included. The batch ends with one check: the checks before push, the cache version bumped once, two feedback runs compared byte for byte with the tier census (round 70 ran one and missed a turn that varied from run to run), the paired bank only when the user asks for it. Every pin the batch moves waits for one gate at the end; each fix gets its own commit.
- A small fix that grows (a second cause, a re-fit, more than a few files) becomes a larger bug and gets its TODO.
- A feedback run takes about ten minutes and a bank run in CI about five (round 79), so a run per lane fits a wave and separates the lanes' effects; never one per fix.

## Working in rounds

- Rounds are numbered in one series across the project (the ledger calls them "improvement round N"). Each round: brainstorming and spec, build with tests, measurement, user gate, booking, push after the okay. A batch of small fixes is a round too: it gets a number and a short booking, without a spec and with its one check at the end.
- An audit or review that names a wrong rule leaves a TODO proposal with its red sweep the same day. A triage closes a TODO only when the wrong rule is gone from the code; otherwise it parks the TODO with a trigger (round 70: four of the batch's 18 faults stood in the audit of 24.09., and the triage of 05.10. had closed one of them).
- `NextSteps.md` holds only open work, along the finish line to the release; each step is a round, and the parked TODOs wait in `docs/backlog.md`. TODOs carry fixed T-numbers; the next free number is in `NextSteps.md`.
- A new TODO needs the user's approval (user 21.10.2026). The gate that proposes it gives its user scene, what a user of the app or the packages sees, and whether it is worth building before the release; only an approved TODO enters `docs/backlog.md`, and one the user turns down is parked with a trigger or dropped.
- Booking at the end of a round: a ledger block in `test/regression/eval-calibration.spec.ts`, an entry in `docs/completed/<area>.md` (goal, delivered, evidence, measurement, gate, lessons, rests), rests as TODO proposals for the gate and, once approved, as new TODOs in `docs/backlog.md` and as a line in their package, the header line of `NextSteps.md`. A fresh reviewer checks new TODOs against the code before they are booked.
- Waves: several lanes in parallel, one branch and worktree per lane, no shared file, measurements through the integrator's queue (one heavy run at a time), the merge in a separate clone, then a wave run with all holdouts and one gate with a table over all lanes.

## Agents

- Roles in `.claude/agents/`: `wave-builder` (Sonnet, builds one step), `wave-reviewer` (Sonnet, checks claims against the code), `wave-scout` (Haiku, finds and counts), `wave-reader` (Haiku, reads measurements by the rules above). The main session stays on Opus; sub-agents never run on Opus (`.claude/settings.local.json` lifts the global Opus setting).
- One fresh agent per step, starting from the brief, the plan, the ledger and `git log`, and writing its step into the ledger before it stops. After a pause of more than five minutes do not resume an old agent. A monitor reports the end of a measurement, never a sleep.
