/**
 * Round 82 (forced dice): the words of the dice module. A die is one draw of the simulator that decides something the user
 * can see (GLOSSARY.md). The module names a die by the simulator's own hook (docs/adr/0002) and answers it as the user
 * forces it (docs/adr/0001). The types are JSON-clean on purpose: a forced die rides on the slot choice of a branch.
 */

export type DieKind = 'accuracy' | 'crit' | 'damage-roll' | 'secondary' | 'self-effect' | 'hit-count' | 'status-check'
  // eslint-disable-next-line names/no-new-dex-name -- the kind of the Protect-like draws (the simulator's `StallMove` event), not an ability id
  | 'stall' | 'fickle-beam' | 'speed-tie' | 'ability-proc' | 'item-proc' | 'quick-claw' | 'end-of-turn';

/** `slot` is the body that holds the draw (the user of the move; the holder for end-of-turn dice), `moveId` is empty outside a move. */
export interface DieName { slot: string; moveId: string; targetSlot?: string; kind: DieKind; effectId?: string }

export type DieResult =
  | { happens: boolean }        // a chance: accuracy, crit, secondary, status check, procs, stall, end of turn
  | { step: number }            // the damage roll, 0 is the lowest damage
  | { hits: number }            // the hit count
  | { option: string }          // a die with several results (Effect Spore's status), by its protocol word
  | { first: string };          // a tie: the slot that goes first

export interface ForcedDie { name: DieName; result: DieResult }

/** `applied`: the draw ran and took the answer. `no-draw`: the simulator never drew it. `no-chance`: the draw has no way to give the answer. `blocked`: drew and forced, the effect did not land. */
export type DieTook = 'applied' | 'no-draw' | 'no-chance' | 'blocked';

export interface DieReport { die: ForcedDie; took: DieTook; chance?: number; logIndex?: number; reason?: string }

export interface DiceReport { forced: DieReport[]; naturalEndSeed: string }

/**
 * The key of a die: its name without the index of a repeat (the third hit, the second secondary). A forced die applies to
 * every repeat, so the key is what the user's choice and the record of the natural turn share.
 */
export function dieKey(name: DieName): string {
  return [name.slot, name.moveId, name.targetSlot ?? '', name.kind, ...(name.effectId ? [name.effectId] : [])].join(':');
}

/** One call of the simulator to its PRNG, as the module reads it. A chance carries its denominator in `from`, a sample its length. */
export interface Draw {
  call: 'chance' | 'random' | 'sample' | 'shuffle';
  from?: number;
  to?: number;
  /** The numerator of a chance. */
  numerator?: number;
}

/** What the simulator drew for one occurrence of a die: the raw call (`random(from, to)`) and its value. */
export interface Answer { from: number | undefined; to: number | undefined; value: number }

/** The natural turn's draws per die, in order of occurrence. */
export type NaturalRecord = ReadonlyMap<string, readonly Answer[]>;
