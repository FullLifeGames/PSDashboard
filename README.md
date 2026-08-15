# PS Dashboard

PS Dashboard is an early-stage web app for replay-based "what if?" analysis on Pokemon Showdown battles. It loads a Showdown replay, reconstructs the battle state up to a chosen turn, and then lets you branch from that point by selecting alternative moves or switches for both sides.

Published app: [https://fulllifegames.github.io/PSDashboard/](https://fulllifegames.github.io/PSDashboard/)

The current implementation is a working prototype, not a fully accurate replay recreation engine yet. It is best treated as an exploratory simulator built from replay evidence plus inferred hidden information.

## Current Capabilities

- Load a Pokemon Showdown replay from a replay URL or replay ID, with input validation and readable error messages. Smogtours ids are normalized to their real formats (`smogtours-gen3ou-…` → `gen3ou`).
- Load a locally exported replay by dropping a "Download replay" `.html` file (or a raw protocol log) onto the loader panel or picking it via `Browse file` — every feature (stats, branching, sharing) works on file-based replays. Synthetic logs survive ingestion too: CRLF line endings are normalized, unparseable protocol lines are skipped instead of failing the replay, and the reconstruction stays in lockstep with logs that lack `|upkeep` markers (e.g. video-reconstructed replays).
- Hidden-information guesses merge usage stats per species across a fallback chain: the format's own file first (VGC formats map to their year-level stats), then the Smogon doubles ladder for VGC, the generation's OU, and Ubers — so a Pokémon missing from one file (banned in OU, absent from a niche meta) still gets guessed moves, items, and abilities.
- Deep-link and embed support: `?replay=<id|url>` auto-loads a replay on startup, and `?embed=1` hides the app chrome so the dashboard can run inside another site's iframe (see "Embedding" below).
- Render the original replay inside an embedded Pokemon Showdown replay viewer with two-way turn sync (playback runs through without self-pausing; the end position is labelled `End`).
- Parse the replay protocol into per-turn snapshots.
- Infer both teams from replay data, including revealed moves, items, abilities, levels, gender, and tera type when shown — plus ability reveals from effect attributions (e.g. Poison Heal heals), item reveals from heal messages, mega stones, and item-damage lines (Life Orb recoil names its holder; Rocky Helmet chip names the `[of]` Pokémon, or in logs that drop that tag, the target of the damaged Pokémon's last move), and a Heavy-Duty Boots inference for Pokemon that switch into Stealth Rock without taking damage. Unrevealed abilities that no stats file can guess default to the species' slot-0 ability instead of simulating a Pokémon with no ability at all.
- Rule out what the protocol disproves: hazard, status, weather, or Life Orb damage rules out Magic Guard, Stealth Rock chip rules out Heavy-Duty Boots, a landed Ground move rules out Levitate, two distinct plain moves without switching rule out every Choice item (with a Dancer-species guard; called moves like Sleep Talk's never count), and a plain status move rules out Assault Vest — so a usage guess can never contradict what the replay showed (the T25 case: a Clefable that visibly took Stealth Rock is never simulated as Magic Guard), and guessed Choice items stop fabricating move locks that derail late-game reconstruction. Rule-outs walk to the next candidate instead of dropping to nothing, and the Levitate inference is careful about proof: damage is only attributed inside the current move action (a confusion self-hit or a resolving Future Sight proves nothing), and Gravity, immunity-ignoring moves, and attackers whose species can carry Mold Breaker never count as evidence.
- Fit hidden EV spreads to the damage the replay actually showed: every clean singles hit becomes a damage observation, and a deterministic solver checks standard spread candidates against `@smogon/calc` roll ranges — replacing usage-guessed spreads only where at least two observations demand it, never touching revealed or edited spreads, and never claiming what the evidence cannot measure (offense only from attacking observations, bulk only from defending ones). Speed is measured from the replay's own races: same-turn move order and KOs landed before the victim ever acted (a chosen switch would have resolved first) become hard speed constraints, with directional exclusions that keep only what a modifier strengthens — an attacker outrunning a Tailwind-doubled victim outruns its base speed a fortiori, a paralyzed Pokémon moving first won at a quarter speed, while Trick Room turns and priority races prove nothing. Solves that misfit their own evidence forfeit back to the usage prior instead of standing on a least-bad fabrication (video-reconstructed HP bars can fit no legal spread), unless the solve is what repairs a speed violation. Every candidate is legalized before scoring — spreads respect the format's EV budget (508 total, 252 per stat; Pokémon Champions formats use their own 66-total/32-per-stat system), leftovers top up unmeasured non-Speed stats, and the sim never fields an over- or under-statted guess. Solved spreads flow into every simulator team and show in the stats panel as "fits observed damage" — so branches stop KOing Pokémon that visibly survived the same hit in the replay.
- Parse Open Team Sheets (`|showteam|`) and embedded "View team" chat exports as revealed team data.
- Accept a pasted player team export (validated, shown as manual data in the stats panel, persisted across reloads). German stat abbreviations are normalized.
- Fetch optional usage stats (via the CORS-safe `data.pkmn.cc` mirror) and `@pkmn/smogon` set assumptions for unrevealed abilities, items, moves, natures, and EV spreads. Guessed sets assemble coherently instead of stacking independent marginals: published sets are scored against the revealed evidence and the winner fills the unrevealed slots as one unit, while marginal fills pass pairwise vetoes — a big attack the set's boost does not serve falls (Swords Dance Cobalion never guesses Body Press), an orphaned defense-boost falls with its vetoed payoff (no Iron Defense without a surviving Body Press), same-type damaging redundancy collapses, and a Choice or Assault Vest guess suppresses guessed status fills. The stats panel and the simulator run the SAME guesser, so what you see is what the engine plays — and "Analyze game" waits for the Smogon fetches, so a sweep can never silently bake stats-less teams.
- Display whether team data is revealed from the replay, guessed from usage stats, or manually edited.
- Edit reconstructed information for both players before or during branching (edits rebuild the branch and replay its history).
- Edit teams with legal dropdown pools: species-legal moves (learnset-based, prevo chain included), gen-legal items, the species' real abilities, tera types (gen 9), and natures. Moves and items use a filterable combobox — click an option to select it, arrow keys + Enter for keyboard use — validated against the pools.
- Export both teams' current sets as text (Showdown format under `=== p1 ===` / `=== p2 ===` headers) and import corrected sets back — imported values apply as green manual knowledge, rebuild a live branch in place, and persist per replay for repeated perfect-information "what if I did a, b, or c" analysis. Natures, IVs, and levels round-trip.
- Try hypothetical moves while branching ("What if it had Flamethrower?") — picked from the legal move pool, loaded into the set (adding or replacing a move), and pre-selected as that slot's pending choice with damage previews included.
- A chess-style position evaluation panel sits beside the battle in the right column by default — on the replay view and inside a branch, no toggle needed: a sim-backed search plays out every legal choice pair on forked battles (depth 1–2, a DUCT Monte-Carlo tree search mode, or the default Auto mode that routes each position by its own fainted fraction — matrix search while boards are full, the tree once a quarter of all bodies have fallen: the grid-tuned best line on the stratified calibration bed, re-baselined on ~800 positions with Smogon-informed sets; deterministic fixed-seed sampling with KO-boundary roll grouping, parallelized across a worker pool), then solves the resulting choice matrix as a matrix game via regret matching: choices are ranked by expected value against the opponent's equilibrium mix, the position score lives in win-probability units end to end (the sigmoid fitted to real game outcomes applies once at the search leaf, so averaging values averages probabilities — which is exactly what makes variance genuinely worth something when you are behind) and the mapping is phase-aware: the same positional edge claims less early and more as bodies drop, because the fitted confidence-per-point genuinely grows with the fainted fraction — the measured cure for the eval's early-game overconfidence. Displayed percentages then pass through a second, corpus-graded calibration stage: averaging and equilibrium selection re-inflate the aggregated root score, so the shown win% is the sigmoid-mapped honest number (fitted on the weight corpus, validated out-of-sample on the calibration bed; a truly finished position still reads 100/0, and regret/swing differences stay in raw win-probability units) — and the maximin floor stays visible as the "safe" line — each choice showing its EV, worst case, the punishing reply, and — at depth 2+ — the followup line explaining the "why". Pivot moves are first-class pairs at the root: U-turn, Volt Switch, Flip Turn, Parting Shot, Teleport, Baton Pass, Chilly Reception, and Shed Tail enumerate as "U-turn → Clefable"-style move-plus-incoming choices over the live bench (in the ranked lists AND the matrix, on both the in-process and worker-pool paths — a parity test keeps them from ever diverging), so the engine can finally say WHICH incoming Pokémon makes the pivot safe; EV-tied leading rows additionally fold in their one-ply horizon trend, so a decaying stall line no longer shades out an equivalent building switch. The eval is matchup-aware: a per-pair 1v1 threat estimate (movesets, type chart, stats, speed, the big items and immunity abilities, priority, recovery walls) makes early positions readable before anything faints — hazards are priced per living victim (a Boots or Magic Guard team shrugs off rocks the eval no longer charges it for, grounding comes from the sim itself — Gravity grounds fliers — and Toxic Spikes immunity from the type chart), a living hazard remover holds an option on the net board state (Rapid Spin nets its side's full relief, Defog nets relief minus the side's own hazards across the field, and a net-negative option is never exercised — so switching into the Defogger reads as the play that clears the rocks, not as walking deeper into them), benched Pokémon fight through their entry damage (a 4×-rock-weak sweeper behind rocks presses less than its raw pairs claim — unless it holds Boots), guaranteed-failing clicks like Stealth Rock with rocks already up are dropped from the candidate list outright, coverage gaps, Choice items locked into bad moves, and status-dampened setup all carry terms, and the weights are calibrated per gametype against a pinned corpus of 2,100 tournament and ladder games: doubles runs its own fitted weights, where the data confirms what VGC players know — speed control (Tailwind, Trick Room) is worth several times its singles value. Positions with no safe line are labeled as toss-ups (the maximin interval is wide — the turn hinges on prediction). Tera enumeration is a setting: Auto infers "banned" from a replay that never terastallized, and a Revealed mode — the automatic behavior in draft and custom formats — restricts Tera to the Pokémon that actually terastallized in the replay, so a one-Tera draft game is not analyzed as if everyone could Tera. Ranked choices read like the eval bar: rank number, a mini gauge, and the equilibrium EV as a win percentage, with the guaranteed floor and the punishing reply in the tooltip. Clicking any engine line — from the replay view or inside a branch, singles or doubles — plays the turn out chess-style: the clicked side commits its line, the other side answers with the engine's top reply, the turn executes, and the result re-evaluates so the next recommendations are already waiting (the click also arms the visible Auto setting; stale results from a previous position are never clickable). Doubles replays evaluate too: the engine searches combined two-slot choices — per-slot targets, spread moves, and one Tera/Mega Evolution/Ultra Burst per turn — restricted per side to a core-deduplicated candidate list so the joint matrix stays tractable: static threat hints plus setup, support, spread, and Fake Out bonuses rank the combos, distinct move cores fill the budget before gimmick variants of the same core, and the actually played combination (plus its gimmick siblings) is always kept so its regret stays computable. Turns where a slot's action stayed hidden (a flinch, a fainted partner) are graded charitably on the visible slot alone. The score is a heuristic estimate for spotting swings and blunders — not an oracle.
- Analyze the whole game into a chess-style evaluation graph (`Analyze game` in the eval panel): a background sweep evaluates every turn in three passes (a fast depth-1 scan shapes the whole line in seconds, your configured settings then deepen every report-worthy swing, and finally the whole line converges to your settings — the settings ARE the line, with per-turn d1/d2/MCTS badges on the report chips and the turn view tracking the convergence), acquires all positions from a single replay reconstruction instead of one per turn, draws the win-probability line with markers on the turns whose play created each blunder-sized swing (the marker, the turn analysis, and the report chips all point at the same turn), bridges evaluation gaps with a dashed connector so a decided ending never floats detached at the edge, renders identically on desktop and mobile (the graph's geometry tracks its rendered size instead of stretching a fixed canvas), and clicking a point jumps the replay to that turn — and opens that turn's analysis. The sweep also grades the team-preview decision: turn 0 evaluates every lead pair (doubles) or lead (singles), appears as its own diamond before turn 1 on the graph, and clicking it opens a lead analysis of what each player brought vs the engine's preferred leads. Each turn's analysis shows: what each player actually played vs the engine's preferred choice (with regret when they differ and the prevention line at depth 2+), plus a decomposition of the swing into a decision part and a chance part (rolls/crits, with the played pair valued at the sweep's own search depth so the split never leaks estimator disagreement) — and a plain-language summary sentence leading the numbers. The analysis explains the "why" in condensed form: aligned worst-case comparison rows for played vs best (each with its punishing reply and a mini gauge) and a one-phrase difference when the choices differ in exactly one detail ("The difference: only the Mega Evolution"). Verdicts are banded chess-style on equilibrium-EV regret — inaccuracy, mistake, blunder — with one-tier leniency in decided positions (garbage time does not stack blunders), and every flagged mistake or blunder is re-searched one depth deeper before the verdict sticks: the deeper look can acquit a move, never convict it. Verdicts are also honest about hidden information: a verdict that survives the deep pass gets sensitivity-probed against the opponent's guessed items (the next usage-plausible alternatives, rule-outs respected, swapped directly into the position) — if some plausible item flips the verdict, it softens to the most charitable probed tier and says so ("hinges on Heatran's item — Choice Scarf: mistake · Leftovers: fine"), because a grade that depends on information the player could not have is not a grade. Verdicts are honest about prediction too: a flagged regret whose priced-in punisher the opponent never clicked is a "risk (unpunished)", not a misplay — and when the actual pair beat the safe line's guarantee by a clear margin it becomes a "read paid off", praised in green, with the payoff allowed to cash in over the following turns instead of just one; setup moves carry a search-horizon caveat, and the maximin alternative is framed as the "safe" line rather than "better" (its guarantee merely holds the current assessment). Feeding a Pokémon to the opponent is graded as what it is: a faint from ≤15% HP reads as a deliberate sacrifice — softened one verdict tier, framed neutrally ("a low-cost trade"), excluded from the loss's seeds, and shown as its own gray chip — and a HEALTHY body switched in and fed reads as a simplification sack, but only while the engine's own scores call the game decisively won on both sides of it (trading surplus material for certainty is fine play; feeding a healthy body from a close position is not) — though a blunder-sized throw is never forgiven by either label. A side KO'd before it ever acted is priced through a charitable stand-in: the KO logic proves it chose a move (a switch would have resolved first) and every priority-0 move is outcome-equivalent, so the turn grades the stay-in itself against the engine's best escape instead of reading "unclear" — while sleep, flinch, and full-paralysis turns honestly keep the no-blame verdict, since there the hidden choice may have mattered. An exploitative "Read" lens looks past equilibrium: a boundedly-rational opponent model (softmax over the opponent's own payoffs, anchored to the equilibrium mix, sharpened by their observed attack/switch tendencies from this very replay — forced replacements excluded) surfaces a "Read:" line whenever a confident prediction makes a non-equilibrium choice clearly better, with the payoff breakdown per predicted reply; the model is advice, never part of the grade, but a flagged risk that matches it upgrades from "risk (unpunished)" to "a read against the opponent's tendencies". Reads work in both engine modes, matrix and MCTS. Selecting a turn never re-searches — it shows the stored result with its settings badge, and deepening is the explicit "Think deeper about this position" button: a sketch or gap first rises to your configured settings, then one depth further (cap 3, never shedding samples on the way up), with the score, ranked moves, matrix, graph, and report updating together; the single-turn re-search acquires through the same per-turn snapshot healing as the sweep (with a loud reached-guard for replays healing cannot repair), and graph writes are monotone, so a later re-analyze can never downgrade an explicitly deepened turn back to the fast scan. The MCTS mode carries its own corpus calibration: hint-ordered expansion under progressive widening (the restriction's own static hints decide which options may open, so the doubles 16×16 root no longer starves its iteration budget), and equilibrium rankings over tree-informed root cells whose chance-suspect support cells — a root cell fixes one chance outcome per tree, so a lucky miss can masquerade as a good line — are re-verified by the matrix-grade multi-seed sampler before the verdict stands; on the honest fills rig the depth-1 matrix ties or beats the pure tree overall, which is exactly why Auto, not pure MCTS, is the default line. The default Auto line routes to it once a quarter of all bodies have fallen — and the honesty features follow the line everywhere: misplay verification, item-sensitivity probes, and the "Think deeper" ladder work regardless of which engine drew the turn (a flagged MCTS turn re-adjudicates as matrix pairs at the same deep tier the matrix line gets, and deepening an MCTS turn crosses into the matrix ladder at depth 2, where monotone graph writes keep that product safe from later sweeps); only root pivot pairs remain matrix-side. Once a sweep covers enough of the game, a game report tells the multi-turn story: who won and where the game tipped for good, a chess-style accuracy score per player (computed from per-turn win-probability loss, volatility-weighted so one wild turn cannot define a game, only shown once enough decided turns exist), the losing side's costliest choices before the tipping point ("the seeds of the loss" — unpunished risks never count), the lead matchup as turn-0 chips, each side's biggest misplays — tier-labeled — and paid-off reads as clickable chips (selected per player so one side's numbers cannot crowd the other's out, with an explicit "no clear misplays" note), summed regret per player, the net luck contribution, and clickable key moments. Every analyzed turn's engine lines are jump-off points into the play-out walk. Results are cached per turn, merged across partial sweeps, and reused by single-position evaluations.
- Select a turn and branch from that point into a controllable simulator — including Random Battle replays and older generations. Branch reconstructions replay the protocol's Tera/Mega/Ultra markers as real choice modifiers, stay turn-synced with the simulator (choices only ever land on the turn that produced them, taunt-blocked moves replay from their `|cant|` line), and correct HP, status, and the active Pokémon against the replay snapshot at every turn boundary — so a late-game branch opens on the position the analysis was describing instead of a drifted one, with pending state like Future Sight intact; corrected Pokémon enter fresh (no choice locks inherited from a diverged history) and then regain the locks the replay text itself proves (one committed move on a choice item since the real entry — a guessed Choice item must also survive the damage record), corrections rebuild the sim's requests and disable flags, and the side-level invariants the sim runs on (the win-check counter, the active flags) are restored after every correction pass and on every evaluation deserialize — so a KO of the last body actually ends the game in every searched line. Branch errors name species next to draft nicknames ("Sludge Shadow (Muk-Alola) is no longer available…"). When the guessed sets cannot faithfully replay a line — the simulated game wedges or even ends before the requested turn — the branch says so with an explicit divergence notice (and a pointer to Edit Player/Opp) instead of letting clicks fail cryptically against a finished simulation.
- Pick moves or switches for both players and advance the branch turn by turn. Choices are stored by move identity, so forced-switch interludes and team edits can never execute a different move than the one clicked.
- Use Tera / Mega Evolution / Ultra Burst / Z-Move toggles where the format and the reconstructed sets allow them.
- Use slot-aware and target-aware controls for doubles battles, including blocking duplicate simultaneous switch targets, plus a dropdown listing every legal choice.
- View damage estimates computed with the replay's generation, the exact reconstructed sets (abilities, items, EVs), and field conditions — including per-target previews for targeted and spread moves in doubles.
- Get loud, actionable errors: invalid choices are rejected with messages, failed turns keep your selections, and stuck reconstructions explain themselves instead of dead-ending.
- Animate newly executed branch turns, or disable animation to jump straight to the result.
- Compare branch history (including forced replacements) against the original replay line.
- Save branches locally (open and delete them again) and create share links that also work in an already-open tab.
- Show a battle statistics panel for both teams, with placeholders for unrevealed Random Battle slots. Knowledge is provenance-tagged: revealed (proven by the protocol), sheet (from an open team sheet posted in the replay chat — authoritative for items, abilities, moves, and EVs the protocol never showed, like a Choice Scarf on a Pokémon that never moved), guessed (usage statistics), and manual (your edits). Proven and manual knowledge always outrank the sheet; the sheet outranks guesses and the "has item" preview marker — and the same precedence governs the simulator teams used for branching and evaluation, so a usage guess can never overwrite a sheet-known item.

## What "Works" Today

As of the current repository state:

- `npm run lint` passes.
- `npm run build` succeeds.
- `npm run test:build` passes: a production-build smoke suite that drives the MINIFIED bundle (the dev suite runs unminified sources, which once hid a build-only failure — `@pkmn/sim` serializes battle references by `constructor.name`, so mangled class names broke every worker search and the eval graph came out empty in the built app while dev looked perfect; `keepNames` on the app and worker bundles is what fixes it).
- `npm run test:e2e` passes with 63 browser tests (the replay JSON and the Showdown embed script are served from fixtures/cache, so the suite is CDN-independent).
- `npm run test:feedback` (on demand, never a standard gate): the expert-feedback drift suite — six pinned smogtours replays analyzed through the real app in a browser, graded against a corpus distilled from an experienced player's review. Hermetic (replays and Smogon data served from committed recordings) and deterministic (repeat runs are bit-identical), and warn-only by design: drift against the expert-approved truths is an analysis point in `docs/reports/feedback-drift.md`, never a failing test — the only reds are harness breakage. Gap items track the known weaknesses the improvement rounds are aimed at, and gaps explain themselves: every turn whose evaluation fails carries its reason into the report, the ⚠ notice, and the turn view — silent holes are a harness failure, not a possibility.
- `npm run test:regression` passes with 580 tests (plus documented known-divergence skips, an opt-in `EVAL_BENCH=1` throughput benchmark, an opt-in `EVAL_CALIBRATION=1` sweep scoring the eval's sign-accuracy, confidence calibration, per-phase Brier scores, and win-probability fit against 40 real replays including doubles and VGC — with `EVAL_CALIBRATION_DEPTH=2` and `EVAL_CALIBRATION_MODE=mcts` levers so every engine mode earns numbers on the same corpus; two identical seeded runs are bit-identical, so every adoption gates against exact paired comparisons — and an opt-in `EVAL_FIT=1` weight-fitting harness that regresses the eval's feature weights against a manifest-pinned corpus of 2,100+ tournament and ladder replays — gen9 singles, old-gen singles, doubles, and VGC tranches — with cluster-bootstrap standard errors, phase/gen-class splits, and a phase-conditioned win-probability fit; adopted weights must additionally pass the calibration gate, and the header history records every adoption and every rejected experiment with its evidence) covering replay reconstruction (including a video-reconstructed synthetic replay pinned turn-by-turn), identity-based choice resolution, execute error paths, gimmick availability, damage-calc generation/set alignment, team sheets, team paste (including natures, IVs, and levels), sets import/export round-trips, legal option pools, position evaluation (static eval, forward model, equilibrium ranking, maximin search with deepening, doubles combined choices, team-preview leads, played-vs-best analysis, verdict tiers, win probability, accuracy, reports, sacrifice detection, sensitivity probes, the Read lens, per-turn eval-gap visibility, and searched-mechanics honesty pins), protocol rule-outs and damage observations, protocol-proven choice-lock restoration with damage corroboration, hidden-power typing from effectiveness evidence and usage, spread inference with format EV budgets, Tera allowances, stats parsing, exported replay file parsing, save/share, inference quality, and an end-to-end spec pinning the GPL replay's verdicts.

The browser test suite validates the main happy path with a mocked replay fixture:

- load replay
- render replay iframe
- select a branch turn
- enter branch mode
- show move and switch controls
- enable turn execution after both choices are selected
- return to the original replay

## Where Accuracy Is Still Limited

This project is not yet a frame-perfect recreation of the original battle. The current branch state is rebuilt from:

1. the replay protocol
2. an inferred team model
3. optional Smogon usage-stat fallbacks for hidden information
4. a post-reconstruction HP/status correction step

That means branch outcomes can diverge from the original replay when hidden information matters. Important limitations today:

- Hidden moves, EVs, IVs, natures, and some items/abilities can be guessed when they were not revealed in the replay. EV spreads are fitted to observed damage where the replay provides enough clean hits, but "the defender is bulkier" and "the attacker is weaker" can fit the same damage line — the solve guarantees pair consistency with the replay, not ground-truth per-Pokémon spreads.
- Probability-backed guesses come from the `data.pkmn.cc` usage-stat mirror (the only endpoint that sends CORS headers in a browser). When it has no data for a format, `@pkmn/smogon` set data provides non-probability set assumptions before the app falls back to unknown/default simulator values.
- HP and status are corrected from the snapshot at branch start, but other hidden or volatile state may still differ. Reconstructions that end up in an unplayable state are detected and reported instead of dead-ending.
- Damage previews match the sim's generation and sets, but an *armed* Tera toggle is not pre-applied to the preview numbers — they update once the terastallized turn executes.
- Doubles battles have multi-active reconstruction, explicit target reconstruction, redirection/retargeting fixtures, and protocol correction for `switch`/`drag` active-slot evidence, but unusual targeting effects and some volatile state can still diverge.
- Save/share links are compact branch reports today; they do not yet fully restore and replay an alternate line from scratch.
- Replay viewing and sprite rendering depend on Pokemon Showdown-hosted assets. On phones the embed keeps its desktop layout inside a horizontally scrollable container.
- The automated tests use a mocked replay response and do not yet cover a large replay corpus or difficult edge cases.

## Local Development

### Requirements

- Node.js
- npm

If Playwright browsers are missing locally, install them once with:

```bash
npx playwright install
```

### Install

```bash
npm install
```

### Run the app

```bash
npm run dev
```

Open the local Vite URL shown in the terminal.

### Quality checks

```bash
npm run lint
npm run build
npm run test:e2e
npm run test:regression
```

## Embedding

The app can be included in another site and handed a replay to render:

- **Deep link:** `https://…/?replay=gen3customgame-2115579570` auto-loads that replay on startup (works standalone and inside an iframe).
- **Embed mode:** add `?embed=1` to hide the header and loader chrome — combined: `?embed=1&replay=<id>`.
- **postMessage handoff** for replays that are not hosted (exported HTML files, raw logs):

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

  The app posts `ps-embed-ready` to its parent once it can receive replays, and answers every `ps-load-replay` with `ps-replay-loaded` (`id`, `format`) or `ps-replay-error` (`message`).

  A runnable host-page demo lives in [`examples/embed-host.html`](./examples/embed-host.html) — with the dev server running, open `http://localhost:5173/examples/embed-host.html`, pick an exported replay file (or click the demo button), and the embedded dashboard renders it.

## How To Use The Prototype

1. Paste a replay URL or replay ID into the loader, or drop an exported replay `.html` file onto the loader panel.
2. Optionally expand the team section and paste your own exported team to improve reconstruction.
3. Load the replay.
4. For perfect-information analysis, open `Import/Export Sets`, correct both teams (or paste the real sets), and import — the import is remembered for this replay.
5. Scrub to a turn using the replay viewer or the branch slider.
6. Click `Branch Here`.
7. Choose a move or switch for both sides — or load a hypothetical move via "What if it had …".
8. Execute the turn and continue exploring the branch.
9. Use `Edit Player` or `Edit Opp` if you want to override inferred details before branching.

## Repository Map

- [`src/App.tsx`](./src/App.tsx) hosts the main application flow.
- [`src/hooks/useReplay.ts`](./src/hooks/useReplay.ts) loads the replay (fetched or file-based) and derives snapshots plus inferred team data.
- [`src/hooks/useEmbedHost.ts`](./src/hooks/useEmbedHost.ts) implements `?replay=`/`?embed=1` and the host-page postMessage protocol.
- [`src/lib/replay-file.ts`](./src/lib/replay-file.ts) parses exported replay HTML files and raw protocol logs into replay data.
- [`src/hooks/useBranch.ts`](./src/hooks/useBranch.ts) manages React state for the live branch simulator.
- [`src/lib/branch-engine.ts`](./src/lib/branch-engine.ts) reconstructs the battle up to a selected turn in a pure, directly testable module.
- [`src/lib/protocol-parser.ts`](./src/lib/protocol-parser.ts) converts replay protocol logs into turn snapshots.
- [`src/lib/opponent-inferrer.ts`](./src/lib/opponent-inferrer.ts) extracts revealed team information from the replay log.
- [`src/lib/team-builder.ts`](./src/lib/team-builder.ts) builds simulator teams from replay evidence, pasted teams, and usage-stat guesses.
- [`src/lib/smogon-stats.ts`](./src/lib/smogon-stats.ts) fetches and normalizes Smogon monthly usage probabilities.
- [`src/lib/smogon-sets.ts`](./src/lib/smogon-sets.ts) fetches normalized fallback set assumptions through `@pkmn/smogon`.
- [`src/lib/team-info.ts`](./src/lib/team-info.ts) enriches revealed team data while preserving revealed/guessed/manual source labels.
- [`src/lib/branch-choices.ts`](./src/lib/branch-choices.ts) defines the identity-based choice model shared by the UI and the engine.
- [`src/lib/damage-calc.ts`](./src/lib/damage-calc.ts) computes damage previews with `@smogon/calc` using the replay generation, sim sets, and field state.
- [`src/lib/eval/`](./src/lib/eval/) contains the evaluation engine: a sim forward model (including team-preview lead choices, pivot-pair follow-ups, and locked-release targeting on round-tripped states), a static positional eval with a boost-aware matchup threat term weighted by hazard entry costs, victim-aware hazard pricing with removal option value, coverage/item/choice-lock terms, and per-gametype corpus-fitted weights, maximin search with iterative deepening over no-op-filtered candidates and pivot pairs enumerated at the root, a regret-matching matrix-game solver for equilibrium EVs with horizon-trend folding for tied leading rows, a corpus-calibrated DUCT-MCTS mode with equilibrium rankings over verified tree-informed root cells, a pure async orchestrator fanned out over a worker pool (parity-tested against the sync path, pivot pairs included), per-Pokémon Tera allowances, a per-gametype phase-aware outcome-fitted win-probability mapping applied once at the search leaf, played-action and lead parsing (singles and per-slot doubles), sacrifice detection (low-HP feeds and score-gated healthy simplification sacks), a stay-in phantom for sides KO'd before acting, item-sensitivity probes for flagged verdicts, an exploitative opponent model behind the Read lens, per-turn analysis with tiered verdicts and deeper verification, natural-language summaries, and the game report with per-player accuracy and per-turn engine badges.
- [`src/lib/set-coherence.ts`](./src/lib/set-coherence.ts) scores published sets against revealed evidence and applies the pairwise coherence vetoes shared by the stats-panel display and the simulator team builder.
- [`src/lib/spread-inference.ts`](./src/lib/spread-inference.ts) solves damage-consistent EV spreads from replay observations against `@smogon/calc` roll ranges — hard-constrained by observed speed races, forfeiting solves that misfit their own evidence — legalized to the format's EV budget (standard 508/252, Pokémon Champions 66/32).
- [`scripts/build-fit-corpus.mjs`](./scripts/build-fit-corpus.mjs) builds the manifest-pinned weight-fitting corpus (ReplayScouter tournament data, direct Smogon-thread scraping for gen9 singles, doubles, and VGC — official tournament replays carry a `smogtours-` room prefix the scraper understands — plus ladder samples); the manifest is committed, the replay cache is not.
- [`src/hooks/useEvaluation.ts`](./src/hooks/useEvaluation.ts) coordinates single evaluations, two-pass game sweeps, per-turn caching (memory + IndexedDB), and evaluation preferences.
- [`src/lib/team-paste.ts`](./src/lib/team-paste.ts) parses pasted Showdown exports (including natures, IVs, and levels) and overlays them as manual knowledge.
- [`src/lib/sets-io.ts`](./src/lib/sets-io.ts) builds and parses the side-headered both-teams text format for the Import/Export Sets panel.
- [`src/lib/pokemon-options.ts`](./src/lib/pokemon-options.ts) serves legal move/item/ability/tera/nature pools for dropdowns (loaded lazily to keep dex data out of the entry chunk).
- [`src/components/PSReplayFrame.tsx`](./src/components/PSReplayFrame.tsx) renders the Showdown replay viewer in an iframe.
- [`src/components/BranchPanel.tsx`](./src/components/BranchPanel.tsx) renders move and switch controls for the active branch.
- [`src/components/BranchSaveSharePanel.tsx`](./src/components/BranchSaveSharePanel.tsx) saves branch summaries locally and creates compact share links.
- [`src/components/BattleStatsPanel.tsx`](./src/components/BattleStatsPanel.tsx) shows inferred team information for both players.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) explains the current internal flow in more detail.

## Sample Inputs In The Repo

- [`replay.txt`](./replay.txt) contains a sample replay URL.
- [`team.txt`](./team.txt) contains a sample team export with German stat labels.

## Notes For Contributors

- The current app path uses the Showdown iframe viewer plus the `useBranch` simulator hook.
- The production bundle is large because the simulator and learnset data are included client-side.

## Next Priorities

- Turn branch share links into full replayable branch restores.
- Pre-apply an armed Tera toggle to the damage previews.
- Improve reconstruction fidelity for unusual targeting effects and volatile hidden battle state.
- Expand the replay regression suite with many more real replays and expected snapshots.
- Continue reducing async chunk size for `@pkmn/dex`, learnsets, and protocol parsing.
- Add deeper branch comparison tools.
