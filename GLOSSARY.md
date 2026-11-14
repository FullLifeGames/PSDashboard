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
The dice of a replay turn as its log shows them, among them each hit of a multi-accuracy chain, the random target and the drag. The reconstruction forces them, so a rebuilt turn shows what the log shows.
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

**Hit count**:
The die that sets how many times a multi-hit move hits, such as Bullet Seed's 2 to 5. A move whose every hit rolls its own accuracy (Triple Axel, Triple Kick, Population Bomb) has one accuracy die per later hit instead, and the dice panel folds them into one "Hits" row of counts under the move's "Hit" row. A count the game cut short reads "(5 landed)", and the log line says "Forced 10 hits, 5 landed". An ability or item that fixes the count shows one row without a choice, such as "Hits: 5 (Skill Link)".

**Random target**:
The die that picks a foe for a move with no chosen target: a spread move clicked in doubles, a move that hits a random foe, or a click that an Encore bent onto another target. It names no chip in the dice panel.

**Drag**:
The die that picks which bench body Roar, Whirlwind, Dragon Tail, Circle Throw or a Red Card pulls in. One drag die belongs to the slot dragged out. It names no chip in the dice panel.

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
The seed of one tree expansion's dice below the root, hashed from the tree's number and the iteration, so the dice come true at the Dex chance.

**Root quantile**:
The answer a tree gives to each named die of a root cell. Tree k of T takes the quarter `(pi_d(k) + u_d) / T` of the die's range: `pi_d` is the die's own order of the quarters and `u_d` a hash that places the die inside its quarter. A die with chance p comes true in floor(T p) or ceil(T p) of the trees, a die of a quarter or more is never missed by all four, and two dice are independent across the trees (`search/root-quantile.ts`).

**Cell seed**:
The seed that a cell of the matrix, the verify round, the pair search or the trend probe reads at one slot of its list. It is hashed from the cell's key (the position and the two choices) and the slot (`cellSeed` in `search/leaf.ts`), so two cells never share one dice stream, and the paths that read one cell share its list.

**Rolled copy**:
A copy of a logged turn that plays with one die turned over, a miss turned into a hit (`rolledCopy` in the code). The report uses it to price the die behind its "biggest roll" sentence. The headword follows the code; the report's sentence keeps "roll" for this die.

**Biggest roll**:
The die with the largest chance against the eventual winner: a miss of the winner's sure kill, in singles or as a named click in doubles (`BiggestRoll` in `biggest-roll.ts`, built by `biggestRollFor`). The headword follows the code; the report's sentence keeps "roll" for this die. The report's own sentence calls it "The game's biggest roll" and gives the winner's chance after a hit and after the miss.
_Avoid_: roll (outside "damage roll" and the report's quoted sentence)

### Teams

**Body**:
One Pokémon of a side as the battle holds it, on the field or on the bench.

**Bench**:
The bodies a side can switch to. In a bring-limited game the What-if bench, the stored positions and the snapshot pickers offer the bodies a side brought: a side that fielded its whole selection offers those bodies, and a short side offers its fielded bodies plus the guess of the likeliest set (`src/lib/bench.ts`). The engine and the play-out choose from the same bodies: the rebuild trims both teams to the bring count, or neither (ADR 0024).

**Stand-in**:
A body the log never showed, filled in for a side that never showed its whole team in a game without Team Preview (Gen 1 to 4). It comes from the format's teammate statistics and carries the flag `standIn` (`team/stand-ins.ts` in replay-core); the app marks it "Not revealed (guessed from teammate usage)" with the badge "guessed". In a Random Battle (any generation) it comes from the format's random-set data instead, and the mark reads "Not revealed (guessed from random-set data)".
_Avoid_: placeholder

**Stand-in move**:
The move the reconstruction gives a body that never acts in a logged turn: its slowest move at priority 0 or below, so the turn keeps the log's order (`slowestRequestMove`), or, for a body whose cant line stands before a logged action, the move that keeps its place in the turn (`cantStandIn`).

**Short side**:
In a bring-limited game (VGC, Champions VGC, Battle Stadium Singles), a side whose log shows fewer bodies than the game's bring count, because the game ended before its last brought body entered. The engine plays the fielded bodies and one guess for each missing body, taken from the team preview and the format's usage statistics. It searches each set of guesses (the code calls one a world; at most three, the likeliest by usage) and blends the values by usage. The app marks the guess "Not fielded (guessed from usage)" and plays the likeliest set in the What-if, Let it play out and the stored positions (`bring-worlds.ts` in eval-engine).

### Lines and games

**Main line**:
The turns of the replay, or the turns played in a game. The pointer sits on the main line or on the variation.

**Variation**:
The one line the user plays from a turn of the main line, by a different choice, by a click on a line, or by Let it play out. At most one exists (ADR 0015).

**Line**:
The turns the engine expects after a choice, for the choices that the search rated: both players' choices for at most three turns, every die at its likeliest result, and the win chance for the player at the line's end (`EvalLine` in the code). A tree search keeps a line only where a node holds 8 visits, so a line ends early where the search stopped there, and it says so when the next step is a switch nobody chose. A row's percentage averages many outcomes of its dice; a line follows one of them. The user sees a line in the Lines section under the turn's analysis and in the Game review. ▶ Play turns the line into a variation with those dice forced (the button's tooltip lists them); a chip shows a die only where the other result was possible.
_Avoid_: principal variation, PV (code names such as `PV_MAX_STEPS` keep them)

**Engine line**:
A line that starts with the engine's best choice for a player, the opponent answering with the reply that the search rated best. The Lines section shows it before the played line.

**Played line**:
A line that starts with the choice the player made. A player who played the engine's choice gets one line.

**Game review**:
The panel under the game report that lists, per player, the graded turns (inaccuracy, mistake or blunder) with the played value, the engine's value, the loss, and the engine line and the played line with a ▶ Play button each. The graph marks the same turns, a circle for player 1 and a square for player 2.

**New game**:
A game that starts in the app from two pasted teams and a format (a listed format or a Custom Game), not from a Showdown replay. The `Game` menu opens its dialog. Both sides know both teams in full, as with open team sheets, and the user plays both sides or lets the engine play; the turns played become the game's main line, graded, reported and branched like a replay's.

**Game record**:
What a new game consists of (`NewGameRecord` in `src/lib/new-game/record.ts`): the format, both teams as the format's battle reads them, the player names, the seed, the header the format's battle wrote and every turn played, with the log lines of each finished turn. The app builds the game's replay data from the record's log, so every reader of a replay works on a game unchanged.

**Saved game**:
A game record in the browser's storage (`ps-replay-interceptor:game:<id>`). The game saves at Start and after every finished turn. The `Game` menu and the start page list the saved games, the three newest first with "Show all", with Open and Delete; the open game has no Delete. The 21st saved game first pushes out games without a played turn, then the oldest, and a notice names the game that went.

**Game seed**:
The seed of the dice of a new game's simulator. Start draws a fresh one and shows it in the dialog, where "New seed" draws another and a typed or pasted seed is checked (four numbers or a sodium seed; an empty field means a fresh seed). The same seed, teams and choices roll the same dice. A variation of a game plays the game's own dice up to the change and what the seed gives after it. Saved rows and share links show the seed.

**Share link**:
A URL with the sharer's branch in its hash. Version 1 holds a replay's branch (the replay id, the executed choices and the final log). Version 2 holds a game: the format, both teams, the seed, the played choices, the open variation and the turn on screen, and the reader plays it on its own simulator (ADR 0014). Opening a link of the open game opens its branch in that game; any other game link opens a copy.

**State file**:
The JSON file that `Report issue` downloads: the replay log, the sets, the variation and its choices, the position on screen and the engine settings, enough to replay a report. For a new game it also holds the game record.
