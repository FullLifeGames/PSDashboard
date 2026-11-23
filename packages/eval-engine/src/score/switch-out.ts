import type { Battle, Pokemon } from '@pkmn/sim';

/**
 * Whether `mon` can switch out: the simulator would accept `switch N` for it. The simulator clears every stage of a body that switches
 * out (`clearVolatile`), so a drop on a body that can leave is a cost of the next turn, not a lasting handicap (the search prices the
 * switch itself); a drop on a trapped body stays until the foe's moves remove it (`removesStages` in boost-bite.ts), a raise is kept.
 * The body is on the field, not trapped (`pokemon.trapped`) and its side has a living body off the field (`battle.canSwitch(side)`).
 * In doubles the partner is no bench: with one waiting body both actives read as free, as `legalChoices` asks per holder. Champions and
 * VGC count the bodies brought and not on the field, as `canSwitch` does.
 *
 * Known limit: `trapped` is the value of the last turn end, so at an open mid-turn request (a forced switch in a tree) a trap set
 * this turn is not read yet and a trapper that left this turn still reads. The cells the search prices end at a turn boundary,
 * where it is fresh; the legal choices keep their own reading of the request (`forward/choices.ts`).
 *
 * Oracle: `test/switch-out-sweep.spec.ts` compares both readings with the simulator for every Dex entry that traps.
 */
export function canSwitchOut(battle: Battle, mon: Pokemon): boolean {
  return mon.isActive && !mon.fainted && !mon.trapped && battle.canSwitch(mon.side) > 0;
}

/** Whether a stage of `mon` counts in the boost terms: a raise always, a drop only while the holder cannot switch out. */
export function stageStands(battle: Battle, mon: Pokemon, stage: number): boolean {
  return stage > 0 || (stage < 0 && !canSwitchOut(battle, mon));
}
