# PS Dashboard Evaluation Reference

This file says what the engine claims, what it guesses, and where it fails. Read it before you trust or doubt a number. The score is a heuristic estimate for spotting swings and blunders, not an oracle. [ARCHITECTURE.md](./ARCHITECTURE.md) covers how the code is layered; [README.md](./README.md) covers setup and commands.

## 1. What the app knows about a game

### Sources

The loader takes a Pokemon Showdown replay URL or id, including smogtours ids and private `-…pw` password links, and falls back to the replay server's `.log` route when the JSON route is unusable. A locally saved replay loads too: drop a "Download replay" `.html` file or a raw protocol log on the loader, or use `Browse file`. `?replay=<id|url>` loads a replay on startup and `?embed=1` hides the app chrome for an iframe host (README, "Embedding").

### Revealed, sheet, guessed, manual

Every field of both teams carries its source, and the stats panel shows it:

- revealed: proven by the protocol (moves, items, abilities, levels, gender, Tera type), including ability reveals from effect attributions, item reveals from heal messages, mega stones, Life Orb recoil and Rocky Helmet chip, and a Heavy-Duty Boots inference for a Pokémon that takes no Stealth Rock damage,
- sheet: from an open team sheet (`|showteam|` or a "View team" chat export), authoritative for items, abilities, moves and EVs the protocol never showed,
- guessed: usage statistics and set assumptions; a spread fitted to observed damage shows as "fitted", a Choice Scarf the move order proved as "inferred",
- manual: your edits and imports.

Revealed and manual knowledge outrank the sheet, and the sheet outranks guesses. The simulator teams for branching and evaluation follow the same order, so a usage guess never overwrites a sheet item. Placeholders stand in for unrevealed Random Battle slots.

### Rule-outs

The protocol disproves guesses, and a guess never contradicts the replay:

- hazard, status, weather or Life Orb damage rules out Magic Guard,
- Stealth Rock chip rules out Heavy-Duty Boots,
- a landed Ground move rules out Levitate, but only inside the current move action, and never under Gravity, with an immunity-ignoring move, or from a species that can carry Mold Breaker,
- two distinct plain moves without switching rule out every Choice item (Dancer species excepted; called moves like Sleep Talk never count),
- a plain status move rules out Assault Vest.

A rule-out moves the guess to the next candidate instead of dropping to nothing.

### Usage and set guesses

Usage stats come from `data.pkmn.cc`, the only host that sends CORS headers, with the GitHub Pages mirror behind it when the primary host fails outright; a 404 counts as an answer. `@pkmn/smogon` supplies set assumptions for abilities, items, moves, natures and EVs. Guesses merge per species along a fallback chain: the format's own stats file, then the Smogon doubles ladder for VGC, the generation's OU, and Ubers. VGC reads the file of its year; Pokémon Champions VGC reads its own (`gen9championsvgc2026`), since Champions plays with megas, its own items and its own stat scale. A species missing from a file still gets guessed moves, items and abilities. Set assumptions come from the format's set file, then the generation's Ubers file (Doubles Ubers for doubles); VGC reads the set file of its year and never the Doubles OU analyses. Each guess names the file it came from. An ability no file can guess defaults to the species' slot-0 ability. When the set files cannot load at all, the top bar says "Smogon sets unavailable" instead of guessing without them.

A guessed set assembles as one unit. Published sets are scored against the revealed evidence, the winner fills the unrevealed slots, and pairwise vetoes trim the marginal fills: a big attack the set's boost does not serve falls (a Swords Dance Cobalion never guesses Body Press), an orphaned defense boost falls with its payoff, same-type redundancy collapses, and a Choice or Assault Vest guess suppresses guessed status moves. The stats panel and the simulator run the same guesser, and "Analyze game" waits for the Smogon fetches.

### Fitted spreads and inferred Scarf

Hidden EV spreads are fitted to the damage the replay showed. Every clean hit, in singles and doubles, becomes a damage observation; a deterministic solver checks standard spread candidates against `@smogon/calc` roll ranges. It replaces a usage-guessed spread only where at least two observations demand it, never touches revealed or edited spreads, and reads offense only from attacking observations and bulk only from defending ones. Speed comes from the replay's own races: same-turn move order and knock-outs landed before the victim acted become speed constraints. The parser drops any order something other than Speed explains (priority, Prankster, Quick Claw, Trick Room turns, weather speed abilities, copied actions). Candidates respect the format's EV budget (508 total and 252 per stat; Pokémon Champions uses 66 Stat Points and 32 per stat).

A solve that misfits its own evidence falls back to the usage prior. Solved spreads reach every simulator team.

What the fit cannot prove: "the defender is bulkier" and "the attacker is weaker" fit the same damage line, so the solve guarantees consistency with the replay, not the true spread. A knock-out line is only a lower bound, so an attacker seen only in knock-outs keeps its guessed offense. A move order no legal spread reproduces keeps the guessed Speed.

A move order the mover cannot reach at full Speed reads as a Choice Scarf. The solver measures the mover against the slowest plausible opponent spread (common usage spreads, or the real one when a sheet or edit fixed it) and gives the Scarf only when even that opponent stays out of reach, the Scarf closes the gap, and the species runs Speed-invested spreads at all. The rule also runs backwards: a guessed Scarf that would outrun an observed order is dropped and the build takes the next item. Known items, sheet sets and protocol rule-outs stay untouched, and the sensitivity probes skip an inferred Scarf.

### Editing and importing sets

Edits for either player (`Edit Player` and `Edit Opp` in the top bar's `Setup` menu) rebuild the branch and replay its history. The editor offers legal pools: learnset-based moves, generation-legal items, the species' abilities, Tera types and natures. `Import/Export Sets` round-trips both teams as Showdown text (natures, IVs, levels included); imports persist per replay as manual knowledge. An import that names a move, ability, item, nature or Tera type the editor would not offer, or a species that is not on the team, imports nothing and lists what to fix. Hypothetical moves ("What if it had …") load into the set.

## 2. The evaluation

### Search modes

A sim-backed search plays every legal choice pair on forked battles and solves the choice matrix as a zero-sum game by regret matching. Sampling is deterministic with fixed seeds and KO-boundary roll grouping, and the work fans out over a worker pool sized by the machine's cores, so pool size moves only wall-clock. The engine selector offers four modes:

- depth 1 and depth 2: the full joint matrix, with deeper cells valued by a shallower sub-search,
- MCTS: a DUCT tree search (four trees of 600 iterations). A forced switch after a knock-out is a decision node inside the tree; the root matrix, verify sampler, play-outs and prover resolve replacements by the static pick. Chance-suspect root cells are re-verified by the matrix sampler, so a lucky miss in one tree cannot masquerade as a good line. A cell the trees played out over enough visits, with the trees in agreement, keeps the trees' value when it reads a decided game (±0.9), and in an endgame of at most two living Pokémon a side at any value: there the trees play the game to its end, and the sampler's single ply turned the ranked lines against the score,
- Auto, the default: singles run a depth-1 matrix with three samples while boards are full and the tree once a quarter of all Pokémon have fainted; doubles run the tree from the first turn. The team-preview lead stays on a depth-1 matrix in both game types.

Pivot moves (U-turn, Volt Switch, Flip Turn, Parting Shot, Baton Pass and the like) are move-plus-incoming pairs over the live bench, so the engine can say which Pokémon makes a pivot safe. Guaranteed-failing clicks are dropped from the candidates.

Tera enumeration is a setting. Auto infers "banned" from a replay that never terastallized; Revealed mode, the automatic behavior in draft and custom formats, restricts Tera to the Pokémon that terastallized in the replay.

Doubles search combined two-slot choices (per-slot targets, spread moves, one Tera, Mega Evolution or Ultra Burst per turn) over a candidate list cut down per side. Static threat hints rank the combos, distinct move cores fill the budget before gimmick variants, and the pair played in the real game always stays so its regret remains computable. A turn with a hidden slot action (a flinch, a fainted partner) is graded on the visible slot alone.

### Win probability

Choices rank by expected value against the opponent's equilibrium mix. The score lives in win-probability units: one sigmoid fitted to real outcomes applies at the search leaf, so averaging values averages probabilities, which makes variance worth something when you are behind. The mapping is phase-aware, claiming more per point of edge as Pokémon faint. Shown percentages pass a second calibration stage fitted on the weight corpus and checked out of sample, because averaging re-inflates the aggregated root score. A finished position reads 100/0.

### Matchup, hazard and race terms

- Matchup: a per-pair 1v1 threat estimate (movesets, type chart, stats, speed, big items, immunity abilities, priority, recovery walls) makes early positions readable before anything faints. Active pairs weigh more than bench pairs, and the term reads the doubled speed of a Tailwind side.
- Hazards: priced per living victim, with Boots, Magic Guard, grounding and Toxic Spikes immunity read from the simulator or the type chart. A living hazard remover holds an option on the net board (Defog nets relief minus the hazards it clears off its own side, and a net-negative option is never exercised). A benched Pokémon fights through its entry damage, and one that cannot survive re-entry is priced as finished unless a teammate can clear the hazards.
- Race: with one living Pokémon per side, the leaf gives the race winner 0.6 plus 0.1 per turn of clock margin, capped at 0.9. The clocks come from heal, residual and PP budgets, and mutual walls keep the static. Fixed-damage moves count at their fixed amount.
- Smaller terms: boosts that bite, coverage gaps, Choice items locked into bad moves, status-dampened setup, screens, speed control, and in doubles pair focus and redirection. A tie among the leading rows folds in the one-ply horizon trend.

### The forced-win prover

On a small board (at most three living Pokémon, or the last pair), or when the decided sweep names a side, a prover runs after the root search. It plays the favored side's moves against every reply in the simulator, outcome class by outcome class, until the game ends, and reports the proven mass: the share of classes along which the side wins against everything. A proof at or above one half lifts the score to that mass; the matrix and rankings stay as searched, and the engine's own score stays next to the bar. At 0.9 or above the turn card says "X wins in N against every reply", with a caveat when one roll stays open, a crit was not priced, or the rolls were sampled (doubles). A greedy probe runs first, and the budget is 100 matrix cells per position, never wall clock, so a position always proves the same way. A class the simulator refuses stays open and lowers the mass. On boards above three Pokémon the prover waits for the search to read the game at 0.6 or beyond.

### Weight tables

Each rule set and game type reads its own static weight table, named from the replay's format ([`weights.ts`](./packages/eval-engine/src/score/weights.ts)). The fits use a pinned corpus of about 5,600 tournament and ladder games built the way the app builds teams, and the doubles and Champions fits are checked on a held-out third of their games.

- Standard singles: the hand-set table (matchup 120, screens 5, tailwind 8, Trick Room 10).
- Standard doubles (Doubles OU): fitted; screens 88, Tailwind 68, Trick Room 58, matchup 118.
- VGC doubles (Scarlet/Violet VGC): fitted on its own games; Tailwind 0, because the matchup term already reads the doubled speed, Trick Room 54, screens 48, matchup 169.
- Champions singles: a body counts 121 against 200 in standard singles, and a matchup 210 against 120.
- Champions doubles and Champions VGC: fitted on rated Champions games; screens 83, matchup 96, Trick Room 87.

### Other engines

The Evaluation panel can hand positions to another engine instead of the search ([ENGINES.md](./ENGINES.md)). The dashboard sends it the options the search would rank and checks the shape of every answer. An answer with the value of every pair goes through the same equilibrium solve as the search's matrix; an answer with one value per option stands as the engine gave it, so floors and punishers stay empty. Verdicts, the graph and the report read those values with the same bands. The bank, the holdouts and the expert pins measure the dashboard's own search, so another engine's percentages carry that engine's calibration; the panel says "estimate from" and the engine's name, and depth and samples hide while another engine evaluates.

## 3. Game analysis

### The three-pass sweep

`Analyze game` turns the game into an evaluation graph. A background sweep runs three passes: a depth-1 scan shapes the line in seconds, your settings then deepen every report-worthy swing, and the whole line converges to your settings. Per-turn d1, d2 and MCTS badges show where each turn stands. Results cache per turn in IndexedDB, merge across partial sweeps and serve single-position evaluations; a stored result never downgrades to a shallower one. The cache key carries an engine version, and any change that moves what a position evaluates to bumps it, so old results never pass as current.

The graph draws the win-probability line with markers on the turns whose play created each blunder-sized swing; clicking a point opens that turn. "Always on" starts the sweep when a replay loads and evaluates fresh variation positions without a button; it persists and is off by default. Turn 0 grades the team-preview decision: every lead (singles) or lead pair (doubles) is searched and shown as a diamond before turn 1. A turn the sweep has not reached offers "Analyze this position".

### Turn verdicts

Each turn shows what each player played against the engine's choice, with the regret and, from depth 2, the line that prevents it. The swing splits into a decision part and a chance part (rolls, crits). A plain-language sentence leads, then aligned worst-case rows for played against best.

Verdict bands sit on equilibrium-EV regret in win probability: inaccuracy at 5 points, mistake at 10, blunder at 20. Once a side stands at 85% or better, verdicts soften one tier, so garbage time does not stack blunders. Every flagged mistake or blunder is re-searched one depth deeper; the deeper look can acquit a move, never convict it. The re-search and the probes below run for every engine mode.

- Sacrifice: a faint from 15% HP or less is "a low-cost trade", softened one tier and shown as a gray chip. A healthy Pokémon switched in and fed is a simplification sack only while the engine's scores call the game decisively won on both sides of it. A Pokémon that stayed in and died above 15% is a deliberate feed only when the realized outcome hit the line's priced floor and its payoff inside the payoff window clears the safe guarantee. No label forgives a blunder-sized throw.
- Stay-in: a side KO'd before it acted is priced through a stand-in that chose some priority-0 move, so the turn grades the stay-in against the best escape. Sleep, flinch and full-paralysis turns keep a no-blame verdict.
- Risk: a flagged regret whose punisher the opponent never clicked is "risk (unpunished)", not a misplay.
- Read: an actual pair that beat the safe line's guarantee by a clear margin is a "read paid off", and its payoff may cash in over the following turns. The "safe" line is framed as a guarantee, not as "better".

Sensitivity probes check a surviving verdict against the opponent's next plausible items, rule-outs respected. If some item flips it, the verdict softens to the most charitable tier and says so ("hinges on Heatran's item (Choice Scarf: mistake · Leftovers: fine)"), because a grade that depends on hidden information is not a grade.

### The Read lens

A boundedly rational opponent model (softmax over the opponent's payoffs, anchored to the equilibrium mix, sharpened by the attack and switch tendencies seen in the replay) surfaces a "Read:" line when a confident prediction makes a non-equilibrium choice the better pick, with the payoff per predicted reply. The model is advice and never part of the grade, except that a flagged risk matching it becomes "a read against the opponent's tendencies".

### The game report

Once a sweep covers enough of the game, the report tells the story:

- who won and where the game tipped for good, naming the mechanism only when the report can vouch for it (a paid-off read, or a roll the protocol shows),
- a chess-style accuracy score per player, volatility-weighted, shown once enough decided turns exist,
- "the seeds of the loss": the loser's costliest choices before the tipping point (unpunished risks never count),
- the lead matchup as turn-0 chips, each side's biggest misplays and paid-off reads as clickable chips, and summed regret per player,
- net luck, with a decided game's resolution booked apart from luck,
- the denied early end when the protocol shows a side one roll from clearing everything left and the roll failing,
- clickable key moments chosen by a turn's biggest component, so the biggest roll surfaces even when decision and chance partly cancel.

## 4. Timeline and playing lines

The replay is the main line. Executing a different move at any turn opens the single variation there, and the T0 view lets you pick leads (one per side in singles, both slots in doubles) and "Play from turn 0". Navigation is view-only and lossless. Playing a different move inside the variation cuts its tail; replacing the variation from the main line asks first. The graph overlays the variation as a gold curve. Branches save locally and share by link.

"Let it play out" has the engine play both sides' top choice to the end; Stop works anytime and every turn stays navigable. Clicking one engine line plays that turn out chess-style, the other side answers with its top reply, and the result re-evaluates. Mid-turn KOs resolve with the engine's replacement.

Bring-limited formats like VGC pick the bring-four at T0, and every reconstruction fields only what was brought. The trim is both sides or neither: if a side's selection was never revealed, the whole replay stays untrimmed.

A deviation rebuilds the simulator at that point from the protocol, the team model, optional usage fallbacks, an HP and status correction at each turn boundary, and a per-turn seed search that aligns the simulator's crits, misses and faints with the real log. When the guessed sets cannot replay a line (the simulated game wedges or ends early), the branch shows a divergence notice with a pointer to Edit Player/Opp.

## 5. Measuring the engine

Adopting a weight, a search rule or a team-building change goes through a paired gate: the old and new engine run the same bank positions, and the verdict reads paired Brier and log-loss deltas with a 90% band from a bootstrap over replays, where pooled rows decide and single phase cells only warn. Weights also face the holdout. The commands below write only to gitignored folders.

- Bench: `EVAL_BENCH=1 npx vitest run --project eval-engine eval-bench` prints forward-model and search throughput to the console.
- Calibration bank: `node scripts/run-calibration.mjs [--slices 6] [--out .calibration/<name>]` runs [`test/regression/eval-calibration.spec.ts`](./test/regression/eval-calibration.spec.ts) (`EVAL_CALIBRATION=1`) in parallel slices over 130 pinned replays (Gen 9 OU, Doubles OU, VGC and a few drafts, tournament and ladder) and writes per-slice dumps, `merged.jsonl` and `summary.txt` there. It scores sign accuracy, confidence calibration, per-phase Brier and the win-probability fit, plus an `hq:` line (tournament and 1700+ ladder games) and a `luck-adjusted:` line. Levers include `EVAL_CALIBRATION_DEPTH`, `_MODE=mcts`, `_SAMPLES`, `_TRANCHE`, `_SMOGON=1` (usage fills, disk-pinned in `.smogon-cache/`) and `_SOURCE=fit|holdout` (the fit corpus or the holdout instead of the bank, which brings in Champions). The bank builds teams the way the app does. `node scripts/paired-calibration.mjs a.jsonl b.jsonl [--quality hq|std]` compares two dumps.
- Fit corpus and holdout: `node scripts/build-fit-corpus.mjs` pins about 5,600 replays in `test/regression/fixtures/fit-corpus-manifest.json` (logs cache in `.fit-corpus/`). `EVAL_FIT=1 npx vitest run test/regression/eval-fit.spec.ts` regresses feature weights per rule set and game type with cluster-bootstrap errors, folds clustered by player set, and a phase-conditioned win-probability fit; reports land in `.fit-corpus/`. A third of the doubles and Champions sets (`test/regression/fixtures/fit-holdout-manifest.json`) never enters a fit and serves as a test bed. The harness only reports; weights are adopted by hand after the paired gate.
- Endgame truth: a solver under `packages/eval-engine/src/endgame/` computes the exact value of endgames with at most three living Pokémon, singles and doubles, under best play, by recursing over turn boundaries with chance priced as outcome classes. A result is `exact` only when no cap (30 turns, 20,000 states, 120 s), unpriced chance or loop was touched. `EVAL_ENDGAME_TRUTH=1` grades the static, matrix and MCTS estimators against it on positions the bank exports (`EVAL_CALIBRATION_POSITIONS=<dir>`) and on synthetic fixtures; `node scripts/endgame-truth-table.mjs` renders the dump. The solver is an instrument, not a production path.
- Feedback drift suite: `npm run test:feedback` analyzes seven pinned replays (plus five census replays that feed `scripts/tier-census.mjs`) through the real app and grades them against a corpus distilled from an experienced player's review. It is on demand, hermetic (recorded replays and Smogon data), deterministic on one browser build, and warn-only: drift is an analysis point, never a failing test, and only harness breakage fails. It writes `docs/reports/feedback-drift.md` and `.json` locally (`docs/` is not in the repository); `FEEDBACK_DUMP=1` also writes the full dumps for a byte-level comparison.

The always-on suites (`npm run test:regression` runs four Vitest projects: app, replay-core, eval-engine and ui) pin behavior and list themselves; README names the commands.

## 6. Known limits

The app does not recreate the original battle frame by frame, and branches can diverge from the replay when hidden information matters.

- Hidden moves, EVs, IVs, natures and some items and abilities are guesses when the replay did not reveal them. Some Tera details stay unknown before the reveal. Fitted spreads prove consistency with the replay, not the true spread (section 1).
- Usage guesses rest on `data.pkmn.cc` and its mirror. When neither has data for a format, set assumptions from `@pkmn/smogon` apply, then default simulator values. Unrevealed Random Battle slots stay `unknown`.
- Choice reconstruction reads `|move|` and `|switch|` lines and translates doubles targets to simulator targets. Redirection, retargeting after a faint and phazing are covered, but unusual targeting effects and volatile state the snapshot never shows can still break or skew a reconstruction. HP and status are corrected at each turn boundary, yet other hidden or transient state may differ. An unplayable reconstruction is detected and reported.
- Damage previews match the simulator's generation, sets and field, and apply an armed Tera toggle. Mega Evolution, Ultra Burst and Z-Moves are left out of previews until the turn executes.
- Share links are compact branch reports (identity, format, players, branch turn, executed choices, final log). They do not restore and replay an alternate line.
- The engine is a heuristic: a score is not a proof outside the prover's budget, and a search with a fixed budget can miss a line a deeper one finds.
- The replay viewer, sprites and the viewer script load from Pokemon Showdown-hosted assets, and usage stats and set files need the network, so the app is not self-contained; a file-based replay still loads offline except for those assets. On phones the viewer keeps its desktop layout inside a horizontally scrollable container.
