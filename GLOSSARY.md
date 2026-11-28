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

**Opponent reads my move**:
A checkbox in the Setup menu, under "Animate branch turns" (`EvalPreferences.hardMode`). A visible note under the box says what it does. With it on, the opponent answers the move in hand with the reply the search rates lowest for it (the worst reply) instead of its own best row. It acts in three places: a click on an engine move (the title names the reply), the turn dock once one side's slots are set by the user, and the Lines section (a line at the top says each line meets that reply, and each line is the one against it). While it is on, the turn dock's status row starts with "Opponent reads your move", ends, in a variation, with where the read stands ("its reply follows your pick", "its engine slots answer your pick", "no ranked reply to this pick, so its slots keep the engine's choice" or "both sides hold your picks") and carries a "Turn off" button. Row tails and the Game review read the usual line. The setting changes no grade, score or report. Release 1.2.0 ships it switched off, behind `VITE_FEATURE_OPPONENT_READS` (`src/lib/feature-flags.ts`, off in every build); with the flag off the checkbox, the note and the setting are gone, and a `hardMode` stored by an earlier nightly is ignored. It returns in 1.2.1.

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
The die that picks a foe for a move with no chosen target: a spread move clicked in doubles, a move that hits a random foe, or a click that an Encore bent onto another target. It names no chip in the dice panel. A line says "the seed decides the random target" only where the sample can change the turn (more than one foe stands and the move aims at one body); a spread or field move ignores the sample. The check reads the move after its own handlers changed its target: Tera Starstorm of Terapagos-Stellar and Expanding Force on Psychic Terrain become spread moves, and a Curse of a body that is not a Ghost aims at the user, so no line names the target for them.

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
The seed that a cell of the matrix, the verify round, the pair search or the trend probe reads at one slot of its list. The engine hashes it from the cell's key (the position and the two choices) and the slot (`cellSeed` in `search/leaf.ts`), so two cells never share one dice stream, and the paths that read one cell share its list.

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
In a bring-limited game (VGC, Champions VGC, Battle Stadium Singles), a side whose log shows fewer bodies than the game's bring count, because the game ended before its last brought body entered. The engine plays the fielded bodies and one guess for each missing body, taken from the team preview and the format's usage statistics. It searches each set of guesses (the code calls one a world; at most three, the likeliest by usage) and blends the values by usage. The app marks the guess "Not fielded (guessed from usage)" and plays the likeliest set in the What-if, Let it play out and the stored positions (`packages/eval-engine/src/branch/bring-worlds.ts`).

### Lines and games

**Main line**:
The turns of the replay, or the turns played in a game. The pointer sits on the main line or on the variation.

**Variation**:
The one line the user plays from a turn of the main line, by a different choice, by a click on a line, or by Let it play out. At most one exists (ADR 0015). The top bar names the variation's last position its **tip** ("Variation tip: Turn 33"), whichever turn the slider shows; a game's main line has a tip too, its last played position. `Discard variation` asks first once the variation holds a played turn.

**Replacement**:
The switch-in the simulator asks for in the middle of a turn: after a knockout, or after a pivot move such as U-turn, Flip Turn or Eject Button. The history list and a shared branch print it as its own row, "replacement (P1)", "replacement (P2)" or "replacement (both sides)", and it takes no turn of its own. The row's word is neutral because the sim does not say whether a knockout or a pivot move asked for it. While it is open, the evaluation card reads "Replacement after turn N" with the number the replay frame shows; the timeline and the card of the turn that follows count the position, "Turn N+1".
The engine picks one by the turn that follows it: under the matrix each switch-in's board gets the engine's own search of that turn, and the best value wins; the tree plays the next turn inside its forced node. Inside a turn the matrix takes the static pick, and a line names it as its own step under the matrix as under the tree.
_Avoid_: forced replacement (in the lists; the code's `forced` entry kind keeps its name)

**Line**:
The turns the engine expects after a choice, for the choices that the search rated: both players' choices for at most three turns (the line of a proof, in the win paths, runs for the proof's turns), every die at its likeliest result, and the win chance for the player at the line's end (`EvalLine` in the code). A tree search keeps a line only where a node holds 4 visits, and each turn after the first follows the pair of options that rate best for their side among those the search visited enough, not the cell it visited most. A line ends early where the search stopped there (after the game report the app adds the line pass, extra iterations aimed at the rows a line shows, for every graded turn), and it says so when it stops before a replacement, which it does not play. Each side's best ranked row shows its line after "then ...", and a step where the game left a side one choice says "(only choice)". A row's percentage averages many outcomes of its dice; a line follows one of them, so the Lines section shows both ("row 23%, this line ends at 19%") and says why they differ. The user sees a line in the Lines section under the turn's analysis (closed until its `Lines` toggle opens it) and, once the Game review returns in 1.2.1, in the Game review. A graded turn gets its lines from one more tree search after the game report: an early singles turn, which the matrix scores and which keeps no line, and every tree turn, whose lines from the sweep stand on thin second turns; the review shows the progress. ▶ Play turns the line into a variation with those dice forced (the button's tooltip lists them); a chip shows a die only where the other result was possible.
_Avoid_: principal variation, PV (code names such as `PV_MAX_STEPS` keep them)

**Engine line**:
A line that starts with the engine's best choice for a player, the opponent answering with a reply that the search ranked; the line's head names the reply and its rank ("vs Draining Kiss (Tzon's top choice)"), and the best reply means the best one overall by the merged ranking. The Lines section shows it before the played line.

**Played line**:
A line that starts with the choice the player made. A player who played the engine's choice gets one line.

**Graded turn**:
A turn on which a side's card prints an inaccuracy, a mistake or a blunder. A side without a played row or an engine row has no grade, and a mistake or blunder that the card replaces by a sacrifice or a read that paid off is not graded. An inaccuracy with a read that paid off is graded only when the side lost ground on the turn. A turn without a tracked played choice is skipped for both sides. The Game review lists graded turns, the graph marks them, and the early lines stage searches them. A grade's size reads as the difference of the two chances on the card.

**Game review**:
The fold under the game report and under each turn's card, closed at first and kept open or closed while the game stays loaded, that lists, per player, the graded turns (inaccuracy, mistake or blunder) with the played value, the engine's value, the loss, and the engine line and the played line with a ▶ Play button each. The graph marks the same turns, a circle for player 1 and a square for player 2, with a line under the graph that names each shape. The row of the shown turn is marked, and a click on a row's turn shows that turn's card above the review. A game that reached its endgame adds an Endgame row for the player who lost. Release 1.2.0 ships it switched off, behind `VITE_FEATURE_GAME_REVIEW` (`src/lib/feature-flags.ts`, off in every build); with the flag off the section, the marks and the line that names them are not drawn. It returns in 1.2.1.

**Endgame**:
A position with at most three Pokémon standing in total, both sides together (`ENDGAME_MAX_BODIES` in the code). A side counts the bodies it brought, so a VGC player who brought four and lost one has three. The forced-win prover runs there, and the Game review's Endgame row opens at the first turn of the game that has this few left. The turn card offers the loser's question on the endgame turns and on every turn 0.3 or more behind; the row and its picker keep the endgame turns.

**Delay (repeated stall)**:
A foe's repeated Protect, Detect or Endure that holds and leaves the board as it was, so the position after the hold is the position before it with a weaker stall. The forced-win prover does not follow such a hold as a new position: it prices the cell by what happens when the repeat fails (the hold's chance falls with each repeat and the move's PP ends the chain) and records the stalling move in the proof (`delay`, with its Dex name in `delayName`). The turn card, and the Game review once it returns in 1.2.1, then end the forced-win sentence with "a repeated Protect only delays it" ("only delayed it" in the review). A hold that heals the foe, hurts the attacker, lets the foe's partner hit or changes a stage is no delay.

**Sure strike**:
A move that knocks out the foe's last standing body in every roll and moves before every damaging move the foe can click, so the game ends before the foe acts. The forced-win prover tries it first, at the root and at inner nodes; the one reply that can stop it is a stalling move, which the proof reads as a reply of its own (a repeat that changes nothing is a delay). When a proof stands on a strike that the engine's own list does not hold, it names the choice (`choice`); the card says which move strikes first and which move stands beside it (`choiceNames`).

**Win path**:
A way the player who lost could have won, found from a turn of the endgame or a turn where that player stands 0.3 or more behind on the engine's score, by a search that the user starts (the closed `How could <player> have won from here?` toggle on the turn's card, or, once the Game review returns in 1.2.1, its Endgame row, which keeps the endgame turns). It has three steps, named in the panel: `1 · A stronger play` (a choice that wins within three turns in a share of the dice whatever the opponent answers), `2 · Luck` (the likeliest dice that give the player the win, with the chance of that sequence) and `3 · A mistake by <opponent>` (the smallest slip by the opponent that hands the player the win, with the chance of the dice it needs). Each step shows its line with ▶ Play. Every number is a lower bound: it holds within three turns and within the search limit, so a path the search did not reach may add to it. A turn with a forced win also has a `How does <player> win from here?` toggle: one step, "The proof's line", the proof's choices under the likeliest dice with which they win, over the proof's own number of turns.

**New game**:
A game that starts in the app from two pasted teams and a format (a listed format or a Custom Game), not from a Showdown replay. The `Game` menu opens its dialog. Both sides know both teams in full, as with open team sheets, and the user plays both sides or lets the engine play; the turns played become the game's main line, graded, reported and branched like a replay's. The dialog checks both teams against the format with the simulator (the `Validate` button runs the check again) and lists each problem; the list informs and never stops Start. Three things do stop Start, each shown under the box that causes it: a side with no readable set, a side with more than six sets, and a species the format's Dex does not know (plus a seed the engine refuses, under the seed field). Start gives a set without an ability the first ability of the species that the format allows (Generation 3 and later; where the format bans slot 0, as Evasion Abilities Clause does for Sand Veil, the next slot), and the check says so ("has no ability: plays <ability>"). Start asks first while an open variation is not saved. A team edit of a running game that makes played turns invalid asks first too: the question names the turns that fall away, the turns the game keeps and whether the open variation goes.

**Game record**:
What a new game consists of (`NewGameRecord` in `src/lib/new-game/record.ts`): the format, both teams as the format's battle reads them, the player names, the seed, the header the format's battle wrote and every turn played, with the log lines of each finished turn. The app builds the game's replay data from the record's log, so every reader of a replay works on a game unchanged.

**Saved game**:
A game record in the browser's storage (`ps-replay-interceptor:game:<id>`). The game saves at Start and after every finished turn. Loading a replay or opening a saved game asks first while an open variation is not saved (`Discard variation`); a reload or the browser's back button drops such a variation without a question. The `Game` menu and the start page list the saved games, the three newest first with "Show all", with Open and Delete; the open game has no Delete. The 21st saved game first pushes out games without a played turn, then the oldest, and a notice names the game that went.

**Game seed**:
The seed of the dice of a new game's simulator. Start draws a fresh one and shows it in the dialog, where "New seed" draws another and a typed or pasted seed is checked (four numbers or a sodium seed; an empty field means a fresh seed). The same seed, teams and choices roll the same dice. A variation of a game plays the game's own dice up to the change and what the seed gives after it. Saved rows and share links show the seed.

**Turn link**:
The address `?replay=<id>&turn=<n>`, which opens a replay on turn `n`. A `#branch=` share link or a saved game named in the same address takes precedence and brings its own turn.

**Share link**:
A URL with the sharer's branch in its hash. Version 1 holds a replay's branch (the replay id, the executed choices and the final log). Version 2 holds a game: the format, both teams, the seed, the played choices, the open variation and the turn on screen, and the reader plays it on its own simulator (ADR 0014). Opening a link of the open game opens its branch in that game; any other game link opens a copy.

**State file**:
The JSON file that `Report issue` downloads: the replay log, the sets, the variation and its choices, the position on screen and the engine settings, enough to replay a report. For a new game it also holds the game record.

**Depth**:
The search mode the user picks in the `Setup` menu (`EvalPreferences.mode` and `depth`): 1 or 2 (the joint matrix), MCTS (the tree) or Auto, the default, which chooses per turn from the game type and the fainted share. Under a matrix depth the menu also shows `Samples`, the damage-roll seeds averaged per cell. The Evaluation panel's header does not carry either (release 1.2.0). Another engine decides its own depth, so the menu hides both then.

### Turn verdicts

**Safe line**:
The choice with the best worst case on a turn (`side.safe`). The card calls its worst case the guarantee and compares the played choice with it; "safe" does not mean "better". The worst case is the lowest cell of the choice's row in the matrix dialog; in doubles it can sit below the table, when the floor names an added answer that the dialog says it does not list.

**Worst reply**:
The opponent's reply that hurts a move most: the lowest value of the move's row among the cells the search trusts (`worstAnswer` in the engine, `worstReply` in `src/lib/worst-reply.ts`), with the row's own floor and then the opponent's best row as fallbacks. "Opponent reads my move" plays it (while the flag of that setting is off, as in 1.2.0, nothing does), and the matrix dialog marks it as the "worst" cell of the played choice. With the setting on, the "worst vs" beside a clickable choice names the reply the click plays; where that differs from the row's lowest cell, its title says why (a thinly searched cell, or no ranked reply for the lowest cell, so the opponent's best row answers). The played row and "risked ... vs" keep the row's lowest cell.

**Read that paid off**:
A risk whose punisher the opponent did not click, whose payoff over the safe line's guarantee cleared the margin, and whose played choice also beat the safe choice by at least one shown point against the reply that came (`riskPaidOff`, `safeAgainstClick` on `SideAnalysis`). The card ends it "…came instead, and against it the play beat the safe line by +N%."
_Avoid_: good guess, lucky read

**Risk that went unpunished**:
A risk that cleared the same payoff margin but whose played choice did not beat the safe choice by one shown point against the reply that came. The card says "a risk that went unpunished" and the gap to the safe line; the side earns no read credit (`safeAgainstClick` without `riskPaidOff`). Where no matrix cell is known, the test is skipped and the old rule stands.

**Quiet turn**:
A turn where the estimate moved less than a mistake band and no one earned a grade (attribution `quiet`). The card says "A quiet turn." only when it highlights nothing else; beside another sentence or a hindsight hint it says "Neither side made a mistake." and the badge reads "no mistake" instead of "quiet turn" (`quietVoice`). A card that names an unpunished risk or an inaccuracy starts with that sentence instead, and its badge reads "risk (unpunished)" or "small inaccuracy". Where a side carries a mistake or blunder tier, the card writes no quiet sentence beside the others; that case and a turn without played actions keep the badge "quiet turn".
_Avoid_: calm turn, nothing happened

**Standoff**:
Ten or more consecutive turns at one fainted share in which nobody fainted and nobody switched (`standoffsOf` in the engine). The game report names the span ("Turns 12 to 24 were a standoff"), and the shifts, rolls and paid-off reads of those turns stay out of its key moments and read list; a graded decision inside the span still counts.
