# PS Dashboard Evaluation Reference

This file says what the engine computes, what it guesses, and where it goes wrong. Read it before you trust or doubt a number. [ARCHITECTURE.md](./ARCHITECTURE.md) covers how the code is layered; this file covers what the app claims.

## 1. Loading and reconstruction

### Replay sources

The loader takes a Pokemon Showdown replay URL or replay id, validates the input, and reports unreadable input in plain words. Smogtours ids normalize to their real formats (`smogtours-gen3ou-…` becomes `gen3ou`). Private replay links load from the full `-…pw` password link; the loader keeps the password for the fetch and out of the inferred format. If a replay's JSON route comes back unusable, the loader retries the replay server's `.log` route before it gives up.

A locally exported replay loads too: drop a "Download replay" `.html` file or a raw protocol log onto the loader panel, or pick it with `Browse file`. Stats, branching, and sharing all work on file-based replays. Synthetic logs survive ingestion: the loader normalizes CRLF line endings, skips protocol lines it cannot parse instead of failing the replay, and keeps the reconstruction in lockstep with logs that lack `|upkeep` markers, such as video-reconstructed replays.

The original replay renders inside an embedded Pokemon Showdown replay viewer with two-way turn sync. Playback runs through without pausing itself, and the end position is labelled `End`. The app parses the replay protocol into per-turn snapshots. `?replay=<id|url>` loads a replay on startup and `?embed=1` hides the app chrome for another site's iframe (README, "Embedding").

### Revealed team data

Both teams come from the replay first: revealed moves, items, abilities, levels, gender, and Tera type when shown. The inferrer also reads:

- ability reveals from effect attributions (Poison Heal heals, for example),
- item reveals from heal messages, mega stones, and item-damage lines: Life Orb recoil names its holder; Rocky Helmet chip names the `[of]` Pokémon, or, in logs that drop that tag, the target of the damaged Pokémon's last move,
- a Heavy-Duty Boots inference for a Pokémon that switches into Stealth Rock without taking damage.

An unrevealed ability that no stats file can guess defaults to the species' slot-0 ability instead of a Pokémon with no ability at all.

Open Team Sheets (`|showteam|`) and embedded "View team" chat exports count as revealed team data. A pasted player team export is accepted as well: validated, shown as manual data in the stats panel, and persisted across reloads. German stat abbreviations are normalized. The stats panel labels every field as revealed from the replay, guessed from usage stats, or edited by hand.

### Rule-outs

The protocol disproves guesses, and the app honors that:

- hazard, status, weather, or Life Orb damage rules out Magic Guard,
- Stealth Rock chip rules out Heavy-Duty Boots,
- a landed Ground move rules out Levitate,
- two distinct plain moves without switching rule out every Choice item, with a Dancer-species guard; called moves like Sleep Talk's never count,
- a plain status move rules out Assault Vest.

A usage guess can therefore never contradict what the replay showed: a Clefable the replay shows taking Stealth Rock is never simulated as Magic Guard, and a guessed Choice item stops fabricating move locks that derail late-game reconstruction. A rule-out walks to the next candidate instead of dropping to nothing.

The Levitate inference demands proof. It attributes damage only inside the current move action (a confusion self-hit or a resolving Future Sight proves nothing), and Gravity, immunity-ignoring moves, and attackers whose species can carry Mold Breaker never count as evidence.

### Usage stats and set guessing

Optional usage stats come through the CORS-safe `data.pkmn.cc` mirror, and `@pkmn/smogon` supplies set assumptions for unrevealed abilities, items, moves, natures, and EV spreads. Guesses merge per species across a fallback chain: the format's own file first (VGC formats map to their year-level stats), then the Smogon doubles ladder for VGC, the generation's OU, and Ubers. A Pokémon missing from one file, banned in OU or absent from a niche meta, still gets guessed moves, items, and abilities. Set assumptions fall back the same way: a species without a set in the format's file takes the generation's Ubers file (Doubles Ubers for doubles and VGC), and each guess names the file it came from. Both fetchers try `data.pkmn.cc` first and the GitHub Pages mirror behind it when the primary host fails outright (a 404 is an answer, not a reason to try again); when the set files cannot be loaded at all, the top bar says "Smogon sets unavailable" instead of guessing silently.

A guessed set assembles as a coherent whole instead of stacking independent marginals. Published sets are scored against the revealed evidence, and the winner fills the unrevealed slots as one unit. Marginal fills pass pairwise vetoes: a big attack the set's boost does not serve falls (a Swords Dance Cobalion never guesses Body Press), an orphaned defense boost falls with its vetoed payoff (no Iron Defense without a surviving Body Press), same-type damaging redundancy collapses, and a Choice or Assault Vest guess suppresses guessed status fills.

The stats panel and the simulator run the same guesser, so the sets you see are the sets the engine plays. "Analyze game" waits for the Smogon fetches, so a sweep can never bake stats-less teams unnoticed.

### EV spreads fitted to damage

Hidden EV spreads are fitted to the damage the replay showed. Every clean singles hit becomes a damage observation, and a deterministic solver checks standard spread candidates against `@smogon/calc` roll ranges. It replaces usage-guessed spreads only where at least two observations demand it, never touches revealed or edited spreads, and never claims what the evidence cannot measure: offense only from attacking observations, bulk only from defending ones.

Speed is measured from the replay's own races. Same-turn move order and KOs landed before the victim ever acted (a chosen switch would have resolved first) become hard speed constraints, with directional exclusions that keep only what a modifier strengthens: an attacker outrunning a Tailwind-doubled victim outruns its base speed a fortiori, a paralyzed Pokémon moving first won at a quarter speed, while Trick Room turns and priority races prove nothing.

A solve that misfits its own evidence forfeits back to the usage prior instead of standing on a least-bad fabrication (video-reconstructed HP bars can fit no legal spread), unless the solve is what repairs a speed violation. Every candidate is legalized before scoring: spreads respect the format's EV budget (508 total, 252 per stat; Pokémon Champions formats use their own 66-total, 32-per-stat system), leftovers top up unmeasured non-Speed stats, and the sim never fields an over- or under-statted guess.

Solved spreads flow into every simulator team and show in the stats panel with the tag "fitted" (detail "fits observed damage"), so branches stop KOing Pokémon that survived the same hit in the replay. Evidence that cannot measure keeps the prior: a knock-out line is only a lower bound, so an attacker seen only in knock-outs keeps its guessed offense investment, and a move order no legal spread of that Pokémon can reproduce (the missing piece is usually an item the build does not carry) keeps its guessed Speed; those kept stats give way last in the EV budget, never to a bulk hypothesis. With no usage entry at all, the default spread invests the offense side the revealed attacks agree on.

### Knowledge provenance

The battle statistics panel shows both teams, with placeholders for unrevealed Random Battle slots. Knowledge carries its source:

- revealed: proven by the protocol,
- sheet: from an open team sheet posted in the replay chat, authoritative for items, abilities, moves, and EVs the protocol never showed, like a Choice Scarf on a Pokémon that never moved,
- guessed: usage statistics,
- manual: your edits.

Proven and manual knowledge always outrank the sheet; the sheet outranks guesses and the "has item" preview marker. The same precedence governs the simulator teams used for branching and evaluation, so a usage guess can never overwrite a sheet-known item.

### Editing and importing sets

You can edit reconstructed information for both players before or during branching; edits rebuild the branch and replay its history. The team editor offers legal dropdown pools: species-legal moves (learnset-based, prevo chain included), gen-legal items, the species' real abilities, Tera types (gen 9), and natures. Moves and items use a filterable combobox (click an option to select it, arrow keys plus Enter for the keyboard), validated against the pools.

`Import/Export Sets` exports both teams' current sets as text (Showdown format under `=== p1 ===` and `=== p2 ===` headers) and imports corrected sets back. Imported values apply as green manual knowledge, rebuild a live branch in place, and persist per replay, so a perfect-information "what if I did a, b, or c" analysis survives a reload. Natures, IVs, and levels round-trip.

Hypothetical moves work while branching ("What if it had Flamethrower?"): pick one from the legal move pool, and it loads into the set (adding or replacing a move) and pre-selects as that slot's pending choice, damage previews included.

## 2. Position evaluation

### Search modes

A chess-style evaluation panel sits beside the battle in the right column by default, on the replay view and inside a variation, with no toggle. A sim-backed search plays out every legal choice pair on forked battles, then solves the resulting choice matrix as a matrix game via regret matching. Three engine modes exist:

- depth 1 to 2: the full joint matrix, with deeper cells valued by a shallower sub-search,
- MCTS: a DUCT Monte-Carlo tree search,
- Auto, the default: each position routes by its own fainted fraction, matrix search while boards are full, the tree once a quarter of all bodies have fallen. This is the grid-tuned best line on the stratified calibration bed, re-baselined on about 800 positions with Smogon-informed sets.

Sampling is deterministic with fixed seeds and KO-boundary roll grouping, and the work fans out across a worker pool sized by the machine's cores. Pool size and lane count only move wall-clock; the numbers are the same on every machine.

### Win probability

Choices rank by expected value against the opponent's equilibrium mix. The position score lives in win-probability units end to end: the sigmoid fitted to real game outcomes applies once at the search leaf, so averaging values averages probabilities, which is what makes variance worth something when you are behind. The mapping is phase-aware: the same positional edge claims less early and more as bodies drop, because the fitted confidence per point grows with the fainted fraction. That was the measured cure for the eval's early-game overconfidence.

Displayed percentages pass through a second, corpus-graded calibration stage. Averaging and equilibrium selection re-inflate the aggregated root score, so the shown win% is the sigmoid-mapped honest number, fitted on the weight corpus and validated out of sample on the calibration bed. A finished position still reads 100/0, and regret and swing differences stay in raw win-probability units.

The score is a heuristic estimate for spotting swings and blunders, not an oracle.

Once each side is down to one living body the material static gives way to the race: the leaf takes the race winner's side at 0.6 plus 0.1 per turn of clock margin, capped at 0.9 in win-probability units, from the same heal-PP, residual, and PP-budget clocks the matchup term already uses. A burned, healing-only wall no longer outscores the Choice Band attacker that two-shots it on HP alone; mutual walls keep the static. Fixed-damage moves (Seismic Toss, Night Shade, Super Fang, Dragon Rage, Sonic Boom) count in the threat proxy at their fixed amount, so a Seismic Toss user races as an attacker, not a wall.

### What the panel shows

The maximin floor stays visible as the "safe" line. Each choice shows its EV, its worst case, the punishing reply, and, at depth 2 and above, the follow-up line that explains the why. Ranked choices read like an eval bar: rank number, a mini gauge, and the equilibrium EV as a win percentage, with the guaranteed floor and the punishing reply in the tooltip.

Clicking any engine line, from the replay view or inside a variation, in singles or doubles, plays the turn out chess-style: the clicked side commits its line, the other side answers with the engine's top reply, the turn executes, and the result re-evaluates so the next recommendations are already waiting. The click also arms the visible Auto setting, and stale results from a previous position are never clickable.

### Pivots, matchups, and hazards

Pivot moves are first-class pairs at the root. U-turn, Volt Switch, Flip Turn, Parting Shot, Teleport, Baton Pass, Chilly Reception, and Shed Tail enumerate as "U-turn → Clefable"-style move-plus-incoming choices over the live bench, in the ranked lists and in the matrix, on both the in-process and the worker-pool path (a parity test keeps them from diverging). The engine can therefore say which incoming Pokémon makes the pivot safe. EV-tied leading rows fold in their one-ply horizon trend, so a decaying stall line no longer shades out an equivalent building switch.

The eval is matchup-aware: a per-pair 1v1 threat estimate (movesets, type chart, stats, speed, the big items and immunity abilities, priority, recovery walls) makes early positions readable before anything faints.

Hazards are priced per living victim. A Boots or Magic Guard team shrugs off rocks it is never charged for; grounding comes from the sim itself, Gravity grounds fliers, and Toxic Spikes immunity comes from the type chart. A living hazard remover holds an option on the net board state: Rapid Spin nets its side's full relief, Defog nets relief minus the side's own hazards across the field, and a net-negative option is never exercised, so switching into the Defogger reads as the play that clears the rocks rather than a walk deeper into them.

Benched Pokémon fight through their entry damage: a 4x-rock-weak sweeper behind rocks presses less than its raw pairs claim, unless it holds Boots. A benched body whose HP cannot survive re-entering through its own side's hazards is priced as finished, half a body of fodder value with its fatal entry never charged twice, unless a living teammate can still clear them; Boots, Magic Guard, and airborne-vs-Spikes mons are never stranded.

Guaranteed-failing clicks like Stealth Rock with rocks already up are dropped from the candidate list outright. Coverage gaps, Choice items locked into bad moves, and status-dampened setup all carry terms. The weights are calibrated per gametype against a pinned corpus of 2,100 tournament and ladder games; doubles runs its own fitted weights, where the data confirms what VGC players know: speed control (Tailwind, Trick Room) is worth several times its singles value.

### Toss-ups and Tera

A position with no safe line is labeled a toss-up: the maximin interval is wide, and the turn hinges on prediction.

Tera enumeration is a setting. Auto infers "banned" from a replay that never terastallized. A Revealed mode, the automatic behavior in draft and custom formats, restricts Tera to the Pokémon that terastallized in the replay, so a one-Tera draft game is not analyzed as if everyone could Tera.

### Doubles

Doubles replays evaluate too. The engine searches combined two-slot choices (per-slot targets, spread moves, and one Tera, Mega Evolution, or Ultra Burst per turn), restricted per side to a core-deduplicated candidate list so the joint matrix stays tractable. Static threat hints plus setup, support, spread, and Fake Out bonuses rank the combos, distinct move cores fill the budget before gimmick variants of the same core, and the combination played in the real game (plus its gimmick siblings) is always kept so its regret stays computable. A turn where a slot's action stayed hidden (a flinch, a fainted partner) is graded charitably on the visible slot alone.

The branch controls for doubles are slot-aware and target-aware, block duplicate simultaneous switch targets, and add a dropdown listing every legal choice. Damage estimates include per-target previews for targeted and spread moves.

### Choices, gimmicks, previews

You pick moves or switches for both players and advance the variation turn by turn. Choices are stored by move identity, so forced-switch interludes and team edits can never execute a different move than the one clicked. Tera, Mega Evolution, Ultra Burst, and Z-Move toggles appear where the format and the reconstructed sets allow them.

Damage estimates use the replay's generation, the exact reconstructed sets (abilities, items, EVs), and the field conditions. Errors are loud and actionable: an invalid choice is rejected with a message, a failed turn keeps your selections, and a stuck reconstruction explains itself instead of dead-ending. Newly executed turns animate, or you disable animation and jump straight to the result.

## 3. Game analysis

### The three-pass sweep

`Analyze game` in the eval panel turns the whole game into a chess-style evaluation graph. A background sweep evaluates every turn in three passes: a fast depth-1 scan shapes the whole line in seconds, your configured settings then deepen every report-worthy swing, and finally the whole line converges to your settings. The settings are the line; per-turn d1, d2, and MCTS badges on the report chips and in the turn view track the convergence. The sweep acquires all positions from a single replay reconstruction instead of one per turn, and reads its persisted results from the browser store in one batch.

The graph draws the win-probability line with markers on the turns whose play created each blunder-sized swing; the marker, the turn analysis, and the report chips all point at the same turn. Evaluation gaps get a dashed connector, so a decided ending never floats detached at the edge. The graph renders identically on desktop and mobile, because its geometry tracks its rendered size instead of stretching a fixed canvas. Clicking a point jumps the replay to that turn and opens that turn's analysis.

Navigation works in reverse too. Selecting a turn on the timeline (slider, arrows) opens that turn's analysis without a graph click. The always-present T0 button opens the team-preview view, with the lead analysis when the graph has one. The "Always on" toggle makes evaluation a companion: Analyze game starts by itself when a replay loads, and fresh variation positions evaluate without the Evaluate button. The toggle persists and is off by default.

The sweep also grades the team-preview decision. Turn 0 evaluates every lead pair (doubles) or lead (singles), appears as its own diamond before turn 1 on the graph, and clicking it opens a lead analysis of what each player brought against the engine's preferred leads.

Results are cached per turn, merged across partial sweeps, and reused by single-position evaluations. Every analyzed turn's engine lines are jump-off points into the play-out walk.

### Turn verdicts

Each turn's analysis shows what each player played against the engine's preferred choice, with the regret when they differ and the prevention line at depth 2 and above. The swing decomposes into a decision part and a chance part (rolls, crits); the played pair is valued at the sweep's own search depth, so the split never leaks estimator disagreement. A plain-language summary sentence leads the numbers.

The analysis explains the why in condensed form: aligned worst-case comparison rows for played against best, each with its punishing reply and a mini gauge, and a one-phrase difference when the choices differ in exactly one detail ("The difference: only the Mega Evolution").

Verdicts are banded chess-style on equilibrium-EV regret: inaccuracy, mistake, blunder, with one tier of leniency in decided positions, so garbage time does not stack blunders. Every flagged mistake or blunder is re-searched one depth deeper before the verdict sticks; the deeper look can acquit a move, never convict it.

Feeding a Pokémon to the opponent is graded as what it is:

- a faint from 15% HP or less reads as a deliberate sacrifice: softened one verdict tier, framed neutrally as "a low-cost trade", excluded from the loss's seeds, and shown as its own gray chip,
- a healthy body switched in and fed reads as a simplification sack, but only while the engine's own scores call the game decisively won on both sides of it; trading surplus material for certainty is fine play, feeding a healthy body from a close position is not,
- a body that stayed in and died above the threshold reads as a deliberate feed, but only when the realized outcome landed on the played line's priced floor (the player accepted the known worst case and got it) and the line's payoff inside the payoff window clears the safe guarantee. The Weavile sac that enables a Garchomp sweep grades as the sacrifice it was, never as a blunder.

A blunder-sized throw is never forgiven by any of the three labels.

A side KO'd before it ever acted is priced through a charitable stand-in. The KO logic proves it chose a move (a switch would have resolved first), and every priority-0 move is outcome-equivalent, so the turn grades the stay-in itself against the engine's best escape instead of reading "unclear". Sleep, flinch, and full-paralysis turns keep the no-blame verdict, since there the hidden choice may have mattered.

### Hidden information and prediction

A verdict that survives the deep pass gets sensitivity-probed against the opponent's guessed items: the next usage-plausible alternatives, rule-outs respected, swapped directly into the position. If some plausible item flips the verdict, it softens to the most charitable probed tier and says so ("hinges on Heatran's item (Choice Scarf: mistake · Leftovers: fine)"), because a grade that depends on information the player could not have is not a grade.

Verdicts are honest about prediction too. A flagged regret whose priced-in punisher the opponent never clicked is a "risk (unpunished)", never a misplay. When the actual pair beat the safe line's guarantee by a clear margin it becomes a "read paid off", praised in green, with the payoff allowed to cash in over the following turns instead of one. Setup moves carry a search-horizon caveat, and the maximin alternative is framed as the "safe" line rather than as "better": its guarantee holds the current assessment, nothing more.

### The Read lens

An exploitative "Read" lens looks past equilibrium. A boundedly rational opponent model (softmax over the opponent's own payoffs, anchored to the equilibrium mix, sharpened by the attack and switch tendencies observed in the replay itself, forced replacements excluded) surfaces a "Read:" line whenever a confident prediction makes a non-equilibrium choice the better pick, with the payoff breakdown per predicted reply. The model is advice, never part of the grade, but a flagged risk that matches it upgrades from "risk (unpunished)" to "a read against the opponent's tendencies". Reads work in both engine modes, matrix and MCTS.

### Think deeper

Selecting a turn never re-searches; it shows the stored result with its settings badge. Deepening is the explicit "Think deeper about this position" button: a sketch or a gap first rises to your configured settings, then one depth further (cap 3, never shedding samples on the way up), with the score, ranked moves, matrix, graph, and report updating together. The ladder ends at the tree: a turn the MCTS engine drew offers no button, since a matrix pass would see three plies where the tree saw seven. The single-turn re-search acquires through the same per-turn snapshot healing as the sweep, with a loud reached-guard for replays that healing cannot repair. Graph writes are monotone, so a later re-analyze can never downgrade an explicitly deepened turn back to the fast scan.

### MCTS mode

The MCTS mode carries its own corpus calibration: hint-ordered expansion under progressive widening (the restriction's own static hints decide which options may open, so the doubles 16x16 root no longer starves its iteration budget), and equilibrium rankings over tree-informed root cells. Chance-suspect support cells (a root cell fixes one chance outcome per tree, so a lucky miss can masquerade as a good line) are re-verified by the matrix-grade multi-seed sampler before the verdict stands; tree disagreement is visit-weighted, so one thin outlier tree beside three deep ones does not tip a cell. Each root cell records the outcome class its tree drew, and the merge pools depth per class: a played-out hit class keeps the trees' depth while a thin miss class keeps the sampler's mean. Verified cells are then searched one ply deeper on their first-seed child, and the other support cells of a row or column that mixes a rich tree cell with a starved one join the verify jobs under the same cap, so a whole line is priced at one depth. On the honest-fills rig the depth-1 matrix ties or beats the pure tree overall, which is why Auto, not pure MCTS, is the default line.

The default Auto line routes to the tree once a quarter of all bodies have fallen, and the honesty features follow the line everywhere. Misplay verification and item-sensitivity probes work regardless of which engine drew the turn: a flagged MCTS turn re-adjudicates as matrix pairs at the same deep tier the matrix line gets. The "Think deeper" ladder stops at the tree (see above). Only root pivot pairs remain matrix-side.

### The game report

Once a sweep covers enough of the game, a game report tells the multi-turn story:

- who won and where the game tipped for good,
- a chess-style accuracy score per player, computed from per-turn win-probability loss and volatility-weighted so one wild turn cannot define a game, shown only once enough decided turns exist,
- the losing side's costliest choices before the tipping point, "the seeds of the loss"; unpunished risks never count,
- the lead matchup as turn-0 chips,
- each side's biggest misplays (tier-labeled) and paid-off reads as clickable chips, selected per player so one side's numbers cannot crowd the other's out, with an explicit "no clear misplays" note,
- summed regret per player,
- the net luck contribution, with a decided game's resolution booked apart from luck: once every score favors the eventual winner, chance that does no more than walk the bar to the final result is the model catching up, not the dice deciding,
- clickable key moments, selected by a turn's biggest component (net swing or the chance share alone), so the game's biggest roll surfaces even when decision and chance partially cancelled each other.

## 4. The timeline

### Main line and variation

There is one unified, chess-engine-style timeline instead of separate replay and branch modes. The replay is the main line. Executing a different move at any turn opens the single variation right there, and turn 0 is playable too: the T0 view shows team preview with a lead picker, one lead per side in singles and both slots in doubles. "Play from turn 0" starts a fresh game with the chosen selection as a variation whose first history entry records the decision.

Navigation between and within both lines is view-only and lossless; a line chip returns to the main line in one click. Stepping back inside the variation and playing a different move cuts the tail without asking, like a chess engine's current line. Replacing the variation from the main line asks first. The variation survives every view change, and stepping back past the branch point and forward again returns to it. The game graph overlays the variation as a gold curve: points fed by the auto-evals, clickable like the blue main line, with a ring marking the current position. The timeline slider marks the variation's span in gold.

Settle on a turn for a second and the app reconstructs the exact position in the background: PP, disabled moves, and (in doubles) target buttons upgrade in place, no button needed. The basic view lists compact action chips, moves and switches side by side with type and damage in the tooltips. The "Advanced" toggle grows them into the full picker with type and damage details, the Fight and Pokémon tabs, a free-choice dropdown, and "What if it had …". The action taken in the real game carries a "played" badge.

Branch history, forced replacements included, compares against the original replay line. Branches save locally (open and delete them again), and share links also work in an already-open tab.

### Playing out a position

"Let it play out" has the engine finish any position playing both sides: it plays both sides' top choice until the game ends, Stop works anytime, and every played turn stays navigable. While it runs, the battle window holds your position instead of flashing every new turn; when it finishes, the window plays the whole line back from your move, with the variation drawn as a gold curve over the game graph. Clicking a single engine line plays that turn out the same way, and mid-turn KOs resolve with the engine's replacement instead of stopping halfway.

### Bring-limited formats

Bring-limited formats like VGC pick the whole bring-four at T0, leads first. Every reconstruction of a bring-limited replay fields only what was brought: interactive branches, the game-graph sweep, single-turn evaluations, and the turn-0 lead analysis alike. The trim is both sides or neither: when the protocol never revealed a side's full selection, the whole replay stays untrimmed, because a pinned four against an unpinned six overrates the open side. The engine therefore never searches a switch into a never-brought Pokémon.

### Reconstruction at a deviation

Under the hood a deviation rebuilds the controllable simulator at that point, Random Battle replays and older generations included. The branch state is rebuilt from:

1. the replay protocol,
2. an inferred team model,
3. optional Smogon usage-stat fallbacks for hidden information,
4. a post-reconstruction HP and status correction step,
5. a per-turn seed search that aligns the simulator's RNG (crits, misses, secondary effects, faints) with what the real game's protocol recorded, so replayed positions carry no phantom rolls the real game disproves.

Branch reconstructions replay the protocol's Tera, Mega, and Ultra markers as real choice modifiers and stay turn-synced with the simulator: choices only ever land on the turn that produced them, and taunt-blocked moves replay from their `|cant|` line. HP, status, and the active Pokémon are corrected against the replay snapshot at every turn boundary, so a late-game branch opens on the position the analysis was describing instead of a drifted one, with pending state like Future Sight intact.

A corrected Pokémon enters fresh, with no choice locks inherited from a diverged history, and then regains the locks the replay text itself proves: one committed move on a choice item since the real entry, and a guessed Choice item must also survive the damage record. Corrections rebuild the sim's requests and disable flags, and the side-level invariants the sim runs on (the win-check counter, the active flags) are restored after every correction pass and on every evaluation deserialize, so a KO of the last body ends the game in every searched line.

### Divergence notices

Branch errors name species next to draft nicknames ("Sludge Shadow (Muk-Alola) is no longer available…"). When the guessed sets cannot faithfully replay a line, because the simulated game wedges or even ends before the requested turn, the branch says so with an explicit divergence notice and a pointer to Edit Player/Opp, instead of letting clicks fail cryptically against a finished simulation.

## 5. Test harnesses

### Build smoke and browser suites

`npm run test:build` drives the minified production bundle in a browser. The dev suite runs unminified sources, which once hid a build-only failure: `@pkmn/sim` serializes battle references by `constructor.name`, so mangled class names broke every worker search and the eval graph came out empty in the built app while dev looked perfect; `keepNames` on the app and worker bundles fixes it.

`npm run test:e2e` runs the browser flows against fixture replays; the replay JSON and the Showdown embed script are served from fixtures and cache, so the suite is CDN-independent. It validates the main happy path with a mocked replay fixture:

- load a replay,
- render the replay iframe,
- navigate the unified timeline (main line plus variation, line chip, clickable notation),
- show the always-visible move and switch controls at any position,
- enable turn execution after both choices are selected; executing rebuilds the sim there,
- truncate inside the variation without asking, confirm before replacing it from the main line,
- return to the original replay.

### Expert-feedback drift suite

`npm run test:feedback` runs on demand and is never a standard gate. Six pinned smogtours replays are analyzed through the real app in a browser and graded against a corpus distilled from an experienced player's review. The suite is hermetic (replays and Smogon data served from committed recordings), deterministic (repeat runs on the same browser build are bit-identical; a new Chromium moves the last floating-point digit, so a Playwright upgrade re-anchors the comparison), and warn-only by design: drift against the expert-approved truths is an analysis point in `docs/reports/feedback-drift.md`, never a failing test, and the only reds are harness breakage.

Gap items track the known weaknesses the improvement rounds target, and gaps explain themselves: every turn whose evaluation fails carries its reason into the report, the ⚠ notice, and the turn view. A silent hole counts as harness breakage, never as an accepted outcome. The drift file compares claim statuses and harness counters; `FEEDBACK_DUMP=1` rewrites the six full dumps in `docs/reports/` for a byte-level comparison of the whole analysis run.

### Regression, calibration, and fit

`npm run test:regression` runs three Playwright projects: the app's own specs plus the integration and measurement-chain specs under `regression/`, and each package's suite under `packages/replay-core/test/` and `packages/eval-engine/test/`, also runnable alone with `npm test -w packages/<name>`. Known divergences are documented skips.

Three opt-in harnesses live next to the suite:

- `EVAL_BENCH=1`: a throughput benchmark.
- `EVAL_CALIBRATION=1`: a sweep scoring the eval's sign accuracy, confidence calibration, per-phase Brier scores, and win-probability fit against 40 real replays including doubles and VGC, with `EVAL_CALIBRATION_DEPTH=2` and `EVAL_CALIBRATION_MODE=mcts` levers so every engine mode earns numbers on the same corpus. Two identical seeded runs are bit-identical, so every adoption gates against exact paired comparisons. `node scripts/run-calibration.mjs` runs the corpus in parallel slices and merges the dumps into one summary.
- `EVAL_FIT=1`: a weight-fitting harness that regresses the eval's feature weights against a manifest-pinned corpus of 2,100+ tournament and ladder replays across gen9 singles, old-gen singles, doubles, and VGC tranches, with cluster-bootstrap standard errors, phase and gen-class splits, and a phase-conditioned win-probability fit. Adopted weights must also pass the calibration gate, and the calibration spec's header records every adoption and every rejected experiment with its evidence.

The suite covers replay reconstruction (including a video-reconstructed synthetic replay pinned turn by turn), identity-based choice resolution, execute error paths, gimmick availability, damage-calc generation and set alignment, team sheets, team paste (natures, IVs, and levels included), sets import and export round-trips, legal option pools, protocol rule-outs and damage observations, protocol-proven choice-lock restoration with damage corroboration, hidden-power typing from effectiveness evidence and usage, spread inference with format EV budgets, Tera allowances, stats parsing, exported replay file parsing, save and share, inference quality, and an end-to-end spec pinning the GPL replay's verdicts.

Position evaluation has its own pins: the static eval, the forward model, equilibrium ranking, maximin search with deepening, doubles combined choices, team-preview leads, played-vs-best analysis, verdict tiers, win probability, accuracy, and reports. The narrative signals are pinned too: decision breadth, equilibrium-conditional recommendations, a null-move guard, forced-mix naming, analytic odds grounding, streak cumulation, hindsight reads against the opponent's actual click, and the entry-is-profit switch context with expected-rate races (the max-move's accuracy and a Fake Out entry chip) plus the switch-in stage naming the one standing holder, spoken once per mon and stage in the game report.

The decided sweep is pinned as display and prose only. One mon that wins every living enemy pair and clears the rest within a short expected clock reads the board as practically decided, with a near-decided stage when one 90%-or-better boundary-event roll unlocks that sweep. It is announced once per game report, re-labels a decided turn's chance swing as the game resolving, and is stripped on the eval graph. Its own calibration bench measured the decided side winning about 80% of clamped positions and refused a real score clamp.

Further pins: analytic boundary-event odds and root-cell class blending (a KO-range roll prices at its true probability instead of its fixed-seed frequency, on MCTS results too, where boundary cells count as chance-suspect for the verify sampler regardless of visit statistics and ranked rows carry the same koOdds payloads), sacrifice detection (low-HP, healthy-simplification, and certainty-gated stay-and-die feeds), stranded-bench pricing, sensitivity probes, the Read lens, per-turn eval-gap visibility, and searched-mechanics honesty pins.

## 6. Known limits

The app does not recreate the original battle frame-perfectly, and branch outcomes can diverge from the original replay when hidden information matters:

- Hidden moves, EVs, IVs, natures, and some items and abilities are guesses when the replay did not reveal them. EV spreads are fitted to observed damage where the replay provides enough clean hits, but "the defender is bulkier" and "the attacker is weaker" can fit the same damage line; the solve guarantees pair consistency with the replay rather than ground-truth per-Pokémon spreads.
- Probability-backed guesses come from the `data.pkmn.cc` usage-stat mirror, the only endpoint that sends CORS headers in a browser. When it has no data for a format, `@pkmn/smogon` set data provides non-probability set assumptions before the app falls back to unknown or default simulator values.
- HP and status are corrected from the snapshot at branch start, but other hidden or volatile state may still differ. A reconstruction that ends up in an unplayable state is detected and reported instead of dead-ending.
- Damage previews match the sim's generation and sets, but the preview numbers ignore an armed Tera toggle; they update once the terastallized turn executes.
- Doubles battles have multi-active reconstruction, explicit target reconstruction, redirection and retargeting fixtures, and protocol correction for `switch` and `drag` active-slot evidence, but unusual targeting effects and some volatile state can still diverge.
- Save and share links are compact branch reports; they do not restore and replay an alternate line from scratch.
- Replay viewing and sprite rendering depend on Pokemon Showdown-hosted assets. On phones the embed keeps its desktop layout inside a horizontally scrollable container.
- The automated tests use a mocked replay response and do not cover a large replay corpus or every difficult edge case.
