import type { Battle, Pokemon } from '@pkmn/sim';

/**
 * Round 89 (SB-2, P1; user ruling 21.11.2026): a stat drop counts only while its holder cannot leave the field.
 *
 * The simulator clears every stage of a body that switches out (`clearVolatile`). A drop on a body that can switch is
 * therefore a cost of the next turn (the holder hits weaker while it stays, which the damage reads keep), not a lasting
 * handicap of the position: the holder pays at most the tempo of one switch, and the search prices that switch in its own
 * rows (the free hit, the hazards on entry). A drop on a body that cannot switch stays with it: nothing removes it but the
 * foe's own moves (`removesStages` in boost-bite.ts). A raised stage is the holder's asset and never moves through this
 * reading; the holder loses it only by its own choice.
 *
 * A body can switch out when the simulator would accept `switch N` for it: it is on the field, it is not trapped
 * (`pokemon.trapped`: written for every active body at the end of each turn from the trapping abilities, items, move
 * conditions and conditions of the Dex, and for a hard-locked move when the request is written) and its side has a living body
 * off the field (`battle.canSwitch(side)`). In doubles the partner is no bench: the rule reads each holder against the bodies
 * that wait, and with one waiting body both actives read as free (each can leave; the rule asks per holder, as `legalChoices`
 * does). Champions and VGC count the bodies brought and not on the field, as `canSwitch` does.
 *
 * The drop is read at 0, not at "what a switch costs": the static has no number for a switch's tempo, and a priced drop is a
 * new weight that AGENTS allows only after a harm reading.
 *
 * Known limit: `trapped` is the value of the last turn end. On a board that stands at an open mid-turn request (a forced
 * switch in a tree, the root of a replacement) a trap set this turn is not read yet, and a trapper that left this turn still
 * reads. The cells the search prices end at a turn boundary, where it is fresh. The legal choices of the search keep their own
 * reading of the request (`forward/choices.ts`); `test/switch-out-sweep.spec.ts` compares the two with the simulator for every
 * Dex entry that traps.
 *
 * Oracle: `test/switch-out-sweep.spec.ts`.
 */
export function canSwitchOut(battle: Battle, mon: Pokemon): boolean {
  return mon.isActive && !mon.fainted && !mon.trapped && battle.canSwitch(mon.side) > 0;
}

/** Whether a stage of `mon` counts in the boost terms: a raise always, a drop only while the holder cannot switch out. */
export function stageStands(battle: Battle, mon: Pokemon, stage: number): boolean {
  return stage > 0 || (stage < 0 && !canSwitchOut(battle, mon));
}
