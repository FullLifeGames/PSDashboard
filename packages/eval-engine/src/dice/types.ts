/** The dice module's words: a die is a simulator draw that decides what the user sees (GLOSSARY.md); JSON-clean. */

/** What a die decides; `random-target` and `drag` sample over bodies and answer `{ option }` (a slot or body name). */
export const DIE_KINDS = [
  'accuracy', 'crit', 'damage-roll', 'secondary', 'self-effect', 'hit-count', 'status-check', 'stalling', 'power',
  'speed-tie', 'ability-proc', 'item-proc', 'move-first', 'end-of-turn', 'random-target', 'drag',
] as const;
/** One of the kinds in `DIE_KINDS`. */
export type DieKind = typeof DIE_KINDS[number];

// `slot` holds the draw: the move's user, the holder at end of turn, the body dragged out for `drag`.
/** The name of one die; `hit` (2 and up) is `move.hit` on the accuracy die of a later `multiaccuracy` hit. */
export interface DieName { slot: string; moveId: string; targetSlot?: string; kind: DieKind; effectId?: string; hit?: number }

/** The answer to a die; the shape depends on the kind. */
export type DieResult =
  | { happens: boolean }        // a chance; status check: the body goes on; move-first: it acts first
  | { step: number }            // the damage roll, 0 is the lowest damage
  | { hits: number }
  | { option: string }          // by its protocol word (Effect Spore's status)
  | { first: string };          // a tie: the slot that goes first

/** A die with the result the user forces. */
export interface ForcedDie { name: DieName; result: DieResult }

/** A forced die's fate: applied; no-draw (never drawn); no-chance (cannot give the answer); blocked (no effect). */
export type DieTook = 'applied' | 'no-draw' | 'no-chance' | 'blocked';

/** One forced die with its fate; `landed`: the hits the protocol counts, on a later-hit die the chain never reached. */
export interface DieReport { die: ForcedDie; took: DieTook; chance?: number; logIndex?: number; reason?: string; landed?: number }

/** The dice of one turn; `unnamed` counts draws no die names (a duration, a non-move tie); the seed decides. */
export interface DiceReport { forced: DieReport[]; naturalEndSeed: string; unnamed?: number }

/** The key of a die; a later `multiaccuracy` hit's accuracy die keeps `hit<N>`, so the user can decide one hit. */
export function dieKey(name: DieName): string {
  return [name.slot, name.moveId, name.targetSlot ?? '', name.kind, ...(name.effectId ? [name.effectId] : []), ...(name.hit ? [`hit${name.hit}`] : [])].join(':');
}

export function plainKey(name: DieName): string {
  return dieKey({ ...name, hit: undefined });
}

/** The die for a speed and priority tie between two bodies; the slots sort, so the die belongs to the pair. */
export function tieName(a: string, b: string): DieName {
  const [slot, targetSlot] = a < b ? [a, b] : [b, a];
  return { slot, moveId: '', targetSlot, kind: 'speed-tie' };
}

export interface Draw {
  call: 'chance' | 'random' | 'sample' | 'shuffle';
  /** A chance's denominator, a sample's length. */
  from?: number;
  to?: number;
  numerator?: number;
  items?: readonly unknown[];
  /** The chance behind a `random(100)` the script compares, 0 to 1; `recognize` fills it when the state names it. */
  chance?: number;
}

export interface SecondaryEntry {
  chance?: number;
  status?: string;
  volatileStatus?: string;
  boosts?: Record<string, number>;
  self?: { boosts?: Record<string, number>; volatileStatus?: string };
}

export interface Answer { from: number | undefined; to: number | undefined; value: number }

/** The natural turn's draws by die key, in order of occurrence. */
export type NaturalRecord = ReadonlyMap<string, readonly Answer[]>;
