import type { Battle, Pokemon } from '@pkmn/sim';

/** Whether the simulator would accept `switch N` for `mon`: on the field, not trapped, a living body off the field. */
export function canSwitchOut(battle: Battle, mon: Pokemon): boolean {
  // `trapped` is the value of the last turn end: at an open mid-turn request a trap set this turn is not read yet.
  return mon.isActive && !mon.fainted && !mon.trapped && battle.canSwitch(mon.side) > 0;
}

/** Whether a stage of `mon` counts in the boost terms: a raise always, a drop only while it cannot switch out. */
export function stageStands(battle: Battle, mon: Pokemon, stage: number): boolean {
  return stage > 0 || (stage < 0 && !canSwitchOut(battle, mon));
}
