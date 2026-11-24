import type { SimPosition } from '../forward/position.ts';
import { dieKey, type DieName, type Draw } from '../dice/types.ts';
import type { PRNGSeed } from '@pkmn/sim';
import { cellSeedList, hash32, hashText } from './leaf.ts';

/**
 * The root quantiles (EVALUATION.md, "How the search prices chance"): tree k of T answers each named die of the cell's root draw with
 * `U = (pi_d(k) + u_d) / T`, where `u_d = hash(cell, die, occurrence) / 2^32` places the die inside its quarter and `pi_d` is the die's
 * own order of the T quarters (without it two 50 % dice never give "A yes, B no"). A binary die `randomChance(n, den)` comes out yes
 * when `floor(U * den) < n`; `random(m)` answers `floor(U * m)`, `random(a, b)` `a + floor(U * (b - a))`, a `sample` the index
 * `floor(U * length)`. A bare `random()`, a shuffle (the speed tie) and an offset outside [0, T) stay on the stream. The PRNGs draw
 * the natural number first and replace it for a named die, so every unnamed draw and every fork below the root keeps the stream's number.
 */

export interface DieQuantiles {
  answer(name: DieName, draw: Draw): number | boolean | undefined;
}

export const rootSalt = (text: string): number => hash32(hashText(text));

interface SaltBody { details?: string; hp?: number; status?: string; fainted?: boolean; item?: string; ability?: string; boosts?: unknown; moveSlots?: { id: string; pp: number }[] }
interface SaltState { turn?: number; gameType?: string; formatid?: string; sides?: { pokemon?: SaltBody[] }[] }

/**
 * The salt of a serialized battle, read from the state of the game and nothing else: the turn, and per body (in the order the
 * search keeps, bench canonical) its details, hit points, status, boosts, item, ability and moves with their PP. The text itself
 * carries the input log, the effect counters and the switch flags of the way the board was reached, and two boards of one game
 * state in two bench orders differ there (`bench-order.spec.ts` holds the boards to one ranking).
 */
export function positionSalt(serialized: string): number {
  const state = JSON.parse(serialized) as SaltState;
  const bodies = (state.sides ?? []).map(side => (side.pokemon ?? []).map(body => [
    // the shiny flag is no part of the game state: a shiny and a plain body draw the same dice (identity-blind.spec.ts)
    body.details?.replace(/, shiny\b/, ''), body.hp, body.status, body.fainted, body.item, body.ability, JSON.stringify(body.boosts ?? null),
    (body.moveSlots ?? []).map(slot => `${slot.id}:${slot.pp}`).join(','),
  ].join('~')).join('/'));
  return rootSalt([state.formatid, state.gameType, state.turn, ...bodies].join('|'));
}

const positionKeys = new WeakMap<object, number>();

export function positionKey(position: SimPosition): number {
  let key = positionKeys.get(position);
  if (key === undefined) {
    key = positionSalt(position.serialized);
    positionKeys.set(position, key);
  }
  return key;
}

/** The key of a root cell: the salt and the two choice strings (swapping the sides gives another key). */
export const cellHash = (salt: number, p1Choice: string, p2Choice: string): number =>
  hash32((salt ^ Math.imul(hashText(p1Choice), 0x9e3779b1) ^ Math.imul(hashText(p2Choice) ^ 0x5bd1e995, 0x85ebca6b)) >>> 0);

/** Slots of a cell's seed list: the matrix's five base seeds and eleven probe seeds; the verify round draws all sixteen (`VERIFY_PLAIN_DRAWS`). */
export const CELL_SEED_SLOTS = 16;

/** The seed list of a root cell, shared by every path; a tied cell's two move orders keep one list (scripts stay out of the key). */
export const cellSeeds = (root: SimPosition, p1Choice: string, p2Choice: string): PRNGSeed[] =>
  cellSeedList(cellHash(positionKey(root), p1Choice, p2Choice), CELL_SEED_SLOTS);

export class RootQuantiles implements DieQuantiles {
  private readonly seen = new Map<string, number>();
  readonly cell: number;
  readonly offset: number;
  readonly trees: number;

  constructor(cell: number, offset: number, trees: number) {
    this.cell = cell;
    this.offset = offset;
    this.trees = trees;
  }

  private unit(name: DieName): number {
    const key = dieKey(name);
    const occurrence = this.seen.get(key) ?? 0;
    this.seen.set(key, occurrence + 1);
    const die = hash32((this.cell ^ Math.imul(hashText(key), 0x9e3779b1) ^ Math.imul(occurrence + 1, 0x85ebca6b)) >>> 0);
    const u = hash32((die ^ 0x27d4eb2f) >>> 0) / 0x100000000;
    const order = Array.from({ length: this.trees }, (_, index) => index);
    let state = hash32((die ^ 0x165667b1) >>> 0);
    for (let i = this.trees - 1; i > 0; i--) {
      state = hash32((state + 0x632be5ab) >>> 0);
      const j = state % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    return (order[this.offset] + u) / this.trees;
  }

  answer(name: DieName, draw: Draw): number | boolean | undefined {
    if (!Number.isInteger(this.offset) || this.offset < 0 || this.offset >= this.trees) return undefined;
    if (draw.call === 'chance') return this.chance(name, draw);
    if (draw.call === 'random') return this.value(name, draw);
    if (draw.call === 'sample') return this.pick(name, draw);
    return undefined;
  }

  private chance(name: DieName, draw: Draw): boolean | undefined {
    const denominator = draw.from;
    if (denominator === undefined || !(denominator > 0) || draw.numerator === undefined) return undefined;
    return Math.floor(this.unit(name) * denominator) < draw.numerator;
  }

  private value(name: DieName, draw: Draw): number | undefined {
    if (draw.from === undefined) return undefined;
    const [low, high] = draw.to === undefined ? [0, draw.from] : [draw.from, draw.to];
    if (!(high > low)) return undefined;
    return low + Math.min(high - low - 1, Math.floor(this.unit(name) * (high - low)));
  }

  private pick(name: DieName, draw: Draw): number | undefined {
    const length = draw.items?.length ?? 0;
    return length > 0 ? Math.min(length - 1, Math.floor(this.unit(name) * length)) : undefined;
  }
}
