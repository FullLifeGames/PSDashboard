/**
 * Round 82 (forced dice): the words of the dice module. A die is one draw of the simulator that decides something the user
 * can see (GLOSSARY.md). The module names a die by the simulator's own hook (docs/adr/0002) and answers it as the user
 * forces it (docs/adr/0001). The types are JSON-clean on purpose: a forced die rides on the slot choice of a branch.
 */

/**
 * What a die decides, never a Dex entry (AGENTS.md): `stalling` is a stalling move that succeeds again, `power` a chance that
 * changes a move's power, `move-first` a die that lets its holder act first in its priority bracket. A text that names the
 * move or the item reads it from the Dex at run time.
 */
export const DIE_KINDS = [
  'accuracy', 'crit', 'damage-roll', 'secondary', 'self-effect', 'hit-count', 'status-check', 'stalling', 'power',
  'speed-tie', 'ability-proc', 'item-proc', 'move-first', 'end-of-turn',
] as const;
export type DieKind = typeof DIE_KINDS[number];

/**
 * `slot` is the body that holds the draw (the user of the move; the holder for end-of-turn dice), `moveId` is empty outside a move.
 * `hit` (round 88, T337): the accuracy die of a later hit of a move whose every hit rolls its own accuracy (`multiaccuracy`), the
 * simulator's own `move.hit`, 2 and up. The first hit keeps the name without it.
 */
export interface DieName { slot: string; moveId: string; targetSlot?: string; kind: DieKind; effectId?: string; hit?: number }

export type DieResult =
  | { happens: boolean }        // a chance: accuracy, crit, secondary, procs, stalling, end of turn; a status check: the body goes on; a first mover: it acts first
  | { step: number }            // the damage roll, 0 is the lowest damage
  | { hits: number }            // the hit count
  | { option: string }          // a die with several results (Effect Spore's status), by its protocol word
  | { first: string };          // a tie: the slot that goes first

export interface ForcedDie { name: DieName; result: DieResult }

/** `applied`: the draw ran and took the answer. `no-draw`: the simulator never drew it. `no-chance`: the draw has no way to give the answer. `blocked`: drew and forced, the effect did not land. */
export type DieTook = 'applied' | 'no-draw' | 'no-chance' | 'blocked';

/** `landed` (round 89): on the die of a later hit that the chain never reached, the hits the protocol counts for the target. */
export interface DieReport { die: ForcedDie; took: DieTook; chance?: number; logIndex?: number; reason?: string; landed?: number }

/**
 * `unnamed` (round 89, #104): how many draws of the real turn no die names and no forced tie covers (a duration, a random target, a
 * tie of bodies that are not move actions); the seed decides them. Absent when the turn drew none.
 */
export interface DiceReport { forced: DieReport[]; naturalEndSeed: string; unnamed?: number }

/**
 * The key of a die: its name without the index of a repeat (the second secondary, the next hit of a move that draws no accuracy
 * per hit). A forced die applies to every repeat, so the key is what the user's choice and the record of the natural turn share.
 * The accuracy die of a later hit of a multi-accuracy move is the exception (round 88, T337): its key ends in `hit<N>`, so the
 * user can decide one hit; a forced die without a hit still covers every hit (`plainKey`).
 */
export function dieKey(name: DieName): string {
  return [name.slot, name.moveId, name.targetSlot ?? '', name.kind, ...(name.effectId ? [name.effectId] : []), ...(name.hit ? [`hit${name.hit}`] : [])].join(':');
}

/** The key of a die without its hit: the die that covers every hit of the move (the first hit's own key). */
export function plainKey(name: DieName): string {
  return dieKey({ ...name, hit: undefined });
}

/**
 * The name of the die that decides which of two bodies acts first when their move actions tie in speed and priority: the
 * two slots in sorted order (the die belongs to the pair, whichever body the user names first). Its result is `{ first: slot }`.
 */
export function tieName(a: string, b: string): DieName {
  const [slot, targetSlot] = a < b ? [a, b] : [b, a];
  return { slot, moveId: '', targetSlot, kind: 'speed-tie' };
}

/** One call of the simulator to its PRNG, as the module reads it. A chance carries its denominator in `from`, a sample its length. */
export interface Draw {
  call: 'chance' | 'random' | 'sample' | 'shuffle';
  from?: number;
  to?: number;
  /** The numerator of a chance. */
  numerator?: number;
  /** The items of a `sample`: a hit count is found among them. */
  items?: readonly unknown[];
  /**
   * The chance behind a `random(100)` that the script compares (a secondary entry, a self effect), 0 to 1. `recognize` fills it
   * when the simulator's state names it, so the answer knows whether the draw can go the other way.
   */
  chance?: number;
}

/** One entry of the secondaries a move carries, as the simulator hands it to `ModifySecondaries` (the fields the module reads). */
export interface SecondaryEntry {
  chance?: number;
  status?: string;
  volatileStatus?: string;
  boosts?: Record<string, number>;
  self?: { boosts?: Record<string, number>; volatileStatus?: string };
}

/** What the simulator drew for one occurrence of a die: the raw call (`random(from, to)`) and its value. */
export interface Answer { from: number | undefined; to: number | undefined; value: number }

/** The natural turn's draws per die, in order of occurrence. */
export type NaturalRecord = ReadonlyMap<string, readonly Answer[]>;
