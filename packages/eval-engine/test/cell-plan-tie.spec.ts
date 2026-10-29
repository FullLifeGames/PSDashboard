import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { advancePositionWithLog, createRootPosition, legalChoices, positionBattle, type SimPosition } from '../src/forward-model';
import { createMatchupCache } from '../src/eval-function';
import { leafValue, rollSensitivePair, SEARCH_SEEDS } from '../src/search/leaf';
import { sampleCell } from '../src/search/cell-sampler';
import { groupedChildren, speedTie } from '../src/search/outcome-children';
import { doublesRoot, pairSet } from './pair-battles';

/**
 * Round 69 (T146 part c4): a singles cell whose two moves have equal priority at equal speed is a coin flip for the
 * move order, and a flip per seed is no price. The root cell draws each order with the order scripted and mixes the
 * two at one half, the way the doubles pair plan writes its `tie` record. The reference is the simulator: the mean
 * leaf over 64 natural seeds, where the shuffle of the tied actions decides the order.
 */

const cache = createMatchupCache();

/** The simulator's mean leaf over 64 natural seeds, and the standard error of that mean. */
function plainMean(root: SimPosition, p1Choice: string, p2Choice: string) {
  const leaves: number[] = [];
  for (let k = 0; k < 64; k++) {
    const { child } = advancePositionWithLog(root, p1Choice, p2Choice, `${1000 + k},${2000 + k},${3000 + k},${4000 + k}` as never);
    leaves.push(leafValue(positionBattle(child), cache));
  }
  const mean = leaves.reduce((sum, leaf) => sum + leaf, 0) / leaves.length;
  const variance = leaves.reduce((sum, leaf) => sum + (leaf - mean) ** 2, 0) / (leaves.length - 1);
  return { mean, se: Math.sqrt(variance / 64) };
}

const set = (species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '', ...extra,
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

/** Mutual sure OHKO at equal speed, the shape of the truth bench's ohko-tie: two Machamp at 1 HP with Close Combat. */
const ohkoTie = (): SimPosition => ones(set('Machamp', ['Close Combat']), set('Machamp', ['Close Combat']));

/** The same in doubles: a 1v1 whose partners are fainted (the simulator refuses one-mon doubles teams). */
function doublesOhkoTie(): SimPosition {
  const mon = () => pairSet('Machamp', 'Machamp', ['Close Combat'], { level: 100 });
  return doublesRoot([mon(), pairSet('Pika', 'Pikachu', ['Tackle'], { level: 5 })], [mon(), pairSet('Chu', 'Pikachu', ['Tackle'], { level: 5 })], battle => {
    for (const side of battle.sides) side.active[1]!.faint();
    battle.resolveFaints();
    for (const side of battle.sides) side.active[0]!.sethp(1);
  });
}

describe('singles speed tie (T146 c4)', () => {
  test('ohko-tie: the root cell reads the half value of the simulator, not one draw', () => {
    const root = ohkoTie();
    const [p1, p2] = ['move closecombat', 'move closecombat'];
    expect(speedTie(positionBattle(root), p1, p2)).toBe(true);
    const { mean, se } = plainMean(root, p1, p2);
    const cell = sampleCell(root, 0, p1, p2, 3, cache, true);
    expect(Math.abs(cell.value - mean)).toBeLessThanOrEqual(2.5 * se);
    expect(cell.value).toBeCloseTo(0, 9);
  });

  test('no tie keeps the single draw: unequal speed, unequal priority, a speed stage', () => {
    const fast = ones(set('Pikachu', ['Tackle', 'Quick Attack']), set('Snorlax', ['Tackle', 'Quick Attack']));
    const equal = ones(set('Machamp', ['Tackle', 'Quick Attack']), set('Machamp', ['Tackle', 'Quick Attack']));
    const staged = ones(set('Machamp', ['Tackle']), set('Machamp', ['Tackle']), battle => { battle.sides[0].active[0]!.boosts.spe = 1; });
    const cases: [SimPosition, string, string][] = [
      [fast, 'move tackle', 'move tackle'], // unequal speed
      [equal, 'move quickattack', 'move tackle'], // unequal priority
      [staged, 'move tackle', 'move tackle'], // a stage breaks the tie
    ];
    for (const [root, p1, p2] of cases) {
      expect(speedTie(positionBattle(root), p1, p2)).toBe(false);
      const cell = sampleCell(root, 0, p1, p2, 3, cache, true);
      expect(cell.value).toBe(1);
      expect(plainMean(root, p1, p2).mean).toBe(1);
    }
  });

  test('a tie with a roll event prices both orders at one half each', () => {
    // Jolteon's Thunder (70 %) against a sure Tackle, both at 1 HP and equal speed.
    const root = ones(set('Jolteon', ['Thunder']), set('Jolteon', ['Tackle']));
    const [p1, p2] = ['move thunder', 'move tackle'];
    expect(speedTie(positionBattle(root), p1, p2)).toBe(true);
    const { mean, se } = plainMean(root, p1, p2);
    const cell = sampleCell(root, 0, p1, p2, 3, cache, true);
    expect(Math.abs(cell.value - mean)).toBeLessThanOrEqual(2.5 * se);
    const accuracy = positionBattle(root).dex.moves.get('thunder').accuracy as number / 100;
    // p1 first: Thunder connects or Tackle ends it; p2 first: Tackle ends it. Each order carries half of the cell.
    expect(cell.value).toBeCloseTo(0.5 * (accuracy - (1 - accuracy)) + 0.5 * -1, 9);
  });

  test('both sides roll: each order folds its own classes, keys carry the order, the weights are halves', () => {
    const root = ones(set('Jolteon', ['Thunder']), set('Jolteon', ['Thunder']));
    const [p1, p2] = ['move thunder', 'move thunder'];
    expect(speedTie(positionBattle(root), p1, p2)).toBe(true);
    const { mean, se } = plainMean(root, p1, p2);
    const cell = sampleCell(root, 0, p1, p2, 3, cache, true);
    expect(Math.abs(cell.value - mean)).toBeLessThanOrEqual(2.5 * se);
    const classes = cell.blend!.classes;
    expect(classes.every(cls => cls.key.startsWith('p1:') || cls.key.startsWith('p2:'))).toBe(true);
    expect(classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
    const accuracy = positionBattle(root).dex.moves.get('thunder').accuracy as number / 100;
    expect(classes.find(cls => cls.key === 'p1:hit-kill|none')!.weight).toBeCloseTo(0.5 * accuracy, 9);
    expect(classes.find(cls => cls.key === 'p2:none|hit-kill')!.weight).toBeCloseTo(0.5 * accuracy, 9);
    expect(classes.filter(cls => cls.hasFirst)).toHaveLength(1);
    expect(cell.value).toBeCloseTo(classes.reduce((sum, cls) => sum + cls.weight * cls.leafSum / cls.count, 0), 9);
  });

  test('groupedChildren of a tied pair returns the two orders at one half each', () => {
    const root = ohkoTie();
    const out = groupedChildren(root, 'move closecombat', 'move closecombat', { seeds: SEARCH_SEEDS });
    expect(out.children.map(child => child.weight).sort()).toEqual([0.5, 0.5]);
  });

  test('a tied pair is roll-sensitive; the same pair without a tie is not', () => {
    const tied = positionBattle(ohkoTie());
    expect(rollSensitivePair(tied, 'move closecombat', 'move closecombat')).toBe(true);
    const staged = positionBattle(ones(set('Machamp', ['Tackle']), set('Machamp', ['Tackle']), battle => { battle.sides[0].active[0]!.boosts.spe = 1; }));
    expect(rollSensitivePair(staged, 'move tackle', 'move tackle')).toBe(false);
  });

  test('doubles: the pair plan already prices the tie, and the singles rule stays out of it', () => {
    const root = doublesOhkoTie();
    const battle = positionBattle(root);
    const choices = (side: 'p1' | 'p2') => legalChoices(root, side).map(option => option.choice).filter(choice => choice.includes('closecombat'));
    const [p1, p2] = [choices('p1')[0], choices('p2')[0]];
    expect(speedTie(battle, p1, p2)).toBe(false);
    const { mean, se } = plainMean(root, p1, p2);
    const cell = sampleCell(root, 0, p1, p2, 3, cache, true);
    expect(Math.abs(cell.value - mean)).toBeLessThanOrEqual(2.5 * se);
    expect(cell.value).toBeCloseTo(0, 9);
  });
});
