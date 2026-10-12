import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { createRootPosition, legalChoices, positionBattle, type SimPosition } from '../src/forward-model';
import { createMatchupCache } from '../src/eval-function';
import { sampleCell, plainVerifySample } from '../src/search/cell-sampler';
import { pairCellSample } from '../src/pair/sampler';
import { speedTie } from '../src/search/leaf';
import { VERIFY_PLAIN_SEEDS } from '../src/search/verify-cell';
import { doublesRoot, pairSet } from './pair-battles';

/**
 * Round 69 (T146 part c6): the verify pass of a tied singles cell. The root cell of the search mixes the two move
 * orders at one half (c4); a verify cell (`plainDraws` set) cannot, because its draws are natural, so it prices like a
 * plan the sampler cannot fold: the 16 natural draws, no blend, the outcome groups for the deepening. A blend of the
 * three base draws would carry bare class keys whenever they agree on the order, and the tree's prefixed keys (c5)
 * would find no class there.
 */

const cache = createMatchupCache();
const PLAIN = VERIFY_PLAIN_SEEDS.length;

const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
});

function ones(p1: PokemonSet, p2: PokemonSet, setup: (battle: Battle) => void = () => {}): SimPosition {
  const battle = new Battle({
    formatid: toID('gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack([p1]) }, p2: { name: 'Beta', team: Teams.pack([p2]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  for (const side of battle.sides) side.active[0]!.sethp(1);
  setup(battle);
  return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
}

describe('tied singles cell in the verify pass (T146 c6)', () => {
  const tied: [string, SimPosition, string, string][] = [
    ['ohko-tie', ones(set('Machamp', ['Close Combat']), set('Machamp', ['Close Combat'])), 'move closecombat', 'move closecombat'],
    ['Thunder against Tackle', ones(set('Jolteon', ['Thunder']), set('Jolteon', ['Tackle'])), 'move thunder', 'move tackle'],
    ['Thunder both ways', ones(set('Jolteon', ['Thunder']), set('Jolteon', ['Thunder'])), 'move thunder', 'move thunder'],
  ];

  test.each(tied)('%s: the cell is the plain verify sample (no blend, outcome groups)', (_name, root, p1, p2) => {
    expect(speedTie(positionBattle(root), p1, p2)).toBe(true);
    const cell = sampleCell(root, 0, p1, p2, 3, cache, true, PLAIN);
    const plain = plainVerifySample(root, p1, p2, PLAIN, cache);
    expect(cell.blend).toBeUndefined();
    expect(cell.outcomes).toBeDefined();
    expect(cell.value).toBe(plain.value);
    expect(cell.outcomes!.length).toBe(plain.outcomes!.length);
  });

  test('the search pass of the same cells still mixes the orders (c4 stays)', () => {
    for (const [, root, p1, p2] of tied) {
      const cell = sampleCell(root, 0, p1, p2, 3, cache, true);
      expect(cell.outcomes).toBeUndefined();
      if (cell.blend) expect(cell.blend.classes.every(cls => /^p[12]:/.test(cls.key))).toBe(true);
    }
  });

  test('no tie keeps the verify blend: a Thunder cell at unequal speed', () => {
    const root = ones(set('Jolteon', ['Thunder']), set('Snorlax', ['Tackle']));
    expect(speedTie(positionBattle(root), 'move thunder', 'move tackle')).toBe(false);
    const cell = sampleCell(root, 0, 'move thunder', 'move tackle', 3, cache, true, PLAIN);
    expect(cell.blend).toBeDefined();
  });

  test('doubles: the pair plan prices the tie, the singles rule stays out of it', () => {
    const mon = () => pairSet('Machamp', 'Machamp', ['Close Combat'], { level: 100 });
    const root = doublesRoot([mon(), pairSet('Pika', 'Pikachu', ['Tackle'], { level: 5 })], [mon(), pairSet('Chu', 'Pikachu', ['Tackle'], { level: 5 })], battle => {
      for (const side of battle.sides) side.active[1]!.faint();
      battle.faintMessages();
      for (const side of battle.sides) side.active[0]!.sethp(1);
    });
    const choice = (side: 'p1' | 'p2') => legalChoices(root, side).map(option => option.choice).filter(c => c.includes('closecombat'))[0];
    const [p1, p2] = [choice('p1'), choice('p2')];
    const cell = sampleCell(root, 0, p1, p2, 3, cache, true, PLAIN);
    const pair = pairCellSample(root, p1, p2, 3, cache, PLAIN);
    expect(pair.kind).toBe('sample');
    if (pair.kind === 'sample') expect(cell.value).toBe(pair.sample.value);
  });
});
