import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PRNG, type Battle, type Pokemon, type PokemonSet } from '@pkmn/sim';
import { hitReader, hitStats, NO_COST, resetHitMemo, type HitCost, playedHit } from '../src/score/contact';
import { loadSimMods } from '../src/forward/sim-mods';
import { configureSimFast, resetSimFastForTests, simFastCounters } from '../src/forward/sim-fast/state';
import { set } from './move-oracle';
import { battleOf, fingerprint } from './power-oracle';

/**
 * What one hit of a move costs the attacker, read from the simulator and not from a list of items, abilities or moves (Cobalion's
 * contact moves into Talonflame meet Flame Body). The reader plays the hit on a copy of the board on fixed quantiles of its dice and
 * answers the HP the hit takes (a share of the attacker's max HP) and the chance of each status it leaves. Every scene is held to turns
 * of the simulator: the HP the attacker really loses, and how often the dice really burn, paralyze or poison it. The effects run in
 * singles and in doubles; the generations, the Champions mod, benched bodies and the memo have their own scenes below.
 */

await loadSimMods('gen9championscustomgame');

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const CHAMPIONS = 'gen9championscustomgame';
const CHAMPIONS_DOUBLES = 'gen9championsdoublescustomgame';

interface Click { p1: string; p2: string; idle: string }
const SINGLES_CLICK: Click = { p1: 'move 1', p2: 'move 1', idle: 'move 2' };
const DOUBLES_CLICK: Click = { p1: 'move 1 1, move 1', p2: 'move 1, move 1', idle: 'move 2, move 1' };
const FORMATS = [['singles', SINGLES, SINGLES_CLICK], ['doubles', DOUBLES, DOUBLES_CLICK]] as const;

const seedOf = (index: number) => `${index * 97 + 1},${index * 31 + 7},${index * 53 + 3},${index * 11 + 5}`;
const foe = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const attackerOf = (species: string, moves: string[], extra: Partial<PokemonSet> = {}) => set(species, [...moves, 'splash'], extra);

const boardOf = (format: string, attacker: PokemonSet, defender: PokemonSet, seed = '1,2,3,4'): Battle =>
  format === DOUBLES
    ? battleOf(format, [attacker, foe('Clefable')], [defender, foe('Snorlax')], seed)
    : battleOf(format, [attacker], [defender], seed);

const mine = (battle: Battle): Pokemon => battle.sides[0].active[0]!;
const theirs = (battle: Battle): Pokemon => battle.sides[1].active[0]!;

const read = (battle: Battle, move: string): HitCost => hitReader(battle)(mine(battle), theirs(battle), move);

function realLoss(battle: Battle, click: Click, idle = false): number {
  const attacker = mine(battle);
  const before = attacker.hp;
  battle.choose('p1', idle ? click.idle : click.p1);
  battle.choose('p2', click.p2);
  return (before - attacker.hp) / attacker.maxhp;
}

function rate(build: (seed: string) => Battle, count: number, pick: (battle: Battle) => boolean, click: Click): number {
  let times = 0;
  for (let index = 1; index <= count; index++) {
    const battle = build(seedOf(index));
    battle.choose('p1', click.p1);
    battle.choose('p2', click.p2);
    if (pick(battle)) times++;
  }
  return times / count;
}

function meanLoss(build: (seed: string) => Battle, count: number, click: Click): number {
  let total = 0;
  for (let index = 1; index <= count; index++) total += realLoss(build(seedOf(index)), click);
  return total / count;
}

function meanLossWithoutCrit(build: (seed: string) => Battle, count: number, click: Click): number {
  const losses: number[] = [];
  for (let index = 1; index <= count; index++) {
    const battle = build(seedOf(index));
    const loss = realLoss(battle, click);
    if (!battle.log.some(line => line.startsWith('|-crit|'))) losses.push(loss);
  }
  return losses.reduce((sum, loss) => sum + loss, 0) / losses.length;
}

const statusOf = (cost: HitCost, name: string) => cost.statuses.find(entry => entry.status === name);

beforeEach(() => resetHitMemo());

describe.each(FORMATS)('Flame Body, Static, Poison Point and Effect Spore: the chance of a status per contact hit (%s)', (_name, format, click) => {
  const into = (ability: string, species: string, attacker = 'Cobalion') => (seed: string) =>
    boardOf(format, attackerOf(attacker, ['ironhead']), foe(species, { ability }), seed);

  test('Flame Body burns 30% of the time, as often as the dice of real turns burn', () => {
    const build = into('Flame Body', 'Talonflame');
    const cost = read(build('1,2,3,4'), 'ironhead');
    expect(cost.statuses.map(entry => entry.status)).toEqual(['brn']);
    expect(cost.statuses[0].chance).toBeCloseTo(0.3, 9);
    expect(cost.chip).toBe(0);
    const burned = rate(build, 250, battle => mine(battle).status === 'brn', click);
    expect(Math.abs(burned - cost.statuses[0].chance)).toBeLessThan(0.08);
  });

  test('a burn takes 1/16 a turn and halves the damage of a physical move, as the simulator plays them', () => {
    const build = into('Flame Body', 'Talonflame');
    const burn = statusOf(read(build('1,2,3,4'), 'ironhead'), 'brn')!;
    const idle = build('1,2,3,4');
    mine(idle).setStatus('brn');
    expect(burn.chip).toBeCloseTo(realLoss(idle, click, true), 2);
    const damage = (battle: Battle) => {
      const move = battle.dex.getActiveMove('ironhead');
      battle.activeMove = move;
      battle.activePokemon = mine(battle);
      battle.activeTarget = theirs(battle);
      battle.prng = new PRNG('1,2,3,4');
      return battle.actions.getDamage(mine(battle), theirs(battle), move, true) || 0;
    };
    const board = build('1,2,3,4');
    const healthy = damage(board);
    mine(board).setStatus('brn');
    expect(burn.output).toBeCloseTo(damage(board) / healthy, 2);
    expect(burn.output).toBeCloseTo(0.5, 1);
  });

  test('a Fire type cannot be burned: the simulator gives the status to nobody, and the reader says none', () => {
    const cost = read(boardOf(format, attackerOf('Charizard', ['ironhead']), foe('Talonflame', { ability: 'Flame Body' })), 'ironhead');
    expect(cost.statuses).toEqual([]);
  });

  test('Static paralyzes 30% of the time', () => {
    const build = into('Static', 'Raichu');
    const cost = read(build('1,2,3,4'), 'ironhead');
    expect(cost.statuses.map(entry => entry.status)).toEqual(['par']);
    expect(cost.statuses[0].chance).toBeCloseTo(0.3, 9);
    const paralyzed = rate(build, 250, battle => mine(battle).status === 'par', click);
    expect(Math.abs(paralyzed - cost.statuses[0].chance)).toBeLessThan(0.08);
  });

  test('an Electric type cannot be paralyzed', () => {
    expect(read(boardOf(format, attackerOf('Zapdos', ['ironhead']), foe('Raichu', { ability: 'Static' })), 'ironhead').statuses).toEqual([]);
  });

  test('Poison Point poisons 30% of the time for 1/8 a turn; a Steel type is immune', () => {
    const build = (seed: string) => boardOf(format, attackerOf('Machamp', ['ironhead']), foe('Nidoking', { ability: 'Poison Point' }), seed);
    const cost = read(build('1,2,3,4'), 'ironhead');
    expect(cost.statuses.map(entry => entry.status)).toEqual(['psn']);
    expect(cost.statuses[0].chance).toBeCloseTo(0.3, 9);
    expect(cost.statuses[0].chip).toBeCloseTo(1 / 8, 2);
    const poisoned = rate(build, 250, battle => mine(battle).status === 'psn', click);
    expect(Math.abs(poisoned - cost.statuses[0].chance)).toBeLessThan(0.08);
    expect(read(into('Poison Point', 'Nidoking')('1,2,3,4'), 'ironhead').statuses).toEqual([]);
  });

  test('Effect Spore puts the attacker to sleep, paralyzes it or poisons it, a tenth of the time each; a Grass type is immune to the powder', () => {
    const build = (seed: string) => boardOf(format, attackerOf('Machamp', ['ironhead']), foe('Breloom', { ability: 'Effect Spore' }), seed);
    const cost = read(build('1,2,3,4'), 'ironhead');
    expect(cost.statuses.map(entry => entry.status).sort()).toEqual(['par', 'psn', 'slp']);
    for (const entry of cost.statuses) {
      const real = rate(build, 400, battle => mine(battle).status === entry.status, click);
      expect(entry.chance, entry.status).toBeCloseTo(0.1, 9);
      expect(Math.abs(real - entry.chance), entry.status).toBeLessThan(0.05);
    }
    const grass = boardOf(format, attackerOf('Rillaboom', ['woodhammer']), foe('Breloom', { ability: 'Effect Spore' }));
    expect(read(grass, 'woodhammer').statuses).toEqual([]);
  });

  test('a move that makes no contact leaves the attacker alone', () => {
    const board = boardOf(format, attackerOf('Cobalion', ['ironhead', 'earthpower']), foe('Talonflame', { ability: 'Flame Body' }));
    expect(read(board, 'earthpower')).toEqual(NO_COST);
    expect(read(board, 'ironhead').statuses.length).toBe(1);
  });

  test('a body that carries a status gets no second one: the simulator gives it to nobody, and the reader says none', () => {
    const build = (seed: string) => {
      const board = into('Flame Body', 'Talonflame')(seed);
      mine(board).setStatus('par');
      expect(mine(board).status).toBe('par');
      return board;
    };
    expect(read(build('1,2,3,4'), 'ironhead').statuses).toEqual([]);
    expect(rate(build, 100, battle => mine(battle).status === 'brn', click)).toBe(0);
  });

  test('a Sticky Barb moves to an attacker with no item at once and takes 1/8 a turn; an attacker with an item keeps it and loses nothing', () => {
    const board = (item: string) => boardOf(format, attackerOf('Cobalion', ['ironhead'], { item }), foe('Chansey', { item: 'Sticky Barb' }));
    const barb = read(board(''), 'ironhead');
    expect(barb.chip).toBe(0);
    expect(barb.statuses.map(entry => entry.status)).toEqual(['item:stickybarb']);
    expect(barb.statuses[0].chance).toBeCloseTo(1, 9);
    expect(barb.statuses[0].chip).toBeCloseTo(1 / 8, 2);
    const real = board('');
    expect(mine(real).item).toBe('');
    real.choose('p1', click.p1);
    real.choose('p2', click.p2);
    expect(mine(real).item).toBe('stickybarb');
    expect(read(board('Leftovers'), 'ironhead')).toEqual(NO_COST);
  });
});

describe.each(FORMATS)('Rocky Helmet, Rough Skin and Iron Barbs: the chip of a contact hit (%s)', (_name, format, click) => {
  test('Rocky Helmet takes 1/6 of the attacker\'s max HP, the amount the simulator takes in a real turn', () => {
    const build = () => boardOf(format, attackerOf('Cobalion', ['ironhead', 'earthpower']), foe('Chansey', { item: 'Rocky Helmet' }));
    const cost = read(build(), 'ironhead');
    expect(cost.chip).toBeCloseTo(realLoss(build(), click), 9);
    expect(cost.chip).toBeCloseTo(1 / 6, 2);
    expect(cost.statuses).toEqual([]);
    expect(read(build(), 'earthpower')).toEqual(NO_COST);
  });

  test.each([['Rough Skin', 'Garchomp'], ['Iron Barbs', 'Ferrothorn']])('%s takes 1/8, as the simulator does', (ability, species) => {
    const build = () => boardOf(format, attackerOf('Cobalion', ['ironhead']), foe(species, { ability }));
    const cost = read(build(), 'ironhead');
    expect(cost.chip).toBeCloseTo(realLoss(build(), click), 9);
    expect(cost.chip).toBeCloseTo(1 / 8, 2);
  });

  test('the chip is the amount of the effect and not what a body at low HP has left: the attacker is read at full HP', () => {
    const board = boardOf(format, attackerOf('Cobalion', ['ironhead']), foe('Chansey', { item: 'Rocky Helmet' }));
    mine(board).sethp(3);
    theirs(board).sethp(5);
    expect(read(board, 'ironhead').chip).toBeCloseTo(1 / 6, 2);
  });

  test('a Substitute in front of the foe takes the hit and triggers nothing, and the memo tells the two boards apart', () => {
    const build = (substitute: boolean) => {
      const board = boardOf(format, attackerOf('Cobalion', ['ironhead']), foe('Chansey', { item: 'Rocky Helmet' }));
      if (substitute) theirs(board).addVolatile('substitute');
      return board;
    };
    expect(read(build(false), 'ironhead').chip).toBeCloseTo(1 / 6, 2);
    expect(read(build(true), 'ironhead')).toEqual(NO_COST);
    expect(realLoss(build(true), click)).toBe(0);
    expect(realLoss(build(false), click)).toBeCloseTo(1 / 6, 2);
  });

  test('an item and an ability that both punish add up (a Rocky Helmet on a Rough Skin body)', () => {
    const build = () => boardOf(format, attackerOf('Cobalion', ['ironhead']), foe('Garchomp', { ability: 'Rough Skin', item: 'Rocky Helmet' }));
    expect(read(build(), 'ironhead').chip).toBeCloseTo(realLoss(build(), click), 9);
    expect(read(build(), 'ironhead').chip).toBeCloseTo(1 / 6 + 1 / 8, 2);
  });
});

describe.each(FORMATS)('recoil and Life Orb: what the attacker does to itself (%s)', (_name, format, click) => {
  test('Brave Bird costs a third of the damage it deals, the mean of the dice of real turns', () => {
    const build = (seed: string) => boardOf(format, attackerOf('Talonflame', ['bravebird']), foe('Snorlax'), seed);
    const cost = read(build('1,2,3,4'), 'bravebird');
    expect(cost.statuses).toEqual([]);
    const real = meanLoss(build, 120, click);
    expect(cost.chip).toBeGreaterThan(0.05);
    expect(Math.abs(cost.chip / real - 1)).toBeLessThan(0.03);
  });

  test('the stages standing are part of the hit: +2 Attack doubles a recoil that is a share of the damage', () => {
    const plain = boardOf(format, attackerOf('Talonflame', ['bravebird']), foe('Snorlax'));
    const boosted = boardOf(format, attackerOf('Talonflame', ['bravebird']), foe('Snorlax'));
    mine(boosted).boosts.atk = 2;
    expect(read(boosted, 'bravebird').chip / read(plain, 'bravebird').chip).toBeCloseTo(2, 1);
  });

  test('Life Orb takes a tenth of the attacker\'s max HP whatever the move deals, as the simulator takes it', () => {
    const build = () => boardOf(format, attackerOf('Cobalion', ['ironhead'], { item: 'Life Orb' }), foe('Chansey'));
    const cost = read(build(), 'ironhead');
    expect(cost.chip).toBeCloseTo(realLoss(build(), click), 9);
    expect(cost.chip).toBeCloseTo(0.1, 2);
  });

  test('Life Orb and Rocky Helmet add up', () => {
    const build = () => boardOf(format, attackerOf('Cobalion', ['ironhead'], { item: 'Life Orb' }), foe('Chansey', { item: 'Rocky Helmet' }));
    expect(read(build(), 'ironhead').chip).toBeCloseTo(realLoss(build(), click), 9);
  });

  test('a move with no recoil and no reaction costs nothing, and the board plays nothing for it', () => {
    resetHitMemo();
    const plays = hitStats.runs;
    const cost = read(boardOf(format, attackerOf('Cobalion', ['ironhead']), foe('Chansey')), 'ironhead');
    expect(cost).toEqual(NO_COST);
    expect(hitStats.runs).toBe(plays);
  });

  test.each(['fly', 'dig', 'skullbash'])('%s charges first and strikes on the second turn: into a Rocky Helmet it costs what two real turns cost', move => {
    const build = () => boardOf(format, attackerOf('Garchomp', [move]), foe('Chansey', { item: 'Rocky Helmet' }));
    const real = build();
    const before = mine(real).hp;
    for (let turn = 0; turn < 2; turn++) {
      real.choose('p1', turn === 0 ? click.p1 : 'default');
      real.choose('p2', click.p2);
    }
    const lost = (before - mine(real).hp) / mine(real).maxhp;
    expect(lost).toBeGreaterThan(0.1);
    expect(read(build(), move).chip).toBeCloseTo(lost, 9);
  });

  test('a Power Herb skips the charge: Dig costs the same hit at once', () => {
    const board = (item: string) => boardOf(format, attackerOf('Garchomp', ['dig'], { item }), foe('Chansey', { item: 'Rocky Helmet' }));
    expect(read(board('Power Herb'), 'dig').chip).toBeCloseTo(read(board(''), 'dig').chip, 9);
    expect(read(board('Power Herb'), 'dig').chip).toBeCloseTo(1 / 6, 2);
  });

  test.each(['suckerpunch', 'fakeout', 'firstimpression'])('%s hits in the read, whatever it waits for: the races price its damage as a hit, so they price its cost', move => {
    const board = boardOf(format, attackerOf('Kingambit', [move]), foe('Chansey', { item: 'Rocky Helmet' }));
    expect(read(board, move).chip).toBeCloseTo(1 / 6, 2);
  });
});

describe.each(FORMATS)('what the simulator lets a body avoid: Magic Guard, Rock Head, Protective Pads and Long Reach (%s)', (_name, format, click) => {
  test('Magic Guard takes no indirect damage: no Life Orb, no recoil, no Rocky Helmet', () => {
    const build = () => boardOf(format, attackerOf('Clefable', ['doubleedge'], { ability: 'Magic Guard', item: 'Life Orb' }), foe('Chansey', { item: 'Rocky Helmet' }));
    expect(realLoss(build(), click)).toBe(0);
    expect(read(build(), 'doubleedge')).toEqual(NO_COST);
  });

  test('Rock Head takes no recoil, and Double-Edge costs the same body with another ability a quarter of the damage', () => {
    const build = (ability: string) => boardOf(format, attackerOf('Aggron', ['doubleedge'], { ability }), foe('Snorlax'));
    expect(read(build('Rock Head'), 'doubleedge')).toEqual(NO_COST);
    expect(read(build('Sturdy'), 'doubleedge').chip).toBeGreaterThan(0.03);
  });

  test('Protective Pads stop what contact triggers (Rocky Helmet, Flame Body) but not the attacker\'s own recoil', () => {
    const helmet = (item: string) => boardOf(format, attackerOf('Cobalion', ['ironhead'], { item }), foe('Talonflame', { ability: 'Flame Body', item: 'Rocky Helmet' }));
    expect(read(helmet('Protective Pads'), 'ironhead')).toEqual(NO_COST);
    expect(read(helmet(''), 'ironhead').chip).toBeCloseTo(1 / 6, 2);
    expect(statusOf(read(helmet(''), 'ironhead'), 'brn')).toBeDefined();
    const recoil = (item: string) => boardOf(format, attackerOf('Talonflame', ['bravebird'], { item }), foe('Snorlax'));
    expect(read(recoil('Protective Pads'), 'bravebird').chip).toBeCloseTo(read(recoil(''), 'bravebird').chip, 9);
    expect(read(recoil('Protective Pads'), 'bravebird').chip).toBeGreaterThan(0.05);
  });

  test('Long Reach turns the contact move into one that makes no contact: nothing triggers', () => {
    const build = (ability: string) => boardOf(format, attackerOf('Decidueye', ['leafblade'], { ability }), foe('Chansey', { item: 'Rocky Helmet' }));
    expect(read(build('Long Reach'), 'leafblade')).toEqual(NO_COST);
    expect(read(build('Overgrow'), 'leafblade').chip).toBeCloseTo(1 / 6, 2);
  });
});

describe('doubles: the pair, the second slot, a spread move', () => {
  const doubles = (move: string, attacker = 'Cobalion', foeSets: PokemonSet[] = [foe('Chansey', { item: 'Rocky Helmet' }), foe('Snorlax')]) =>
    battleOf(DOUBLES, [attackerOf(attacker, [move]), foe('Clefable')], foeSets);

  test('the foe in the second slot is its own pair: its helmet is read for it and the first foe\'s is not', () => {
    const board = doubles('ironhead', 'Cobalion', [foe('Snorlax'), foe('Chansey', { item: 'Rocky Helmet' })]);
    const reader = hitReader(board);
    expect(reader(mine(board), board.sides[1].active[0]!, 'ironhead')).toEqual(NO_COST);
    expect(reader(mine(board), board.sides[1].active[1]!, 'ironhead').chip).toBeCloseTo(1 / 6, 2);
  });

  test('a spread move is read against the one foe of the pair: two helmets cost a real turn twice, the pair\'s hit once', () => {
    const build = () => doubles('breakingswipe', 'Dragonite', [foe('Chansey', { item: 'Rocky Helmet' }), foe('Blissey', { item: 'Rocky Helmet' })]);
    expect(realLoss(build(), { p1: 'move 1, move 1', p2: 'move 1, move 1', idle: 'move 2, move 1' })).toBeCloseTo(2 / 6, 1);
    expect(read(build(), 'breakingswipe').chip).toBeCloseTo(1 / 6, 2);
  });
});

describe.each(FORMATS)('benched bodies are read as if they stood on the field (%s)', (_name, format) => {
  test('a benched foe is read as if it stood in front: its helmet and its ability count, and the board stays as it was', () => {
    const bench = foe('Talonflame', { ability: 'Flame Body', item: 'Rocky Helmet' });
    const board = format === DOUBLES
      ? battleOf(DOUBLES, [attackerOf('Cobalion', ['ironhead']), foe('Clefable')], [foe('Snorlax'), foe('Blissey'), bench])
      : battleOf(SINGLES, [attackerOf('Cobalion', ['ironhead'])], [foe('Snorlax'), bench]);
    const bodies = [...board.sides[0].pokemon, ...board.sides[1].pokemon];
    const before = fingerprint(board, bodies, 'ironhead');
    const benched = board.sides[1].pokemon[board.sides[1].pokemon.length - 1];
    expect(benched.isActive).toBe(false);
    const cost = hitReader(board)(mine(board), benched, 'ironhead');
    expect(cost.chip).toBeCloseTo(1 / 6, 2);
    expect(statusOf(cost, 'brn')?.chance).toBeCloseTo(0.3, 9);
    expect(fingerprint(board, bodies, 'ironhead')).toBe(before);
    expect(board.sides[1].active[0]).toBe(board.sides[1].pokemon[0]);
    expect(benched.isActive).toBe(false);
  });

  test('a benched attacker is read the same way: the foe\'s Life Orb costs it when it hits', () => {
    const bench = attackerOf('Garchomp', ['crunch'], { item: 'Life Orb' });
    const board = format === DOUBLES
      ? battleOf(DOUBLES, [attackerOf('Cobalion', ['ironhead']), foe('Clefable')], [foe('Snorlax'), foe('Blissey'), bench])
      : battleOf(SINGLES, [attackerOf('Cobalion', ['ironhead'])], [foe('Snorlax'), bench]);
    const benched = board.sides[1].pokemon[board.sides[1].pokemon.length - 1];
    expect(hitReader(board)(benched, mine(board), 'crunch').chip).toBeCloseTo(0.1, 2);
  });
});

describe('the Champions mod and every generation', () => {
  test('the Champions mod plays its own rules: a Rocky Helmet hit on a copy of a Champions battle', () => {
    const SP = { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 };
    const build = () => battleOf(CHAMPIONS, [attackerOf('Cobalion', ['ironhead'], { evs: SP, level: 50 })], [foe('Chansey', { item: 'Rocky Helmet', evs: SP, level: 50 })]);
    expect(read(build(), 'ironhead').chip).toBeCloseTo(realLoss(build(), SINGLES_CLICK), 9);
  });

  test.each([3, 4, 5, 6, 7, 8, 9])('generation %s: Rough Skin and a recoil move are what the simulator of that generation takes', gen => {
    const format = `gen${gen}customgame`;
    const skin = () => battleOf(format, [attackerOf('Snorlax', ['bodyslam'])], [foe('Skarmory', { ability: 'Rough Skin' })]);
    expect(read(skin(), 'bodyslam').chip).toBeCloseTo(realLoss(skin(), SINGLES_CLICK), 9);
    expect(read(skin(), 'bodyslam').chip).toBeGreaterThan(0);
    const recoil = (seed: string) => battleOf(format, [attackerOf('Snorlax', ['doubleedge'])], [foe('Snorlax')], seed);
    // The reader's two probes (u = 0.075 and 0.925) meet no crit at the ordinary stage (1 in 16 up to gen 6, 1 in 24 later), so a recoil it
    // reads deterministic is the cost of a hit without a crit, and the simulator's turns are held to that.
    expect(Math.abs(read(recoil('1,2,3,4'), 'doubleedge').chip / meanLossWithoutCrit(recoil, 60, SINGLES_CLICK) - 1)).toBeLessThan(0.06);
  });

  test.each([1, 2])('generation %s has no abilities and no items to read; the reader answers without failing', gen => {
    const board = battleOf(`gen${gen}customgame`, [attackerOf('Snorlax', ['bodyslam'])], [foe('Skarmory')]);
    expect(read(board, 'bodyslam').statuses).toEqual([]);
    expect(read(board, 'bodyslam').chip).toBe(0);
  });

  test('the Champions mod in doubles (VGC) plays its own rules: the helmet of the first foe and Flame Body of the second, as real turns play them', () => {
    const SP = { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 };
    const mon = (species: string, extra: Partial<PokemonSet> = {}) => foe(species, { evs: SP, level: 50, ...extra });
    const build = (seed = '1,2,3,4') => battleOf(
      CHAMPIONS_DOUBLES, [attackerOf('Cobalion', ['ironhead'], { evs: SP, level: 50 }), mon('Clefable')],
      [mon('Chansey', { item: 'Rocky Helmet' }), mon('Talonflame', { ability: 'Flame Body' })], seed,
    );
    const board = build();
    const reader = hitReader(board);
    const helmet = reader(mine(board), board.sides[1].active[0]!, 'ironhead');
    expect(helmet.chip).toBeCloseTo(realLoss(build(), DOUBLES_CLICK), 9);
    expect(helmet.chip).toBeCloseTo(1 / 6, 2);
    expect(helmet.statuses).toEqual([]);
    const flame = reader(mine(board), board.sides[1].active[1]!, 'ironhead');
    expect(flame.chip).toBe(0);
    expect(flame.statuses.map(entry => entry.status)).toEqual(['brn']);
    expect(flame.statuses[0].chance).toBeCloseTo(0.3, 9);
    const atSecondFoe: Click = { p1: 'move 1 2, move 1', p2: 'move 1, move 1', idle: 'move 2, move 1' };
    const burned = rate(build, 250, battle => mine(battle).status === 'brn', atSecondFoe);
    expect(Math.abs(burned - flame.statuses[0].chance)).toBeLessThan(0.08);
  });
});

describe('the speed layer is not needed: the serialization round trip reads the same costs', () => {
  afterEach(() => resetSimFastForTests());

  const scenes: [string, () => Battle, string][] = [
    ['Rocky Helmet', () => battleOf(SINGLES, [attackerOf('Cobalion', ['ironhead'])], [foe('Chansey', { item: 'Rocky Helmet' })]), 'ironhead'],
    ['Flame Body', () => battleOf(SINGLES, [attackerOf('Cobalion', ['ironhead'])], [foe('Talonflame', { ability: 'Flame Body' })]), 'ironhead'],
    ['Brave Bird', () => battleOf(SINGLES, [attackerOf('Talonflame', ['bravebird'])], [foe('Snorlax')]), 'bravebird'],
    ['Life Orb', () => battleOf(SINGLES, [attackerOf('Cobalion', ['ironhead'], { item: 'Life Orb' })], [foe('Chansey')]), 'ironhead'],
    ['doubles Rough Skin', () => battleOf(DOUBLES, [attackerOf('Cobalion', ['ironhead']), foe('Clefable')], [foe('Snorlax'), foe('Garchomp', { ability: 'Rough Skin' })]), 'ironhead'],
  ];
  const readAll = () => scenes.map(([, build, move]) => {
    const board = build();
    const target = board.sides[1].active[board.gameType === 'doubles' ? 1 : 0]!;
    return hitReader(board)(mine(board), target, move);
  });

  test('every scene reads the same on a copy of the speed layer and on a round trip through the serialization', () => {
    resetSimFastForTests();
    configureSimFast(['rules', 'clone', 'dispatch']);
    const clones = simFastCounters.clones;
    resetHitMemo();
    const copied = readAll();
    expect(simFastCounters.clones).toBeGreaterThan(clones);
    configureSimFast([]);
    resetHitMemo();
    const cloned = simFastCounters.clones;
    const serialized = readAll();
    expect(simFastCounters.clones).toBe(cloned);
    expect(serialized).toEqual(copied);
    copied.forEach((cost, at) => expect(cost.chip > 0 || cost.statuses.length > 0, scenes[at][0]).toBe(true));
  });
});

describe('the reader leaves the battle alone and keeps a memo', () => {
  const helmet = () => battleOf(SINGLES, [attackerOf('Cobalion', ['ironhead'])], [foe('Chansey', { item: 'Rocky Helmet' })]);

  test('the log, the dice, the queues and every body are as before', () => {
    const board = helmet();
    const bodies = [...board.sides[0].pokemon, ...board.sides[1].pokemon];
    const before = fingerprint(board, bodies, 'ironhead');
    read(board, 'ironhead');
    read(battleOf(SINGLES, [attackerOf('Cobalion', ['ironhead'])], [foe('Talonflame', { ability: 'Flame Body' })]), 'ironhead');
    expect(fingerprint(board, bodies, 'ironhead')).toBe(before);
    expect(mine(board).hp).toBe(mine(board).maxhp);
    expect(theirs(board).hp).toBe(theirs(board).maxhp);
  });

  test('a board seen before is answered from the memo, whatever the HP; another item is played again', () => {
    const first = helmet();
    const cost = read(first, 'ironhead');
    const plays = hitStats.plays;
    const hits = hitStats.hits;
    const again = helmet();
    mine(again).sethp(10);
    theirs(again).sethp(10);
    expect(read(again, 'ironhead')).toEqual(cost);
    expect(hitStats.plays).toBe(plays);
    expect(hitStats.hits).toBeGreaterThan(hits);
    read(battleOf(SINGLES, [attackerOf('Cobalion', ['ironhead'])], [foe('Chansey', { item: 'Leftovers' })]), 'ironhead');
    read(battleOf(SINGLES, [attackerOf('Cobalion', ['ironhead'])], [foe('Garchomp', { ability: 'Rough Skin' })]), 'ironhead');
    expect(hitStats.plays).toBe(plays + 1);
  });

  test('the stages that decide the damage are part of the memo, the ones that do not are not', () => {
    const board = (edit: (attacker: Pokemon, defender: Pokemon) => void) => {
      const battle = battleOf(SINGLES, [attackerOf('Talonflame', ['bravebird'])], [foe('Snorlax')]);
      edit(mine(battle), theirs(battle));
      return battle;
    };
    const plain = read(board(() => undefined), 'bravebird');
    const plays = hitStats.plays;
    expect(read(board(attacker => { attacker.boosts.spe = 3; }), 'bravebird')).toEqual(plain);
    expect(hitStats.plays).toBe(plays);
    expect(read(board(attacker => { attacker.boosts.atk = 2; }), 'bravebird')).not.toEqual(plain);
    expect(hitStats.plays).toBe(plays + 1);
  });

  test('no move, or a move that does not hit, is free', () => {
    const board = helmet();
    expect(hitReader(board)(mine(board), theirs(board), null)).toEqual(NO_COST);
    expect(hitReader(board)(mine(board), theirs(board), 'splash')).toEqual(NO_COST);
  });
});

describe('contact-memo-state', () => {


  type Tweak = (battle: Battle) => void;
  type Body = Pokemon & Record<string, unknown>;
  const attackerOf = (battle: Battle): Body => battle.sides[0].active[0]! as Body;
  const defenderOf = (battle: Battle): Body => battle.sides[1].active[0]! as Body;

  const volatile = (who: (battle: Battle) => Pokemon, id: string, state: Record<string, unknown>): Tweak => battle => {
    who(battle).addVolatile(id);
    Object.assign(who(battle).volatiles[id] ?? {}, state);
  };

  interface Row {
    name: string;
    attacker: [species: string, ability: string, item?: string];
    defender: [species: string, ability?: string];
    move: string;
    first: Tweak;
    second: Tweak;
  }

  /** The attacker's happiness, in the field and in its set: the slow mode's copy (EVAL_SIM_FAST=0) rebuilds it from the set, the fast mode's takes the field. */
  const happiness = (battle: Battle, value: number): void => {
    attackerOf(battle).happiness = value;
    attackerOf(battle).set.happiness = value;
  };

  const FLAME_BODY: Row['defender'] = ['Talonflame', 'Flame Body'];

  const ROWS: Row[] = [
    { name: 'Substitute HP 200 against 10', attacker: ['Rillaboom', 'Grassy Surge'], defender: ['Dragonite'], move: 'woodhammer',
      first: volatile(defenderOf, 'substitute', { hp: 200 }), second: volatile(defenderOf, 'substitute', { hp: 10 }) },
    { name: 'Supreme Overlord fallen 0 against 5', attacker: ['Kingambit', 'Supreme Overlord'], defender: ['Dragonite'], move: 'woodhammer',
      first: battle => { (attackerOf(battle).abilityState as { fallen: number }).fallen = 0; },
      second: battle => { (attackerOf(battle).abilityState as { fallen: number }).fallen = 5; } },
    { name: 'Rivalry, the same gender against the other', attacker: ['Nidoking', 'Rivalry'], defender: ['Nidoqueen'], move: 'woodhammer',
      first: battle => { attackerOf(battle).gender = 'M'; defenderOf(battle).gender = 'M'; },
      second: battle => { attackerOf(battle).gender = 'M'; defenderOf(battle).gender = 'F'; } },
    { name: 'Protosynthesis on Attack against Speed', attacker: ['Roaring Moon', 'Protosynthesis', 'Booster Energy'], defender: ['Dragonite'], move: 'woodhammer',
      first: volatile(attackerOf, 'protosynthesis', { bestStat: 'atk' }), second: volatile(attackerOf, 'protosynthesis', { bestStat: 'spe' }) },
    { name: 'Quark Drive on Attack against Special Defense', attacker: ['Iron Hands', 'Quark Drive', 'Booster Energy'], defender: ['Dragonite'], move: 'woodhammer',
      first: volatile(attackerOf, 'quarkdrive', { bestStat: 'atk' }), second: volatile(attackerOf, 'quarkdrive', { bestStat: 'spd' }) },
    { name: 'Stakeout against a foe that stood 0 and 3 turns', attacker: ['Houndstone', 'Stakeout'], defender: ['Dragonite'], move: 'woodhammer',
      first: battle => { defenderOf(battle).activeTurns = 0; }, second: battle => { defenderOf(battle).activeTurns = 3; } },
    { name: 'Gyro Ball at Speed stage 0 and -6 into Flame Body', attacker: ['Ferrothorn', 'Iron Barbs'], defender: FLAME_BODY, move: 'gyroball',
      first: battle => { attackerOf(battle).boosts.spe = 0; }, second: battle => { attackerOf(battle).boosts.spe = -6; } },
    { name: 'Power Trip at evasion stage 0 and +3 into Flame Body', attacker: ['Grimmsnarl', 'Prankster'], defender: FLAME_BODY, move: 'powertrip',
      first: battle => { attackerOf(battle).boosts.evasion = 0; }, second: battle => { attackerOf(battle).boosts.evasion = 3; } },
    { name: 'Retaliate with and without a faint last turn, into Flame Body', attacker: ['Snorlax', 'Thick Fat'], defender: FLAME_BODY, move: 'retaliate',
      first: battle => { battle.sides[0].faintedLastTurn = null; },
      second: battle => { battle.sides[0].faintedLastTurn = battle.sides[0].pokemon[1] ?? battle.sides[0].pokemon[0]; } },
    { name: 'Heavy Slam at two weights, into Flame Body', attacker: ['Snorlax', 'Thick Fat'], defender: FLAME_BODY, move: 'heavyslam',
      first: battle => { attackerOf(battle).weighthg = 1000; }, second: battle => { attackerOf(battle).weighthg = 3000; } },
    { name: 'Return at happiness 255 and 50, into Flame Body', attacker: ['Snorlax', 'Thick Fat'], defender: FLAME_BODY, move: 'return',
      first: battle => happiness(battle, 255), second: battle => happiness(battle, 50) },
  ];

  const FORMATS = [
    ['Scarlet/Violet singles', 'gen9customgame'], ['Scarlet/Violet doubles', 'gen9doublescustomgame'],
    ['Champions singles', 'gen9championscustomgame'], ['Champions doubles', 'gen9championsdoublescustomgame'],
  ] as const;

  function boardOf(format: string, row: Row, tweak: Tweak): Battle | null {
    const [species, ability, item] = row.attacker;
    const [foe, foeAbility] = row.defender;
    const p1 = [set(species, [row.move, 'splash'], { ability, ...(item ? { item } : {}) }), set('Clefable', ['splash'])];
    const p2 = [set(foe, ['splash'], foeAbility ? { ability: foeAbility } : {})];
    if (/doubles/.test(format)) p2.push(set('Snorlax', ['splash']));
    try {
      const battle = battleOf(format, p1, p2);
      if (!battle.dex.moves.get(row.move).exists) return null;
      tweak(battle);
      return battle;
    } catch {
      return null;
    }
  }

  const fresh = (battle: Battle, move: string): HitCost => playedHit(battle, attackerOf(battle), defenderOf(battle), move);
  const read = (battle: Battle, move: string): HitCost => hitReader(battle)(attackerOf(battle), defenderOf(battle), move);

  beforeEach(() => resetHitMemo());

  describe.each(FORMATS)('the hit memo reads the state of the hit (%s)', (_name, format) => {
    const noTeeth: string[] = [];

    test.each(ROWS.map(row => [row.name, row] as const))('%s: each reading is the hit of its own board, in both orders and across a clear', (_row, row) => {
      const boards = [boardOf(format, row, row.first), boardOf(format, row, row.second)];
      if (!boards[0] || !boards[1]) {
        expect(boards[0] === null && boards[1] === null).toBe(true);
        return;
      }
      const expected = boards.map(battle => fresh(battle!, row.move));
      // Teeth: the two boards differ in the played hit (counted below where a format's rules give the same hit twice).
      if (JSON.stringify(expected[0]) === JSON.stringify(expected[1])) noTeeth.push(row.name);
      const wrong: string[] = [];
      for (const order of [[0, 1], [1, 0]]) {
        for (const cleared of [false, true]) {
          resetHitMemo();
          order.forEach((index, step) => {
            if (cleared && step === 1) resetHitMemo();
            if (JSON.stringify(read(boards[index]!, row.move)) !== JSON.stringify(expected[index])) wrong.push(`${order.join('>')}${cleared ? ' cleared' : ''}: board ${index}`);
          });
        }
      }
      expect(wrong).toEqual([]);
    });

    test('every row builds in Scarlet/Violet, the Champions rows a Dex lacks are named, and at most one row per format reads the same twice', () => {
      // Champions' Heavy Slam at level 50 rounds both weights to the same hit; Scarlet/Violet has teeth in every row.
      expect(noTeeth.filter(name => !name.startsWith('Heavy Slam'))).toEqual([]);
      if (format.startsWith('gen9custom') || format.startsWith('gen9doublescustom')) expect(noTeeth).toEqual([]);
      const lacking = ROWS.filter(row => boardOf(format, row, row.first) === null).map(row => row.name);
      if (format.startsWith('gen9custom') || format.startsWith('gen9doublescustom')) expect(lacking).toEqual([]);
      else expect(lacking.length).toBeLessThan(ROWS.length);
    });
  });
});
