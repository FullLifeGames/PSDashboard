# PS Dashboard

PS Dashboard replays Pokémon Showdown games turn by turn and grades the moves with its own engine. The user can branch at any turn and play on with their own choices.

## Language

### Dice

**Die** (plural **dice**):
One random draw of the simulator: an accuracy check, a critical hit, a damage roll, a secondary effect, a status check such as full paralysis, or a speed tie.
_Avoid_: roll (outside "damage roll"), RNG call

**Damage roll**:
The die that sets a hit's damage to one step between 85 and 100 percent: 16 steps from Gen 3 on, 39 in Gens 1 and 2.
_Avoid_: roll

**Logged dice**:
The dice of a replay turn as its log shows them. The reconstruction forces them, so a rebuilt turn shows what the log shows.
_Avoid_: logged rolls

**Hidden dice**:
The dice a replay's log does not show, such as damage rolls and sleep turns. The reconstruction draws them from a frozen seed (index 0 of the list, another seed of the list on a seeded turn).

**Forced die**:
A die whose result comes from outside the simulator's draw: the user sets it in a branch turn, or the reconstruction takes it from the log (logged dice). The simulator decides whether that result can take effect.
_Avoid_: forced hax, forced outcome

**Hax**:
The players' word for a die that decided something, such as a critical hit or a miss.

**End-of-turn die**:
A die that an ability or item draws at the end of the turn, such as Shed Skin's cure or Harvest's berry.

**Duration die**:
A die that sets how many turns a condition lasts when it starts, such as the turns of sleep or of Outrage's lock.
_Avoid_: duration roll

**Random pick**:
A die that chooses one option out of several, such as the move Metronome calls or the status Tri Attack inflicts.

**Faint step**:
The reconstruction's search over the damage-roll steps of the hits on a body whose faint differs from the log's. It plays the turn on copies, keeps a set that reproduces the log, and otherwise the first set that gives the log's faints without an ended mismatch or more soft mismatches than the natural turn.

**Phantom proc**:
An ability or item proc that the forced turn draws and the log does not show, such as a Flame Body burn. The reconstruction forces it not to happen.

**Seeded turn**:
A rebuilt turn that plays its hidden dice under a seed other than the first because that seed fits the log better. The drift line counts them as "seeded N".

**Fallback turn**:
A rebuilt turn that the simulator cannot play with the log's dice, or that would end a game the log goes on past, so the search over sixteen seeds plays it. The drift line counts them as "fallback N".

**Outcome class**:
One result of a cell that the search prices as a whole: a hit without a knock-out, a miss, a knock-out, or a hit with a secondary effect (`hit-nokill+brn`). The weights come from the Dex chances.

**Tree seed**:
The seed of one tree expansion's dice, hashed from the tree's number and the iteration, so the dice come true at the Dex chance.

**Rolled copy**:
A copy of a logged turn that plays with one die turned over, a miss turned into a hit (`rolledCopy` in the code). The report uses it to price the die behind its "biggest roll" sentence. The headword follows the code; the report's sentence keeps "roll" for this die.

**Biggest roll**:
The die with the largest chance against the eventual winner: a miss of the winner's sure kill, in singles or as a named click in doubles (`BiggestRoll` in `biggest-roll.ts`, built by `biggestRollFor`). The headword follows the code; the report's sentence keeps "roll" for this die. The report's own sentence calls it "The game's biggest roll" and gives the winner's chance after a hit and after the miss.
_Avoid_: roll (outside "damage roll" and the report's quoted sentence)

### Teams

**Body**:
One Pokémon of a side as the battle holds it, on the field or on the bench.

**Bench**:
The bodies a side can switch to. In a bring-limited game the What-if bench, the stored positions and the snapshot pickers offer only the bodies a side brought once that side fielded its whole selection; a side that did not stays whole (`src/lib/bench.ts`). The engine and the play-out choose from every body the rebuild holds: four per side when both sides fielded their whole selection, otherwise six.

**Stand-in**:
A body the log never showed, filled in for a side that never showed its whole team in a game without Team Preview (Gen 1 to 4). It comes from the format's teammate statistics and carries the flag `standIn` (`team/stand-ins.ts` in replay-core); the app marks it "Not revealed (guessed from teammate usage)" with the badge "guessed". In a Random Battle (any generation) it comes from the format's random-set data instead, and the mark reads "Not revealed (guessed from random-set data)".
_Avoid_: placeholder

**Stand-in move**:
The move the reconstruction gives a body that never acts in a logged turn: its slowest move at priority 0 or below, so the turn keeps the log's order (`slowestRequestMove`), or, for a body whose cant line stands before a logged action, the move that keeps its place in the turn (`cantStandIn`).
