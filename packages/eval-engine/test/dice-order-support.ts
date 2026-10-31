import type { Battle } from '@pkmn/sim';
import type { ForcedDie } from '../src/dice/types';
import { tieName } from '../src/dice/types';
import { mon, PIKACHU, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules } from './dice-sweep-support';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 82 (forced dice), lane A3b: the boards the two order specs share (the sweep of the speed tie and the first-mover die, and
 * the spec of the offer). Bodies of equal speed for the tie; a slow holder against a fast body for the die that lets a holder act
 * first.
 */

const slotOfIdent = (ident: string): string => ident.split(':')[0].trim();

/**
 * The slots of the bodies that used a move, in the order of the `|move|` lines (a move another move calls is no action; Gen 4
 * writes the move of a Quick Claw holder with `[from] item:`, which is the holder's own action).
 */
export function moveOrder(battle: Battle, start: number): string[] {
  return battle.log.slice(start).map(line => line.split('|'))
    .filter(row => row[1] === 'move' && !row.some(field => field.startsWith('[from]') && !field.startsWith('[from] item:')))
    .map(row => slotOfIdent(row[2]));
}

/** Bodies of equal speed: the same species and set on every place, all of them tackle. */
export function tieBoard(rules: Rules, mode: Mode, seed: string): Battle {
  const body = () => mon(rules, PIKACHU(['tackle']));
  return mode === 'singles'
    ? battleOf(rules.singles, [body()], [body()], seed)
    : battleOf(rules.doubles!, [body(), body()], [body(), body()], seed);
}

export const tieClicks = (mode: Mode): { p1: string; p2: string } =>
  mode === 'singles' ? { p1: 'move 1', p2: 'move 1' } : { p1: 'move 1 1, move 1 2', p2: 'move 1 1, move 1 2' };

export const tieDie = (a: string, b: string, first: string): ForcedDie => ({ name: tieName(a, b), result: { first } });

export const SLOTS: Record<Mode, string[]> = { singles: ['p1a', 'p2a'], doubles: ['p1a', 'p1b', 'p2a', 'p2b'] };
export const PAIRS = (slots: string[]): [string, string][] => slots.flatMap((a, index) => slots.slice(index + 1).map((b): [string, string] => [a, b]));

export interface FirstMover { id: string; label: string; kind: 'items' | 'abilities'; outfit: { item?: string; ability?: string }; activate: RegExp }

export const FIRST_MOVERS: FirstMover[] = [
  { id: 'quickclaw', label: 'Quick Claw', kind: 'items', outfit: { item: 'Quick Claw' }, activate: /^\|-activate\|p1a: [^|]*\|item: Quick Claw/ },
  { id: 'quickdraw', label: 'Quick Draw', kind: 'abilities', outfit: { ability: 'Quick Draw' }, activate: /^\|-activate\|p1a: [^|]*\|ability: Quick Draw/ },
];

/** The first movers a rule set has: Quick Claw from Gen 2, Quick Draw from Gen 8. */
export function moversOf(rules: Rules): FirstMover[] {
  const dex = dexOfRules(rules);
  return FIRST_MOVERS.filter(mover => {
    const entry = dex[mover.kind].get(mover.id);
    return entry.exists && entry.gen <= dex.gen && !entry.isNonstandard;
  });
}

export const moverDie = (mover: FirstMover, happens: boolean): ForcedDie => ({ name: { slot: 'p1a', moveId: '', kind: 'move-first', effectId: mover.id }, result: { happens } });

/** A slow holder (Snorlax) facing a fast body (Pikachu): both use a move of priority 0, the holder goes second unless its die lets it go first. */
export function moverBoard(rules: Rules, mode: Mode, mover: FirstMover | null, seed: string): Battle {
  const outfit = { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), item: mover?.outfit.item ?? '', ability: mover?.outfit.ability ?? 'No Ability' };
  const holder = set('Snorlax', ['tackle'], { ...outfit, gender: 'M' });
  const fast = mon(rules, PIKACHU(['tackle']));
  if (mode === 'singles') return battleOf(rules.singles, [holder], [fast], seed);
  return battleOf(
    rules.doubles!, [holder, mon(rules, { species: 'Blissey', moves: ['splash'] })], [fast, mon(rules, { species: 'Chansey', moves: ['splash'] })], seed,
  );
}

export const moverClicks = (mode: Mode): { p1: string; p2: string } =>
  mode === 'singles' ? { p1: 'move 1', p2: 'move 1' } : { p1: 'move 1 1, move 1', p2: 'move 1 1, move 1' };
