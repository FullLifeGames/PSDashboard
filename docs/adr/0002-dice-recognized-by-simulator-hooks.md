# The dice module names a die by the simulator's hook

The simulator's PRNG calls carry no label: an accuracy check, a confusion check and a secondary effect can all arrive as a draw out of 100. The forced-dice module recognizes a die by the hook the simulator runs right before it (the `Accuracy` event, `ModifyCritRatio`, `ModifySecondaries` for each target, the `BeforeMove` handler of a status, `battle.randomizer` for the damage roll, the `Residual` handler for an end-of-turn die) and answers it with a number from its range, so the simulator's own comparison turns the number into the result. Where an old generation's script runs no such hook once before a draw (Gen 1 draws the crit from base Speed, Gen 2 draws it as `random(256)` and runs `Accuracy` three times before one draw, both draw the damage roll as `random(217, 256)`), the module names the draw by that script's own call. The engine's scripted dice tell draws by the numbers of the call and read a paralysis, infatuation or confusion check as the move's own roll (T299).

## Considered options

- The numbers of the call (`ScriptedPRNG`, `PairPRNG`): they collide with status checks in every generation, with the Champions paralysis and thaw, and they miss the 256ths of Gens 1 and 2.
- `Battle#forceRandomChance`: one answer for every chance of the battle, no draw consumed, so later draws shift; it covers neither damage rolls nor secondary effects.
- Rewriting move data (a secondary's chance set to 0 or 100): it writes the live move and cannot tell one target or one hit from another.
