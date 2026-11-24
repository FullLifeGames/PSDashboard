# Scripts

`scripts/` holds the command-line tools of the repository: the bank and feedback runners and their analysis, the fit corpus builders, the lint ratchets, the release and package tooling, and helpers for the test suites. Every file is a Node ES module; run it from the repository root with `node scripts/<name>.mjs`.

| Script | What it does | Called by |
| --- | --- | --- |
| `bank-ci.mjs` | Runs a bank measurement in GitHub Actions and downloads the merged run | a person |
| `bank-data-pack.mjs` | Packs, uploads and fetches the data the bank reads in CI | a person; `bank.yml` (`--fetch`) |
| `bank-data.mjs` | The gzipped tar of `.smogon-cache` and `.fit-corpus` (library) | `bank-data-pack.mjs` |
| `bank-run-config.mjs` | Validates `.bank-run.json` and starts one job or the merge | `bank.yml`; `bank-ci.mjs` imports its validator |
| `build-fit-corpus.mjs` | Builds the weight-fit corpus and its manifest | a person |
| `build-fit-holdout.mjs` | Draws the holdout sets out of the fit corpus | a person |
| `build-versions-index.mjs` | Renders the `/versions/` page of the Pages site | `pages.yml` |
| `calibration-fingerprint.mjs` | Fingerprints of calibration runs and the reuse decision (library) | `run-calibration.mjs`, `paired-calibration.mjs`, `bank-run-config.mjs`, `bank-data-pack.mjs` |
| `calibration-jobs.mjs` | Job records and the merge check of a CI run (library) | `run-calibration.mjs` |
| `calibration-lib.mjs` | Aggregation over calibration dumps (library) | `run-calibration.mjs`, `paired-calibration.mjs`, `subset-calibration.mjs`, `dossier-decided-losses.mjs` |
| `capture-eval-store.mjs` | Captures the saved engine results the browser specs seed | `npm run capture:eval-store` |
| `comment-counts.mjs` | The comment ratchets of `comment-ratchet.json`; the shape check of workflows and stylesheets | `npm run lint` |
| `comment-lib.mjs` | The one reader of comments (library) | `comment-counts.mjs`, `comment-only-diff.mjs`, `eslint.comments.mjs` |
| `comment-only-diff.mjs` | Proves that an edit moved comments and whitespace only | a person |
| `corpus-coverage.mjs` | Counts the replays that carry each rule-bearing population | a person |
| `cov-compare.mjs` | Compares two coverage reports of one source | a person |
| `dossier-decided-losses.mjs` | Classifies every calibration position whose decided side lost | a person |
| `endgame-truth-table.mjs` | Brier and error of each estimator against the endgame solver | a person |
| `eval-bench.vt.ts` | The engine bench: forward model and search throughput | `npm run bench:eval` |
| `expand-fit-corpus.mjs` | Grows the fit corpus by one ladder format | a person |
| `feedback-ci.mjs` | Runs the feedback corpus in GitHub Actions and downloads the artifacts | a person |
| `feedback-run-config.mjs` | Validates `.feedback-run.json` and compares the runs | `feedback.yml`; `feedback-ci.mjs` imports it |
| `fresh-holdout.mjs` | Draws a holdout family of ladder games no measurement has read | a person |
| `k-stamp.mjs` | Writes the K table a capture runs under | a person; `fit-families.spec.ts` |
| `merge-playwright-reports.mjs` | Merges and reads the JSON reports of the Browser flows parts | `test.yml` |
| `name-census.mjs` | The one reader of Dex name literals in the sources | `twin-lists.mjs`, `update-name-baseline.mjs`; a person (prints the census) |
| `pack-smoke.mjs` | Installs the packed packages into a throwaway project and runs the README examples | `npm run pack:smoke` |
| `paired-calibration.mjs` | Paired engine-against-engine analysis of two dumps | a person |
| `publish-packages.mjs` | Selects, packs and publishes the workspace packages | `release.yml`; `pack-smoke.mjs`; `npm run publish:packages` |
| `record-smogon-fixtures.mjs` | Records Smogon data files as feedback-harness fixtures | a person |
| `release-tags.mjs` | Release tag helpers (library) | `publish-packages.mjs` |
| `rows-collect.mjs` | Lists the rows of the Vitest suite without playing them | a person |
| `rows-compare.mjs` | Compares two row lists: rows lost or gained | a person |
| `run-calibration.mjs` | Runs the calibration bench in parallel slices and merges the dumps | a person; `bank-run-config.mjs` |
| `run-e2e.mjs` | Starts the dev server, runs Playwright against it, stops the server | `npm run test:e2e`, `npm run test:feedback`; `capture-eval-store.mjs` |
| `spec-counts.mjs` | The spec-count ratchet | `npm run lint` |
| `subset-calibration.mjs` | Paired records on a subset of the joined positions | a person |
| `tier-census.mjs` | Counts the verdict tiers of feedback dumps and lists moved turns | a person |
| `twin-lists.mjs` | The twin detector: identical string lists in several files | `npm run lint` |
| `update-lint-ratchet.mjs` | Rewrites the three ratchet files | a person |
| `update-name-baseline.mjs` | Rewrites the name and twin baselines | a person |
| `upgrade-pkmn.mjs` | Moves the `@pkmn` release train to one version | `npm run upgrade:pkmn` |

`name-baseline.json` and `twin-baseline.json` are the baselines of the name ratchet and the twin detector; `update-name-baseline.mjs` writes them.

A section without an Exit line describes a script that exits 0 on success and 1 on an error.

## Bank and calibration

The bank runs through CI (`bank-ci.mjs`) or locally (`run-calibration.mjs`). AGENTS.md ("Tools and pitfalls") holds the rules of the runs: one heavy run at a time, `bank-ci.mjs` does not start while a local heavy run is going, and a bank run needs the user's standing okay for its branch.

### bank-ci.mjs

```sh
node scripts/bank-ci.mjs --name <name> [--commit <ref>] [--jobs 16] [--slices-per-job 4] [--env KEY=VALUE ...] [--tranche NAME] [--reuse] [--dry-run]
node scripts/bank-ci.mjs --resume <name|run id>
```

The script measures `--commit` (default `HEAD`). It builds a run commit on top of it that adds exactly one file, `.bank-run.json`, in a throwaway index, so the working tree, the index and every local branch stay as they are, and the tree need not be clean. It pushes the commit as the branch `bank/<name>` with an explicit refspec (no tag, no `--force`), waits for `.github/workflows/bank.yml`, downloads the merged run into `.calibration/<name>/`, writes `ci.json` there and prints the run's `summary.txt` and the folder. It deletes the branch afterwards, also when a step fails, with `--force-with-lease` against the pushed commit, so a branch that moved stays.

Before the push it reads the diff of the measured commit against `origin/master` and refuses files and lines that look like a token or a key. It also refuses when `.calibration/<name>` exists or when `origin` already has `bank/<name>`.

- `--jobs` takes 1 to 16 and `--slices-per-job` 1 to 4. `--tranche NAME` is short for `--env EVAL_CALIBRATION_TRANCHE=NAME`. `--env` takes only `EVAL_CALIBRATION_*` keys (see `bank-run-config.mjs` for the checks).
- `--reuse` prints the folder of a downloaded run of the same commit and the same settings, and starts nothing.
- `--dry-run` builds and checks the run commit and stops before the push.
- `--resume` takes up a run whose watcher ended. It finds the Bank run by its name (the newest on `bank/<name>`) or by its run id, waits for it by the same rule, downloads it into `.calibration/<name>/` (refused when the folder exists), records it and deletes its branch. A run whose jobs have all completed and whose merged artifact exists counts as over after five minutes, also while GitHub still calls it in progress.
- CI measures only commits that carry this tooling. The data upload is a separate command (`bank-data-pack.mjs --upload`).

Exit: 0 for a successful run, `--reuse` hit or `--dry-run`; 1 when the CI run did not succeed; 2 for a wrong argument or a refusal.

### bank-run-config.mjs

```sh
node scripts/bank-run-config.mjs check          # validate; print the plan
node scripts/bank-run-config.mjs job <index>    # run the job's slices into .calibration/job-<index>
node scripts/bank-run-config.mjs merge <dir>    # merge the folders <dir>/job-* into .calibration/<name>
```

`bank.yml` treats `.bank-run.json` as untrusted input. The script validates the file against an allowlist and starts `run-calibration.mjs` itself, without a shell, so no value of the file reaches a shell line of the workflow; the workflow passes only the job index. `check` also appends `jobs` (a JSON list of job indices) and `name` to `$GITHUB_OUTPUT` when the variable is set.

The file holds `{ "name": "bank-1", "jobs": 16, "slicesPerJob": 4, "env": { "EVAL_CALIBRATION_SOURCE": "holdout", "EVAL_CALIBRATION_TRANCHE": "holdout-vgc2" } }`.

- `name` is 1 to 40 characters of `a-z`, `0-9` and `-`. `jobs` (default 16) is 1 to 16 and `slicesPerJob` (default 4) is 1 to 4.
- `env` holds at most 20 keys, each an `EVAL_CALIBRATION_*` lever with a value of 1 to 100 characters from `A-Z a-z 0-9 . _ / -`. The runner owns `EVAL_CALIBRATION`, `EVAL_CALIBRATION_SLICE`, `EVAL_CALIBRATION_DUMP` and `EVAL_CALIBRATION_POSITIONS`; the file may not set them.
- `EVAL_CALIBRATION_TRANCHE` must name a bank tranche, a fit tranche or `holdout-<family>` for a family of `fit-holdout-manifest.json`. `EVAL_CALIBRATION_SOURCE` is `holdout` or `fit`, `EVAL_CALIBRATION_MODE` is `auto`, `mcts` or `matrix`, and `EVAL_CALIBRATION_FRACTION` is a number above 0 and at most 1.
- Job `k` runs slices `k * slicesPerJob` to `k * slicesPerJob + slicesPerJob - 1` of `jobs * slicesPerJob`.

Exit: 2 when the file or the command is wrong; `job` and `merge` return the exit code of `run-calibration.mjs`.

### bank-data-pack.mjs

```sh
node scripts/bank-data-pack.mjs                          # pack
node scripts/bank-data-pack.mjs --upload                 # upload the packed asset
node scripts/bank-data-pack.mjs --fetch [--file <path>]  # in CI: fetch and unpack
```

- Pack reads `.smogon-cache` whole and the `.fit-corpus` replays that the fit manifest and the holdout manifest name, writes `.calibration/bank-data/bank-data-<16 hex digits of the tar's sha256>.tar.gz` and rewrites `test/regression/fixtures/bank-data.json` (asset, hashes, folders). A manifest replay the cache lacks is left out and named; a holdout replay that is missing stops the pack (run `build-fit-corpus.mjs` first).
- `--upload` creates the GitHub pre-release the fixture names (never Latest, tag on `master`) with `gh`. It refuses when the asset does not match the fixture or when the release exists. It needs the user's okay; no script calls it.
- `--fetch` takes the asset from `<path>` when the file exists. Otherwise it downloads it from the release (needs `GITHUB_REPOSITORY`) and saves it at `<path>` when one is given. It checks the sha256, unpacks into the checkout and checks that both folders hash as the fixture says. `bank-data.mjs` refuses every archive entry that is not a regular file under the two folders.

Exit: 2 for a wrong argument, a missing file or a failed check.

### run-calibration.mjs

```sh
node scripts/run-calibration.mjs [--slices 6] [--out .calibration/<stamp>] [--env KEY=VALUE ...] [--tranche NAME] [--reuse] [--dry-run]
node scripts/run-calibration.mjs --slices N --slice-range a..b --out <dir> [--env KEY=VALUE ...] [--tranche NAME]
node scripts/run-calibration.mjs --merge <job dir> [--merge <job dir> ...] --out <dir>
```

Each slice is one Vitest process (project `app`) over `test/regression/eval-calibration.spec.ts` with `EVAL_CALIBRATION=1`, `EVAL_CALIBRATION_SLICE=i/N` and its own dump `<out>/slice-i.jsonl` (console in `<out>/slice-i.log`). The default levers are `EVAL_CALIBRATION_MODE=auto` and `EVAL_CALIBRATION_SMOGON=1`; `--env` overrides or adds variables and `--tranche` restricts the corpus to one stratum. Locally, run at most four slices.

Afterwards the dumps merge into `<out>/merged.jsonl` (sorted by replay id, then turn), the aggregate lines print and land in `<out>/summary.txt`, and `<out>/run.json` keeps the configuration, exit codes and wall times. A slice is independent of the others (one replay belongs to one slice), so the merged aggregate equals a single-process run. A red slice still merges.

- Base reuse: `run.json` also keeps the run's fingerprint, its fraction, the sha256 of `merged.jsonl`, the count of replays lost to HTTP errors and a `complete` flag (false after a failed slice, an empty merge or an HTTP loss). The fingerprint covers the git tree ids at `HEAD` of `packages`, `src`, `test/regression`, `scripts` and the package, TypeScript, Vite and Vitest config files, the content of `.smogon-cache` and `.fit-corpus`, the installed packages, the lever variables (the run's own and the ambient `EVAL_*` and `CALIB_*` ones) and the Node version; `calibration-fingerprint.mjs` holds the recipe. A change under `test/regression` changes it, a commit that touches only documents does not.
- `--reuse` looks under `.calibration/` for a finished run with the current fingerprint that is complete, clean, stable (no input changed during the run) and intact (`merged.jsonl` matches its recorded hash). When it finds one it prints the folder as its last line, creates no `--out` folder and starts nothing. A dirty tree never reuses, and its run never serves as a base. Without a match the run starts and names the input groups that differ from the closest finished run.
- `--dry-run` prints the fingerprint and the decision and starts nothing.
- Quick tier: `--env EVAL_CALIBRATION_FRACTION=0.25` keeps a quarter of the universe (the same replays every time, each tranche and family in proportion). The fraction goes into `run.json` and the fingerprint, and `paired-calibration.mjs` pairs a quick run against a full base on the rows both hold.
- CI jobs: `--slice-range a..b` runs only slices `a` to `b` of `--slices N` into `--out` and writes `job.json` instead of `merged.jsonl` and `run.json`, so `--reuse` never takes a job for a run. `--merge <dir>` (once per job folder) checks that the jobs make one run (same slice count, env, fraction, commit and fingerprint, every slice once), copies their slice files into `--out` and writes the same files as a local run of all slices.

Exit: 0 on success, and with `--dry-run` also for a run that would start; 1 when a slice failed or left no dump; 2 for a wrong argument; 3 for `--reuse --dry-run` when a run would start.

### paired-calibration.mjs

```sh
node scripts/paired-calibration.mjs <a.jsonl> <b.jsonl> [--quality hq|std] [--a-field <name>] [--b-field <name>]
```

The script joins the two dumps on `id#turn` (identical positions only), reproduces the harness aggregates of each side and prints the verdict table: paired Brier deltas under the K of side A with a 90 % band from a bootstrap over replays (pooled rows decide, phase cells warn). It then prints the same table with each side under its own K per game type and phase (a pure rescale reads zero there), the disagreement structure, and counterfactual hybrid lines (file A early, file B once `faintedFraction` crosses a threshold) plus score blends.

- A side may name several dumps joined by commas (the doubles verdict reads the bank's dump together with the holdout's).
- `--quality` keeps one quality tranche. `--a-field` and `--b-field` read another number of that side's dump as its score (`--b-field gameValue` pairs the root game value against the score of one run).
- A quick run pairs against a full base on the rows both dumps hold. When the `run.json` beside either dump records a fraction under 1, the header names the fraction of each side, the pairing count, its share of A, and where the fixed K comes from: `pairedBands` fits K on all of A, so give the full base as A. A quick pair has wider bands and a resolved row can flip in the full pair: it screens, and the full pair decides.

Exit: 1 without two dump paths.

### subset-calibration.mjs

```sh
node scripts/subset-calibration.mjs <a.jsonl> <b.jsonl> <field> [<field> ...] [--quality hq|std]
```

Joins on `id#turn`, keeps the positions where any named field is truthy in A or in B (a field recorded on one side only still selects the subset), and prints both sides' records plus the rate at which the favored side wins (the sign of the score against `p1Won`) per side. Exit 1 without two paths and a field.

### dossier-decided-losses.mjs

```sh
node scripts/dossier-decided-losses.mjs <merged.jsonl> [--held] > <report>.md
```

Prints a Markdown table of every calibration position whose decided side lost, classified from the rest of the protocol. `--held` lists the losses among the sweeps the bar holds (the dump's `decidedHeld` field) instead of every sweep. Replays come from `.fit-corpus/`, then from `.calibration/replays/`, then from the replay server (cached in `.calibration/replays/`). The classes are `roll` (crit, miss, full paralysis, freeze or flinch against the sweeper before it fainted), `pair` (the sweeper fainted to a pair the clocks called won: no roll line before its faint), `unplayed` (the sweeper was switched out or never attacked before the loss), `forfeit` (a forfeit or timer line) and `unclear`. Exit 1 without a path.

### endgame-truth-table.mjs

```sh
node scripts/endgame-truth-table.mjs <dump.jsonl> [<dump.jsonl> ...]
```

Prints, per estimator, the Brier score and the mean absolute error against the solver's exact value on the exactly solved positions, the sign agreement, the coverage line (solved, capped, unpriced, loop, out of scope) and the decided reference (how many decided positions the solver puts at 0.8 or beyond for the decided side). Exit 1 without a path.

### calibration-fingerprint.mjs, calibration-jobs.mjs, calibration-lib.mjs

Libraries without a command line. `calibration-fingerprint.mjs` computes the fingerprint and the reuse decision and writes the quick-tier header of `paired-calibration.mjs`; `calibration-jobs.mjs` holds the job record and the merge check; `calibration-lib.mjs` aggregates dumps (`EVAL_CALIBRATION_DUMP` files, one JSON sample per line) and replicates `test/regression/fit-helpers.ts`, so a merged summary matches the single-process printout character for character.

## Feedback

AGENTS.md ("Tools and pitfalls") holds the rules of a feedback run: `feedback-ci.mjs` does not start while a local heavy run is going, and a local run takes the machine alone.

### feedback-ci.mjs

```sh
node scripts/feedback-ci.mjs --name <name> [--runs 3] [--commit <ref>] [--reuse] [--dry-run]
```

The script builds a run commit on top of `--commit` (default `HEAD`) that adds exactly one file, `.feedback-run.json`, by the method of `bank-ci.mjs`. It pushes it as the branch `feedback/<name>` to the repository's URL, waits for `.github/workflows/feedback.yml`, downloads the artifact of every run into `.calibration/feedback-<name>/run<i>/`, prints the verdict of the compare job, compares the downloaded dumps again with the module the job uses, writes `ci.json` and prints the folder. It deletes the branch afterwards, also when a step fails.

- It refuses a dirty working tree (the run measures a commit), a diff against `origin/master` that looks like a secret, an existing `.calibration/feedback-<name>` and an existing `feedback/<name>` on the repository.
- `--runs` takes 1 to 5 (default 3). Each run is one whole `npm run test:feedback` with `FEEDBACK_DUMP=1` on its own runner.
- `--reuse` prints the folder of a downloaded run of the same commit and the same run count, and starts nothing. `--dry-run` builds and checks the run commit and stops before the push.

Exit: 0 for a successful run, `--reuse` hit or `--dry-run`; 1 when the CI run did not succeed; 2 for a wrong argument or a refusal.

### feedback-run-config.mjs

```sh
node scripts/feedback-run-config.mjs check           # validate; print the plan
node scripts/feedback-run-config.mjs compare <dir>   # compare the artifacts <dir>/feedback-run-<i> of every run
```

`feedback.yml` treats `.feedback-run.json` (`{ "name": "fbci-try", "runs": 3 }`) as untrusted input, as `bank.yml` does with `.bank-run.json`: the script validates it against an allowlist (`name` as in `bank-run-config.mjs`, `runs` from 1 to 5), and the workflow passes only the run index to the shell. A run started by hand has no file and gets three runs under the name `dispatch`. `check` appends `runs` (a JSON list of run indices) and `name` to `$GITHUB_OUTPUT` when the variable is set.

`compare` asks whether every run wrote the same bytes: every `feedback-full-*.json` of the first run must exist in the others with the same content, and the drift reports (`feedback-drift.json`, `feedback-drift.md`) must match beyond their date and wall times. Exit 1 when they differ or when the folder count differs from `runs`; exit 2 for a wrong file or command.

### tier-census.mjs

```sh
node scripts/tier-census.mjs <folder> [<folder>...]        # counts per replay, per game type and in total
node scripts/tier-census.mjs --moved <base> <next>         # the turns whose verdict moved between two folders
```

A folder holds the `feedback-full-<id>.json` dumps of one feedback run (`FEEDBACK_DUMP=1 npm run test:feedback` writes them into `docs/reports/`; `feedback-ci.mjs` downloads them). The census prints the tiers as inaccuracy, mistake and blunder per side-turn, with the replay list taken as the union over all folders. Every weight or K change reads it next to the paired bank, because the bank grades the bar and not the move verdicts. A count alone is not the verdict, so `--moved` names every turn behind a changed number.

- A side-turn without a matched played action (`unmatched`) never gets a tier. It is counted and not divided away, so a change that loses matches cannot shrink the denominator.
- Doubles grades are coarser than singles grades: the graded best comes from a restricted set of pair choices, and where a slot's action never showed (flinch, sleep) the regret is a charitable lower bound (`partial`).
- The game type comes from the `|gametype|` line of the replay fixture and is cross-checked against the dump's own doubles marks; a disagreement throws.

### record-smogon-fixtures.mjs

```sh
node scripts/record-smogon-fixtures.mjs /sets/gen8ou.json /sets/gen8ubers.json ...
node scripts/record-smogon-fixtures.mjs --from-cache .smogon-cache /stats/gen9doublesou.json ...
```

Records Smogon data files as feedback-harness fixtures. Every argument is a data path that starts with `/` (under Git Bash set `MSYS_NO_PATHCONV=1`, or the shell rewrites it).

- Without `--from-cache` the script fetches each path through `data.pkmn.cc`, then the GitHub Pages mirror, and writes `test/e2e-feedback/fixtures/smogon/<pathKey>.json`. When no host returns a body it writes an empty `<pathKey>.404` marker and prints the last status, so read the printed status: `status 0` or a 5xx means a network failure was pinned as an absent file. The key rule is the one of `test/e2e-feedback/hermetic.ts`. This mode overwrites an existing pin.
- With `--from-cache <dir>` the script reads the bank's disk cache instead of the network (`test/regression/smogon-fetch-cache.ts`: one `{status, payload}` entry per URL), so a replay the bank already measures gets the inputs the bank measured it with. It keeps a pin that exists and refuses a cached network failure; only a 200 or a 404 is an input.

Exit 1 for a missing path or a path without a leading `/`.

## Fit corpus and holdouts

The fit corpus is `test/regression/fixtures/fit-corpus-manifest.json` (committed, pins the corpus) with its replay cache in `.fit-corpus/` (not committed). The holdout is `fit-holdout-manifest.json`. All four builders talk to the public replay server and the Smogon forums.

### build-fit-corpus.mjs

```sh
node scripts/build-fit-corpus.mjs [--expand]
```

Builds the fit corpus from three tranches: tournament replays through the ReplayScouter data (`fulllifegames.com/Tools/TournamentTeams`, the cleanest outcome labels), the replay links of Smogon forum threads (doubles and Ubers threads, scraped directly), and the top-rated ladder replays of the replay search. It writes the manifest and caches the replay JSONs in `.fit-corpus/`.

The manifest is append-only. When it exists, a plain run only downloads the cache files that are missing; `--expand` runs the tranches again and appends the new replays after the existing ones. Existing entries stay pinned, because run-to-run corpus drift poisons comparisons.

### build-fit-holdout.mjs

```sh
node scripts/build-fit-holdout.mjs
```

One third of the corpus's sets in each of the families Doubles OU, Scarlet/Violet VGC, Champions VGC and Champions OU leaves the fit and becomes a test bank. A set is the games two players play against each other in one format family, so a best-of-three never splits. `EVAL_CALIBRATION_SOURCE=holdout` reads the holdout in the calibration harness, and the fit (`test/regression/eval-fit.spec.ts`) drops every holdout id.

The selection is a pure function of the committed corpus manifest and the player names of the cached replays: FNV-1a of `<family>|<sorted player ids>`, modulo 3, equal to 0. The script writes `fit-holdout-manifest.json` and skips a corpus replay that is not cached (the count is printed). A family that `fresh-holdout.mjs` drew (such as `vgc2`) is not a function of the corpus, so a rebuild keeps the sets of every family it does not draw, after the rebuilt sets, and the manifest's `drawn` notes with them.

### expand-fit-corpus.mjs

```sh
node scripts/expand-fit-corpus.mjs --format gen9championsou --pages 80 --games 450 --min-rating 1300
node scripts/expand-fit-corpus.mjs --format gen9vgc2026regi --sort rating --pages 10 --games 150 --min-turns 6
```

Grows the corpus by one ladder format from the public replay search, highest rated first, without touching the tranches `build-fit-corpus.mjs` scrapes. `--format` is required; the other flags default to `--pages 40`, `--games 300`, `--min-rating 0`, `--min-turns 5` and `--sort newest`.

The script pages the search (`--sort newest` pages back with `before`), keeps the games at or above `--min-rating`, downloads each into `.fit-corpus/` and keeps it only when the log has a winner among the players and at least `--min-turns` turns. New entries append to the manifest. Replays that the calibration bank (`eval-calibration.spec.ts`) or the feedback corpus (`corpus.ts`) name never enter, so the corpus and the bank share no replay. Every new entry carries its rating.

`--sort rating` pages the search by rating (`sort=rating&page=N`), so a format that left the ladder still yields its rated games; `newest` finds only the unrated challenges played after. On a best-of-three ladder only the deciding game of a set carries a rating (games 1 and 2 read 0), so `--sort rating` finds the deciding games only, and the fit's rule against unrated ladder games (`test/regression/fit-families.ts`) would drop the rest of the set.

### fresh-holdout.mjs

```sh
node scripts/fresh-holdout.mjs --family vgc2 --fetch-listing
node scripts/fresh-holdout.mjs --family vgc2 --listing .calibration/fresh-holdout/listing-<date>.json [--dry-run]
```

Draws a holdout family of rated Scarlet/Violet VGC ladder games that no measurement has read. The old VGC holdout is the reference; this draw takes games from the same formats and seasons whose ids no tracked file, no local note under `docs/` and no `.fit-corpus` file names, so a reading on them is a third sample next to the bank and the old holdout.

The draw rule:

- The input is the public replay search, `sort=rating`, pages 1 to 20 of each format in `FRESH_FORMATS` (the script's list of formats with their quotas). `--fetch-listing` fetches it and saves it as `.calibration/fresh-holdout/listing-<date>.json` (also with `--dry-run`); `--listing <file>` reads a saved one.
- Only rows of the main server count (id `<format>-<digits>`; `dawn-`, `smogtours-` and `china-` never enter) with a numeric rating of at least 1500 and an id that no known set holds.
- The formats go in the order of `FRESH_FORMATS`, inside a format by rating (highest first), then by id. At most one game per player pair over the whole draw (the earlier format keeps a pair).
- A game passes when its replay has a winner among its players, at least 6 turns and a rating at the floor. A game that fails leaves the next in line to enter; the quota of a format ends its walk.

Every game becomes one set `<family>|<player>|<player>` of the holdout manifest, appended after the old sets with a `drawn` note; the replays land in `.fit-corpus/` and never in the corpus manifest. A family is drawn once: the script stops when the manifest already has `--family`. `--dry-run` prints the known ids and the candidates per format and writes no manifest. The pure core is exported for `test/regression/fresh-holdout.spec.ts`.

### corpus-coverage.mjs

```sh
node scripts/corpus-coverage.mjs [--bank <run folder>] [--columns fixtures,fit,bank] [--json] [--root <dir>]
```

Counts which rule-bearing populations the replays of the project contain and how many replays carry each. A population with few or no replays is one in which a rule error is invisible to every measurement. There are up to three columns: `fixtures` (every `.json` with a `log` string under the test and e2e fixture folders, one replay once however many folders hold it), `fit` (`.fit-corpus/*.json`) and `bank` (the unique ids of the run's `merged.jsonl`, or of its slice dumps). `--columns` picks and orders them; the default is `fit,fixtures`, and `bank,fit,fixtures` with `--bank`.

A bank replay comes from the fit corpus or the fixtures when one stands there, and is fetched from `replay.pokemonshowdown.com` into the OS temp folder otherwise (never into `.calibration`); offline the script prints `bank: N ids, not fetched`. The rows are generation, game type, protocol features and move classes. A move class is a property of the Dex move (`stallingMove`, `callsMove`, ...), counted through the `|move|` lines of a log, so the script types no move name. `--json` prints the columns and notes as JSON.

### k-stamp.mjs

```sh
node scripts/k-stamp.mjs [out-file]
```

Prints the K table a capture runs under (the leaf's K per rule set and game type), or writes it to `out-file`. `EVAL_FIT_ROOT_K=<stamp file>` names the stamp that a capture with search ran under (`parseKTable` and `rootScaleReports` in `test/regression/fit-families.ts`), and the root-scale report stops when the stamp is not the current table. The stamp comes from `winprobK` in `packages/eval-engine/src/winprob.ts`, so make it at the capture's commit and never type it; `fit-families.spec.ts` holds the two together.

## Lint ratchets and counts

`npm run lint` runs ESLint, then `twin-lists.mjs`, `spec-counts.mjs` and `comment-counts.mjs`. Every ratchet only falls; `update-lint-ratchet.mjs` lowers the baselines after a cut.

### update-lint-ratchet.mjs

```sh
node scripts/update-lint-ratchet.mjs [--allow-raise]
```

Regenerates three files from the tree: `eslint.ratchet.mjs` (the size and complexity worklist), `spec-count-ratchet.json` (spec files per test project) and `comment-ratchet.json` (history lines per source file and comment lines per project). The ratchet has two layers: target values every file should meet (300 lines, 60 per function and complexity 15 for sources; 600, 300 and 20 for tests), and a pin for each legacy file above a target. A pin sits at the file's current measured worst, line caps rounded up to the next 10, so a file can only shrink. After a refactor the pins tighten or disappear.

The script runs ESLint over the sources and tests, so it takes a while. It refuses to raise a pin, add a pin, raise a spec count or raise a comment baseline unless `--allow-raise` is passed, and then writes none of the three files (exit 1, with the list). A raise means a file or a project grew; `--allow-raise` for a spec count is for a new source module, sweep or browser flow that the pull request names.

### spec-counts.mjs

```sh
node scripts/spec-counts.mjs
```

The check behind rule 5 of AGENTS.md "What earns a test": it counts `*.spec.ts` and `*.spec.tsx` files per test project (`SPEC_PROJECTS`: app, replay-core, eval-engine, ui, e2e, e2e-feedback, e2e-build, e2e-capture) and exits 1 when a project holds more than `spec-count-ratchet.json` says.

### comment-counts.mjs

```sh
node scripts/comment-counts.mjs [--shape [files...]]
```

Without a flag it checks the two comment ratchets of `comment-ratchet.json` and exits 1 when one is above its baseline: comment lines per project (`source:eval-engine`, `source:replay-core`, `source:app`, `source:app-css`, `workflows`, `scripts`, `config` and one `test:<project>` each; the calibration ledger spec stays out) and history lines per workflow file. The history lines of the source files are held by the lint rule `comments/no-history`.

`--shape` also checks the shape of the workflow files and the app's stylesheets, which no lint rule reads. With file arguments (paths from the current folder) it checks only those files, skips the ratchets and exits 1 on a hit.

### twin-lists.mjs

```sh
node scripts/twin-lists.mjs [--near] [--json] [--root <dir>] [--baseline <file>]
```

The twin detector. AGENTS.md says one rule lives in one module, and a deliberate copy gets a spec that compares the two. A twin is a list of 3 or more string literals (an array expression, also inside `new Set([...])`) that stands in two or more files of `packages/*/src` and `src` with the same names. Test files, call arguments and type unions are not lists here.

The script exits 1 for a pair (list, file) that `scripts/twin-baseline.json` lacks while the list stands in two or more files. A deliberate copy takes the comment `// twin-ok: <path of the spec that compares the copies>` on the line above the list; the spec must exist. `--near` prints lists with a Jaccard overlap of 0.7 or more (both with 4 or more names) and never fails, because a copy with one more element is no twin to the check. `--json` prints the groups.

### name-census.mjs and update-name-baseline.mjs

```sh
node scripts/name-census.mjs [--json]
node scripts/update-name-baseline.mjs [--allow-raise] [--dry-run]
```

`name-census.mjs` is the one reader of Dex name literals in `packages/*/src`: the name ratchet (`eslint.names.mjs`), the twin detector, `update-name-baseline.mjs` and their specs import it, and the command line prints the census (files by count of names, then the total of `(file, id)` pairs). A name literal is a string literal or a template without `${}`, 4 to 40 characters long, whose text is exactly the display name of a Dex species, move, item or ability (`Rocky Helmet`) or exactly its id (`copycat`), unless that id is also a Dex type, nature or stat id (`Psychic` is a type and a move). Comments, import and export specifiers, regular expressions and templates with an expression do not count. Type unions of names count like any literal. A pair is (file, id), once per file.

`update-name-baseline.mjs` rewrites `scripts/name-baseline.json` and `scripts/twin-baseline.json`. A baseline only shrinks: the script drops the pairs that left the code (a twin group that lost a file keeps the others, a group down to one file goes). When the code holds a pair the baseline lacks, it prints the list and exits 1; `--allow-raise` takes those pairs in (read them with `--dry-run` first). `--dry-run` prints the difference and writes nothing.

### comment-only-diff.mjs

```sh
node scripts/comment-only-diff.mjs <base> [--head <rev>] [paths or globs...]
```

Proves that a clean-up edit moved comments and whitespace only. It compares every changed `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`, `.jsx` and `.css` file between `<base>` and `--head` (default: the working tree), limited to the git pathspecs given (a glob such as `'packages/eval-engine/src/score/**'` works). Untracked files do not show in a diff of the working tree. Files of other types count as "not code".

A file passes when:

1. The tokens, read by the compiler's syntax tree, are equal in text, and so is the line break before each token (a joined line after `return` or before `++` fails). A `{/* c */}` JSX child is no token, and the JSX text around it folds as React folds it.
2. The comments that code reads (`readByCode` in `comment-lib.mjs`) are byte for byte equal and keep their place among the tokens: `// oracle:` marker lines (and the comment block above their declaration), ESLint directives, `@ts-expect-error` and its kin, `@vitest-environment`, coverage pragmas, triple-slash references, shebangs and legal headers. A `-next-line` directive and `@ts-expect-error` also keep the line count to the next token.
3. A stylesheet differs only in comments and whitespace; its legal comments stay.

Added and deleted files fail. Exit 0 when every file passes; exit 1 with the file and the first difference otherwise; exit 2 without a base.

## Release and packages

### publish-packages.mjs

```sh
node scripts/publish-packages.mjs --dry-run           # the plan plus a tarball listing, nothing uploaded
node scripts/publish-packages.mjs --pack <dir> --all  # tarballs for every package
node scripts/publish-packages.mjs                     # publish the selected packages
```

Publishes `@fulllifegames/replay-core` and `@fulllifegames/eval-engine`, in that order, as part of the release flow. Run it from the repository root. `release.yml` runs the last form, in CI through npm trusted publishing (the workflow holds the OIDC permission); locally the publish needs `npm login`.

- One global version: every package manifest carries the version of the root `package.json` (`test/regression/package-api.spec.ts`), and the script writes it again while it runs.
- Changed-only selection: a package is selected when its files changed since the previous release tag (the newest `v*` tag below the current version), when no earlier tag exists, or when the registry has no version of it yet. The release bump moves every manifest, so a release selects every package. `--all` selects both.
- The workspace reference `*` on the sibling package becomes a caret range on the version being published, or on the latest published version when the sibling is skipped this round.
- Without `--all` the script reads `git ls-remote --tags origin` and stops when origin has release tags below the current version that the local tags lack: run `git fetch --tags` first. Otherwise the plan would compare against an older release and publish a package that did not move.
- The script deletes and rebuilds each package's `dist/` with `tsc -b`, and it restores the manifests afterwards, whatever happens in between.
- `--registry-latest <name>=<version>` answers "what is on npm" without the network (tests, air-gapped dry runs); otherwise the script runs `npm view` for each package.

Exit: 1 on any failure; 2 when not run from the repository root.

### pack-smoke.mjs

```sh
npm run pack:smoke          # or: node scripts/pack-smoke.mjs [--keep]
```

Installs the packed workspace packages into a throwaway Node project and runs the README examples there, the way a consumer would. It packs both packages with `publish-packages.mjs --pack <dir> --all` (so it builds), installs the tarballs plus the `@pkmn` and `@smogon/calc` peers linked from this repository's `node_modules` (no registry), runs both examples against `test/e2e/fixtures/replay.json`, and type-checks a NodeNext TypeScript consumer against the shipped declarations. `--keep` leaves the temp directory behind; a failed run keeps it anyway and prints its path. Exit 1 on a failure.

### upgrade-pkmn.mjs

```sh
npm run upgrade:pkmn -- [version] [--dry-run]
```

Moves the `@pkmn` release train to one version in the three manifests (the root and both packages). `@pkmn/sim` and `@pkmn/mods` stay pinned to the exact version, because the speed layer copies the classes of one simulator version and checks no hash in the browser; `@pkmn/dex` and `@pkmn/data` take `^version`. Without a version the registry's latest `@pkmn/sim` is taken; a version must read `x.y.z`.

The script prints the changes per manifest, rewrites the manifests that change, runs `npm install` and prints the checks a simulator change needs before it ships. `--dry-run` prints the plan per manifest and changes nothing.

### build-versions-index.mjs

```sh
node scripts/build-versions-index.mjs <site-dir> <manifest.tsv> <owner/repo> [sha] [date]
```

Renders `<site-dir>/versions/index.html`, the browsable index of the Pages site. `pages.yml` unpacks each release's `ps-dashboard-<version>.zip` into `site/<tag>/`, writes a manifest of what it kept, and calls this script; run it by hand to look at the markup. The manifest holds one release per line, newest first (the first line is the one mirrored at `/latest/`): `<tag>\t<publishedAt ISO>`. A missing manifest renders the empty state. `sha` and `date` label the nightly. Set `PS_PRODUCTION_URL` to add the hosted production deployment; the page renders without it for a fork with nowhere to point. Exit 1 without the three required arguments.

## Test tooling

### run-e2e.mjs

```sh
npm run test:e2e -- [playwright arguments]
npm run test:feedback -- [playwright arguments]
```

Starts the Vite dev server on `127.0.0.1` with `--strictPort`, waits until the dependency pre-bundle is complete and stable (a cold cache would reload open pages and abort a running test's dynamic imports), runs `playwright test` with the remaining arguments and stops the server. It exits with Playwright's exit code.

- The port is `--dev-port <n>` (or `--dev-port=<n>`), else `PS_DEV_PORT`, else 5174. The script passes it on as `PS_DEV_PORT`, so the Playwright config builds the same base URL. `test:feedback` uses 5176 and `capture-eval-store.mjs` 5177. A busy port stops the run with a message; find the owner, check its command line and stop it yourself.
- The e2e server starts with `VITE_FEATURE_GAME_REVIEW=1` and `VITE_FEATURE_OPPONENT_READS=1` unless the environment sets them. A run with `playwright.feedback.config.ts` keeps the shipped build.

### capture-eval-store.mjs

```sh
npm run capture:eval-store -- [--dev-port <n>] [--only <replay id or file name>]
```

Captures the saved engine results the browser specs seed (`test/e2e/eval-store.ts`, `test/e2e-capture/`). It runs `run-e2e.mjs` with `playwright.capture.config.ts` and one worker: the analysis of every capture runs once in the browser on a dev server with the feature flags on, and the IndexedDB records land in `test/e2e/fixtures/eval-store/`. Run it when a spec says "fixture stale", then commit the files. The port defaults to `PS_DEV_PORT`, else 5177; `--only` limits the run to one capture (it sets `EVAL_STORE_ONLY`). Exit 2 for an unknown argument.

### merge-playwright-reports.mjs

```sh
node scripts/merge-playwright-reports.mjs [--out <merged.json>] <report.json>...
```

Merges the JSON reports of the three Browser flows parts (Playwright's JSON reporter writes one file per run) and reads the result. It sums their stats, prints each part's wall time (the reporter's `stats.duration`), the slowest spec files and tests and every test that did not pass, and writes the merged report when `--out` is given. The part number comes from a `part-<n>` in the report's path (the artifact folders of the aggregate job), else from the order of the arguments. A single report works too.

### cov-compare.mjs

```sh
node scripts/cov-compare.mjs <before coverage-final.json> <after coverage-final.json> <repo root> [--list]
```

The protection rule for a test cut, on two coverage reports of the same source. It prints per package (app src, eval-engine, replay-core, other) statements, branches, functions and lines, before and after, and every item the before run covered that the after run leaves uncovered (file and line; `--list` prints them all, otherwise only when at most 50). A file missing from the after run counts as lost. Exit 1 on any loss; exit 2 when the statement maps differ (a source file changed between the runs: the comparison is void, not a pass); exit 3 on a usage error.

### rows-collect.mjs and rows-compare.mjs

```sh
node scripts/rows-collect.mjs <out.json> [--raw <vitest list --json output>] [vitest list arguments...]
node scripts/rows-compare.mjs <before.json> <after.json> [--map <table.json>] [--expect-lost <names.json>] [--expect-gained <names.json>]
```

A fold or a split of spec files keeps every row. `rows-collect.mjs` runs `vitest list --json --staticParse=false` (the files run to collect, so helper-registered rows and `test.each` titles are filled in) and writes one entry per row (`name`, `file`, `projectName`); it prints the row count and the count per project. Collect both lists with the same `DICE_SWEEPS` value. Exit 1 when Vitest fails, 3 on a usage error.

`rows-compare.mjs` compares the two lists by project and full row name, ignoring the file, as multisets, and prints the rows lost and gained with the file each came from. It exits 1 when a row is lost or gained.

- `--expect-lost` reads a JSON array of `"<project> | <row name>"` (one entry per row, repeated for a row counted twice) that a cut removes on purpose; exit 0 only when exactly those rows are lost and none is gained. `--expect-gained` is its mirror for rows a change adds on purpose. With both, exactly the named rows are lost and exactly the named rows are gained.
- The table of `--map` maps renamed rows from before to after: `{ "rows": { "<old name>": "<new name>" }, "prefixes": { "<old start>": "<new start>" } }`. An exact row wins; otherwise the longest prefix that the old name starts with. A table entry that matches no row is an error (exit 2).

The README of the repository lists both in its table of tools.

### eval-bench.vt.ts

`npm run bench:eval` runs it through `vitest.bench.config.ts` and prints the throughput of the forward model and the search to the console.
