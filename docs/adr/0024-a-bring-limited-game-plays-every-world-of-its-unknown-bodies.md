---
Status: accepted (round 89, #124; approved (user, 09.11.2026)). Supersedes ADR 0010.
---

# A bring-limited game plays every world of its unknown bodies and blends them by usage

In VGC, Champions VGC and Battle Stadium Singles each player brings a part of the team (four, or three). The replay log shows only the Pokémon that reached the field (the engine calls them bodies). A player who wins before the last brought body enters leaves that body unknown, and the side is short. ADR 0010 kept both teams whole in such a game: the engine searched six against six and weighed bodies that neither player had brought, and round 88 filtered only the bench. Round 89 first reads the brought bodies from the log's `switch`, `drag` and `replace` lines (`broughtSpeciesFor`), which finds the bodies that entered and fainted within one turn. After that, 550 corpus games still have a short side: 323 of 2,610 in Scarlet/Violet VGC, 67 of 523 in Champions VGC best of one and 160 of 900 in best of three.

## Decision

1. The rebuild trims both teams to the brought count. A side that fielded its whole selection plays those bodies. A short side plays its fielded bodies plus one guess for each missing body, taken from its team preview.
2. Each set of guesses is a world. The engine rebuilds and searches every world in full under perfect information (ADR 0013). The turn's score, each choice's value and the played pair's value are the mean over the worlds, weighted by the guesses' usage share in the format's statistics, and equal where the statistics lack a guess. The engine keeps the three heaviest worlds (`BRING_WORLD_CAP`) and renormalizes their weights.
3. The trim stays both or neither. When one side's list does not resolve, both teams stay whole, so no evaluation pits a pinned four against an open six.
4. The user plays the heaviest world. The What-if, Let it play out and the stored positions run on it, its guess carries the stand-in mark with its own wording, and the guess takes the last party slot, so a choice names the same body in every world.

## Measurement

The gate of round 21 (A.3c) ran again on three games, with the bank's own build and search, at every bank turn. Player 1 won all three and is the short side in both gate scenes. Scores from the winner's side:

| game | reading (weight, the guessed fourth body) | scores | sign right |
| --- | --- | --- | --- |
| 2630452654 (control, both sides full) | 4 v 4 | t2 +0.437, t4 +0.465, t6 +0.600, t8 +0.345 | 4 of 4 |
| | 6 v 6 | +0.370, +0.338, +0.469, +0.217 | 4 of 4 |
| 2630181744 (Scarlet/Violet VGC) | world 1 (0.596, Incineroar) | t2 -0.098, t3 +0.784, t4 +0.847, t5 +0.848, t6 +0.847, t7 +0.962 | 5 of 6 |
| | world 2 (0.280, Amoonguss) | +0.159, +0.766, +0.815, +0.823, +0.838, +0.953 | 6 of 6 |
| | world 3 (0.124, Grimmsnarl) | +0.007, +0.777, +0.812, +0.831, +0.830, +0.955 | 6 of 6 |
| | blend | -0.013, +0.778, +0.834, +0.839, +0.842, +0.959 | 5 of 6 |
| | 6 v 6 | +0.056, +0.579, +0.707, +0.602, +0.613, +0.970 | 6 of 6 |
| 2625939941 (Champions VGC) | world 1 (0.723, Kingambit) | t2 +0.061, t3 -0.077, t4 +0.078, t5 +0.564, t6 +0.844 | 4 of 5 |
| | world 2 (0.184, Ninetales-Alola) | -0.097, -0.107, -0.199, +0.510, +0.850 | 2 of 5 |
| | world 3 (0.093, Ceruledge) | +0.026, +0.073, -0.075, +0.610, +0.861 | 4 of 5 |
| | blend | +0.029, -0.068, +0.013, +0.558, +0.847 | 4 of 5 |
| | 6 v 6 | -0.109, -0.040, -0.128, +0.325, +0.634 | 2 of 5 |

The gate reads: over the two short-side scenes the blend reads no fewer turns right than six against six, and no blend turn that reads 0.1 or more from zero carries the loser's sign. The blend reads 9 of 11 turns right and six against six reads 8 of 11. The blend's two wrong turns read -0.013 and -0.068.

ADR 0010 recorded that game 2630452654 flipped from 4 of 4 to 0 of 4 when round 21 trimmed each side on its own. That reading counted Player 2 as short: Farigiraf entered in turn 2 and fainted six lines later, and no turn snapshot showed it. By the log both sides fielded four, so the game is full today and reads 4 of 4 trimmed and 4 of 4 whole. The flip of round 21 came from a pinned four against an open six, the pairing that rule 3 keeps out.

The bank and the four holdouts read the step against the commit before it and against the round's base in 30 paired runs (full and hq, fixed K and own K): no pooled row reads harm and no phase cell warns. Against the commit before it, the pooled doubles row (bank, Doubles OU holdout and VGC holdout, 6,144 positions) reads -18 bp [-25, -10], the VGC holdout -27 bp [-38, -16] and the Champions VGC holdout -15 bp [-40, +9]; the singles, Doubles OU and Champions OU rows are digit-identical. The bank guards against harm and proves no gain (ADR 0006), so these rows clear the rule and the game's rules carry it. 388 games move: 131 that the log reads full (six against six before, four against four now) and 257 that stay short (six against six before, the blend now).

Three worlds cost time in the families that have short sides. The VGC holdout took 57.2 minutes in CI before the step and 66.4 with it (+16 %). On the short set before the log reading (843 games) the search time of a family grew by 35 % in Scarlet/Violet VGC, 40 % in Champions VGC best of one and 42 % in best of three; 550 of those games stay short.

## Considered options

- Six against six (ADR 0010): reads 8 of 11 turns right on the two scenes and weighs bodies neither player brought.
- Trim each side on its own without a guess (round 21): a pinned four against an open six overrates the open side. Rule 3 keeps it out.
- The heaviest world alone: reads the same 9 of 11 on the two scenes at a third of the cost, and stakes the score on one guess whose usage share is 0.60 and 0.72 there. Where the worlds disagree (2625939941 turn 4: +0.078, -0.199, -0.075) the blend says so and one world does not.
- Every world without a cap: +51 %, +53 % and +66 % in the three families, and single turns get out of hand: 17 corpus games reach 18 or 36 worlds, 80 reach nine or more. The user preferred every world if its cost were acceptable; the totals passed and single turns did not, so the cap of three stood (ruling of 09.11.2026). A cap of nine worlds, exact while each side misses at most one body with three candidates, would cost +47 %, +51 % and +60 %; it stays an alternative.
- A third of the search budget per world, or a search for the heaviest world and the static evaluation for the others: the cost stays flat, and a short-side turn rests on a shallower search than every other turn of the game.
- A chance step inside the tree for the unknown body (option (c) of ADR 0010): the worlds give the same weighting outside the tree, and each search keeps perfect information and its current form.

## Consequences

`replayBringList` (replay-core, `replay-format.ts`) returns each side's fielded bodies and its weighted candidates; `replayBringOnly` keeps its meaning for a game with two full sides. `bringWorlds`, `blendWorlds` and `blendValues` live in eval-engine (`branch/bring-worlds.ts`), and `trimTeamsToBring` (`branch/team-order.ts`) holds "both or neither". The bank builds and blends the worlds through `bankWorldsFor` and `blendReadings` (`test/regression/bank-build.ts`). In the app, `registerWorldPositions` and `worldPositionsOf` (`src/lib/eval/world-positions.ts`) hold the serialized positions of a short-side game's worlds; `EvalWorkerClient.evaluate` (`src/lib/eval/worker-client.ts`) runs a registered position once per world, the heaviest first, and returns the blend, while another engine over HTTP reads the heaviest world alone. The What-if bench, the stored positions and the play-out run on the heaviest world, and its guessed body carries the stand-in badge with the wording of `bringGuessTitle` (`src/lib/stand-in-mark.ts`). A game with two full sides or no bring limit has one world and reads as before, digit for digit.

Specs: `packages/replay-core/test/bring-short-lived.spec.ts` (a body that enters and faints within one turn, per line kind, singles and doubles), `packages/eval-engine/test/bring-limit.spec.ts`, `bring-worlds.spec.ts`, `bring-worlds-blend.spec.ts`, `bring-worlds-scenes.spec.ts` and `bring-worlds-corpus.spec.ts`, and `test/regression/bank-worlds.spec.ts`. The app's specs are `test/ui/hooks/controller/replay-context.spec.tsx`, `test/regression/bench-sweep.spec.ts` and the browser row `test/e2e/bench-bring.spec.ts`.

The real four also show what the two extra bodies had hidden. In Champions VGC game 2694505370 turn 10 the old reading gave +0.632 to the later winner; with the brought bodies the forced-win prover claims the game for the loser, because it reads a repeated Protect as a sure failure. That fault is the prover's and has its own proposal. It is issue #145.

Two rests stay. An Illusion that holds across a turn boundary lists the disguise as the brought body (with #141, milestone 1.3.0). In game 2562593479 the rebuilt Ditto faints one turn early, so the trimmed game ends before its last sampled turn; the whole teams had hidden that divergence behind two bodies the player never brought.

Sources: ADR 0010 and its sources; issue #124; round 89's lane B ledger (the corpus counts, the cost table, the A.3c probe of 09.11.2026); approved (user, 09.11.2026).
