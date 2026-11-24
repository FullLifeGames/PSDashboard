# History that lived in source comments

Until round 90 the source carried long blocks that told how a value was fitted, which round changed a rule, and what a probe measured. The comment pass of round 90 cut them to the fact that code needs. This file keeps the cut blocks verbatim for the record, under the file they came from. The designs they explained are in EVALUATION.md and ARCHITECTURE.md (the headings are named under each block), the fit verdicts are in the calibration ledger of `test/regression/eval-calibration.spec.ts`, and the round entries of the other files here hold the measurement records.

Round numbers, T-numbers, issue numbers and dates in the quoted blocks are the originals.

## src/lib/eval-cache-store.ts

The per-version log of `EVAL_ENGINE_CACHE_VERSION` (v7 to v80), as the file carried it at 0ae67d57. The constant and the rule to bump it stay in the file; ARCHITECTURE.md, "Eval cache and its version rule", states the rule.

```
/**
 * Bump when the engine's numbers change meaning (eval weights, search
 * behavior) — persisted results from older engine versions must not
 * resurface as current.
 */
// v7: active-pair matchup emphasis + team-preview (turn 0) evaluation.
// v11: phase-aware winprob (K = k0 + k1·faintedFraction), sensitivity
//      probes cached per turn.
// v12: hazard-removal option value (net board state, move-aware).
// v13: entry-cost-weighted matchup/coverage (benched mons fight through
//      their hazard entry damage; Boots/Magic Guard exempt).
// v14: guaranteed-failing field moves dropped from candidate lists.
// v15: horizon-trend tiebreak — EV ties in the leading rows reorder by the
//      one-ply trend of their decisive cells (stall lines stop shading out
//      equivalent switches).
// v16: seeded reconstruction — evals cached from unseeded (run-varying)
//      reconstructions could disagree with the branch a click executes in.
// v17: Sleep Clause — branch formats carry the clause (declared |rule| lines
//      or the singles default), and redundant sleep moves leave the
//      candidate lists.
// v18: video-pipeline watermark |rule| lines no longer suppress the
//      singles Sleep Clause default (GPL evals cached without the clause).
// v19: corrected actives enter FRESH (no inherited choice locks from
//      diverged sim histories — GPL T38 hid Grass Knot).
// v20: post-correction request refresh, Imprison-concealed candidates
//      filtered, transform-shortened moveSlots round-trip (the Mew replay
//      crashed whole searches; corrected positions offered benched mons'
//      moves).
// v21: horizon-trend extrapolation (2b-lite) — tied leading rows carry
//      their one-ply trend in their VALUES (no re-solve; score untouched).
// v22: pivot pairs — the root matrix enumerates "U-turn → X" as first-class
//      choices instead of one greedy row.
// v23: pivot pairs reach the ORCHESTRATED path too (the app's worker-pool
//      results cached under v22 were built from unexpanded root options).
// v24: locked releases carry dex-derived targets (doubles mid-charge
//      Phantom Force/Meteor Beam candidates were guaranteed rejects on
//      round-tripped states — those cells never sampled).
// v25: KO'd-before-acting sides price their pair through the stay-in
//      phantom — playedOutcome values stored as null under v24 would
//      otherwise never heal (null means "tried, unmatched" and is final).
// v26: side invariants (pokemonLeft, isActive) restore on every
//      deserialize — corrupted-correction positions used to throw (GPL
//      T38/T39 gaps) or evaluate wiped sides as alive.
// v27: choice tokens come from the request's move id (display names carry
//      computed BP for happiness moves — "Return 102" built a token the
//      sim rejects, silently gapping every Return/Frustration turn) and
//      guessed Frustration sets assume 0 happiness (the sim default 255
//      priced them at BP 1).
// v28: hidden-trapped actives (unrevealed Magnet Pull — the request conceals
//      trapping the validation enforces) stop offering bench switches, the
//      guaranteed reject that killed whole turn evals (573756 t24/32/38-40).
// v29: corrected actives regain protocol-proven choice locks (one distinct
//      committed move since entry + choice item + undisturbed item), a
//      guessed Choice item additionally needing damage corroboration —
//      Keldeo @ Specs graded as a free 4-option side (649664 t23).
// v30: typeless Hidden Power resolves via effectiveness evidence + usage
//      instead of the IV-default type (648453 t13 ran HP Dark for a real
//      HP Ice).
// v31: stranded bench mons (hp ≤ own-side hazard entry fraction, no living
//      removal carrier) price at a damped alive share instead of a full
//      body, leaving the hazard victim term (653785 t19's switch banked a
//      Charizard that could never return; 655336 t23/t24 artifacts) — and
//      the sweep feature weight becomes adoptable (fit 2026-08-15).
// v32: hax-aligned reconstruction — every turn boundary reseeds the sim
//      with the pinned candidate whose rolls reproduce the protocol's
//      crits/misses/secondaries/faints (best of 16, deterministic), so
//      positions no longer carry phantom RNG the real game disproves
//      (653785's endgame died 2 turns early to a seeded crit).
// v33: analytic class-blend at root boundary cells + koOdds payloads
//      (expectation grounding round — a 43% kill roll can no longer
//      sample 5/5 and grade certain; 649664 t23's desired).
// v34: MCTS root odds grounding — koOdds payloads on MCTS rows, boundary-
//      suspect verify coverage (uniform-outcome kill ranges re-priced by
//      the blending sampler), mismatch diagnostics passthrough.
// v35: effective speed is the standard speed source — the matchup and
//      sweep tie-breaks and the Trick Room sign read stages, paralysis,
//      Tailwind, Choice Scarf, Iron Ball, Unburden, weather abilities,
//      and invert under Trick Room instead of comparing naked stats.
// v36: PP truth in the threat model — pair threats, heal status, and the
//      removal-option terms read live slot PP (a drained wall stops
//      walling, a Struggle-locked body stops threatening; 573756's
//      endgame). PP comes from the sim state only, never from dex pools.
// v37: pin-efficiency discount on held heal PP — past the heal rate a
//      race defender's healAbsorb realizes only at healRate/incoming
//      (a pinned healer heals at a net loss and dies with PP in the
//      tank), so healing now outprices holding (655336 t26: Slack Off
//      over a free-turn Protect).
// v38: bring-limited positions field only the brought species (A.3c) —
//      sweep and single-turn reconstructions of VGC/BSS replays trim to
//      the protocol-pinned bring per side (per-side fail-open), and the
//      turn-0 preview enumerates lead pairs over the real four. Singles
//      and bring-all formats are byte-identical to v37.
// v39: knock-out hits are lower bounds in the spread fit (a KO line only
//      says "at least the remainder"; read as a reading it pulled every
//      solve toward a bulkier defender and a weaker attacker: 573756's
//      p1 Toxapex fitted as Bold 252 Def, Melmetal at 0 Atk). Sets, and
//      with them positions, change wherever a knock-out was observed.
// v40: the last pair is priced by its race (a burned, healing-only Toxapex
//      no longer outscores a Choice Band Zapdos-Galar on HP alone), the
//      threat proxy sees fixed-damage moves, the verify step pools tree
//      depth per outcome class and prices verified cells one ply deeper
//      with their rows completed, tree disagreement is visit-weighted, and
//      knock-out hits corroborate Choice items as lower bounds. Teams also
//      moved in round 33 (published Smogon sets, the Ubers fallback, the
//      revealed-attack default, the keep-the-prior fit). Scores move in
//      every endgame and wherever an MCTS verdict leaned on a verified cell.
// v41: round 35, the forced-win bar on the score.
// v42: round 37, a Choice Scarf inferred or dropped from move orders no
//      plausible spread reproduces, and speed evidence in doubles. Sets
//      move wherever an order decided an item or a doubles turn proved one.
// v43: round 40, the log's maximum HP pins the HP EVs, a move order the
//      prior satisfies keeps its Speed, benched bodies keep the sim's HP
//      (Regenerator), and a death after the mon's own miss is no sack.
//      Sets and positions move in every server-log replay.
// v44: round 41, a kept Speed gives way to an offense claim the budget
//      cannot express beside the log's HP, and two kept stats over the
//      budget offer both shaving orders. Sets move where a body lost its
//      measured offense under round 40.
// v45: round 42, a forced switch after a knock-out is a decision node of
//      the MCTS tree (the replaced side picks from its bench with lookahead,
//      the other side waits) instead of the greedy static pick, and doubles
//      option lists offer the pass assignments. Every tree-evaluated
//      position moves (Auto past a quarter of all bodies fainted).
// v46: round 43, the endgame solver and the forced-win prover draw an
//      outcome class the base seeds never showed on demand (the simulator's
//      accuracy, crit and damage rolls scripted for that one move) instead
//      of chasing it with probe seeds. Every proof and every solved endgame
//      with a formerly open class moves; the tree is unchanged (the chance
//      nodes measured in this round stay switched off).
// v47: round 47, a benched body reads its last protocol sighting (plus the
//      third Regenerator restores on the way out) instead of the sim's own
//      bench HP. Every position moves whose bench holds a body that was hit
//      and left within one turn, or whose departure the sim rolled apart
//      from the log (38 of 2306 benched bodies on the bank).
// v48: round 49, the matchup memo keys a halving move (Super Fang, Nature's
//      Madness, Ruination) on the defender's current HP. Before, the first
//      forked position to ask froze its HP into the memo, and a matrix the
//      worker pool split read a different value run to run. The key also
//      carries the other live reads of the memoized threat (current types,
//      the stored stats, the defender's max HP). Every position moves whose
//      sets carry a halving move or whose bodies change type or stats
//      mid-search (Protean, Soak, Power Trick).
// v49: round 53, a mon the full spread solve forfeits keeps the speed-only
//      pre-solve's spread instead of falling back to the usage guess, so
//      the built teams hold the move orders the pre-solve repaired. Every
//      replay moves whose sets carry such a mon (9 of 1549 sets on the
//      bank, all singles).
// v50: round 54, Tera reaches the reconstruction and the static eval. A Tera
//      click on a turn without an action line for its slot (a flinch) is
//      replayed, a body that fainted only in the reconstruction gets its
//      marker back from the snapshot, and the static leaves read the Tera
//      type (immunity, type chart, Stealth Rock, Toxic Spikes, Black Sludge);
//      Wind Rider, Soundproof and Bulletproof blank wind, sound and ball
//      moves. 297 of 833 bank positions move, 293 of them with a living
//      terastallized body (334 positions carry one). STAB stays tera-blind:
//      the rule by the book is parked on branch r54-stab.
// v51: round 55, two rebuild fixes. An Encore that lands before its target
//      moves no longer stands a turn too long (the rebuild sent the encored
//      Protect back as the click, and it ran ahead of the Encore), and a
//      locked doubles slot (recharge, the release turn of Fly) carries no
//      target loc, so the sim no longer rejects the whole side choice and
//      the partner plays its protocol move.
// v52: round 56, the doubles cell plan (pair/). A doubles root cell of the
//      matrix or of an MCTS verify sample whose draws show a dice event
//      (a hit chance under 100 %, a kill only some damage rolls reach) is
//      priced as the weighted mix of its outcome classes (pair/sampler.ts)
//      instead of the plain seed mean. A cell where a fallback rule fires
//      (a speed tie among move actions, a random drag-in, a |cant| or
//      confusion line, a flinch chance on a target that moves later, a
//      status or confusion before the turn, a Protect whose success is
//      rolled, a shield such as Focus Sash at full HP, a multi-hit move, a
//      calc that misses the drawn damage, a missed flip, a coverage outside
//      0.8 to 1.02) takes the mean of eight natural draws. A crit that
//      decides no kill and a chance secondary such as a burn or a stat drop
//      stay inside the drawn class. A cell with neither keeps its value to
//      the digit. On the bank 115 of 129 doubles matrix positions move;
//      singles, the MCTS tree, the solver and the prover are untouched.
//      Doubles options carry kill odds labeled with their slot's move and
//      target.
// v53: round 57, the static prices a move as it lands (move-use.ts). Its
//      type, category and power follow the user's ability (Liquid Voice,
//      the -ate family, Normalize), forme (Ivy Cudgel), item (Judgment), the
//      weather, the terrain, the Tera click and Hidden Power's type and
//      power; Scrappy and Mind's Eye hit Ghosts. Power set at use (weight,
//      happiness, HP, speed: T81) is parked on branch r57-power.
// v54: round 60, the simulator gets the right state and choices. A doubles
//      slot locked in a move (Outrage and the other rampages, Uproar, Bide,
//      charge releases, recharge) is one option without a target and goes
//      to the sim by request index (913996 turn 6 had no playable option).
//      A snapshot correction writes Spikes and Toxic Spikes layers and the
//      remaining turns of weather and terrain (T92). The build gives every
//      set an ability the dex knows for its species: the log's "As One"
//      becomes Calyrex's As One forme, and outside custom games Ogerpon and
//      Terapagos lose the ability of their battle-only forme (T93).
//      Outside custom games a species with a fixed Tera type or item
//      carries it (Ogerpon's masks and Tera types, Terapagos; T79), and a
//      Tera forme switching back in maps to its species through the dex
//      (749895 built a second Ogerpon). An ability from a protocol line
//      goes to the Pokémon whose species can have it (Water Absorb heals,
//      Pickpocket, Trace; T104). The static's burn and poison residual
//      follows the generation (burn 1/8 in gens 2 to 6, poison 1/16 in
//      gen 1; T95). The static's speed list matches the simulator's getStat
//      on every bank body: Slush Rush in snow, Protosynthesis and Quark
//      Drive, Unburden only with the simulator's volatile, suppressed
//      abilities and items, stages floored (T95).
// v55 (round 61, T98): the search budget chosen at the round-61 gate
//      (03.10. 23:30): auto turns run the tree from the first turn
//      (tree-from 0) with 1200 iterations per tree, measured in T97 against
//      the app's own search on the bank (early tree -23 bp, doubled
//      iterations -10 bp pooled) and inside the time window from before
//      round 59.
// v56 (round 61, T98): the pair missed the time gate (04.10.: 222 s
//      against 198 s before round 59), so the gate's fallback holds: the
//      tree from the first turn with 600 iterations per tree (-23 bp
//      pooled on the bank).
// v57 (round 63, wave 1): eight lanes land together: early singles turns
//      on the matrix again (T110), the static's move core asks the
//      simulator (T81 without STAB) and memoizes its hints (T112), the
//      verify step deepens per class and checks doubles boundary cells
//      (T16, T78), set fidelity (T89, T28, T80, T101), the choice lock
//      after Trick (T115) and observed move orders (T117).
// v58 (round 64, wave 1.5): the doubles prover answers every legal reply
//      (T118), the static's memo and setup hint read the stats a move
//      really uses (T125), the verify step deepens per state a class
//      leaves (T119), sets read published item slots, IVs and the Boots
//      tell (T120, T122 point 4), the rebuild follows every protocol item
//      line and switch-in (T121), and the speed solver reads formes,
//      Transform and Scarf rounding and fills open EV budgets toward the
//      prior (T122).
// v59 (round 65): the static weighs by the replay's rule set. Champions OU
//      gets its own fitted weights (bodies 121, hazards 1.13, matchup 210),
//      and the greedy replacement after a knock-out reads the table of the
//      rule set its position carries. Champions OU positions read new
//      values; every other position keeps its value.
// v60 (round 65, gate "2b"): Doubles OU and every doubles format outside
//      VGC and Champions take the round-65 fit (bodies 180, hazards 0.51,
//      screens 88, Trick Room 58, matchup 118, coverage 91); VGC outside
//      Champions is a rule set of its own and keeps the hand doubles table,
//      as Champions VGC does. Doubles OU positions read new values.
// v61 (round 66, T141): Champions VGC builds its teams from the Champions
//      VGC usage file (gen9championsvgc2026: megas, Champions items and EV
//      scale) instead of the Scarlet/Violet one (gen9vgc2026). Champions VGC
//      positions read new values; every other position keeps its value.
// v62 (round 66, T142): VGC reads the VGC set file of its year
//      (gen9vgc2025, gen9vgc2024, Champions championsvgc2026) and never the
//      Doubles OU analyses; a year without a file (Scarlet/Violet 2026)
//      guesses from its usage file. VGC positions read new values.
// v63 (round 66, T137, gate "2a"): Champions doubles weigh by the Champions
//      VGC fit (screens 83, bodies 196, matchup 96). Champions doubles
//      positions read new values.
// v64 (round 67, wave 2): the rebuild plays the entry effects of a body its
//      correction puts on the field and reads the protocol with the
//      simulator's names; the inference rules out guessed items the log's
//      damage refutes and takes facts from its own client walk; every calc
//      Pokémon comes from one builder (entry boosts once, Tera bodies, forms,
//      Paradox, Supreme Overlord, Hidden Power); the search reads one bench
//      order, lists partner targets and grades doubles roots against the
//      unlisted answers; Pokémon Champions runs on the Champions mod with
//      Stat Points, reads its own set file and prices doubles with its own K.
//      Positions of every format read new values.
// v65 (round 68, T186): @smogon/calc 0.12: Pokémon Champions is the calculator's
//      own generation 0 (Stat Points, species and moves from the mod), Gen 1 and 2
//      read their EVs, Rivalry reads the species' gender, Protect and entry
//      stages follow the simulator. Calculator values of every format can move.
// v66 (round 69, wave 3): doubles hits feed the spread solver and every hit is priced with the field,
//      the item and the Paradox stat it landed with; the inference reads Champions species, item triggers,
//      |cant| moves and defender items; the rebuild keeps volatiles, sleep counters and slots; the singles
//      cell plan prices missing weight, immunity and speed ties; doubles verify and answers go deeper; the
//      static reads boosts that bite, the field pair, a status fix and a phase form, with refitted tables;
//      results carry cell visits, outcome classes and hindsight reads. Positions of every format read new values.
// v67 (round 70, batch of fixes): standing stages count where they win a race the holder gets to act in,
//      with end-of-turn residuals and contact costs played in the simulator; healers attack where that wins;
//      side protectors and Protect get a damage tempo in the doubles hints; the trend probe reads every base
//      draw; Gen 1 and 2 build at the server's spread; Z-moves and Max moves reveal their item and base type;
//      the cards name the click a row walked into. Positions of every format read new values.
// v68 (round 72, wave 4): the built sets carry the replay's nicknames, shiny flags, levels and genders, so a
//      serialized position carries the names; a commanding Tatsugiri passes its slot in the search and in the
//      rebuilt turn; the speed tie comes from the simulator's queue; Dex reads replace hand lists (Tidy Up clears
//      both sides, Defog before Generation 6, Normalize and Hidden Power, Generation 1 screens, Symbiosis and
//      Pickup). Positions of every format read new values.
// v69 (round 73, wave 5): the static counts a stage only where its holder acts and wins its front race, a
//      matchup pair weighs the HP share of its winner, paralysis and sleep are priced from the played hit; the
//      rebuild leaves a slot empty where the log does, plays the log's -start lines and keeps a Sitrus Berry the
//      game kept; the spread solver reads history powers, partner abilities and the field of the hit, and drops
//      Z, Max and cut spread hits. Positions of every format read new values.
// v70 (round 76, the last wave): the healer race follows the simulator's sequence of hits and heals, Rage Fist and
//      Last Respects read the hits taken and the faints from the history, a Taunt from a -start line ticks as the
//      simulator does, and an open team sheet without EVs takes the solved spread (the sets of open-sheet games move).
//      Positions of every format read new values.
// v71 (round 77, T267): in an endgame (at most two living Pokémon on each side) the verify round keeps an agreeing
//      tree pool of 100 visits below the depth floor, so the rankings and verdicts of endgame turns move, and with
//      them a prover's proof; the score of the trees stays.
// v72 (round 78, @pkmn 0.10.12): the simulator of Showdown b354a81f (Pursuit, recoil, Emergency Exit, the Gen 3 and 4
//      entry, the faint order, Champions Regulation M-C), a corrected Gen 1 to 4 entry plays it, and a calculator body
//      takes the Dex values where the calculator's differ. Positions of every format may read new values.
// v73 (round 79, wave 7): a tree turn prices its played pair with the root's own cell (T287), a defensive stage that
//      takes away the foe's win counts (T288), the near-decided stage and the clean-up read who acts (T282, T283), and
//      the sweep prices the replacements after a knockout (T290). Stored decision and chance parts, tiers and the
//      positions with a Defense or Special Defense stage read new values.
// v74 (round 80, small batch): the near-decided stage names the clicker, who clears the rest itself, and records its
//      click (T292); stored near stages, the forced-win starts they name and the denied ends read new values.
// v75 (round 83, small batch): the turn boundary keeps the simulator's count of a side condition or a pseudo weather
//      where the client's snapshot allows it (T307); positions under a screen of a Light Clay holder read new turns.
// v76 (round 86, the engine reads the dice): the tree's dice run on the dice module (T299), secondary effects count at
//      their chance (T305), the doubles trees key their root draws, and the trees' seeds follow the Dex (T323); the
//      rebuild plays each turn with the dice the log shows (T306), the report prices the copy of the turn's biggest
//      roll (T304), and the item reader sees screen turns (T310). Every tree turn, rebuilt position and report moves.
// v77 (round 87, release 1.1.0): the @pkmn train moves from 0.10.12 to 0.10.15 (Showdown 16db150a); a Struggle that
//      deals no damage costs its user a quarter of its HP, a Gen 1 Transform resets the last move slot, and a typeless
//      Synchronoise misses a typeless target, so any search line that reaches them reads new values.
// v78 (round 88, the wave of 1.1.1): the set reader rules out a terrain seed or Room Service that never fired (T349)
//      and reads weather and terrain as proof of the setter's item (T329); the bench offers brought bodies only
//      (T314); the rebuild keeps the logged order for a body that never acts (T325), takes out a body the log never
//      shows (T327), forces Diamond Storm's gain once per move in doubles (T338) and keeps a battle-only forme through
//      a switch (#103); a game without team preview fills its unseen bodies with stand-ins (#101); the dice offer a
//      charge move that skips its charge turn (T344) and one accuracy die per hit (T337); the prover carries a proof
//      over a secondary that only helps the mover (T336). Positions of those games and turns read new values.
// v79 (round 89, the wave of 1.2.0): the rebuild and the set reader follow the log more closely (#110, #75, #137,
//      #139, #150); a body that cannot act is no longer offered; each search cell draws its own seed list (T324);
//      the prover prices more dice, delays a win behind a repeated Protect and tries a sure strike first. Positions of
//      those games and turns read new values.
// v80 (round 89, SB3c): a stat drop counts in boostsBiting and in the boosts term only while its holder cannot switch
//      out (trapped, or no living body off the field); a free holder loses the drop with its switch. Turns whose
//      leaves hold a drop on a free holder read new values.
```

## src/lib/stale-chunk-reload.ts

Original comment (header (1-7): round 81 incident).

```
/**
 * Round 81 (T298): every build renames its lazy chunks, and a deploy replaces the old ones, so a page built before
 * the deploy (an open tab, or an index.html the browser kept) asks for chunks that are gone. Production, 31.10.2026:
 * "Error loading .../assets/opponent-inferrer-DmwVZADz.js" until a hard reload. Vite's preload helper raises
 * `vite:preloadError` for a failed lazy import; the page reloads once to fetch the new index.html. A second failure
 * within the guard shows the error, and without session storage the page never reloads, so no loop can start.
 */
```

## src/lib/replay-frame-zoom.ts

Original comment (header (3-14): round 84 zoom probe).

```
/**
 * Round 84 (T315, A7d): the replay frame under the root's zoom. The zoom probe of A7c found the engines apart. Chromium carries the
 * zoom into a same-origin frame (inside it the layout width is the frame's CSS width and the pixel ratio is the zoom's), so nothing
 * is left to do. WebKit 27.2 lays the frame's document out at the physical width (600 for a frame of 400 CSS px at 150 %) and draws
 * the content at 100 %: the replay would stand small in a frame that grew. This follower compares the document's layout width with
 * the frame's CSS width, and when the document is wider zooms its root by the ratio, so the replay fills the frame at the zoomed
 * size (a browser zoom redraws the text at full resolution, no bitmap is stretched) and is never scaled twice: where the two widths
 * agree, nothing is set.
 *
 * It measures with its own zoom taken off, so the result is the same however often it runs, and refits on a new factor of the
 * store, on the page's resize and on the frame's own resize. The three paths all end at the same state; none sets a state of React.
 */
```

## src/lib/replay-frame-height.ts

Original comment (followContentHeight (round 84 A7d, ResizeObserver loop count)).

```
/**
 * Follows the content height of a same-origin replay document while it stands in phone mode (the scene, the controls and the log in
 * one column): the iframe's property takes the document's height on every change of its size or class, and gives it back when the
 * document returns to the desktop layout. Writes the element's style directly, no React state. Returns the disposer.
 *
 * Round 84 (A7d): three rules keep it out of a ResizeObserver loop (the A7c run raised "loop completed with undelivered
 * notifications" 15 times in 19 tests). The observer is the frame document's own (`contentWindow.ResizeObserver`), so a page
 * observer never sees a body of another document, and the frame's own loop stays in the frame. It measures the body's box, the
 * content, and not the root's `scrollHeight`, which never falls below the viewport and so reads back the box it sized. And it
 * writes only when the height changed; the desktop layout writes nothing at all.
 */
```

## src/lib/replay-phone.ts

Original comment (PHONE_STYLES comment (round 84 A7e overshoot)).

```
/**
 * Round 84 (A7e): the scale is the frame's width over the battle's border box (642 px), with no inset. The 1.1 px overshoot of A7c and
 * A7d was Showdown's own scaling, not a rounding: `Battle.onResize` (battle.js, with `autoresize` on) writes an inline
 * `transform: scale(width / 640)` and `margin-bottom` on the battle frame whenever the window is under 640 px, and an inline style beats
 * a plain rule, so the document drew the scene at 642 x width / 640 = 363.1 px in a 362 px frame whatever `--ps-k` said. The two
 * declarations below carry `!important`, which beats the inline ones, so `--ps-k` decides.
 */
```

## src/lib/teambuilder-table.ts

Original comment (header (round 85 timings)).

```
/**
 * Round 85 (T318): the part of Showdown's teambuilder table a replay frame reads. Every frame document ran
 * `data/teambuilder-tables.js` (15.8 MB, one `JSON.parse`): 185 to 200 ms on the app's main thread at load and 140 to 185 ms
 * again at every variation start, since the frame is a same-origin blob document. The replay client reads the table only in
 * `battledata.js` (ModdedDex): `BattleTeambuilderTable["gen" + i]` for the generations from the replay's own up to
 * Generation 8, and `BattleTeambuilderTable[modid]` for the mods it builds a Dex for (`battle.js`: `Dex.forGen`,
 * `Dex.mod('champions')`, `Dex.mod('gen7letsgo')`, `Dex.mod('gen9ssb')`). A worker cuts that part once per session (1.14 MB
 * of 15.8 MB), and the frame's script hook loads the part's script in place of Showdown's file. Until the part is ready, or
 * when the worker fails, frames load Showdown's file as before. The e2e sweep `test/e2e/teambuilder-table.spec.ts` compares
 * the client's Dex over the part with its Dex over the whole table, entry by entry, for every generation and these mods.
 */
```

## src/lib/support-state.ts

Original comment (header (round 77 and 89 rulings)).

```
/**
 * Round 77 (user gate 28.10.2026, "1a 2a 3a 4a 5a"): the app's state as one readable file for a bug
 * report. It holds what a reproduction needs (the replay, the sets the app played with, the variation
 * with every slot choice, the viewed position, the messages on screen) and nothing beyond what the user
 * gave the app. The recorded positions of the variation stay out: they are large, and the rebuild
 * recomputes them from the choices.
 *
 * Round 89 (#105, H5): a new game has no replay to load, so its file carries the game's record in the optional `game` (the format,
 * both teams, the seed and every turn; its log is `replay.log`), and the restore opens the game from it. The version stays 1: a
 * new optional field is no break, a replay's file is the file of before to the byte, and an app that reads version 1 only meets a
 * game file at "Load the replay newgame-... first", a refusal and no misreading.
 */
```

## packages/eval-engine/src/score/weights.ts

The fit and tuning history of the weights, one block per field (lines of the file at HEAD before the comment pass). EVALUATION.md, "Weight tables", states what the weights mean.

### weights.ts lines 19,33

```
  /**
   * Per boost stage on an active Pokémon (boosts vanish on switch): base
   * points × the diminishing schedule. Offensive stages (atk/spa/spe) carry
   * games; defensive stages read at half weight. Shape follows poke-engine's
   * field-tested curve — the payoff of a setup turn must live in the STATIC
   * eval, deeper search cannot see past its horizon. The 18 Sep re-fit
   * implies 39 ± 6 in singles and the paired bank agrees (hq singles
   * −4/−27/−5 bp), but the verdicts do not: at 39 the stall game 573756 goes
   * from 14 inaccuracies and no mistake to 40 and 7, every one of them "set
   * up instead of stalling on". A standing stage is priced without asking
   * whether it bites the wall in front of it; the weight stays until it does.
   * Round 69 (S8, T49): it does. The singles table prices the stages through
   * boostsBiting (95) and `boosts` reads 0 there; these 12 and 6 stay the
   * hand reference of the 2:1 split that both columns share.
   */
```

### weights.ts lines 62,67

```
  /**
   * Extra weight on active-vs-active pairs in the matchup term: the mons on
   * the field apply the pressure, the bench only threatens to. Also what
   * makes lead choices visible at depth 1 — every leads cell shares the same
   * teams; only the actives differ.
   */
```

### weights.ts lines 83,91

```
  /**
   * Early-game damp on the matchup FEATURE VALUE: at zero faints the term
   * reads at damp × matchup, scaling linearly to full weight at ≥1/3 of all
   * bodies fainted. 1.0 = off. A phase multiplier folded into the raw value
   * like the other non-independent modifiers — NOT independently fittable
   * (it rescales a feature the fit already prices). Grid-tested 2026-08-09
   * at 1.0/0.75/0.5 through the calibration sweep; see the calibration
   * header for the recorded outcome.
   */
```

### weights.ts lines 93,103

```
  /**
   * Fraction of a removal option's NET board-state relief that counts:
   * removal costs a tempo turn and can be punished, so the option is worth
   * half its exercise value. See hazardRemovalEquity — the net is
   * move-aware (Defog also destroys the side's OWN hazards on the
   * opponent's board; a net-negative option is never exercised and counts
   * zero). Folded into the raw hazard value — a non-independent modifier,
   * not fittable. Motivating case: draft T14, where switching into the
   * 4x-rock-weak Defog Talonflame read as walking deeper into the hazard
   * cost on the very turn that sets up the removal.
   */
```

### weights.ts lines 105,113

```
  /**
   * Alive-share multiplier for a STRANDED bench mon — one whose HP cannot
   * survive re-entering through its own side's hazards while the side has
   * no living removal carrier. Its hp share prices at effHp (0 by
   * definition of stranded); the remaining alive share is fodder/absorber
   * value. Hand weight, calibration-gated 2026-08-15 (spec: horizon
   * family ④; the depth-2 switch that strands a piece banked a phantom
   * body — 653785 t19, 655336 t23/t24).
   */
```

### weights.ts lines 152,160

```
  /**
   * Round 69 (T42, decision 15): the field pair of a doubles board, p1-positive
   * differences, 0 in singles, weight 0 until a fit prices them. pairFocus: a
   * foe on the field that neither of the side's two actives KOs alone and both
   * KO together, valued by the second attacker's marginal share of the foe's
   * HP, over the foes on the field. pairRedirect: a living Follow Me or Rage
   * Powder user next to a partner with damage, valued by the partner's best
   * share of a foe's HP it covers, at the redirector's HP (score/field-pair.ts).
   */
```

### weights.ts lines 163,179

```
  /**
   * Round 69 (T49, decision 16): `boosts` with every standing stage damped by
   * the share of living foes it bites (score/boost-bite.ts): a foe bites back
   * the stage when it plays Unaware (asked from the simulator's ModifyBoost),
   * clicks a move that takes the stages away (Haze, Clear Smog, Roar and the
   * like, played in the simulator), or when the stage buys no KO, no slower
   * foe KO and no move order within a few turns of the race. Same sign and
   * scale as `boosts`, p1-positive difference; weight 0 until a fit prices it,
   * and then it replaces `boosts` (the damping lives in the feature).
   * 13.10.2026 (the Swords Dance report on gen9draft-2058494320): a boost
   * counts against a foe only where the holder WINS the race with it and gets
   * to act in it, a drop only where the foe does (score/boost-race.ts); the
   * foes on the field gate the stage for everybody behind them, and the
   * end-of-turn HP of the bodies in the race (Leech Seed, Leftovers, weather)
   * is played in the simulator (score/residuals.ts). The weights below were
   * fitted before these rules; a re-fit is open.
   */
```

### weights.ts lines 181,192

```
  /**
   * Round 69 (T102, decision 17): what the status multiplier of `bodies` gets
   * wrong for a body whose ability changes what the status costs. Per living
   * body, (the right multiplier minus the applied one) times the body's share
   * before the status multiplier, p1-positive difference. The right multiplier
   * is played in the simulator (score/status-factor.ts): 1 where the ability
   * turns the status into a gain (Poison Heal, Guts, Quick Feet, Marvel Scale,
   * Toxic Boost, Flare Boost), part of the way to 1 where it cancels only some
   * of the cost (Magic Guard under burn: the chip is gone, the halved Attack
   * stays). 0 for every body without such an ability. Weight 0 until a fit
   * prices it; at the weight of `bodies` it folds the right multiplier in.
   */
```

### weights.ts lines 196,215

```
/**
 * The hand singles table. Round 69 (S8, T49): the standing-stage weight moved
 * from `boosts` (the 12 of EVAL_WEIGHTS.boostStage) to `boostsBiting`, the
 * same stages damped by the share of living foes they bite. REPLACEMENT fit on
 * the r69-b0 capture, 10,350 positions of 1,363 sets, rest of the table at
 * hand: out of fold better in 20 of 20 seeds (log-loss -16 bp, Brier 20 of
 * 20), boostsBiting 95 [77, 112], no flagged band. The ADDITIVE fit (boosts
 * kept at 12, boostsBiting 74) reads another 14 bp better; by the
 * pre-registered order (REPLACEMENT before ADDITIVE) the replacement is the
 * step that is measured, the additive form waits for that reading.
 *
 * Round 69 (S9, T102): `statusFix` takes the weight of `bodies`, so a body whose
 * ability changes what a status costs is priced at the right multiplier (the
 * fold: out of fold better than the table in 20 of 20 seeds, log-loss -8 bp,
 * 968 statused positions). The phase form of this family (bodies and matchup
 * with the share of fainted mons, score/phase-form.ts) rides on top of this
 * table behind a switch; the other four tables hold statusFix at 0 (their
 * fold lost out of fold: 0 of 20 seeds in the two Scarlet/Violet doubles
 * tables, too few statused positions in Champions).
 */
```

### weights.ts lines 236,254

```
/**
 * Doubles OU and every doubles format outside VGC and Champions, fitted
 * 2026-10-09 (round 65, T127) at the fixed doubles K on the corpus measured
 * like the app (the app's team build, the bank's reconstruction): 3,951
 * positions of 679 sets of the Scarlet/Violet doubles without the holdout
 * (739 Doubles OU games, 28 VGC games), folds and bootstrap clustered by
 * set. Fitted with their 90 % band: bodies 180 [159, 201], hazards 0.51
 * [0.13, 0.92], screens 88 [44, 144], matchup 118 [42, 205], coverage 91
 * [34, 171], Trick Room 58 [29, 90]. Held: the boost weights, tailwind (the
 * first pass flagged it) and choice mismatch. Out of fold it beats the hand
 * table in 17 of 20 seeds (log-loss −14.5 bp, Brier −7 bp), short of the
 * pre-registered 20. On the holdout's 369 Doubles OU games the search reads
 * −36 bp [−62, −10] (own K per phase −28 [−51, −6]), on the bank's 36
 * Doubles OU games +144 [+24, +279], nearly all of it the screens weight:
 * in the bank's games with screens up the screens side lost 9 of 14, in the
 * holdout's it won 48 of 83. Bank and holdout together read −11 [−40, +18].
 * Adopted at the round-65 gate ("2b": Doubles OU takes the fit, VGC keeps
 * the hand table).
 */
```

### weights.ts lines 275,323

```
/**
 * VGC outside Champions (doubles; bring six, pick four, level 50): the hand
 * doubles table, corpus-fitted 2026-08-08 (590 doubles and VGC games,
 * cluster-bootstrap significant): speed control carries far more win
 * probability in doubles than the singles hand weights say (tailwind 68±25
 * against 8, Trick Room 87±27 against 10, boosts 27±7 against 12); the
 * other weights are the singles hand weights. Round 65 keeps it for VGC:
 * the corpus holds 50 VGC games against 1,108 Doubles OU, and on the 31 VGC
 * games of bank and holdout the Doubles OU fit read +85 bp [−10, +181].
 * Written out in full, so a refit of Doubles OU never moves it.
 *
 * Round 69 (S7, T42): pairFocus fitted free on the 3,893 VGC positions of 711
 * sets (r69-b0 capture, rest of the table at hand): -188 [-284, -94], out of
 * fold better in 20 of 20 seeds. The sign is the reverse of the cell's
 * reading (a pair that can double up on a foe the singles cannot KO); the
 * bank and the VGC holdout decide (R3) whether the weight stays. User gate of
 * 13.10. (6b): pairFocus is 0 again. The cell is a 0/1 gate, and at -188 the
 * VGC score fell as a foe took damage in 24 of 103 HP series of the 54 VGC
 * positions (largest fall 0.098); T199 builds a ramp over the KO window and
 * refits.
 *
 * Round 69 (S12, T144): the August values for tailwind (68) and coverage (40)
 * and the fit that kept them (round 66, 14 of 20 seeds) priced what the
 * matchup already holds: the matchup term reads the doubled speed of a
 * Tailwind (speed.ts; on 35 doubles positions with one side under Tailwind it
 * moves 0.112 toward that side, 27 up and none down), and Coverage grows with
 * the same margins (correlation 0.43 with the matchup, 0.32 with the bodies;
 * alone its fit is +24, with the matchup in the model -44). The flag itself
 * is right (3,779 of 3,779 positions agree with the log, four turns with the
 * set turn). One side has Tailwind in 15.8 % of the positions, both in 1.6 %,
 * and the side with it wins 45 % of those, where the other columns alone
 * predict 43.5 % and the hand weight 53.6 %. The refit on the r69-b0
 * capture (3,779 positions of 711 sets) holds tailwind and coverage at 0 and
 * refits bodies 177, screens 48, matchup 169 and Trick Room 54 (hazards stay
 * at the hand value, R2 flagged): out of fold better in 20 of 20 seeds, Brier
 * 20 of 20, log-loss -62 bp, Brier -24 bp against the table before.
 *
 * Round 69 (S17, T49): `boosts` 27 replaced by boostsBiting 16 (REPLACEMENT on
 * the Schluss-Fit corpus, 32,088 positions, with stage drops counted: 16.1
 * [2.8, 30.7], out of fold better in 20 of 20 seeds, Brier 20 of 20, log-loss
 * -126 bp, no flagged band; before the drops counted the column was flagged
 * and missed R1). The bank and the VGC holdout decide it (R3).
 *
 * Round 74 (T263): the matchup refit on the search capture of the fit corpus
 * (2,334 positions of 711 sets, root features at today's K) gave 123 [100, 149],
 * out of fold better in 20 of 20 seeds (log loss -13 bp). On the VGC holdout it
 * read +4 [-8, +16] with a luck-adjusted mid warning (+36), and the bank's VGC
 * rows read harm on the luck-adjusted doubles row (+16, own K +21): 169 stays.
 */
```

### weights.ts lines 344,357

```
/**
 * The rule set a battle runs under (round 65). The simulator knows no
 * Pokémon Champions format (its doubles reconstructions run as Doubles OU,
 * its singles as a custom game), so the host names the rule set from the
 * replay's format (replayRuleset in replay-core) and hands it to the search
 * (EvalSettings.ruleset); the static weighs the features with the table of
 * its rule set and game type. Champions OU (singles) and Champions VGC
 * (doubles) are their own games with their own fits: on the round-65
 * corpus their fitted weights part from the Scarlet/Violet games'
 * (Champions OU bodies 121 and matchup 210 against the singles table's 200
 * and 120). VGC outside Champions parts from Doubles OU (bring six, pick
 * four, level 50) and keeps the hand doubles table until it has data of
 * its own; a VGC singles game reads the singles table.
 */
```

### weights.ts lines 360,382

```
/**
 * Champions OU (singles), fitted 2026-10-09 (round 65, T127) at the fixed
 * singles K on its own games: 1,971 positions of 285 sets (450 ladder games
 * rated 1366 to 1665, two thirds of their sets; the third is the holdout),
 * the corpus measured like the app (the app's team build, the bank's
 * reconstruction), folds and bootstrap clustered by set. Out of fold it
 * beats the singles table in 20 of 20 seeds (log-loss −102 bp, Brier
 * −50 bp); on the holdout's 149 games the static reads −85 bp [−164, −5]
 * and the search −23 bp [−97, +49] (own K per phase −8, early −83
 * [−172, 0], late +87 under the fixed K and +24 under its own). Fitted with
 * their 90 % band: bodies 121 [87, 157], hazards 1.13 [0.6, 1.7], matchup
 * 210 [82, 363]. Held: coverage (the first pass flipped its sign), the
 * boost, Trick Room and choice-mismatch weights (variant E's holds);
 * screens and tailwind lack support in Champions OU. Round 67 (wave 2,
 * decision 31): refit on the faithful reconstruction (T145, the Champions
 * mod; T143, the Champions OU set file), 1,972 positions of 285 sets, the
 * free weights land on bodies 122 [87, 159], hazards 1.07 [0.54, 1.65] and
 * matchup 252 [102, 427] and lose out of fold in 20 of 20 seeds (log-loss
 * +62 bp): the table stays. Round 69 (S8, T49): `boosts` 12 replaced by
 * boostsBiting 102 [62, 152] (REPLACEMENT, 1,971 positions of 285 sets, out
 * of fold better in 20 of 20 seeds, log-loss -19 bp). Written out in full,
 * so an edit of the singles table never moves a held Champions weight.
 */
```

### weights.ts lines 403,431

```
/**
 * Champions doubles: every Champions doubles format reads this table, fitted
 * 2026-10-09 (round 66, T137) on Champions VGC at the fixed doubles K: 2,601
 * positions of 386 sets (rated Bo1 ladder games of regulations M-A, M-B and
 * M-C and the Bo3 tournament games, two thirds of their sets; the third is
 * the holdout; unrated challenges played after a ladder ended stay out of
 * the fit), the corpus measured like the app with Champions usage and set
 * files (T141, T142), folds and bootstrap clustered by set. Out of fold it
 * beats the hand doubles table in 20 of 20 seeds (log-loss −25.3 bp, Brier
 * −10.8 bp). Fitted with their 90 % band: screens 83 [45, 122], bodies 196
 * [171, 223], matchup 96 [44, 151]. Held at the hand table: coverage,
 * hazards, tailwind and Trick Room (the first pass flagged them), the boost
 * and choice-mismatch weights. On the holdout's 491 games the search reads
 * −16 bp [−35, +3] (early −45 [−86, −7], regulation M-C −50 [−92, −13]; own
 * K per phase −6), no harm. Round 65's fit on 283 sets, most of them unrated
 * challenges, won 7 of 20 seeds. Adopted at the round-66 gate ("2a").
 * Round 67 (wave 2, decision 31): refit on the faithful reconstruction
 * (T145, the Champions mod), 2,605 positions of 386 sets, bodies 197
 * [173, 225], screens 84 [46, 123] and matchup 107 [58, 161] lose out of
 * fold in 20 of 20 seeds (log-loss +28 bp): the table stays. Written out
 * in full. Round 69 (S8, T49): `boosts` 27 replaced by boostsBiting 87
 * [64, 120] (REPLACEMENT, 2,604 positions of 386 sets, out of fold better in
 * 20 of 20 seeds, log-loss -30 bp, and 20 of 20 against the additive form).
 * Round 69 (S17): boostsBiting 87 -> 61 [42, 81], the Schluss-Fit on the
 * corpus with stage drops counted (32,088 positions; Brier better in 16 of 20
 * seeds, the log-loss in 19 of 20). The lane value lies outside the new band
 * and the new value outside the lane band, so decision 3 (user answer 2a)
 * takes the fit value.
 */
```

## packages/eval-engine/src/search/answers.ts

Original header (lines 8-44 at HEAD). The design is in EVALUATION.md, "The verify round and the answer round"; this text keeps the scenes and the measurements behind it.

```
/**
 * Round 67 (T128): the doubles root's answer round. The tree lists 16
 * combos per side (the hint cut of search/options.ts), so a best row can
 * read 1.00 against every listed answer while an unlisted legal answer
 * refutes it (VGC 2630685175 t7: Wood Hammer + Earth Power against the 12
 * listed p2 combos; each of Zamazenta's six Protect answers holds it near
 * 0.75). After the verify round each side is graded against the other
 * side's legal answers: 'protect' prices the side's best row against every
 * legal answer for one natural draw and adds the answers that beat the
 * listed ones by more than ANSWER_MARGIN (at most ANSWER_CAP), 'full' adds
 * every unlisted legal answer. An added answer is priced for every listed
 * row of the graded side by one natural draw, and the side's ranking is
 * solved over its listed rows against the listed and the added answers.
 * Since b4 (2630685175 t8) a 'protect' candidate counts only when it still
 * refutes the best row one ply deeper (one natural draw, a depth-1 search of
 * its child: the depth the verify round prices a cell at). At one ply a
 * stall answer reads the board's static, which can lie far from the trees'
 * value (p1's double Protect read -0.16 for p2 at one ply and +0.87 one ply
 * deeper, where every listed answer read +0.84). The added column itself
 * was priced by one natural draw: the best row's step from one ply to one
 * ply deeper does not carry to the other rows (2629703929 t8: shifted by it,
 * every p1 row fell to about -0.54 and the played row read a blunder).
 * Round 69 (T149): the three gaps of that round. Detection reads every row
 * within PROVER_NEAR_TIE of the top, up to ANSWER_NEAR_ROWS (2629703929 t4:
 * six p1 rows within 0.012, so which of them stood first, a tree's noise,
 * decided the verdict): the best row against every answer, the others
 * against the listed ones and the answers that read lowest against the best
 * row; each candidate meets the highest near row it refutes. The near rows
 * that can still decide the ranking (at most ANSWER_DEEP_ROWS) price the
 * added column one ply deeper (912045 t6: the switching row read 0.18 to
 * 0.21 by one draw, 0.03 to 0.07 one ply deeper), the other rows keep their
 * one plain draw; and a round that changes a side's best row sends the new
 * row's unverified cells through one more verify round (tree-orchestrator.ts).
 * The answers come from the simulator's legal list (legalChoices), never a
 * hand list. The score stays the visit mean; the rankings read the answers.
 * Pure and sim-free, like the merge.
 */
```

## packages/eval-engine/src/winprob.ts

The K fit history and the two-stage calibration, block by block as the file carried them (the text of each comment, without its margin). The calibration ledger in `test/regression/eval-calibration.spec.ts` holds the K verdicts.

### packages/eval-engine/src/winprob.ts, header (lines 1-61 at HEAD): the K fit history and the two-stage calibration

```
Score → win-probability mapping fitted to real replay outcomes (the
logistic fit lives in test/regression/eval-calibration.spec.ts and the larger
corpus refit in test/regression/eval-fit.spec.ts; pin the printed K here when
adopting a new fit).
PHASE-AWARE since 2026-08-09: K = k0 + k1·faintedFraction (fainted bodies
over total bodies, both sides — a game-length-independent phase signal).
Fitted on the 1,100-game pinned corpus (eval-fit schema 2, 5,985
positions): singles k0=2.28 k1=1.49 (n=3551), doubles k0=2.98 k1=0.88
(n=2434). Phase-K beat constant-K (2.61/3.15) on held-in Brier in every
phase bucket of both gametypes — the early game genuinely earns LESS
confidence per point than the endgame, which is the measured early
overconfidence this mapping now prices. faintedFraction defaults to 0,
so any caller without phase context gets the (conservative) early K.
RE-FIT 2026-09-18 (round 47, the first capture since the forme-marker
merge, 12,821 positions of 2,111 games): NOTHING ADOPTED. fitPhaseK stops
after 500 fixed gradient steps, short of the maximum: it reports singles
2.51/1.18 and doubles 2.58/1.15 where the likelihood peaks at 1.86/3.73
and 1.99/3.67, and the pins below are such intermediate states too. On
the bank none of the three separates from the pins (paired Brier with a
bootstrap over games: 500-step singles K +2 bp [−4, +9], the maxima −2
bp [−19, +14], early better, hq mid and doubles late worse). See the
ledger (RE-FIT VERDICT 2026-09-18).
ROUND 48 (2026-09-19): the fitter runs to its maximum now, and the pins
STAY. A capped singles form (1.548 + 6.007·min(ff, 0.35)) wins 4 bp out
of sample on the fit corpus and shows no harm on the bank, but it stamps
a blunder on the expert golden's t23 sack: the verdict tiers and the sack
and prover floors are measured in wp-units, so a new K moves each of
them. No K adoption before those thresholds are decoupled or re-set with
it (ledger K FIT CONVERGED 2026-09-19, NextSteps T52; doubles T53).
ROUND 67 (T52): that converged doubles maximum, 1.987 + 3.666·ff, did not
pass on the bank plus the doubles holdout: the bank gain (fixed K −36 bp)
did not carry to the holdout, and with own K per phase the doubles row read
+5 [−2, +12] with harm in the luck-adjusted rows (+8 [+1, +16]); the pins
stay.
ROUND 74 (T163): every family's K fitted on the search's own root values
(the full fit corpus captured with search in CI; test/regression/fit-families.ts
rootScaleReports, K' = K·c) and measured on the bank and the four holdouts:
standard singles 2.81 + 0.80·ff (+12, unresolved), Doubles OU 2.95 + 1.11·ff
(−1, unresolved), VGC 2.09 + 1.13·ff (own K +12 [+3, +22], harm: the flatter
leaves sort VGC positions worse, although the root reads too confident),
Champions OU 2.05 + 3.22·ff (−12, unresolved, a mid warning), Champions VGC
1.80 + 3.07·ff (−13 [−23, −4] better, but late and mid warnings). None
passed the pre-registered rule, so the pins stay; the bank now guards
against harm and does not chase a gain (AGENTS.md, user 22.10.2026).
Since the win-prob-space conversion, the LEAF sigmoid applies once, at
the search leaf (`wpUnits`): every downstream value — cell averages, the
equilibrium solve, EvalResult.score, regret — lives in wp-units
(2p−1 ∈ [−1, +1]). Averaging wp-units averages probabilities, which is
what makes variance genuinely valuable when behind (Jensen) instead of
being flattened by score-space means.
DISPLAY is a SECOND calibration stage (2026-08-11): averaging plus
equilibrium selection re-inflates the aggregated ROOT score, so the
empirically honest displayed probability is sigmoid(DISPLAY_K · score),
not the linear (score+1)/2. Both stages are measured, not accidental —
see DISPLAY_K below. DIFFERENCES (regret, swings, verdict bands) stay in
wp-units.
```

### packages/eval-engine/src/winprob.ts, CHAMPIONS_WINPROB_K (lines 72-85 at HEAD)

```
Round 67 (T138): Pokémon Champions doubles prices its own scale. Fitted on
its own corpus games in the app's build on the Champions mod with the
round-67 tables, the holdout and unrated ladder games left out (test/regression/
fit-families.ts phaseKReports): 1.86 + 4.17·ff (2,510 positions of 386
sets; K at a third fainted 3.25 [2.83, 3.65]). On the Champions VGC holdout
with search it reads −16 bp [−27, −5] with the base's K (early −40) and
level with own K per phase: the Scarlet/Violet doubles K read the early
Champions game too confidently. Champions singles keeps the singles K: its
fit, 1.64 + 4.41·ff (1,956 positions of 285 sets), read the Champions OU
holdout −28 [−56, +1] with the base's K but its mid game worse in both
tables (+35 [+7, +65], own K +26 [+3, +47]). The thresholds in wp-units
stay where they are (wave 2, decision 33).
```

### packages/eval-engine/src/winprob.ts, VGC_WINPROB_K (lines 91-97 at HEAD)

```
Round 74 (T163): VGC doubles resolves its own entry. It holds the values of Doubles OU (2.98 + 0.88·ff, the one
table both families shared until now), so nothing moves; a fit on the search's own root values sets it without
touching Doubles OU. VGC has no singles game, its singles entry is the standard one. Champions singles likewise
holds the standard singles values in an entry of its own (it referenced them before), so each of the five
families (standard and Champions singles, Doubles OU, VGC, Champions VGC) is fitted and pinned on its own.
```

### packages/eval-engine/src/winprob.ts, DISPLAY_K (lines 126-146 at HEAD)

```
Display calibration for aggregated root scores. Fitted 2026-08-11 on a
1/20 fit-corpus slice (629 joined d1/mcts search-score pairs: d1 1.75 ·
mcts 1.81 · auto-routed 1.87 — insensitive within the range) and graded
OUT-OF-SAMPLE on the 826-position calibration grand bed: brier 0.2275
(linear) → 0.2207, late 0.2180 → 0.1972. Per-mode (+0.0002),
phase-linear (k1 fits negative), and per-gametype (doubles overfits,
0.2167 vs 0.2068) variants all tie or lose OOS — one shared constant is
the honest map.
Round 69 (T51): the constant stays the value for the opening of the game.
From a fainted share of DISPLAY_RAMP_START the K rises by DISPLAY_RAMP per
unit of share over DISPLAY_RAMP_SPAN (1.85 to 3.10 at a share of 0.5):
late positions are proven, not guessed, and the constant showed them too
timid (late 76 % shown, 88 to 91 % won). Probe P1 (displayk-offline.mjs, 4931
rows of the bank and the four holdouts, 1527 games, leave-one-game-out and
both train/grade swaps): pooled -18 bp [-25, -10], late -64 bp, Doubles late
-66 bp, early +0.6 bp (share under 0.25 reads as before), mid +10 bp
(band includes 0). One shared form: a K per game type or for VGC did not
beat it out of sample.
```

## packages/eval-engine/src/types.ts, AUTO_MCTS_FAINTED_FRACTION

```
The auto engine mode's switch point: matrix search below this fainted
fraction, the DUCT tree at or above it (for full 6v6 boards: from the
third faint). Grid-tuned 2026-08-11 on the grand 826-position bed with
per-stratum robustness: the 0.00–0.25 plateau wins overall (+0.7 sign,
−0.002 brier vs the original 0.40) and 0.25 keeps the matrix side — and
with it verification and sensitivity probes —
through the opening while mid (+3.3 ladder) and doubles (+2.5 ladder)
take the tree's stronger reading. Lives here (not search.ts) so the UI
layer can import it without pulling @pkmn/sim into the main chunk.
Round 61 (T98): the auto mode reads its threshold from the search budget
(search/budget.ts), whose default ran the tree from the first turn; this
constant named the threshold before round 61 (bank measurement chains).
Round 63 (T110): it is again the singles default of the budget, where
turns below a quarter fainted run the matrix with three draws; doubles
keep the tree from the first turn.
```

## packages/eval-engine/src/types.ts, PROVER_SCORE_FLOOR

```
Outside the small endgame the prover runs only when the search already
reads the board at this score or beyond (round 35 follow-up): on the
90-position bank no proof stood below 0.6, one of ten between 0.6 and
0.8, and 24 of 50 at 0.8 or more, while 42 of 573756's 51 decided turns
sit below 0.6 and would only pay the probe.
```

## packages/eval-engine/src/verify-select.ts

Original header (lines 5-21 at HEAD). The design is in EVALUATION.md, "The verify round and the answer round".

```
Which root cells the verify step re-prices (moved out of mcts-merge.ts in
round 63). A root cell fixes ONE chance outcome per tree at creation —
every later visit descends through that same child, so visit counts
measure subtree exploration, not independent samples of the cell's own
transition (at most one per tree, ever). A support cell is
chance-suspect when the pool has too few visits, when too few trees
expanded it, or when the trees that did DISAGREE (draft t56: [Ice Beam ×
Draco Meteor] per-tree means −0.38/+0.37/−0.34/−0.37 — one tree rode a
missed 90% Draco Meteor through its whole subtree; disagreement is
visit-weighted since round 33, so a thin outlier beside three deep trees
does not count). Suspect cells get re-priced by the matrix mode's
multi-seed cell sampler before the verdict stands. Round 63 (T78): the
played row and column join the support, and a doubles tree's boundary
cells come from the pair plan in the verify step itself. Pure and
sim-free, like the merge.
```

## packages/eval-engine/src/score/phase-form.ts

Original file header (lines 3-22 at HEAD): the fit evidence of the standard singles form. EVALUATION.md, "Weight tables", states the form.

```
/**
 * Round 69 (S9, T102, decision 17): the model form of the static. A weight
 * that runs with the game is `base + addend x the share of fainted mons`
 * (the fit prices the addend as the column `<feature>@phase`, g x faintedFraction).
 * Standard singles takes the form on bodies and matchup: fitted on the
 * r69-b0 capture (10,350 positions of 1,363 sets, the table at the S8 state,
 * out of fold better than the table in 20 of 20 seeds, log-loss -21 bp, Brier
 * -7 bp, no flagged band): bodies 148.3 [114, 179] + 232.0 [157, 336] x share,
 * matchup 136.8 [44, 233] + 327.3 [121, 608] x share. The model that put the
 * phase on every priced column (coverage, hazards, boostsBiting) read another
 * 3.6 bp better, in 19 of 20 seeds against this one: short of the pre-registered
 * 20, and with more columns, so this one stands.
 *
 * The status fold rides on the form: `statusFix` weighs what `bodies` weighs
 * (the table's statusFix is the weight of bodies, 200; the form's statusFix is
 * the form's bodies), so a body whose ability changes what a status costs is
 * priced at the phase weight of bodies. The other four families keep their
 * tables. The switch gives the table's score back exactly:
 * `EVAL_STATIC_FORM=0` in Node, `setStaticForm(false)` in a test.
 */
```

## packages/eval-engine/src/search/verify-cell.ts

Original header and the blocks of `VERIFY_DEEPEN_COVER`, `VERIFY_LIGHT`, the state rule and the doubles state rule (HEAD lines 9-124). The design is in EVALUATION.md, "The verify round and the answer round"; this text keeps the measurements.

```
/**
 * Round 63 (T16): the verify step prices a cell at one depth. A blend cell
 * (the singles class plan, the doubles pair plan) goes one ply deeper per
 * open class through the class's own first draw and keeps the plan
 * weights; a cell without a plan draws VERIFY_PLAIN_DRAWS natural seeds,
 * groups them by outcome (who fell, who missed, who could not act) and
 * goes one ply deeper per group, mixed by draw share. Before, only the
 * first draw went deeper: the second fixed seed misses in 21 of 22 cells
 * with a miss chance and the first never does (round 62), so the first
 * draw decided notes that 40 fresh draws do not carry, and a plain mean
 * over three fixed seeds weighed a 10 % miss a third. Measured on ten
 * corpus scenes against a Monte-Carlo reference (40 fresh draws, each one
 * ply deeper): 18 of 20 side verdicts agree, against 13 before; splitting
 * classes further or deepening every rare outcome bought no verdict and up
 * to twice the sub-searches (probe docs/perf/probes/2026-10-05-r63/lanes/C).
 *
 * Round 64 (T119): one child still stood for its whole outcome, so what the
 * log does not split decided it. VGC 2629703929 t8: the Sleep Powder hit
 * class went deeper through a sleep counter of 3 (−0.17) while a third of
 * its draws wake next turn (0.96); its mean over 18 fresh draws is 0.21.
 * Now an outcome takes the verify pool's natural draws and goes one ply
 * deeper through one child per state they leave, mixed by that state's
 * share of its draws: the simulator draws the lengths and the chances, an
 * outcome whose draws all leave one state prices as before. Against the
 * Monte-Carlo reference on every corpus turn with a verify step (probe
 * docs/perf/probes/2026-10-06-r64/lanes/C): singles cells outside 2.5
 * standard errors 9 → 2 of 177, side verdicts 72 → 73 of 75; doubles
 * cells 51 → 35 of 218, verdicts 42 of 44 before and after.
 */
/**
 * Outcomes go deeper by descending weight until this share of the cell's
 * open weight is covered; the rarer rest takes its one-ply value shifted by
 * the deepened outcomes' weighted mean step, so no cell mixes depths.
 * Doubles goes deeper through the heaviest outcome only: a doubles
 * sub-search costs about three singles ones (0.25 s against 0.09 s), and
 * the doubles tree-time bound of round 63 (+20 % on twenty bank positions)
 * leaves room for one per verified cell once the played row and the pair
 * plan's boundary cells join the verify set (T78). On the 54 doubles corpus
 * sides the verdicts agree with the Monte-Carlo reference 49 times, against
 * 50 at 90 % and 43 before. Singles keeps 90 %: with the heaviest outcome
 * only, 655336 t26 p2's full-paralysis note comes back (0.12 against the
 * reference's 0.05).
 */
/**
 * Round 69 (T148): how an outcome beyond the cover is priced. 'off' shifts its one-ply leaf by the mean step of the
 * deepened outcomes (singles, and doubles before this round); 'all' prices every open one through a light
 * sub-search, 'states' only those whose draws leave different states (the others shift).
 */
/**
 * The light sub-search: `options` a side by the static hints (a 5 x 5 matrix instead of 16 x 16, a fifth of a full
 * sub-search's time), and outcomes lighter than `minWeight` keep the shift. Against the Monte-Carlo census of 23 doubles
 * turns (probe lanes/D): cells outside 2.5 standard errors 47 to 39 of 215, mean error 0.0628 to 0.0495, at 247 light
 * sub-searches on top of 304 full ones; 8 options and no weight floor read 35, at twice the cost.
 */
/**
 * Round 64 (T119): how an outcome that goes deeper splits its draws.
 * `split`: 'state' reads every state the simulator keeps on a Pokémon (HP
 * apart), 'counter' only the effects that keep a count (a sleep,
 * confusion, trap, lock, Protect or Encore counter, Toxic's stage).
 * `span`: a state whose one-ply leaves span more than this splits into its
 * lower and upper half (0: never). The states go deeper by descending share
 * until `cover` of the outcome's draws is covered, at most `cap` of them;
 * the rest shift by the deepened states' mean step. `pool`: the natural
 * draws a class or a one-draw cell takes for it.
 */
/**
 * Doubles reads only the counts: every other split, the leaf span and a
 * 16-draw pool cost doubles 251 sub-searches against 176 before on the
 * twenty timing positions (the bound is +10 % tree time); the counts cost
 * 186. On the doubles corpus cells the full split reads 0.053 off the
 * reference, the counts 0.058, the old step 0.083, with the same verdicts.
 */
```

## packages/replay-core/src/inference/client-facts.ts

Original file header, with the census numbers of that round. The list of what the inference keeps is in ARCHITECTURE.md, "Replay to teams", "Facts from the client". The moved copy of the pass ended in the middle of the last sentence, so the text below comes from the commit before the cut (ecf19da5~1).

```
/**
 * Facts the inference reads from its own @pkmn/client walk (round 67, T108
 * step 2, spec decision 19). After each line the client's state gives every
 * Pokémon of the inferred side its ability and its item, where the inference
 * has none yet: this replaces the handlers for -ability lines, consumed
 * items, healing items, Mega Stones and the holder's own recoil items, and it
 * adds what no handler read, as the census of client against inference found
 * it (1692 team members of the bank and feedback games, 544 deviations in
 * 133 games): an ability a line names as its effect (230: `|-activate|p2a: X|
 * ability: Quark Drive`, a Queenly Majesty block, a Magic Bounce reflection)
 * and an item a line names on the holder's side (31: `[from] item: Toxic Orb`
 * on a status line, the item Poltergeist names). A move line books its move
 * by the client's rule (7: a Magic Bounce reflection, a move while
 * transformed and Struggle are no moves of the set; a move another move
 * called books the caller).
 * The inference keeps its own handlers where the census found the client
 * wrong or blind (R8): the team list and the preview's markers (the client
 * keeps preview entries it never matched; 15 item markers), the set item
 * before a swap (17, the client shows the item held now), the Tera type after
 * a faint (139, the client clears it), Natural Cure and Grassy Surge
 * attributions (2, the client misses them), the holder of Rocky Helmet,
 * Jaboca and Rowap Berry without [of], and a move's booking by nickname (3,
 * where the client's positions go astray). Ogerpon's Embody Aspect (2) stays
 * off the set because the Dex keeps a Tera forme's ability off its species;
 * the moves a `cant` line names (9) are booked from the line itself (T175).
 */
```

