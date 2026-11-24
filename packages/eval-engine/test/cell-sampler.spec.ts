import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { advancePositionWithLog, createRootPosition, legalChoices, positionBattle, type SimPosition } from '../src/forward-model';
import { createMatchupCache } from '../src/eval-function';
import { leafValue, rollSensitivePair, speedTie } from '../src/search/leaf';
import { sampleCell, MISSING_WEIGHT_CUT, plainVerifySample } from '../src/search/cell-sampler';
import { doublesRoot, pairSet } from './pair-battles';
import { BOUNDARY_DRAW_BUDGET } from '../src/cell-blend';
import { pairCellSample } from '../src/pair/sampler';
import { VERIFY_PLAIN_SEEDS } from './seed-streams';

/**
 * A singles cell whose two moves have equal priority at equal speed is a coin flip for the move order. The root cell draws each
 * order with the order scripted and mixes the two at one half, as the doubles pair plan writes its `tie` record. The reference is
 * the simulator: the mean leaf over 64 natural seeds, where the shuffle of the tied actions decides the order.
 */

const cache = createMatchupCache();

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

describe('singles speed tie', () => {
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
    // The cell's own seeds draw 0.25 (inside 2.5 SE of the mean above).
    expect(cell.value).toBeCloseTo(0.25, 9);
  });
});

describe('cell-plan-missing', () => {
  const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const mon = (species: string, moves: string[], extra: Partial<PokemonSet>): PokemonSet => ({
    name: species, species, item: '', ability: '', moves, nature: 'Hardy',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs, level: 100, gender: 'M', ...extra,
  });

  function scene(item: string): SimPosition {
    const p1 = [
      mon('Tornadus-Therian', ['Hidden Power Ice', 'Hurricane', 'Knock Off', 'U-turn'],
        { ability: 'Regenerator', item: 'Leftovers', nature: 'Timid', evs: { hp: 248, atk: 0, def: 0, spa: 40, spd: 0, spe: 220 }, ivs: { ...ivs, atk: 30, def: 30 } }),
      mon('Volcanion', ['Steam Eruption', 'Flamethrower', 'Earth Power', 'Protect'], { ability: 'Water Absorb', item: 'Leftovers', nature: 'Modest', evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 4, spe: 0 } }),
      mon('Cofagrigus', ['Hex', 'Will-O-Wisp', 'Haze', 'Toxic Spikes'], { ability: 'Mummy', item: 'Leftovers', nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 4, spd: 0, spe: 0 } }),
    ];
    const p2 = [
      mon('Dragonite', ['Dragon Claw', 'Dragon Dance', 'Extreme Speed', 'Earthquake'],
        { ability: 'Multiscale', item, nature: 'Adamant', evs: { hp: 48, atk: 252, def: 0, spa: 0, spd: 0, spe: 208 } }),
      mon('Charizard', ['Flare Blitz', 'Dragon Claw', 'Earthquake', 'Dragon Dance'], { ability: 'Blaze', item: 'Charizardite X', nature: 'Jolly', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } }),
      mon('Starmie', ['Scald', 'Rapid Spin', 'Recover', 'Psyshock'], { ability: 'Natural Cure', item: 'Leftovers', nature: 'Timid', evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 252 } }),
    ];
    const battle = new Battle({ formatid: toID('gen6customgame'), seed: '1,2,3,4', p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.choose('p1', 'team 123');
      battle.choose('p2', 'team 123');
    }
    battle.sides[0].active[0]!.sethp(241);
    battle.sides[1].active[0]!.sethp(252);
    return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
  }

  function plainMean(root: SimPosition, p1Choice: string, p2Choice: string) {
    const cache = createMatchupCache();
    const leaves: number[] = [];
    for (let k = 0; k < 64; k++) {
      const { child } = advancePositionWithLog(root, p1Choice, p2Choice, `${1000 + k},${2000 + k},${3000 + k},${4000 + k}` as never);
      leaves.push(leafValue(positionBattle(child), cache));
    }
    const mean = leaves.reduce((sum, leaf) => sum + leaf, 0) / leaves.length;
    const variance = leaves.reduce((sum, leaf) => sum + (leaf - mean) ** 2, 0) / (leaves.length - 1);
    return { mean, se: Math.sqrt(variance / 64 + variance / BOUNDARY_DRAW_BUDGET) };
  }

  describe('missing class weight', () => {
    test('653785 t24: Weakness Policy turns the unreachable class into a draw mean', () => {
      const root = scene('Weakness Policy');
      const [p1, p2] = ['move hiddenpower', 'move dragonclaw'];
      const truth = plainMean(root, p1, p2);
      const sample = sampleCell(root, 0, p1, p2, 1, createMatchupCache(), true);
      // The cell's own seeds also leave 'hit-kill|none' (a crit class) unreached.
      expect(sample.diagnostic?.missing).toEqual(['hit-kill|none', 'hit-nokill|hit-nokill']);
      expect(Math.abs(sample.value - truth.mean)).toBeLessThan(2.5 * truth.se);
      expect(sample.blend).toBeUndefined();
    });

    test('the same cell without the policy keeps the analytic blend (a small missing weight stays renormalised)', () => {
      const root = scene('Leftovers');
      const [p1, p2] = ['move hiddenpower', 'move dragonclaw'];
      const truth = plainMean(root, p1, p2);
      const sample = sampleCell(root, 0, p1, p2, 1, createMatchupCache(), true);
      // The cell's own seeds reach every class of this cell, so there is no diagnostic; a cell that misses a class must still stay below the cut.
      const missing = (sample.diagnostic?.missing ?? []).reduce((sum, key) => sum + sample.diagnostic!.analytic[key], 0);
      expect(missing).toBeLessThan(MISSING_WEIGHT_CUT);
      const classes = sample.blend!.classes;
      expect(classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
      expect(sample.value).toBe(classes.reduce((sum, cls) => sum + cls.weight * (cls.leafSum / cls.count), 0));
      expect(Math.abs(sample.value - truth.mean)).toBeLessThan(2.5 * truth.se);
    });

    test('the cut lies below the weight the policy scene misses', () => {
      expect(MISSING_WEIGHT_CUT).toBeGreaterThan(0);
      expect(MISSING_WEIGHT_CUT).toBeLessThan(0.87890625);
    });

    test('doubles: a root cell is priced by the pair plan from the dice drawn, with no missing class to report', () => {
      const side = (names: string[], move: string) => Teams.pack(names.map(species => mon(species, [move, 'Protect'], {
        ability: 'No Ability', evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 }, level: 50,
      })));
      const battle = new Battle({
        formatid: toID('gen9doublescustomgame'), seed: '1,2,3,4',
        p1: { name: 'Alpha', team: side(['Pikachu', 'Raichu'], 'Thunder') },
        p2: { name: 'Beta', team: side(['Snorlax', 'Blissey'], 'Tackle') },
      });
      if (battle.sides.some(s => s.requestState === 'teampreview')) {
        battle.choose('p1', 'team 12');
        battle.choose('p2', 'team 12');
      }
      const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)));
      const sample = sampleCell(root, 0, 'move thunder 1, move thunder 2', 'move tackle 1, move tackle 2', 1, createMatchupCache(), true);
      expect(sample.diagnostic).toBeUndefined();
      expect(Number.isFinite(sample.value)).toBe(true);
    });
  });
});

describe('cell-plan-tie-verify', () => {
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

  describe('tied singles cell in the verify pass', () => {
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
        battle.resolveFaints();
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
});
