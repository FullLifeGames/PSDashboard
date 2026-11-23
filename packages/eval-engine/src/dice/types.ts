/** The words of the dice module: a die is one simulator draw that decides something the user sees (GLOSSARY.md); the types stay JSON-clean. */

/** What a die decides: `random-target` and `drag` are samples over bodies and answer `{ option }` with a foe slot or a body name (docs/adr/0001). */
export const DIE_KINDS = [
  'accuracy', 'crit', 'damage-roll', 'secondary', 'self-effect', 'hit-count', 'status-check', 'stalling', 'power',
  'speed-tie', 'ability-proc', 'item-proc', 'move-first', 'end-of-turn', 'random-target', 'drag',
] as const;
/** One of the kinds in `DIE_KINDS`. */
export type DieKind = typeof DIE_KINDS[number];

// `slot` is the body that holds the draw (the user of the move; the holder for end-of-turn dice; the body dragged out for a `drag` die,
// so two draws that drag one slot share one die), `moveId` is empty outside a move. `hit` is the simulator's `move.hit` (2 and up) on the
// accuracy die of a later hit of a `multiaccuracy` move; the first hit keeps the name without it.
/** The name of one die. */
export interface DieName { slot: string; moveId: string; targetSlot?: string; kind: DieKind; effectId?: string; hit?: number }

/** The answer to a die; the shape depends on the kind. */
export type DieResult =
  | { happens: boolean }        // a chance: accuracy, crit, secondary, procs, stalling, end of turn; a status check: the body goes on; a first mover: it acts first
  | { step: number }            // the damage roll, 0 is the lowest damage
  | { hits: number }            // the hit count
  | { option: string }          // a die with several results (Effect Spore's status), by its protocol word
  | { first: string };          // a tie: the slot that goes first

/** A die with the result the user forces. */
export interface ForcedDie { name: DieName; result: DieResult }

// `applied`: the draw ran and took the answer. `no-draw`: the simulator never drew it. `no-chance`: the draw cannot give the answer. `blocked`: forced, the effect did not land.
/** What became of a forced die. */
export type DieTook = 'applied' | 'no-draw' | 'no-chance' | 'blocked';

/** One forced die with its fate; `landed` is, on the die of a later hit the chain never reached, the hits the protocol counts for the target. */
export interface DieReport { die: ForcedDie; took: DieTook; chance?: number; logIndex?: number; reason?: string; landed?: number }

/** The dice of one turn; `unnamed` counts the draws no die names and no forced tie covers (a duration, a tie of non-move actions), which the seed decides. */
export interface DiceReport { forced: DieReport[]; naturalEndSeed: string; unnamed?: number }

/** The key of a die: its name without the index of a repeat; the accuracy die of a later `multiaccuracy` hit keeps `hit<N>`, so the user can decide one hit. */
export function dieKey(name: DieName): string {
  return [name.slot, name.moveId, name.targetSlot ?? '', name.kind, ...(name.effectId ? [name.effectId] : []), ...(name.hit ? [`hit${name.hit}`] : [])].join(':');
}

/** The key of a die without its hit: the die that covers every hit of the move (the first hit's own key). */
export function plainKey(name: DieName): string {
  return dieKey({ ...name, hit: undefined });
}

/** The name of the die that decides which of two bodies acts first on a speed and priority tie; the slots sort, so the die belongs to the pair. */
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
