# Architecture Notes

This document describes how the current prototype works internally and where its biggest approximation points are.

## End-to-End Flow

### 1. Replay loading

The app starts in [`src/components/ReplayLoader.tsx`](./src/components/ReplayLoader.tsx), where the user provides:

- a replay URL or replay ID
- or a locally exported replay file (a "Download replay" `.html` export or a raw protocol log), via drag & drop or the file picker
- optionally a pasted team export

`useReplay` then:

1. normalizes the replay input in `parseReplayUrl` and fetches `https://replay.pokemonshowdown.com/<id>.json`, falling back to the `<id>.log` route when the JSON one answers with nothing usable (refused, empty, non-JSON, or a record with no log); the two routes are separate handlers on the replay server and do not always answer alike. A private replay's `-{password}pw` suffix stays on the fetched id (the replay server parses it off itself) and is stripped from everything derived from the id, so a 31-character password cannot end up inside the inferred format. Or, for files, parses the export in `parseExportedReplay` (the export wraps the log in a `text/plain` script with `/` escaped as `\/`; the replay id comes from the hidden `replayid` input, never from the file name, so arbitrary file names cannot corrupt format inference)
2. parses the replay log into snapshots
3. infers visible team information for both sides

Both steps take milliseconds on the main thread. Everything heavier that a loaded replay needs later — the damage-consistent spread solve and every simulator reconstruction — runs in the **replay worker** (round 38): one dedicated instance of the worker script, driven by [`src/lib/replay-jobs/client.ts`](./src/lib/replay-jobs/client.ts) with a job queue and abort-by-termination, separate from the evaluation pool so an evaluation's cancel never terminates a reconstruction. The worker-side handlers ([`src/lib/replay-jobs/handlers.ts`](./src/lib/replay-jobs/handlers.ts)) run the same package code the main thread used to run; `regression/replay-jobs.spec.ts` pins their positions and solved spreads byte for byte against the main-thread path.

The app can also be driven from outside ([`src/hooks/useEmbedHost.ts`](./src/hooks/useEmbedHost.ts)): `?replay=<id|url>` auto-loads a replay on startup, `?embed=1` hides the chrome for iframe embedding, and a host page can post `{ type: 'ps-load-replay', replay }` (id, URL, raw log, or exported HTML content). The app answers with `ps-embed-ready` / `ps-replay-loaded` / `ps-replay-error`; these types are disjoint from the internal viewer-iframe protocol below.

Relevant files:

- [`src/hooks/useReplay.ts`](./src/hooks/useReplay.ts)
- [`src/hooks/useEmbedHost.ts`](./src/hooks/useEmbedHost.ts)
- [`src/lib/replay-fetcher.ts`](./src/lib/replay-fetcher.ts)
- [`src/lib/replay-file.ts`](./src/lib/replay-file.ts)
- [`packages/replay-core/src/protocol-parser.ts`](./packages/replay-core/src/protocol-parser.ts) with [`packages/replay-core/src/protocol/`](./packages/replay-core/src/protocol/)
- [`packages/replay-core/src/opponent-inferrer.ts`](./packages/replay-core/src/opponent-inferrer.ts) with [`packages/replay-core/src/inference/`](./packages/replay-core/src/inference/)

### 2. Snapshot creation

`parseReplayLog` uses `@pkmn/client` to feed the raw replay protocol into a battle client and record snapshots at turn boundaries.

Each `TurnSnapshot` stores:

- both sides' Pokemon state
- field state
- side conditions
- the chunk of protocol associated with that snapshot

This snapshot data powers the turn slider and later helps correct reconstructed simulator state.

The same pass also collects **damage observations** (`parseReplayLogWithObservations`): every clean singles hit (no crit, no multi-hit, no `[from]` attribution, and only inside the current move action, so confusion self-hits and Future Sight resolutions are never misattributed) records attacker, defender, move, boosts, screens, weather, and the observed HP fraction. These observations feed the spread inference below.

### 3. Team reconstruction

When the user starts a branch, `buildTeamsFromReplay` creates `PokemonSet[]` values for both sides.

The current precedence is:

1. revealed information from the replay (and the user's manual edits)
2. the user's pasted team for `p1`, when provided, and Open Team Sheets
3. damage-consistent inferred spreads ([`packages/replay-core/src/spread-inference.ts`](./packages/replay-core/src/spread-inference.ts) with [`packages/replay-core/src/spreads/`](./packages/replay-core/src/spreads/)): a deterministic solver checks standard EV-spread candidates against `@smogon/calc` roll ranges for every observation a Pokémon appears in, replacing guessed spreads only where at least two observations demand it, and only in the dimensions the evidence can measure (offense from attacking observations, bulk from defending ones). Speed constraints come from the replay's own races: same-turn move order and KO-before-acting evidence (the KO proves the victim chose a move; a chosen switch would have resolved before the attack) become hard constraints over the built configuration, with directional exclusions keeping observations a modifier only strengthens; solves whose best candidate misfits the observations beyond a per-observation threshold forfeit back to the prior instead of standing on a least-bad fabrication, unless the solve repairs a speed violation. Every candidate is legalized to the format's EV budget before scoring (508 total / 252 per stat; Pokémon Champions formats, detected from the `|tier|` line, use 66/32), least-evidenced stats give way first with Speed last, and winners top up their unspent budget in unmeasured non-Speed stats; the sim never fields an over- or under-statted spread. The solve runs in the replay worker, once per knowledge state (the cache keys the small inputs — the two team infos and the paste — by content and the big ones — replay, evidence, Smogon payloads — by identity, so an identity churn alone never re-solves), only once the Smogon data has settled, and is shared across all team-build call sites; the pickers' snapshot approximation takes a cached solve and never starts one. The stats panel shows solved spreads as "fits observed damage"
4. Smogon usage-stat guesses for anything still unknown, when monthly stats can be fetched. Formats without a stats file (Custom Game, niche metas) fall back to the generation's OU stats. Guessed moves assemble as coherent sets ([`packages/replay-core/src/set-coherence.ts`](./packages/replay-core/src/set-coherence.ts)): published sets are scored against the revealed evidence (fit per revealed move/item/ability, rule-outs disqualifying, usage marginals as the tiebreak) and the winner fills unrevealed slots as one unit; marginal fills pass pairwise vetoes (big attacks the set's boosts do not serve, orphaned defense-boost enablers without their payoff attack, same-type damaging redundancy, and status fills under a Choice/Assault Vest guess all fall), with the deeper usage pool refilling the slots. The stats-panel enrichment (`team-info.ts`) and the simulator team builder run the SAME selection and vetoes, so the display never shows a set the engine would not play
5. `@pkmn/smogon` set assumptions for remaining gaps (Custom Game also maps to the generation's OU here)

Guesses are additionally filtered by **protocol rule-outs** (`RevealedPokemonInfo.ruledOut`): hazard/status/weather/Life Orb damage disproves Magic Guard, rocks chip disproves Heavy-Duty Boots, a landed Ground move disproves Levitate (guarded against Gravity, immunity-ignoring moves, and possible Mold Breaker attackers), two distinct plain moves without leaving the field disprove every Choice item (Dancer-capable species and `[from]`-called moves never count; a switch resets the evidence), and a plain status move disproves Assault Vest. A disproven ability or item walks to the next candidate instead of surviving as a guess, and disproven Choice guesses stop fabricating move locks in late-game reconstruction.

The knowledge model round-trips natures, IVs, and levels. Both teams can be exported as text and re-imported (`src/lib/sets-io.ts`, side-headered Showdown blocks); imports overlay as manual knowledge, persist per replay id in localStorage, and rebuild a live branch through the same refresh path as team edits. The team editor draws its choices from legal pools (`src/lib/pokemon-options.ts`: learnset-based move pools with prevo-chain walk, gen-legal items, species abilities, tera types, natures), loaded via dynamic import so dex data stays out of the entry chunk.

This is the most important approximation point in the current implementation. The branch engine can only be as accurate as the reconstructed teams.

Relevant files:

- [`packages/replay-core/src/team-builder.ts`](./packages/replay-core/src/team-builder.ts) with [`packages/replay-core/src/team/set-resolvers.ts`](./packages/replay-core/src/team/set-resolvers.ts)
- [`packages/replay-core/src/team-info.ts`](./packages/replay-core/src/team-info.ts)
- [`src/lib/smogon-stats.ts`](./src/lib/smogon-stats.ts) with [`src/lib/smogon/`](./src/lib/smogon/): the usage-stat fetcher, the format fallback chain, and [`hosts.ts`](./src/lib/smogon/hosts.ts), which tries the Smogon data hosts in order (data.pkmn.cc, then its GitHub Pages mirror; a 404 is an answer) and normalizes `@pkmn/smogon`'s double-slash paths
- [`src/lib/smogon-sets.ts`](./src/lib/smogon-sets.ts): set assumptions through `@pkmn/smogon` with a bound fetcher (the library calls `this.fetch`, which a browser's `window.fetch` refuses on a foreign `this`), per-species error collection (a total failure rejects and is never cached), and the generation Ubers file as the fallback for species the format lacks
- [`packages/replay-core/src/team-parser.ts`](./packages/replay-core/src/team-parser.ts)
- [`packages/replay-core/src/team-paste.ts`](./packages/replay-core/src/team-paste.ts): pasted Showdown exports (natures, IVs, and levels included) overlaid as manual knowledge
- [`packages/replay-core/src/smogon/`](./packages/replay-core/src/smogon/): the usage types and the pure lookups the app-side fetchers feed
- [`packages/replay-core/src/ids.ts`](./packages/replay-core/src/ids.ts) and [`packages/replay-core/src/calc-field.ts`](./packages/replay-core/src/calc-field.ts): the one Showdown id normalizer (`toId`) with the side-id helpers every layer reads, and the sim weather and terrain ids mapped onto `@smogon/calc` labels for the damage previews, the kill-odds pricing, and the spread fit

### 4. Branch reconstruction

`packages/eval-engine/src/branch-engine.ts` is the facade of the core reconstruction engine. The engine itself lives in `packages/eval-engine/src/branch/`: types, team ordering, protocol choice extraction, boundary corrections, log sync, state builders, choice execution, and the staged reconstruction pipeline over one session. `useBranch` wraps it with React state for the UI.

When `startBranch` runs, it:

1. creates a new `@pkmn/sim` battle
2. reorders both teams so the replay lead appears first (or, for a turn-0
   lead branch, the chosen `leadOverride` lead)
3. starts the battle and sends `default` for team preview
4. splits the replay protocol into turn blocks
5. replays original choices turn by turn until the target branch turn, staying in lockstep with the simulator's turn counter: a block's choices are only written when the simulator stands at that block's turn (a sim that ran ahead skips stale blocks, one that fell behind advances on defaults first, a wedged battle stops instead of feeding later turns wrong choices). Taunt-blocked moves replay from their `|cant|` line instead of defaulting to move 1.
6. handles follow-up forced switches when the simulator requests them
7. corrects HP, status, and the active Pokémon from the selected snapshot, including Pokémon the simulator fainted but the real battle kept alive (guessed spreads make damage rolls differ), which would otherwise leave the wrong Pokémon on the field with no protocol switch line to fix it. Corrected actives enter fresh (no choice locks inherited from the diverged history) and are then re-stamped with the locks the replay protocol itself proves (`choice-lock.ts`: one distinct committed move on an undisturbed choice item since the mon's last real entry; a guessed Choice item also needs the damage record not to contradict it); the stamp lands before the request refresh so the disable pass bakes it in. Corrections rerun the sim's disable pass and rebuild requests, and every correction pass restores the side-level invariants the sim itself runs on: `pokemonLeft` (the win-check counter: drifted high, a KO of the last body would not end the game) and `isActive` flags (drifted false, bench enumeration would offer a switch onto the field)
8. exposes the resulting simulator state to the UI

For doubles, the branch state includes slot-indexed active Pokemon, move lists, legal target options, switch lists, force-switch flags, and pending choices. The legacy single-active fields still point at slot 0 so the singles UI/tests remain compatible. Reconstruction also uses protocol `switch` and `drag` lines to correct active slots when simulator randomness would otherwise choose a different phazing target.

The same lockstep replay tolerates synthetic logs (e.g. video-reconstructed replays): missing `|upkeep` markers, unparseable lines (skipped during snapshot parsing), and CRLF endings (normalized at ingestion) no longer desync the reconstruction; the regression suite pins a full video-reconstructed replay turn by turn, down to a pending Future Sight surviving to its branch point.

**Hax alignment (per-turn seed search).** The replayed choices are the real game's, but the simulator rolls its own RNG: a phantom crit or miss the real game never had can contaminate a turn or even end the battle early, and boundary corrections cannot revive an ended battle. So before each block commits, the reconstruction serializes a checkpoint of the live battle, trials the block's choices under a pinned 16-seed candidate list (`packages/eval-engine/src/hax-alignment.ts` scores each trial's emitted events against the protocol block: game end and the faint set compare first, then soft counts over misses/crits/secondaries/hit counts/`|cant|`s/confusion self-hits/move counts plus a move-order signal), and calls `battle.resetRNG` with the best candidate. The pick repeats identically on every run (ordered trials, early exit on a perfect match, ties keep the earlier seed), and reseeding every turn keeps one turn's RNG consumption from shifting the next turn's rolls. The trial runner is `trialAdvanceLog` in the forward model (a fork-based sibling of `advancePosition` that answers forced switches from the protocol's replacement species); the runtime records each block's chosen seed plus the truly emitted block's score, and the sweep surfaces those records on `window.__psDebug.haxAlignment`, a premature-end notice, and the drift report's meta section. Damage magnitude stays unscored on purpose: boundary snapshots already pin HP, and matching rolls would reward wrongly guessed spreads.

**Turn-0 lead branch.** `startBranch` with target turn 0 rebuilds a FRESH game to the start of turn 1: no replayed blocks, no snapshot corrections and no choice locks (a corrected boundary would put the original leads right back on the field), and the chosen leads first in each team order. The lead decision becomes history entry 0; rebuilds of the variation (truncation, team edits) re-seed that entry from its recorded `leadChoices` instead of replaying it through the sim.

**Bring limits (VGC).** The branch runs on a bring-all base format (`gen9doublesou`), which would field all six — so every reconstruction of a bring-limited replay passes `bringOnly` and trims the teams before the battle starts: the interactive branch (the T0 picker's own selection, or on any later branch turn the species the real game brought), the game-graph sweep, the single-turn eval acquire, the calibration harness (same trim, same helper), and the turn-0 team-preview position (the lead analysis enumerates pairs over the real four). The shared derivation lives in `replayBringOnly`/`broughtSpeciesFor` (`packages/replay-core/src/replay-format.ts`): brought species come from the protocol's actives with one entry per BODY (an in-battle forme change like Terapagos-Terastal → -Stellar keeps its first-seen name instead of counting twice), and matching against the built sets resolves per NAME — exact species/nickname id first, then a UNIQUE base-species match (the protocol reveals active formes like Zamazenta-Crowned while sets may carry the base name, and teams holding both forme siblings as separate sets keep the exact one only). Fail-open is BOTH sides or neither: when either side's full selection never entered the field (short games), the whole replay stays untrimmed — the gate's A/B run showed that evaluating a pinned four against an unpinned six overrates the open side (it flipped a won game to the loser), so symmetric-wrong beats asymmetric-wrong. Evaluations and play-outs on trimmed battles can never switch into a never-brought Pokémon, and the snapshot pickers filter their bench options the same way. Adopted as a gated round (cache v38): the singles/bring-all corpus stayed byte-identical, and the both-pinned VGC games re-searched under the honest four.

After branch entry, the user can choose actions for both sides and `executeTurn` submits them to the live simulator.

**Where the branch's runtime comes from (round 38).** `startBranch` no longer reconstructs on the main thread. The board layer hands it `options.acquireRuntime`, implemented by the app's one **position source** ([`src/hooks/usePositionSource.ts`](./src/hooks/usePositionSource.ts)): the exact-position store (session cache keyed replay:turn:sets) answers at once when it holds the turn, otherwise the replay worker reconstructs (streaming every healed boundary into the store on the way, for free), and the arrival — or the stored position — becomes the live runtime through `adoptSerializedRuntime` ([`packages/eval-engine/src/branch/adopt.ts`](./packages/eval-engine/src/branch/adopt.ts)): `deserializeBattleExact`, the reconstruction's own arrival corrections (`correctBattleFromSnapshot` + `refreshRequestsFromLiveState`, identities on an already corrected position, so a sweep-captured boundary adopts as well as a single-turn arrival), a fresh battle stream with the same log and error pumps (`openStreams`), the sim's `restart(send)`, and the branch's protocol log (the replay prefix through `|turn|N` plus active corrections, `branchLogForPosition`). The stable serialization drops the sim's `|t:|` lines, so the adopted battle's log cursors count fewer lines than the live one's — exactly the shift every engine fork lives with; `packages/eval-engine/test/adopt-runtime.spec.ts` pins pickers, log, played turns, and rejected choices against the live reconstruction. Only a sim that could not even start falls back to the main-thread reconstruction. The same source serves Evaluate's single-turn acquire, the dwell rebuild, and the sweep's streamed pass, so a position is reconstructed at most once per set knowledge; positions built while the Smogon sets still load are used once and never kept.

Relevant files:

- [`src/hooks/useBranch.ts`](./src/hooks/useBranch.ts)
- [`packages/eval-engine/src/branch-engine.ts`](./packages/eval-engine/src/branch-engine.ts) with [`packages/eval-engine/src/branch/`](./packages/eval-engine/src/branch/)
- [`src/hooks/branch/`](./src/hooks/branch/): the execute side of `useBranch` (turns, forced-switch interludes, choice recording) and its session side (rebuild at a turn, battle access, teardown)
- [`packages/eval-engine/src/branch-choices.ts`](./packages/eval-engine/src/branch-choices.ts): the identity-based choice model the UI and the engine share
- [`packages/eval-engine/src/damage-calc.ts`](./packages/eval-engine/src/damage-calc.ts) with [`src/lib/branch-damage.ts`](./src/lib/branch-damage.ts): damage previews through `@smogon/calc` from the replay generation, the sim sets, and the field state

## UI Structure

[`src/App.tsx`](./src/App.tsx) is a thin composition: it calls
[`useAppController`](./src/hooks/useAppController.ts) and renders the loader,
the shared-branch view, the workspace, and the modals from the controller's
grouped surfaces. The controller stacks four hooks in
[`src/hooks/controller/`](./src/hooks/controller/), each with an explicit
input contract: the replay context (replay, embed host, branch simulator,
evaluation handle, Smogon knowledge, team knowledge, format metadata), the
transient interaction state (play-out run, draft choices, pending confirm,
reset per replay), the board (timeline pointer, deviation and rebuild road,
branch refresh, the load reset), and the engine (position acquisition,
evaluation view glue, the engine walk, the play-out loop). Every hook call
keeps the order the original App() had, so effects fire as before.

The main application surface is ONE unified
timeline, chess-engine style: the replay is the main line, at most one
variation exists, and a position pointer (`viewTurn` + `viewLine`) replaces
the former replay/branch mode split. The pure position model lives in
[`src/lib/timeline.ts`](./src/lib/timeline.ts): position "turn T" always
means the state before turn T, and deviations classify as open / extend /
truncate / replace.

### The timeline

- The timeline bar (slider + step buttons) is always visible and spans
  `max(replay end, variation tip)`; the displayed total counts played turns
  (the end snapshot is the "End" sentinel, not an extra turn). While a
  variation exists, a line chip `[Main line | Variation]` switches lines
  view-only and stays rendered at every turn (clicking Variation clamps
  into its covered span); returning to the main line is one click and
  never destroys the variation.
- Turn 0 is a view of its own, always reachable via the `T0` button (or the
  back arrow from turn 1): the replay frame seeks to team preview and a
  lead picker (`LeadPanel`) replaces the turn pickers, with the real leads
  preselected and badged. Singles picks one lead per side, doubles picks
  two (selection order is the slot order, marked a/b on the chips; a pick
  past the limit replaces the oldest). Bring-limited formats (VGC's 4 of
  6, BSS's 3 of 6 — `getReplayBringCount`, rule table first, format-id
  heuristic for regulations newer than the bundled sim) extend the pick to
  the whole brought selection: the real game's brought Pokémon preselect,
  the first picks lead, the rest ride in the back. "Play from turn 0"
  starts a fresh game with the chosen leads as a variation whose entry 0
  records the lead decision (`turnNumber` 0, `leadChoices` as slot-ordered
  species lists on the history entry); play then continues at turn 1 like
  any variation. When the graph carries a lead evaluation, T0 also opens
  the team-preview analysis.
- `PSReplayFrame` shows the original replay for main-line positions and the
  branch simulator log for variation positions. The branch frame ignores
  seekTurn prop changes after mount (re-seeking fought the append stream), so
  user navigation sends explicit one-shot `seekRequest` commands from the
  `navigateTo` funnel; tip-follow after an executed turn skips them (the
  append already positions, animated when enabled). Every `navigateTo` seek
  also arms the seek-intent echo guard, so a freshly remounted replay frame
  (leaving the variation) cannot knock the chosen turn back with its boot
  echoes. The chosen line is
  sticky: stepping back across the branch point and forward again returns to
  the variation; only an explicit main-line click (chip, notation, graph)
  leaves it. The timeline slider carries a gold stripe over the variation's
  turn span.
- `useEvaluation` tags single-position eval results with the position they
  started at (`resultTag`); a run finishing after the user navigated away
  renders as stale, is never recorded into the variation overlay's scores,
  and auto re-evaluates under the auto pref.
- The game graph (`EvalGraph`) overlays the variation as a gold curve
  anchored at the branch point; its points are the evaluated variation
  positions (fed by the auto-evals after executed turns). Gold points
  navigate the variation, blue points the main line; a white ring marks the
  pointer on its line.

### Choices at every position (variant B)

`BranchPanel` renders at EVERY position, fed by the best available source
(the panel names it): the live sim at the variation tip; a recorded
serialized position elsewhere in the variation (`useBranch` captures one per
executed entry: exact, incl. live PP and disables, rebuilt via
`src/lib/picker-state.ts`); or snapshot + guessed teams on main-line turns
whose exact position is not yet known (approximate: move types come from
the dex, PP shows as a dash, the sim validates legality on execute).
Exactness is the app's job: every reconstruction that passes
through the app (Evaluate's single-turn acquire, Analyze game's streamed
boundaries) lands in a session cache of exact positions, and when the
pointer DWELLS ~1s on an unknown main-line turn the app reconstructs it in
the background through the same healed path. The pickers upgrade in place
(real PP, disables, doubles targets), and the source line flips to "Choices
from the reconstructed position". The panel is compact by default: small
action chips (moves with PP, switch chips beside them, no tabs; type and
damage ride the tooltips), the played action badged "played", Use
Recommended, Execute. The "Advanced" disclosure grows the chips into the
full picker: type/damage details on 2x2 move buttons, the Fight/Pokémon
tabs, the free-choice dropdown, and the "What if it had …" tools. Doubles
target rows render in both views (targeting is correctness, not detail).
Executing at a position without the live sim
funnels through one deviation path: chess rules (truncation without asking
inside the variation, an inline confirm when replacing the variation from
the main line), then the proven rebuild (reconstruct to the variation
start plus replay of the kept entries, the same path team edits refresh
through), then the move.
"Let it play out" (`src/lib/play-out.ts`) loops the engine's top choice for
both sides from any position until the game ends, Stop, or a 100-turn cap.
Forced-switch interludes step the acting side alone (the waiting side's
'wait' sentinel is not a playable choice), every played turn is a normal,
navigable, truncatable entry, the panel reports why a run ended, and a
finished run seeks the battle window back to its start turn and plays the
new line ("watch it from your move"). While the run streams turns in, the
branch frame appends in 'hold' mode (no seeking), so the battle window
stays on the start position instead of flashing every appended turn.

- `BranchPanel` also carries the "What if it had …" row (behind Advanced)
  that loads a hypothetical legal move into the active set: a team edit
  through the same branch-refresh path as `TeamEditor` saves, with the move
  pre-seeded as that slot's pending choice.
- `BranchHistoryPanel` ("Variation moves") is the variation's clickable
  notation. Headers name the real moves (never raw sim commands); the
  left column jumps to the main line, the right to the variation, with the
  current position highlighted.
- `BranchSaveSharePanel` saves compact branch reports to localStorage and creates URL-hash share payloads.
- `BattleStatsPanel` stays visible to show inferred team information.
- `TeamEditor` lets the user override inferred fields for either player before branching.

Relevant files:

- [`src/components/PSReplayFrame.tsx`](./src/components/PSReplayFrame.tsx)
- [`src/lib/replay-html.ts`](./src/lib/replay-html.ts)
- [`src/components/BranchPanel.tsx`](./src/components/BranchPanel.tsx) with [`src/components/branch/`](./src/components/branch/)
- [`src/components/ReplayWorkspace.tsx`](./src/components/ReplayWorkspace.tsx) and [`src/components/WorkspaceEvalColumn.tsx`](./src/components/WorkspaceEvalColumn.tsx)
- [`src/components/EvalPanel.tsx`](./src/components/EvalPanel.tsx) with [`src/components/eval/`](./src/components/eval/)
- [`src/components/BranchHistoryPanel.tsx`](./src/components/BranchHistoryPanel.tsx)
- [`src/components/BattleStatsPanel.tsx`](./src/components/BattleStatsPanel.tsx)
- [`src/components/TeamEditor.tsx`](./src/components/TeamEditor.tsx) inside [`src/components/ModalDialog.tsx`](./src/components/ModalDialog.tsx), with the fields in [`src/components/team-editor/`](./src/components/team-editor/) and the draft state in [`src/hooks/useTeamDraft.ts`](./src/hooks/useTeamDraft.ts)
- [`src/components/LeadPanel.tsx`](./src/components/LeadPanel.tsx): the T0 lead picker, team preview as a playable position
- [`src/components/BranchSaveSharePanel.tsx`](./src/components/BranchSaveSharePanel.tsx): local branch saves and compact share links
- [`src/lib/type-colors.ts`](./src/lib/type-colors.ts): the type badge colors the stats panel and the choice buttons share
- [`src/styles/`](./src/styles/): the stylesheet in domain files (base, layout, loader, timeline, pickers, forms, stats-panel, eval-panel, shared-branch), imported once each by `src/index.css` after Tailwind; `regression/css-audit.spec.ts` keeps them free of classes no source uses
- [`ui/`](./ui/): the app suite, mirroring `src/components/` and `src/hooks/` with one spec per file under jsdom (Vitest project `ui`, Testing Library, the fixtures under `ui/fixtures/`)

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

The replay viewer iframe is rendered with `sandbox="allow-scripts allow-same-origin"`. This combination disables the sandbox for the blob document in practice, and that is a deliberate choice: the two-way turn synchronization (`ps-seek-turn` / `ps-turn` postMessages, live log appends) and the e2e assertions need script execution plus same-origin access to the embedded `Replays` object. The document only ever contains our generated wrapper plus `replay-embed.js` from play.pokemonshowdown.com, so the trust boundary is the same as loading that script directly.

On narrow screens the embed keeps its desktop layout; the app wraps it in a horizontally scrollable container with a 640px minimum width so the battle log stays reachable instead of being cut off.

## Validation Status

The current codebase has been validated with:

- `npm run lint`
- `npm run build`
- `npm run test:e2e` (Playwright): the browser flows, one file per theme under [`e2e/`](./e2e/) (loader, embed, eval, eval-graph, timeline, branch, pickers) over the shared steps in [`e2e/helpers.ts`](./e2e/helpers.ts)
- `npm run test:regression` (four Vitest projects: the root specs, each package's suite, and the app suite; the browser suites stay on Playwright)
- `npm run test:ui` (the app suite alone): [`ui/`](./ui/) holds a spec next to every component and hook under jsdom with Testing Library; the fixtures under [`ui/fixtures/`](./ui/fixtures/) build positions, results, analyses, and the worker fakes, and the controller and workspace specs run the real hooks with the replay job handler on the test thread; `npx tsc -p ui/tsconfig.json --noEmit` type-checks it. [`.github/workflows/test.yml`](./.github/workflows/test.yml) runs the Node suites and the browser flows on every push and pull request.
- `npm test -w packages/replay-core`, `npm test -w packages/eval-engine` (one package's suite alone): [`packages/replay-core/test/`](./packages/replay-core/test/) and [`packages/eval-engine/test/`](./packages/eval-engine/test/) hold each package's own specs, white-box against `../src`, the sibling package by name, fixtures package-local; [`regression/`](./regression/) keeps the app specs, the app-plus-package integration specs, the measurement chains (calibration, fit, feedback corpus), and the API snapshot ([`regression/package-api.spec.ts`](./regression/package-api.spec.ts)); root specs import the packages by name over the curated barrels, so they consume the public API the way the app does, and only the three measurement chains (calibration, fit, endgame truth) read package internals
- `npm run pack:smoke` ([`scripts/pack-smoke.mjs`](./scripts/pack-smoke.mjs)): packs both packages, installs the tarballs into a throwaway Node project, and runs the worked examples under [`packages/replay-core/examples/`](./packages/replay-core/examples/) and [`packages/eval-engine/examples/`](./packages/eval-engine/examples/), the ones the package READMEs embed verbatim
- `EVAL_FIT=1` on the weight-fitting corpus that [`scripts/build-fit-corpus.mjs`](./scripts/build-fit-corpus.mjs) builds (ReplayScouter tournament data, Smogon-thread scraping for gen9 singles, doubles, and VGC, ladder samples); the manifest is committed, the replay cache is not
- `npm run test:feedback` (on demand): the expert-feedback drift suite. Six pinned smogtours replays are swept through the real app and graded warn-only against a corpus of expert-approved truths and tracked gaps; hermetic and bit-repeatable, the suite reports to `docs/reports/` instead of failing on drift. Eval-layer failures surface per turn (`evalErrors` through the debug handle into the report), so a gap always names its reason.

The regression suite covers pure Smogon-stat parsing/enrichment (including the Custom Game → OU fallback), exported replay file parsing, branch save/share encoding, target-specific damage previews, basic doubles branch state, redirection/retargeting/phazing fixtures, stable checkpoints from a mocked fixture, and stable checkpoints from a saved real replay. Two deeper checkpoints are marked `fixme` to document known divergence rather than hiding it.

## Recommended Refactor Direction

If the project continues, the cleanest next architectural move would be to keep tightening the three independently testable layers:

1. replay ingestion and inference
2. deterministic branch reconstruction
3. UI rendering and controls

That makes it much easier to measure reconstruction accuracy, expand replay regression tests, and keep the frontend moving without coupling it to simulator internals.

The UI layer now holds that line: App() is composition over controller hooks, every hook and component sits under the lint ceilings (300 lines per file, 60 per function, complexity 15), and the app-level libraries and the evaluation engine now live in two workspace packages, `@fulllifegames/replay-core` and `@fulllifegames/eval-engine`, published from the release workflow at the root version whenever their files changed. The stylesheet follows the same cut: one file per domain under `src/styles/`, audited for dead classes on every regression run.

The layering is enforced, not just described. `eslint.zones.mjs` turns the package order (the app in `src/`, then `@fulllifegames/eval-engine` in `packages/eval-engine/`, then `@fulllifegames/replay-core` in `packages/replay-core/`) into `no-restricted-imports` errors: a package never reaches `src/` or the UI layer, replay-core never imports the engine, the app imports the packages by name and never their files, nothing under `src/lib` imports hooks, components, App, or workers, and components use the hook facades rather than their internals. The app resolves the package names to the package sources (a Vite alias and tsconfig `paths`), so dev, HMR, the build, and the suites share one module graph; `tsc -b` builds each package as a composite project with its own `dist/` declarations. The parts the app loads on demand (reconstruction, the forward model, choice locks, damage previews, serialization, the protocol parser, the opponent inferrer, the team builder, hidden-power) go through re-export modules under `src/lib/lazy/`: a package barrel imported both statically and dynamically would fold into the entry chunk; the facades keep the app's lazy-load boundaries where they were, and the packages' `sideEffects: false` lets the bundler drop every unused re-export. Package sources import each other with `.ts` specifiers and compile with `rewriteRelativeImportExtensions`, so the emitted JavaScript resolves in Node without a bundler while the declarations keep resolving in TypeScript (bundler and NodeNext resolution alike). Each barrel is curated (what the app, the worker, the sibling package, and the worked example use, plus the types those signatures mention) and pinned by `regression/package-api.spec.ts`. `scripts/pack-smoke.mjs` installs the packed tarballs into a throwaway Node project, runs the README examples, and type-checks a NodeNext consumer; `scripts/publish-packages.mjs` publishes the changed packages at the root version from `release.yml`, rewriting the workspace `"*"` reference into a caret range on the way out.

## Evaluation Engine

The chess-style evaluation lives in [`packages/eval-engine/src/`](./packages/eval-engine/src/), the `@fulllifegames/eval-engine` workspace package, and is deliberately layered so the expensive sim work stays off the main thread while everything above it is pure and unit-testable:

1. **Forward model** ([`forward-model.ts`](./packages/eval-engine/src/forward-model.ts) with [`forward/`](./packages/eval-engine/src/forward/)): forks the serialized battle, enumerates legal choices from the live request cross-checked against live state (singles and combined doubles choices with targets and one Tera/Mega/Ultra per side per turn; a side waiting out the opponent's forced switch gets a `wait` sentinel; Imprison-concealed moves are filtered by live disable flags; locked releases whose request carries no target data (mid-charge Phantom Force, rampages) fall back to the dex's target type, because serialization drops the locked-request shape and the round-tripped sim demands a target again), advances joint choice pairs under fixed seeds (pivot choices carry their declared follow-up switch as `move uturn > switch 4`, answered when the sim raises the forced-switch request), and greedily resolves remaining mid-turn forced switches. Every deserialize passes through a repair layer: transform-shortened moveSlots pad-deserialize-trim, fainted actives regain a proper switch request, and the side invariants (`pokemonLeft`, `isActive`) restore from ground truth so stale correction-era states self-heal.
2. **Static eval** ([`eval-function.ts`](./packages/eval-engine/src/eval-function.ts) with [`score/`](./packages/eval-engine/src/score/)): positional scoring (bodies, HP, status, boosts, hazards, screens, Tailwind, Trick Room) plus an aggregated 1v1 matchup threat term: per-pair best-damage fractions from movesets (live-PP slots only; a drained move is no threat, a drained heal no wall; PP reads from the sim state, never from dex pools), the type chart, stats, the big items and immunity abilities, and priority. Healer walls are **finite races** (`raceClocks`): remaining heal PP absorb as survival at each move's own heal rate (dex ratios exact, callback healers proxied at ~50%), a healer under pressure attacks only on its spare turns (pinned outright once pressure crosses its best heal rate, which a status residual can tip (brn/psn/tox; Magic Guard and Poison Heal exempt)), and every KO clock caps at the attacker's usable PP budget, so a slow win against a full wall never lands; tied KO races and the Trick Room sign read **effective speed** (`speed.ts`: stages, paralysis, Tailwind, Choice Scarf, Iron Ball, Unburden, weather abilities, inverted under Trick Room) instead of naked stats. The memoized pair term is HP- and boost-independent; current boost stages are applied outside the memo, so a Swords Dance moves the matchup term, beyond the flat boost weight. Hazards are priced per living victim (type-chart fractions, Boots/Magic Guard skip, the sim's own grounding with a bench-Levitate correction, dex-typed Toxic Spikes immunity), minus the **removal option value** a living Defog/Rapid Spin carrier holds over the net board state (own-side movers net full relief, both-sides movers net relief minus the side's own hazards across the field, net-negative options count zero, and the exercised option is tempo-discounted). The matchup term is **entry-cost-aware**: benched Pokémon are weighed by the HP they would arrive with through their side's hazards, so rocks can disable a benched 4×-weak wincon, unless it holds Boots. The bodies term prices **stranded** bench pieces as finished: a living benched mon whose HP cannot survive re-entering through its own side's hazards, on a side with no living removal carrier, keeps only a damped alive share (fodder value, no HP share) and leaves the hazard victim term so its fatal entry is never charged twice; Boots, Magic Guard, and the bench-Levitate correction inherit from the shared entry-fraction term, and a side that can still clear its hazards never strands a piece. Coverage gaps, Choice items locked into bad moves (including the live choice-lock volatile), item quality, and status-dampened boosts carry their own terms. The whole thing is a fittable feature vector (`evalFeatures` × `FEATURE_WEIGHTS`), and the weights are **calibrated per gametype**: `DOUBLES_FEATURE_WEIGHTS` carries corpus-fitted doubles values (boosts, Tailwind, Trick Room: speed control is worth several times its singles weight), fitted by the opt-in `EVAL_FIT=1` harness on a manifest-pinned corpus of 2,100+ games (gen9 singles, old-gen singles, doubles/VGC tranches) with cluster-bootstrap standard errors, per-phase Brier scoring, and a phase-conditioned win-probability fit, adopted only through the calibration gate, with every rejected experiment recorded in the calibration header.
3. **Search and ranking** ([`search.ts`](./packages/eval-engine/src/search.ts) with [`search/`](./packages/eval-engine/src/search/), [`rank.ts`](./packages/eval-engine/src/rank.ts) with [`ranking/`](./packages/eval-engine/src/ranking/), [`mcts.ts`](./packages/eval-engine/src/mcts.ts)): the joint choice matrix is evaluated with iterative deepening (KO-boundary roll grouping, dominated row/column pruning, candidate restriction for deep sub-searches, and a no-op filter dropping field moves certain to fail against standing conditions: Stealth Rock with rocks already up is a pass wearing a move's label; doubles restrict to a core-deduplicated candidate list ranked by threat hints plus setup/support/spread/Fake Out bonuses, with a separate gimmick budget and the played combo always kept), then solved as a matrix game by regret matching: choices carry their expected value against the opponent's equilibrium mix, the position score is the solved game value, and the maximin floor survives as the "safe" column. Root boundary cells (singles, matrix mode) are **expectation-grounded** ([`ko-odds.ts`](./packages/eval-engine/src/ko-odds.ts), [`cell-blend.ts`](./packages/eval-engine/src/cell-blend.ts)): a cell whose pair carries a priceable binary event (an accuracy roll, a KO-range roll) classifies its fixed-seed children into outcome classes from their advance logs and prices as analytically weighted class means (kill share = the crit-weighted fraction of the 16 damage rolls that reach the defender's HP, from a sim-exact `@smogon/calc` bridge fed the battle's own reconstructed stats, × stage-and-weather-modified accuracy; the first mover's kill truncates the second event), so a 43% kill roll can no longer sample 5/5 seeds and grade certain. Classes the base seeds missed are chased with fixed probe seeds under a bounded draw budget; a class never found renormalizes the found weights and surfaces as a `koDiagnostics` entry instead of an invented value; every guard (protect family, action-prevention statuses, survival items/abilities, pivot/hazard defenders, any deviation from the kill-truncation occurrence model) fails closed to the plain seed average; and deepening re-blends through the first-seed child's class so one deepened branch cannot erase the mixture. Sub-searches, doubles, and MCTS tree expansion keep the seed average byte-for-byte; the blend reaches MCTS results through the verify sampler (round 7), never through the tree. At the root, pivot moves expand into move-plus-incoming pairs over the live bench ("U-turn → Clefable") on both the sync and orchestrated paths (parity-tested); EV-tied leading rows fold in their one-ply horizon trend under the standing equilibrium (no re-solve; the re-solve variant refuted itself: the equilibrium re-weights toward the corrected row's punishers). A DUCT Monte-Carlo tree search mode runs four seed-rotated root trees merged by pooled root-cell statistics. Its rankings are the SAME equilibrium solve the matrix mode runs, over tree-informed cells: each cell's value is the mean of the leaves backed through it plus one static-prior visit, and a root cell fixes ONE chance outcome per tree (visits measure subtree exploration, not transition samples). Support cells the pool has starved, seen through too few trees, priced in disagreement across trees, or flagged as **boundary cells** are re-verified by the matrix-grade multi-seed cell sampler (blending since round 6, so boundary cells re-price to their analytic mixture) in one bounded worker round before the solve. Boundary cells (round 7): each tree scans the root grid with the blend's own event planner, and a cell carrying a priceable accuracy/KO-range event is chance-suspect by construction, because K fixed per-tree outcomes cannot represent an accuracy×kill-fraction split (four trees that all drew the hit side look rich, unanimous, converged, and wrong); the scan bypasses the ended-cell exclusion too, since a game-ending kill range is ended in its drawn class exactly because the pool cannot see the other one. Ranked MCTS rows carry the same analytic `koOdds` payloads the matrix mode ships, computed sim-side and attached by the sim-free merge, and verified-cell mismatch diagnostics pass through the merge sorted by cell, keeping the `koDiagnostics` inventory live on MCTS turns; blend payloads are dropped on purpose, since MCTS has no deepening pass to re-blend through. Every root option is therefore ranked with matrix-mode ev/mix/punisher semantics, while the SCORE keeps the visit-mean formulation the corpus records were measured on (full score delegation to the equilibrium measured −1 sign paired and was rejected). Expansion is hint-ordered under progressive widening: the restriction machinery's own static hints decide which options may open as visits accumulate, so a wide doubles root no longer starves its iteration budget. The mode carries its own corpus calibration: on the clean fills rig the depth-1 matrix ties or beats the pure tree overall, so the tree earns its seat through the default Auto line, which routes to it once the fainted fraction crosses the threshold and is best-or-tied both early and late on the re-baselined bed. Team preview is searchable too: turn 0 enumerates lead pairs (doubles) or leads (singles) as `team` choices, with an active-pair matchup emphasis in the static eval making lead order visible at depth 1.
4. **Orchestration** ([`orchestrator.ts`](./packages/eval-engine/src/orchestrator.ts), [`worker-client.ts`](./src/lib/eval/worker-client.ts), [`src/workers/eval-worker.ts`](./src/workers/eval-worker.ts)): a pure async orchestrator with exact parity to the sync search, fanned out over a worker pool sized to the machine. The workers stream progress and partial results far faster than a panel can show them (an MCTS tree reports every iteration): the worker posts one progress message per ten iterations, and the single-evaluation hook collapses progress and partials to the latest value per 100 or 250 ms ([`throttle-latest.ts`](./src/lib/eval/throttle-latest.ts)) — every delivery is a React render, and before round 38 a play-out kept the main thread 93 to 99 percent busy rendering. The same worker script carries the replay jobs (spread solve, reconstruction) for the separate replay worker instance described in section 1; their handlers load on demand as their own chunk (workers build as ES modules, `worker.format: 'es'`), because they carry replay-core's team builder, the standalone dex, and the learnsets — inlined, the evaluation pool's script grew from 7 to 12 MB, parsed by every one of its workers.
5. **Analysis** ([`played.ts`](./packages/eval-engine/src/played.ts), [`analysis.ts`](./packages/eval-engine/src/analysis.ts) with [`turn-analysis/`](./packages/eval-engine/src/turn-analysis/), [`leads.ts`](./packages/eval-engine/src/leads.ts), [`winprob.ts`](./packages/eval-engine/src/winprob.ts), [`opponent-model.ts`](./packages/eval-engine/src/opponent-model.ts), [`summary.ts`](./packages/eval-engine/src/summary.ts), [`report.ts`](./packages/eval-engine/src/report.ts) with [`prose/`](./packages/eval-engine/src/prose/)): parses the played actions and leads from the protocol (per-slot in doubles, charitable matching when a slot's action stayed hidden), matches them into the ranked lists, decomposes each swing into a decision part and a chance part (the played pair is valued at the sweep's own depth), and assigns verdicts banded on equilibrium-EV regret: inaccuracy, mistake, or blunder, with one-tier leniency in decided positions, an acquit-only verification pass one depth deeper for flagged mistakes (engine-independent: an MCTS-line flag re-adjudicates as matrix pairs at the same deep tier), sacrifice detection (a faint from ≤15% HP is a deliberate low-cost trade: one-tier demotion, neutral phrasing, never a seed of the loss; a HEALTHY body switched in and fed reads as a simplification sack only while the sacker's engine score stays decisively winning before AND after; a body that STAYED in and died above the threshold reads as a deliberate feed only when the realized outcome landed on the played line's priced floor (the player accepted the known worst case and got it, so the turn's own rolls contributed nothing positive) AND the best expectation inside the payoff window clears the safe guarantee by the read margin, which lets a Weavile sac that enables a sweep grade as the sacrifice it was: demoted one band, or cleared entirely when the windowed payoff repaid the FULL regret with the margin on top (a *verified* feed: measured from the accepted floor upward, that bar says the line reached what the engine's best promised); a blunder-sized regret is never forgiven by any of the three labels), a stay-in phantom for sides KO'd before they ever acted (the KO evidence proves a move was chosen and every priority-0 move is outcome-equivalent, so the best-ranked one prices the pair and the stay-in grades against the engine's best escape, while sleep/flinch/full-paralysis turns keep the honest "unclear"), and unpunished risks / paid-off reads (the payoff may cash in over a multi-turn window) kept apart from misplays. All values live in win-probability units: the per-gametype logistic mapping fitted to real outcomes applies exactly once, at the search leaf (`wpUnits`), so every downstream mean, equilibrium solve, and regret averages probabilities. Display then passes through a **second fitted stage** (`DISPLAY_K` in `winprob.ts`): averaging plus equilibrium selection re-inflates the aggregated root score, so `winPercent` maps it through sigmoid(DISPLAY_K·s), fit-corpus-trained and graded out-of-sample on the calibration bed, with exact ±1 (an ENDED evaluation) staying a literal 100/0, while regret/delta texts and the verdict bands stay in wp-units and mean literal win-probability loss (5/10/20%). The mapping is **phase-aware** (`K = k0 + k1·faintedFraction`, fitted per gametype): the same positional edge claims less confidence early and more as bodies drop, the corpus-measured fix for early-game overconfidence. Verdicts that survive verification are then **sensitivity-probed** against the opponent's guessed items ([`sensitivity.ts`](./packages/eval-engine/src/sensitivity.ts) swaps usage-plausible alternatives directly into the serialized position, rule-outs respected, ≤2 probes per flagged side): if an alternative flips the verdict, it softens to the most charitable probed tier and the summary names the hinge; acquit-only, like the deep pass. The Read lens is an exploitative layer on top of the already-solved matrix: `modelOpponent` mixes the equilibrium with a softmax over the opponent's own payoffs (Restricted-Nash-style anchor) sharpened by replay-observed tendencies, and `computeRead` surfaces a best response when the model is confident and disagrees with equilibrium; advisory only, never part of the grade. The game report aggregates turning point, seeds of the loss, the lead matchup, per-side misplays, sacks, and reads, per-player accuracy (win-probability loss, volatility-weighted), and luck, where chance booked past the favor boundary *toward* the winner counts as the decided game resolving (`resolutionTotal`, the static bar's horizon gap on a locked endgame), kept out of the luck ledger and the key moments, while chance against the winner stays real luck everywhere. Key moments select by a turn's biggest component (net swing or the chance share alone), so the game's biggest roll surfaces even when the decision delta partially cancelled it (573756 t73). Tera enumeration honors a per-Pokémon allowance ([`tera.ts`](./packages/eval-engine/src/tera.ts)): revealed-only in draft/custom formats or on user request. **Narrative signals** (computed render-time in `analyzeTurn`, spoken by `summary.ts`/`report.ts`, grading untouched, all failing closed on missing data): a culprit-free shift where both sides had four-plus options within an inaccuracy of best reads as a "genuinely open turn" (a prediction contest, with the per-side breadth counts) instead of a drift; a recommendation whose own equilibrium mix leans a different choice (≥50% weight) carries its condition, the opponent reply with the largest value split in the solved matrix ("B only if you expect X; Z covers Y"); a mechanically null recommendation (Will-O-Wisp into a Fire-type; [`null-moves.ts`](./packages/eval-engine/src/null-moves.ts), type-chart-driven and conservative, with attacker abilities suppressing uncertain verdicts) swaps its display to a co-optimal alternative within the rank-tie epsilon or carries its enabling-condition caveat; and a near-pure equilibrium switch (≥85%) is named in prose as the forced expectation it is. Round 13 adds two more: *the read that was on the table* (against the opponent's ACTUAL click the solved matrix knows the best own row, named on shift turns when it beats the played line in that column by a mistake-sized gain; 562428 t10: switching to Heatran into the Horn Leech, the expert's own read) and *entry-is-profit* context when the played or recommended line brings in a mon the opponent has no live race answer to (race verdicts computed once at the search root, hazard-adjusted entry HP, carried on the result across both search paths; 648453 t13: any clean entry of the Lopunny forces a sacrifice). Round 14 makes that profile honest about reliability: its races run on **expected rates** (the pair threat carries the category-max move's accuracy in fields the score path never reads, so a 70% Hurricane is no full-hit one-turn clock), a fresh entry's first-turn flinch move (Fake Out) chips the standing answer for free before the race starts (together these flip the actual t13: two expected Hurricanes against two Returns from the chipped bar, and the faster Lopunny takes the tie), and a mon every *benched* enemy loses the entry race to while a standing active still wins the pair sits in the **switch-in stage** with its holder named ("no switch-in left on the other side — only the standing X holds it, and from the bench the opponent can only sacrifice into it", the expert's literal no-remaining-switch-ins state; a 1v1 endgame never enters, the stage being trivially true there). The game report speaks each mon's entry sentence once per stage: the walk feeds its spoken keys back into `analyzeTurn`, a stronger stage is a new statement, and the per-turn card keeps every sentence. Round 15 reads the whole board from the same race machinery. The **decided sweep** (one mon that WINS every living enemy pair, the entry verdict without the toll, since replacements arrive on a KO, clears the whole team within a short expected clock (`DECIDED_MAX_TURNS`), and survives the accumulated spare-turn return fire) marks the game practically decided for its side; when no sweep stands but one ≥90% boundary-event roll against the standing active would unlock it, the **near-decided** stage names the odds and the removal ("one 95% roll from clearing the rest", 573756 t73, pinned). Both are display and prose only (announced once per side, species, and stage in the game report, re-labeling a decided turn's chance swing toward the sweep as the game resolving, and drawn as edge strips on the eval graph), because their own preregistered calibration bench refused a real score clamp: across the broad bed the decided side won ~80% of clamped positions (singles ~73%), so the calibrated bar keeps its honest number and the sweep stays a narrative claim rather than a score. **Odds grounding** (round 6): ranked root options carry their own move's analytic kill odds (`koOdds`, cache-borne from the search), and clauses that recommend or blame such a move quote the arithmetic ("kills ~43% of the time", "an 80% roll to connect", "a 90% roll into a ~43% kill range") in the summary clauses, the report's seeds sentence, and a compact turn-panel suffix. **Streak cumulation** ([`streaks.ts`](./packages/eval-engine/src/streaks.ts), render-time over the played-move history) names what repetition buys at milestone lengths: secondary fishing (Serene Grace doubled, Shield Dust/Covert Cloak suppressed, flinch gated on outspeeding every streak turn) and crit accumulation against boosted walls, with cumulative odds 1 − (1−p)^n. The value/narrative contract in one line: **the search prices what the next roll is worth; the report narrates what many rolls mean**. One-turn analytic expectation lives in the cached, calibration-gated value channel; multi-turn cumulation is render-time narrative and never a grade.

[`useEvaluation.ts`](./src/hooks/useEvaluation.ts) drives it, with [`src/hooks/evaluation/`](./src/hooks/evaluation/) holding the preferences, the single-position evaluate path, and the graph sweep as staged runners (types, verification and sensitivity probes, cache-hit install, per-turn evaluation, the lane runner, the three-pass orchestration): single evaluations, three-pass game sweeps (a fast depth-1 scan shapes the line in seconds, the configured settings deepen every report-worthy swing (the same threshold the report's key moments use, so the report never names a turn the sweep left shallow), and then every remaining turn converges to the configured settings: the settings ARE the line), and per-turn caching in memory and IndexedDB keyed by replay, turn, a sets fingerprint, the Tera allowance, and the engine settings/version. Graph writes are monotone (`supersedesStored`): a shallower pass never overwrites a deeper stored turn, so re-analyzing cannot downgrade an explicitly deepened result, including across engines: a matrix escalation of depth ≥ 2 stored on an MCTS-target turn (the ladder crossed engines before round 32) outranks the d1s1-grade MCTS tier in every later sweep. Selecting a turn never re-searches; deepening is the explicit "Think deeper" button (sketch → configured settings → depth 3, never shedding samples; a tree turn offers no rung, since a matrix pass would see three plies where the tree saw seven), and per-turn settings badges on the report chips and the turn view keep mixed-depth curves honest. The single-turn re-search acquires its position through the same per-turn snapshot healing the sweep uses, with a reached-guard that fails loudly (instead of publishing a decided ±1) when a replay diverges beyond what healing can repair. The default engine mode `auto` is a complete spec resolved per turn BEFORE dispatch (d1s1 matrix below `AUTO_MCTS_FAINTED_FRACTION` of bodies fainted, the DUCT tree at or above), so stored results and store keys always carry the concrete engine that ran, the sweep's routing mirrors the calibration harness bit-exactly, and supersedes/upgrade decisions resolve through the turn's recorded fainted fraction (failing closed across modes when it is unknown). The sweep waits for the Smogon usage/sets fetches, so it can never bake teams without the guessed fills unnoticed. Game sweeps acquire every position from one boundary-corrected reconstruction; entering a branch uses the same per-turn snapshot corrections so the branch opens on the position the analysis described. Clicking an engine line plays the turn out against the engine's reply and re-evaluates: the chess-engine walk.
