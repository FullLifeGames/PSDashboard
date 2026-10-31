# PS Dashboard

PS Dashboard replays Pokémon Showdown games turn by turn and grades the moves with its own engine. The user can branch at any turn and play on with their own choices.

## Language

### Dice

**Die** (plural **dice**):
One random draw of the simulator: an accuracy check, a critical hit, a damage roll, a secondary effect, a status check such as full paralysis, or a speed tie.
_Avoid_: roll (outside "damage roll"), RNG call

**Damage roll**:
The die that sets a hit's damage to one of 16 steps between 85 and 100 percent.
_Avoid_: roll

**Logged dice**:
The dice of a replay turn as its log shows them.
_Avoid_: logged rolls

**Forced die**:
A die whose result the user sets in a branch turn. The simulator decides whether that result can take effect.
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
