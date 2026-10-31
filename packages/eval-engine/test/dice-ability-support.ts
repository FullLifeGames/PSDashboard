import { PRNG, type Battle } from '@pkmn/sim';
import type { ForcedDie } from '../src/dice/types';
import { copyOf } from '../src/sim-ask/copy';
import type { Mode, Rules } from './dice-fixtures';
import { dexOfRules, monOf, outfitBoard } from './dice-sweep-support';

/**
 * Round 82 (forced dice), lane A4: the boards of the ability and item procs, of the end of the turn, and of Effect Spore. One
 * proc is an ability or an item whose handler draws a chance when its holder is hit (or, for the holder's own hit, when it
 * hits): the die belongs to the move in flight, and the witness is a protocol line that names the ability or the item.
 */

export interface Proc {
  /** The ability's or the item's id, as the die names it. */
  id: string;
  kind: 'abilities' | 'items';
  /** Who holds it: the body that is hit, or the body that hits. */
  holder: 'target' | 'user';
  /** The move that reaches the handler: a contact move for the contact abilities. */
  move: string;
  /** A hit that would faint the target (the item saves only a body that would faint). */
  lethal?: boolean;
}

export const PROCS: Proc[] = [
  { id: 'cutecharm', kind: 'abilities', holder: 'target', move: 'tackle' },
  { id: 'flamebody', kind: 'abilities', holder: 'target', move: 'tackle' },
  { id: 'poisonpoint', kind: 'abilities', holder: 'target', move: 'tackle' },
  { id: 'static', kind: 'abilities', holder: 'target', move: 'tackle' },
  { id: 'cursedbody', kind: 'abilities', holder: 'target', move: 'tackle' },
  { id: 'poisontouch', kind: 'abilities', holder: 'user', move: 'tackle' },
  { id: 'toxicchain', kind: 'abilities', holder: 'user', move: 'tackle' },
  { id: 'focusband', kind: 'items', holder: 'target', move: 'tackle', lethal: true },
];

/** Effect Spore: its draw gives a status as well as a yes or a no, so its results are learned (its own sweep). */
export const EFFECT_SPORE: Proc = { id: 'effectspore', kind: 'abilities', holder: 'target', move: 'tackle' };

/** The ids of every proc, the die kind of the census named: the census holds this list to the simulator's own handlers. */
export const PROC_IDS: string[] = [...PROCS, EFFECT_SPORE].map(proc => proc.id);

/** Whether the rule set has the ability or the item (the Dex says so, not a list of generations). */
export function present(rules: Rules, kind: 'abilities' | 'items', id: string): boolean {
  const dex = dexOfRules(rules);
  const entry = dex[kind].get(id);
  return entry.exists && entry.gen <= dex.gen && !entry.isNonstandard;
}

/** The ability's or the item's name in the rule set's own Dex (the protocol writes it: `[from] ability: Static`). */
export const nameOf = (rules: Rules, kind: 'abilities' | 'items', id: string): string => dexOfRules(rules)[kind].get(id).name;

/** The label the protocol writes for the effect: `ability: Static`, `item: Focus Band`. */
export const labelOf = (rules: Rules, kind: 'abilities' | 'items', id: string): string => `${kind === 'abilities' ? 'ability' : 'item'}: ${nameOf(rules, kind, id)}`;

/** Snorlax uses the move on a Vaporeon; the proc's holder carries the ability or the item. */
export function procBoard(rules: Rules, mode: Mode, proc: Proc): Battle {
  const outfit = { [proc.kind === 'abilities' ? 'ability' : 'item']: nameOf(rules, proc.kind, proc.id) };
  const board = outfitBoard(rules, mode, { species: 'Snorlax', moves: [proc.move], ...(proc.holder === 'user' ? outfit : {}) }, { species: 'Vaporeon', ...(proc.holder === 'target' ? outfit : {}) });
  if (proc.lethal) monOf(board, 'p2a').hp = 1;
  return board;
}

/** The accuracy die forced to hit, so the hit and the procs behind it run whatever the seed gives. */
export const hitDie = (moveId: string): ForcedDie => ({ name: { slot: 'p1a', moveId, targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: true } });

/** Whether the turn's lines (from `start`) mention the label, in a `[from]` argument or an `-activate` line. */
export const mentions = (battle: Battle, start: number, label: string): boolean => battle.log.slice(start).some(line => line.includes(label));

/**
 * The oracle for a proc's chance: the chance the simulator itself passes to `randomChance` while the effect's handler runs
 * (`battle.effect` is the ability or the item), read from a plain turn under a spy over the battle's stream. A seed whose turn
 * never reaches the handler (a miss) gives nothing; the caller tries several seeds.
 */
export function chanceOfEffect(board: Battle, clicks: { p1: string; p2: string }, effectId: string, play: (battle: Battle, clicks: { p1: string; p2: string }) => void): number[] {
  const battle = copyOf(board);
  battle.prng ??= board.prng.clone();
  const natural = battle.prng;
  const seen: number[] = [];
  battle.prng = new (class extends PRNG {
    override random(from?: number, to?: number): number {
      return natural.random(from, to);
    }
    override randomChance(numerator: number, denominator: number): boolean {
      const drawn = natural.randomChance(numerator, denominator);
      if ((battle.effect as { id?: string } | undefined)?.id === effectId) seen.push(numerator / denominator);
      return drawn;
    }
  })(natural.getSeed());
  play(battle, clicks);
  return seen;
}
