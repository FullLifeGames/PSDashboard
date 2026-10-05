import { test, expect, describe, vi } from 'vitest';
import { State } from '@pkmn/sim';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createRootPosition, legalChoices, type ChoiceOption, type SimPosition } from '../src/forward-model';
import { combinedOptionHints, singlesOptionHints } from '../src/search/hints';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 63 (T112): the search hints keep a memo per position. A doubles node
 * hints up to some hundred combos built from a few dozen parts, and hints its
 * kept combos a second time for the expansion order; every distinct part of
 * a position is now priced once. The memo is keyed by the position object,
 * whose battle never changes, so a hint is the same with or without it.
 */

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/eval-function', async importOriginal => {
  const mod = await importOriginal<typeof import('../src/eval-function')>();
  const count = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => { calls.n++; return fn(...args); };
  return { ...mod, singleMoveFraction: count(mod.singleMoveFraction), pairThreat: count(mod.pairThreat), boostedFraction: count(mod.boostedFraction) };
});

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const rootOf = (battle: Battle): SimPosition => createRootPosition(JSON.stringify(State.serializeBattle(battle)));

function doublesRoot(): SimPosition {
  return rootOf(battleOf('gen9doublescustomgame',
    [set('Garchomp', ['earthquake', 'dragonclaw', 'swordsdance', 'protect'], { teraType: 'Fire' }),
      set('Rillaboom', ['woodhammer', 'fakeout', 'uturn', 'grassyglide']), splash('Pikachu')],
    [set('Incineroar', ['flareblitz', 'fakeout', 'partingshot', 'knockoff']), set('Amoonguss', ['spore', 'ragepowder', 'pollenpuff', 'protect'])]));
}

const counted = <T>(run: () => T): [T, number] => {
  const before = calls.n;
  const value = run();
  return [value, calls.n - before];
};

describe('the hint memo (round 63, T112)', () => {
  test('combined hints price each distinct part once per position', () => {
    const root = doublesRoot();
    const options = legalChoices(root, 'p1', { tera: true });
    const [first, firstCalls] = counted(() => combinedOptionHints(root, 'p1', options));
    const [again, againCalls] = counted(() => combinedOptionHints(root, 'p1', options.slice(0, 16)));
    expect(again).toEqual(first.slice(0, 16));
    expect(againCalls).toBe(0);
    const parts = new Set(options.flatMap(option => option.choice.split(',').map((part, index) => `${index}:${part.trim()}`)));
    expect(firstCalls).toBeLessThanOrEqual(parts.size * 4);
  });

  test('a fresh position of the same state hints the same, singles and doubles', () => {
    const doubles = doublesRoot();
    const options = legalChoices(doubles, 'p1', { tera: true });
    expect(combinedOptionHints(createRootPosition(doubles.serialized), 'p1', options)).toEqual(combinedOptionHints(doubles, 'p1', options));
    const singles = rootOf(battleOf('gen9customgame',
      [set('Garchomp', ['earthquake', 'dragonclaw', 'swordsdance'], { teraType: 'Fire' }), splash('Pikachu')], [splash('Blissey'), splash('Corviknight')]));
    const singlesOptions: ChoiceOption[] = legalChoices(singles, 'p1', { tera: true });
    expect(singlesOptionHints(createRootPosition(singles.serialized), 'p1', singlesOptions))
      .toEqual(singlesOptionHints(singles, 'p1', singlesOptions));
  });
});
