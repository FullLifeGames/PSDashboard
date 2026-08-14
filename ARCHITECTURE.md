# Architecture Notes

This document describes how the current prototype works internally and where its biggest approximation points are.

## End-to-End Flow

### 1. Replay loading

The app starts in [`src/components/ReplayLoader.tsx`](./src/components/ReplayLoader.tsx), where the user provides:

- a replay URL or replay ID
- or a locally exported replay file (a "Download replay" `.html` export or a raw protocol log), via drag & drop or the file picker
- optionally a pasted team export

`useReplay` then:

1. normalizes the replay input in `parseReplayUrl` and fetches `https://replay.pokemonshowdown.com/<id>.json` — or, for files, parses the export in `parseExportedReplay` (the export wraps the log in a `text/plain` script with `/` escaped as `\/`; the replay id comes from the hidden `replayid` input, never from the file name, so arbitrary file names cannot corrupt format inference)
2. parses the replay log into snapshots
3. infers visible team information for both sides

The app can also be driven from outside ([`src/hooks/useEmbedHost.ts`](./src/hooks/useEmbedHost.ts)): `?replay=<id|url>` auto-loads a replay on startup, `?embed=1` hides the chrome for iframe embedding, and a host page can post `{ type: 'ps-load-replay', replay }` (id, URL, raw log, or exported HTML content). The app answers with `ps-embed-ready` / `ps-replay-loaded` / `ps-replay-error`; these types are disjoint from the internal viewer-iframe protocol below.

Relevant files:

- [`src/hooks/useReplay.ts`](./src/hooks/useReplay.ts)
- [`src/hooks/useEmbedHost.ts`](./src/hooks/useEmbedHost.ts)
- [`src/lib/replay-fetcher.ts`](./src/lib/replay-fetcher.ts)
- [`src/lib/replay-file.ts`](./src/lib/replay-file.ts)
- [`src/lib/protocol-parser.ts`](./src/lib/protocol-parser.ts)
- [`src/lib/opponent-inferrer.ts`](./src/lib/opponent-inferrer.ts)

### 2. Snapshot creation

`parseReplayLog` uses `@pkmn/client` to feed the raw replay protocol into a battle client and record snapshots at turn boundaries.

Each `TurnSnapshot` stores:

- both sides' Pokemon state
- field state
- side conditions
- the chunk of protocol associated with that snapshot

This snapshot data powers the turn slider and is also used later to partially correct reconstructed simulator state.

The same pass also collects **damage observations** (`parseReplayLogWithObservations`): every clean singles hit — no crit, no multi-hit, no `[from]` attribution, and only inside the current move action, so confusion self-hits and Future Sight resolutions are never misattributed — records attacker, defender, move, boosts, screens, weather, and the observed HP fraction. These observations feed the spread inference below.

### 3. Team reconstruction

When the user starts a branch, `buildTeamsFromReplay` creates `PokemonSet[]` values for both sides.

The current precedence is:

1. revealed information from the replay (and the user's manual edits)
2. the user's pasted team for `p1`, when provided, and Open Team Sheets
3. damage-consistent inferred spreads ([`src/lib/spread-inference.ts`](./src/lib/spread-inference.ts)): a deterministic solver checks standard EV-spread candidates against `@smogon/calc` roll ranges for every observation a Pokémon appears in, replacing guessed spreads only where at least two observations demand it — and only in the dimensions the evidence can measure (offense from attacking observations, bulk from defending ones). Speed constraints come from the replay's own races: same-turn move order and KO-before-acting evidence (the victim provably chose a move — a chosen switch would have resolved before the attack) become hard constraints over the built configuration, with directional exclusions keeping observations a modifier only strengthens; solves whose best candidate misfits the observations beyond a per-observation threshold forfeit back to the prior instead of standing on a least-bad fabrication, unless the solve repairs a speed violation. Every candidate is legalized to the format's EV budget before scoring (508 total / 252 per stat; Pokémon Champions formats, detected from the `|tier|` line, use 66/32), least-evidenced stats give way first with Speed last, and winners top up their unspent budget in unmeasured non-Speed stats — the sim never fields an over- or under-statted spread. The solve runs once per replay and is cached across all team-build call sites; the stats panel shows solved spreads as "fits observed damage"
4. Smogon usage-stat guesses for anything still unknown, when monthly stats can be fetched — formats without a stats file (Custom Game, niche metas) fall back to the generation's OU stats. Guessed moves assemble coherently ([`src/lib/set-coherence.ts`](./src/lib/set-coherence.ts)): published sets are scored against the revealed evidence (fit per revealed move/item/ability, rule-outs disqualifying, usage marginals as the tiebreak) and the winner fills unrevealed slots as one unit; marginal fills pass pairwise vetoes — big attacks the set's boosts do not serve, orphaned defense-boost enablers without their payoff attack, same-type damaging redundancy, and status fills under a Choice/Assault Vest guess all fall, with the deeper usage pool refilling the slots. The stats-panel enrichment (`team-info.ts`) and the simulator team builder run the SAME selection and vetoes, so the display never shows a set the engine would not play
5. `@pkmn/smogon` set assumptions for remaining gaps (Custom Game also maps to the generation's OU here)

Guesses are additionally filtered by **protocol rule-outs** (`RevealedPokemonInfo.ruledOut`): hazard/status/weather/Life Orb damage disproves Magic Guard, rocks chip disproves Heavy-Duty Boots, a landed Ground move disproves Levitate (guarded against Gravity, immunity-ignoring moves, and possible Mold Breaker attackers), two distinct plain moves without leaving the field disprove every Choice item (Dancer-capable species and `[from]`-called moves never count; a switch resets the evidence), and a plain status move disproves Assault Vest. A disproven ability or item walks to the next candidate instead of surviving as a guess — and disproven Choice guesses stop fabricating move locks in late-game reconstruction.

The knowledge model round-trips natures, IVs, and levels. Both teams can be exported as text and re-imported (`src/lib/sets-io.ts`, side-headered Showdown blocks); imports overlay as manual knowledge, persist per replay id in localStorage, and rebuild a live branch through the same refresh path as team edits. The team editor draws its choices from legal pools (`src/lib/pokemon-options.ts`: learnset-based move pools with prevo-chain walk, gen-legal items, species abilities, tera types, natures), loaded via dynamic import so dex data stays out of the entry chunk.

This is the most important approximation point in the current implementation. The branch engine can only be as accurate as the reconstructed teams.

Relevant files:

- [`src/lib/team-builder.ts`](./src/lib/team-builder.ts)
- [`src/lib/team-info.ts`](./src/lib/team-info.ts)
- [`src/lib/smogon-stats.ts`](./src/lib/smogon-stats.ts)
- [`src/lib/smogon-sets.ts`](./src/lib/smogon-sets.ts)
- [`src/lib/team-parser.ts`](./src/lib/team-parser.ts)

### 4. Branch reconstruction

`src/lib/branch-engine.ts` is the core reconstruction module. `useBranch` wraps it with React state for the UI.

When `startBranch` runs, it:

1. creates a new `@pkmn/sim` battle
2. reorders both teams so the replay lead appears first
3. starts the battle and sends `default` for team preview
4. splits the replay protocol into turn blocks
5. replays original choices turn by turn until the target branch turn, staying in lockstep with the simulator's turn counter: a block's choices are only written when the simulator stands at that block's turn (a sim that ran ahead skips stale blocks, one that fell behind advances on defaults first, a wedged battle stops instead of feeding later turns wrong choices). Taunt-blocked moves replay from their `|cant|` line instead of defaulting to move 1.
6. handles follow-up forced switches when the simulator requests them
7. corrects HP, status, and the active Pokémon from the selected snapshot — including Pokémon the simulator fainted but the real battle kept alive (guessed spreads make damage rolls differ), which would otherwise leave the wrong Pokémon on the field with no protocol switch line to fix it. Corrected actives enter fresh (no choice locks inherited from the diverged history), corrections rerun the sim's disable pass and rebuild requests, and every correction pass restores the side-level invariants the sim itself runs on: `pokemonLeft` (the win-check counter — drifted high, a KO of the last body would not end the game) and `isActive` flags (drifted false, bench enumeration would offer a switch onto the field)
8. exposes the resulting simulator state to the UI

For doubles, the branch state includes slot-indexed active Pokemon, move lists, legal target options, switch lists, force-switch flags, and pending choices. The legacy single-active fields still point at slot 0 so the singles UI/tests remain compatible. Reconstruction also uses protocol `switch` and `drag` lines to correct active slots when simulator randomness would otherwise choose a different phazing target.

The same lockstep replay tolerates synthetic logs (e.g. video-reconstructed replays): missing `|upkeep` markers, unparseable lines (skipped during snapshot parsing), and CRLF endings (normalized at ingestion) no longer desync the reconstruction — the regression suite pins a full video-reconstructed replay turn by turn, down to a pending Future Sight surviving to its branch point.

After branch entry, the user can choose actions for both sides and `executeTurn` submits them to the live simulator.

Relevant files:

- [`src/hooks/useBranch.ts`](./src/hooks/useBranch.ts)
- [`src/lib/branch-engine.ts`](./src/lib/branch-engine.ts)

## UI Structure

The main application surface in [`src/App.tsx`](./src/App.tsx) has two modes:

- original replay mode
- branch mode

### Original replay mode

- `PSReplayFrame` renders the fetched replay log through a generated HTML document.
- That HTML bootstraps `replay-embed.js` from Pokemon Showdown.
- Turn updates are posted back to the parent window so the branch slider can follow the replay viewer.

### Branch mode

- `PSReplayFrame` renders the branch simulator log instead of the original replay log.
- `BranchPanel` shows move, target, and switch controls for both sides, plus a "What if it had …" row that loads a hypothetical legal move into the active set — implemented as a team edit going through the same branch-refresh path as `TeamEditor` saves, with the move pre-seeded as that slot's pending choice.
- `BranchHistoryPanel` compares executed branch turns against the original replay line.
- `BranchSaveSharePanel` saves compact branch reports to localStorage and creates URL-hash share payloads.
- `BattleStatsPanel` stays visible to show inferred team information.
- `TeamEditor` lets the user override inferred fields for either player before branching.

Relevant files:

- [`src/components/PSReplayFrame.tsx`](./src/components/PSReplayFrame.tsx)
- [`src/lib/replay-html.ts`](./src/lib/replay-html.ts)
- [`src/components/BranchPanel.tsx`](./src/components/BranchPanel.tsx)
- [`src/components/BranchHistoryPanel.tsx`](./src/components/BranchHistoryPanel.tsx)
- [`src/components/BattleStatsPanel.tsx`](./src/components/BattleStatsPanel.tsx)
- [`src/components/TeamEditor.tsx`](./src/components/TeamEditor.tsx)

## Approximation Points

These are the main reasons the current simulator can diverge from the real battle:

### Hidden information

The replay log does not expose every relevant battle input. Unknown values are currently inferred or guessed:

- unrevealed moves
- EVs/IVs/natures
- unrevealed items and abilities
- some tera details before reveal

The UI keeps these categories separate:

- `revealed`: directly observed in the replay protocol
- `guessed`: filled from Smogon usage probabilities or `@pkmn/smogon` set assumptions
- `manual`: edited by the user
- `unknown`: not known and not guessed

### Replay choice reconstruction

The branch engine reconstructs prior choices from protocol lines such as `|move|` and `|switch|`. For targetable doubles moves, it translates protocol targets like `p2b:` into the simulator's relative target locations such as `+2`. Regression fixtures now cover redirection, retargeting after a fainted target, and protocol-guided phazing correction. Complex edge cases can still break reconstruction, especially unusual targeting effects or volatile state that is not represented in the replay snapshot.

### Save/share

Branch share payloads are intentionally compact. They include replay identity, format, players, branch turn, executed choices, and the final branch protocol log. They are useful for reporting and comparing a branch, but they are not yet a full deterministic branch restore mechanism.

### Bundle splitting

The initial app path avoids importing the heaviest simulator modules directly. Replay parsing, Smogon stats, team building, branch reconstruction, and damage calculation are loaded with dynamic imports when the user reaches those workflows. The build still emits large async Pokemon data chunks for dex/learnsets, but they are no longer part of the initial entry chunk.

### Partial state correction

After replaying turns inside the simulator, the code corrects HP and status from the selected snapshot. This helps reduce visible divergence, but it does not fully reconcile every hidden or transient state.

### External viewer dependency

The replay viewer and sprite assets are loaded from Pokemon Showdown-hosted resources. The app is not fully self-contained today.

### iframe sandbox

The replay viewer iframe is rendered with `sandbox="allow-scripts allow-same-origin"`. This combination effectively disables the sandbox for the blob document — and that is a deliberate choice: the two-way turn synchronization (`ps-seek-turn` / `ps-turn` postMessages, live log appends) and the e2e assertions need script execution plus same-origin access to the embedded `Replays` object. The document only ever contains our generated wrapper plus `replay-embed.js` from play.pokemonshowdown.com, so the trust boundary is the same as loading that script directly.

On narrow screens the embed keeps its desktop layout; the app wraps it in a horizontally scrollable container with a 640px minimum width so the battle log stays reachable instead of being cut off.

## Validation Status

The current codebase has been validated with:

- `npm run lint`
- `npm run build`
- `npx playwright test`
- `npm run test:regression`
- `npm run test:feedback` (on demand): the expert-feedback drift suite — six pinned smogtours replays swept through the real app, graded warn-only against a corpus of expert-approved truths and tracked gaps; hermetic and bit-repeatable, reporting to `docs/reports/` instead of failing on drift.

The regression suite covers pure Smogon-stat parsing/enrichment (including the Custom Game → OU fallback), exported replay file parsing, branch save/share encoding, target-specific damage previews, basic doubles branch state, redirection/retargeting/phazing fixtures, stable checkpoints from a mocked fixture, and stable checkpoints from a saved real replay. Two deeper checkpoints are marked `fixme` to document known divergence rather than hiding it.

## Recommended Refactor Direction

If the project continues, the cleanest next architectural move would be to keep tightening the three separately testable layers:

1. replay ingestion and inference
2. deterministic branch reconstruction
3. UI rendering and controls

That makes it much easier to measure reconstruction accuracy, expand replay regression tests, and keep the frontend moving without coupling it to simulator internals.

## Evaluation Engine

The chess-style evaluation lives in [`src/lib/eval/`](./src/lib/eval/) and is deliberately layered so the expensive sim work stays off the main thread while everything above it is pure and unit-testable:

1. **Forward model** ([`forward-model.ts`](./src/lib/eval/forward-model.ts)) — forks the serialized battle, enumerates legal choices from the live request cross-checked against live state (singles and combined doubles choices with targets and one Tera/Mega/Ultra per side per turn; a side waiting out the opponent's forced switch gets a `wait` sentinel; Imprison-concealed moves are filtered by live disable flags; locked releases whose request carries no target data — mid-charge Phantom Force, rampages — fall back to the dex's target type, because serialization drops the locked-request shape and the round-tripped sim demands a target again), advances joint choice pairs under fixed seeds (pivot choices carry their declared follow-up switch as `move uturn > switch 4`, answered when the sim raises the forced-switch request), and greedily resolves remaining mid-turn forced switches. Every deserialize passes through a repair layer: transform-shortened moveSlots pad-deserialize-trim, fainted actives regain a proper switch request, and the side invariants (`pokemonLeft`, `isActive`) restore from ground truth so stale correction-era states self-heal.
2. **Static eval** ([`eval-function.ts`](./src/lib/eval/eval-function.ts)) — positional scoring (bodies, HP, status, boosts, hazards, screens, Tailwind, Trick Room) plus an aggregated 1v1 matchup threat term: per-pair best-damage fractions from movesets, the type chart, stats, the big items and immunity abilities, priority, and recovery walls. The memoized pair term is HP- and boost-independent; current boost stages are applied outside the memo, so a Swords Dance moves the matchup term, not just a flat weight. Hazards are priced per living victim (type-chart fractions, Boots/Magic Guard skip, the sim's own grounding with a bench-Levitate correction, dex-typed Toxic Spikes immunity), minus the **removal option value** a living Defog/Rapid Spin carrier holds over the net board state (own-side movers net full relief, both-sides movers net relief minus the side's own hazards across the field, net-negative options count zero, and the exercised option is tempo-discounted). The matchup term is **entry-cost-aware**: benched Pokémon are weighed by the HP they would actually arrive with through their side's hazards, so rocks can genuinely disable a benched 4×-weak wincon — unless it holds Boots. Coverage gaps, Choice items locked into bad moves (including the live choice-lock volatile), item quality, and status-dampened boosts carry their own terms. The whole thing is a fittable feature vector (`evalFeatures` × `FEATURE_WEIGHTS`), and the weights are **calibrated per gametype**: `DOUBLES_FEATURE_WEIGHTS` carries corpus-fitted doubles values (boosts, Tailwind, Trick Room — speed control is worth several times its singles weight), fitted by the opt-in `EVAL_FIT=1` harness on a manifest-pinned corpus of 2,100+ games (gen9 singles, old-gen singles, doubles/VGC tranches) with cluster-bootstrap standard errors, per-phase Brier scoring, and a phase-conditioned win-probability fit — adopted only through the calibration gate, with every rejected experiment recorded in the calibration header.
3. **Search and ranking** ([`search.ts`](./src/lib/eval/search.ts), [`rank.ts`](./src/lib/eval/rank.ts), [`mcts.ts`](./src/lib/eval/mcts.ts)) — the joint choice matrix is evaluated with iterative deepening (KO-boundary roll grouping, dominated row/column pruning, candidate restriction for deep sub-searches, and a no-op filter dropping field moves that fail deterministically against standing conditions — Stealth Rock with rocks already up is a pass wearing a move's label; doubles restrict to a core-deduplicated candidate list ranked by threat hints plus setup/support/spread/Fake Out bonuses, with a separate gimmick budget and the actually played combo always kept), then solved as a matrix game by regret matching: choices carry their expected value against the opponent's equilibrium mix, the position score is the solved game value, and the maximin floor survives as the "safe" column. At the root, pivot moves expand into move-plus-incoming pairs over the live bench ("U-turn → Clefable") on both the sync and orchestrated paths (parity-tested); EV-tied leading rows fold in their one-ply horizon trend under the standing equilibrium (no re-solve — the re-solve variant refuted itself: the equilibrium re-weights toward the corrected row's punishers). A DUCT Monte-Carlo tree search mode runs four seed-rotated root trees merged by pooled root-cell statistics — its rankings are the SAME equilibrium solve the matrix mode runs, over tree-informed cells (each cell's value is the mean of the leaves backed through it plus one static-prior visit; a root cell fixes ONE chance outcome per tree — visits measure subtree exploration, not transition samples — so support cells the pool has starved, seen through too few trees, or priced in disagreement across trees are re-verified by the matrix-grade multi-seed cell sampler in one bounded worker round before the solve), so every root option is ranked with matrix-mode ev/mix/punisher semantics, while the SCORE keeps the visit-mean formulation the corpus records were measured on (full score delegation to the equilibrium measured −1 sign paired and was rejected) — with hint-ordered expansion under progressive widening — the restriction machinery's own static hints decide which options may open as visits accumulate, so a wide doubles root no longer starves its iteration budget; it carries its own corpus calibration — on the clean fills rig the depth-1 matrix ties or beats the pure tree overall, so the tree earns its seat through the default Auto line, which routes to it once the fainted fraction crosses the threshold and is best-or-tied both early and late on the re-baselined bed. Team preview is searchable too: turn 0 enumerates lead pairs (doubles) or leads (singles) as `team` choices, with an active-pair matchup emphasis in the static eval making lead order visible at depth 1.
4. **Orchestration** ([`orchestrator.ts`](./src/lib/eval/orchestrator.ts), [`worker-client.ts`](./src/lib/eval/worker-client.ts), [`src/workers/eval-worker.ts`](./src/workers/eval-worker.ts)) — a pure async orchestrator with exact parity to the sync search, fanned out over a worker pool sized to the machine.
5. **Analysis** ([`played.ts`](./src/lib/eval/played.ts), [`analysis.ts`](./src/lib/eval/analysis.ts), [`leads.ts`](./src/lib/eval/leads.ts), [`winprob.ts`](./src/lib/eval/winprob.ts), [`opponent-model.ts`](./src/lib/eval/opponent-model.ts), [`summary.ts`](./src/lib/eval/summary.ts), [`report.ts`](./src/lib/eval/report.ts)) — parses the actually played actions and leads from the protocol (per-slot in doubles, charitable matching when a slot's action stayed hidden), matches them into the ranked lists, decomposes each swing into a decision part and a chance part (the played pair is valued at the sweep's own depth), and assigns verdicts banded on equilibrium-EV regret: inaccuracy, mistake, or blunder — with one-tier leniency in decided positions, an acquit-only verification pass one depth deeper for flagged mistakes (engine-independent — an MCTS-line flag re-adjudicates as matrix pairs at the same deep tier), sacrifice detection (a faint from ≤15% HP is a deliberate low-cost trade: one-tier demotion, neutral phrasing, never a seed of the loss; a HEALTHY body switched in and fed reads as a simplification sack only while the sacker's engine score stays decisively winning before AND after — but a blunder-sized regret is never forgiven by either label), a stay-in phantom for sides KO'd before they ever acted (the KO evidence proves a move was chosen and every priority-0 move is outcome-equivalent, so the best-ranked one prices the pair and the stay-in grades against the engine's best escape — while sleep/flinch/full-paralysis turns keep the honest "unclear"), and unpunished risks / paid-off reads (the payoff may cash in over a multi-turn window) kept apart from misplays. All values live in win-probability units: the per-gametype logistic mapping fitted to real outcomes applies exactly once, at the search leaf (`wpUnits`), so every downstream mean, equilibrium solve, and regret averages probabilities. Display then passes through a **second fitted stage** (`DISPLAY_K` in `winprob.ts`): averaging plus equilibrium selection re-inflates the aggregated root score, so `winPercent` maps it through sigmoid(DISPLAY_K·s) — fit-corpus-trained, graded out-of-sample on the calibration bed, with exact ±1 (an ENDED evaluation) staying a literal 100/0 — while regret/delta texts and the verdict bands stay in wp-units and mean literal win-probability loss (5/10/20%). The mapping is **phase-aware** (`K = k0 + k1·faintedFraction`, fitted per gametype): the same positional edge claims less confidence early and more as bodies drop — the corpus-measured fix for early-game overconfidence. Verdicts that survive verification are additionally **sensitivity-probed** against the opponent's guessed items ([`sensitivity.ts`](./src/lib/eval/sensitivity.ts) swaps usage-plausible alternatives directly into the serialized position, rule-outs respected, ≤2 probes per flagged side): if an alternative flips the verdict, it softens to the most charitable probed tier and the summary names the hinge — acquit-only, like the deep pass. The Read lens is an exploitative layer on top of the already-solved matrix: `modelOpponent` mixes the equilibrium with a softmax over the opponent's own payoffs (Restricted-Nash-style anchor) sharpened by replay-observed tendencies, and `computeRead` surfaces a best response when the model is confident and disagrees with equilibrium — advisory only, never part of the grade. The game report aggregates turning point, seeds of the loss, the lead matchup, per-side misplays, sacks, and reads, per-player accuracy (win-probability loss, volatility-weighted), and luck. Tera enumeration honors a per-Pokémon allowance ([`tera.ts`](./src/lib/eval/tera.ts)): revealed-only in draft/custom formats or on user request.

[`useEvaluation.ts`](./src/hooks/useEvaluation.ts) drives it: single evaluations, three-pass game sweeps (a fast depth-1 scan shapes the line in seconds, the configured settings deepen every report-worthy swing — the same threshold the report's key moments use, so the report never names a turn the sweep left shallow — and then every remaining turn converges to the configured settings: the settings ARE the line), and per-turn caching in memory and IndexedDB keyed by replay, turn, a sets fingerprint, the Tera allowance, and the engine settings/version. Graph writes are monotone (`supersedesStored`): a shallower pass never overwrites a deeper stored turn, so re-analyzing cannot downgrade an explicitly deepened result — including across engines: deepening an MCTS turn crosses into the matrix ladder at depth 2, and a matrix escalation of depth ≥ 2 outranks the d1s1-grade MCTS tier in every later sweep. Selecting a turn never re-searches — deepening is the explicit "Think deeper" button (sketch → configured settings → depth 3, never shedding samples), and per-turn settings badges on the report chips and the turn view keep mixed-depth curves honest. The single-turn re-search acquires its position through the same per-turn snapshot healing the sweep uses, with a reached-guard that fails loudly (instead of publishing a decided ±1) when a replay diverges beyond what healing can repair. The default engine mode `auto` is a complete spec resolved per turn BEFORE dispatch — d1s1 matrix below `AUTO_MCTS_FAINTED_FRACTION` of bodies fainted, the DUCT tree at or above — so stored results and store keys always carry the concrete engine that ran, the sweep's routing mirrors the calibration harness bit-exactly, and supersedes/upgrade decisions resolve through the turn's recorded fainted fraction (failing closed across modes when it is unknown). The sweep waits for the Smogon usage/sets fetches, so it can never silently bake teams without the guessed fills. Game sweeps acquire every position from one boundary-corrected reconstruction; entering a branch uses the same per-turn snapshot corrections so the branch opens on the position the analysis described. Clicking an engine line plays the turn out against the engine's reply and re-evaluates — the chess-engine walk.
