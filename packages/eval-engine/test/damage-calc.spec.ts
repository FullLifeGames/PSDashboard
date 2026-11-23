import { describe, expect, test } from 'vitest';
import { Field, Generations, Move, Pokemon, calculate } from '@smogon/calc';
import { calcSingleDamageRange, hitCounts, type HitCount } from '../src/damage-calc';
import type { BranchMoveOption, SimPokemonInfo } from '../src/branch-engine';
import { makePokemonInfo } from '../src/branch/pokemon-info';
import { positionBattle } from '../src/forward-model';
import { boundaryEvent } from '../src/ko-odds';
import { killCount } from '../src/pair/kill-table';
import { checkedRolls, drawTurn, rollSet as set, rootOf } from './calc-roll-oracle';
import type { PokemonSet } from '@pkmn/sim';
import { rulesDex } from '@fulllifegames/replay-core';
import { set as setFromDamageCalcHitCounts } from './move-oracle';
import { battleOf, powerInTurn } from './power-oracle';

/** The preview's damage of a multi-hit move is the sum of its hits, as the calc sums them (Result.range); its KO text is the calc's verdict over all the hits (Result.kochance). */
const gen9 = Generations.get(9);
const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function mon(species: string, overrides: Partial<SimPokemonInfo> = {}, gen = gen9): SimPokemonInfo {
  const evs = overrides.evs ?? { ...STATS, hp: 252, atk: 252 };
  const maxhp = new Pokemon(gen, species, { level: overrides.level ?? 100, evs, ability: overrides.ability || undefined }).maxHP();
  return {
    name: species, species, hp: maxhp, maxhp, hpPercent: 100, status: '', fainted: false, isActive: true, activeSlot: 0,
    moves: [], ability: '', item: '', stats: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 'Hardy', evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, gender: '', teraType: '', boosts: {}, level: 100,
    types: [], ...overrides,
  };
}

function move(name: string, targetType = 'normal'): BranchMoveOption {
  return { name, activeSlot: 0, slot: 1, pp: 16, maxpp: 16, disabled: false, type: '', targetType, requiresTarget: false, targetOptions: [] };
}

function calcDirect(attacker: SimPokemonInfo, defender: SimPokemonInfo, name: string, gen = gen9, hits?: number) {
  const poke = (info: SimPokemonInfo) => new Pokemon(gen, info.species, {
    level: info.level, ability: info.ability || undefined, item: info.item || undefined, nature: info.nature,
    evs: info.evs, ivs: info.ivs, curHP: info.hp,
  });
  const options = { ability: attacker.ability as never, item: (attacker.item || undefined) as never, ...(hits ? { hits } : {}) };
  return calculate(gen, poke(attacker), poke(defender), new Move(gen, name, options), new Field({ gameType: 'Singles' }));
}

const pct = (damage: number, maxhp: number) => Math.round(damage / maxhp * 1000) / 10;

describe('multi-hit moves in the damage preview', () => {
  test('Surging Strikes into Great Tusk shows all three hits, as the calc sums them (the scene)', () => {
    const urshifu = mon('Urshifu-Rapid-Strike', { ability: 'Unseen Fist' });
    const tusk = mon('Great Tusk', { evs: { ...STATS, hp: 252, def: 4 } });
    const direct = calcDirect(urshifu, tusk, 'Surging Strikes');
    const [min, max] = direct.range();
    const result = calcSingleDamageRange(urshifu, tusk, move('Surging Strikes'));
    expect(result.minPercent).toBe(pct(min, tusk.maxhp));
    expect(result.maxPercent).toBe(pct(max, tusk.maxhp));
    // The weakest three hits beat the strongest one twice over.
    const oneHitMax = Math.max(...(direct.damage as number[][])[0]);
    expect(result.minPercent).toBeGreaterThan(2 * pct(oneHitMax, tusk.maxhp));
  });

  test('Skill Link lands five hits, as the calc reads it from the attacker', () => {
    const cinccino = mon('Cinccino', { ability: 'Skill Link' });
    const target = mon('Blissey', { evs: { ...STATS, hp: 252, def: 252 } });
    const [min, max] = calcDirect(cinccino, target, 'Bullet Seed').range();
    const result = calcSingleDamageRange(cinccino, target, move('Bullet Seed'));
    expect([result.minPercent, result.maxPercent]).toEqual([pct(min, target.maxhp), pct(max, target.maxhp)]);
    expect(calcDirect(cinccino, target, 'Bullet Seed').move.hits).toBe(5);
  });

  test('the KO text of a multi-hit is the calc\'s verdict over all its hits at the target\'s current HP', () => {
    const urshifu = mon('Urshifu-Rapid-Strike', { ability: 'Unseen Fist' });
    const full = mon('Great Tusk', { evs: { ...STATS, hp: 252, def: 4 } });
    const [min, max] = calcDirect(urshifu, full, 'Surging Strikes').range();
    const damaged = { ...full, hp: Math.round((min + max) / 2) };
    const verdict = calcDirect(urshifu, damaged, 'Surging Strikes').kochance(false);
    expect(verdict.n).toBe(1);
    expect(verdict.chance).toBeGreaterThan(0);
    expect(verdict.chance).toBeLessThan(1);
    expect(calcSingleDamageRange(urshifu, damaged, move('Surging Strikes')).koChance).toBe(verdict.text);
  });

  test('a fixed-damage Parental Bond hit counts twice', () => {
    const gen7 = Generations.get(7);
    const kangaskhan = mon('Kangaskhan-Mega', { ability: 'Parental Bond' }, gen7);
    const target = mon('Chansey', {}, gen7);
    const result = calcSingleDamageRange(kangaskhan, target, move('Seismic Toss'), { gen: 7 });
    expect(result.maxPercent).toBe(pct(200, target.maxhp));
    expect(result.minPercent).toBe(pct(200, target.maxhp));
  });

  test('a single hit reads as before', () => {
    const garchomp = mon('Garchomp');
    const kingambit = mon('Kingambit');
    const [min, max] = calcDirect(garchomp, kingambit, 'Earthquake').range();
    const result = calcSingleDamageRange(garchomp, kingambit, move('Earthquake', 'allAdjacent'));
    expect([result.minPercent, result.maxPercent]).toEqual([pct(min, kingambit.maxhp), pct(max, kingambit.maxhp)]);
  });
});

/**
 * A move whose hit count the simulator draws (2 to 5 hits, or Population Bomb under Loaded Dice) shows every count it can land, each priced
 * by the calc; the counts and their chances are the simulator's (35/35/15/15 from gen 5 on, Loaded Dice 4 or 5 and 4 to 10).
 */
describe('multi-hit moves with a drawn hit count (T124 point 3)', () => {
  const breloom = mon('Breloom');
  const blissey = mon('Blissey', { evs: { ...STATS, hp: 252, def: 252 } });
  const spanOf = (attacker: SimPokemonInfo, defender: SimPokemonInfo, name: string, fewest: number, most: number) =>
    [pct(calcDirect(attacker, defender, name, gen9, fewest).range()[0], defender.maxhp), pct(calcDirect(attacker, defender, name, gen9, most).range()[1], defender.maxhp)];

  test("2 to 5 hits span the fewest hits' minimum to the most hits' maximum, singles and doubles", () => {
    for (const gameType of ['Singles', 'Doubles'] as const) {
      const result = calcSingleDamageRange(breloom, blissey, move('Bullet Seed'), { gameType });
      expect([result.minPercent, result.maxPercent], gameType).toEqual(spanOf(breloom, blissey, 'Bullet Seed', 2, 5));
    }
  });

  test('Loaded Dice lands 4 or 5 hits of a 2 to 5 hit move, and 4 to 10 of Population Bomb', () => {
    const dice = mon('Breloom', { item: 'Loaded Dice' });
    const seed = calcSingleDamageRange(dice, blissey, move('Bullet Seed'));
    expect([seed.minPercent, seed.maxPercent]).toEqual(spanOf(dice, blissey, 'Bullet Seed', 4, 5));
    const maushold = mon('Maushold', { item: 'Loaded Dice' });
    const bomb = calcSingleDamageRange(maushold, blissey, move('Population Bomb'));
    expect([bomb.minPercent, bomb.maxPercent]).toEqual(spanOf(maushold, blissey, 'Population Bomb', 4, 10));
    // Without Loaded Dice the ten hits stay the calc's own count: the preview reads a move that connects.
    const plain = calcSingleDamageRange(mon('Maushold'), blissey, move('Population Bomb'));
    expect([plain.minPercent, plain.maxPercent]).toEqual(spanOf(mon('Maushold'), blissey, 'Population Bomb', 10, 10));
  });

  test("the OHKO chance weighs every count by its chance; agreeing counts keep the calc's text", () => {
    // At 329 HP only 4 and 5 hits knock Blissey out: 0.15 x 99.6 % + 0.15 x 100 %.
    const damaged = { ...blissey, hp: 329 };
    const ohko = (hits: number) => {
      const verdict = calcDirect(breloom, damaged, 'Bullet Seed', gen9, hits).kochance(false);
      return verdict.n === 1 ? verdict.chance ?? 0 : 0;
    };
    const chance = 0.35 * ohko(2) + 0.35 * ohko(3) + 0.15 * ohko(4) + 0.15 * ohko(5);
    expect(chance).toBeGreaterThan(0.15);
    expect(chance).toBeLessThan(0.3);
    expect(calcSingleDamageRange(breloom, damaged, move('Bullet Seed')).koChance).toBe(`${Math.round(chance * 1000) / 10}% chance to OHKO`);
    expect(calcSingleDamageRange(breloom, { ...blissey, hp: 1 }, move('Bullet Seed')).koChance).toBe('guaranteed OHKO');
  });

  test("an ability that fixes the count wins over the draw: Battle Bond's Water Shuriken shows its three hits (review of wave 1.5)", () => {
    const gen7 = Generations.get(7);
    const ash = mon('Greninja-Ash', { ability: 'Battle Bond' }, gen7);
    const snorlax = mon('Snorlax', { evs: { ...STATS, hp: 252, def: 252 } }, gen7);
    const result = calcSingleDamageRange(ash, snorlax, move('Water Shuriken'), { gen: 7 });
    const three = calcDirect(ash, snorlax, 'Water Shuriken', gen7, 3).range();
    expect([result.minPercent, result.maxPercent]).toEqual([pct(three[0], snorlax.maxhp), pct(three[1], snorlax.maxhp)]);
  });

  test("without an OHKO: the fewest hits' guaranteed verdict holds for every count, else a possible KO in the fewest uses", () => {
    // At 486 HP two hits guarantee a 3HKO, and every larger count a 2HKO.
    const at486 = { ...blissey, hp: 486 };
    expect(calcDirect(breloom, at486, 'Bullet Seed', gen9, 2).kochance(false).text).toBe('guaranteed 3HKO');
    expect(calcSingleDamageRange(breloom, at486, move('Bullet Seed')).koChance).toBe('guaranteed 3HKO');
    // At full HP two hits may need four uses, five hits always take two: two uses can do it, not always.
    expect(calcSingleDamageRange(breloom, blissey, move('Bullet Seed')).koChance).toBe('possible 2HKO');
  });
});

/** The result carries the distribution per hit count, each count with the simulator's chance and its own calc range. */
describe('the per-count distribution of a drawn hit count (T136 point 1)', () => {
  const breloom = mon('Breloom');
  const blissey = mon('Blissey', { evs: { ...STATS, hp: 252, def: 252 } });
  const countRange = (attacker: SimPokemonInfo, hits: number) => {
    const [min, max] = calcDirect(attacker, blissey, 'Bullet Seed', gen9, hits).range();
    return { minPercent: pct(min, blissey.maxhp), maxPercent: pct(max, blissey.maxhp) };
  };

  test('Bullet Seed into Blissey: 2, 3, 4 and 5 hits at 35, 35, 15 and 15 %, each with its range, singles and doubles', () => {
    for (const gameType of ['Singles', 'Doubles'] as const) {
      const result = calcSingleDamageRange(breloom, blissey, move('Bullet Seed'), { gameType });
      expect(result.hitShares, gameType).toEqual([
        { hits: 2, chance: 0.35, ...countRange(breloom, 2) },
        { hits: 3, chance: 0.35, ...countRange(breloom, 3) },
        { hits: 4, chance: 0.15, ...countRange(breloom, 4) },
        { hits: 5, chance: 0.15, ...countRange(breloom, 5) },
      ]);
    }
  });

  test('Loaded Dice: 4 or 5 hits at half each; one hit or a fixed count carries no distribution', () => {
    const dice = mon('Breloom', { item: 'Loaded Dice' });
    expect(calcSingleDamageRange(dice, blissey, move('Bullet Seed')).hitShares).toEqual([
      { hits: 4, chance: 0.5, ...countRange(dice, 4) },
      { hits: 5, chance: 0.5, ...countRange(dice, 5) },
    ]);
    expect(calcSingleDamageRange(breloom, blissey, move('Seed Bomb')).hitShares).toBeUndefined();
    expect(calcSingleDamageRange(mon('Cinccino', { ability: 'Skill Link' }), blissey, move('Bullet Seed')).hitShares).toBeUndefined();
  });
});

const option = (name: string): BranchMoveOption =>
  ({ name, activeSlot: 0, slot: 1, pp: 15, maxpp: 15, disabled: false, type: 'Normal', targetType: 'normal', requiresTarget: false, targetOptions: [] });

describe('Hidden Power goes to the calc typed (T83)', () => {
  test('singles gen 6: Hidden Power Ice into Landorus-Therian at 83 HP is the sure KO the simulator deals', () => {
    const root = rootOf('gen6customgame', [set('Starmie', ['Hidden Power Ice'])],
      [set('Landorus-Therian', ['Splash'], { ability: 'Battle Armor' })], battle => { battle.sides[1].active[0].sethp(83); });
    const battle = positionBattle(root);
    expect(battle.sides[0].active[0].hpType).toBe('Ice');
    const [hit] = checkedRolls(drawTurn(root, 'move hiddenpower', 'move splash'));
    expect(hit.holds).toBe(true);
    const event = boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], 'hiddenpower')!;
    expect(event.killFraction).toBe(1);
    expect(event.normalKillRolls).toBe(killCount(hit.table!.normal, 83));
  });

  test('singles gen 3: Hidden Power at the power the IVs give (30), not the typed name\'s 70', () => {
    const ivs = { hp: 29, atk: 29, def: 29, spa: 29, spd: 29, spe: 29 };
    const root = rootOf('gen3customgame', [set('Gengar', ['Hidden Power Fire'], { ivs })], [set('Snorlax', ['Splash'], { ivs })]);
    const gengar = positionBattle(root).sides[0].active[0];
    expect([gengar.hpType, gengar.hpPower]).toEqual(['Fire', 30]);
    const hits = checkedRolls(drawTurn(root, 'move hiddenpower', 'move splash'));
    expect(hits.length).toBe(1);
    expect(hits[0].holds).toBe(true);
  });

  test('doubles gen 7: a Hidden Power hit lands on its kill table at the drawn roll', () => {
    const root = rootOf('gen7doublescustomgame',
      [set('Magnezone', ['Hidden Power Fire']), set('Corviknight', ['Roost'])],
      [set('Ferrothorn', ['Splash'], { ability: 'Battle Armor' }), set('Blissey', ['Soft-Boiled'], { ability: 'Battle Armor' })]);
    const hits = checkedRolls(drawTurn(root, 'move hiddenpower 1, move roost', 'move splash, move softboiled'));
    expect(hits.length).toBe(1);
    expect(hits[0].holds).toBe(true);
  });

  test('the picker\'s state carries the type and power, and the preview prices the slot as its type', () => {
    for (const format of ['gen6customgame', 'gen7doublescustomgame'] as const) {
      const doubles = format === 'gen7doublescustomgame';
      const root = rootOf(format, [set('Starmie', ['Hidden Power Ice']), ...(doubles ? [set('Corviknight', ['Roost'])] : [])],
        [set('Landorus-Therian', ['Splash']), ...(doubles ? [set('Blissey', ['Soft-Boiled'])] : [])]);
      const battle = positionBattle(root);
      const starmie = makePokemonInfo(battle.sides[0].active[0] as never, true, 0);
      const lando = makePokemonInfo(battle.sides[1].active[0] as never, true, 0);
      expect([starmie.hpType, starmie.hpPower], format).toEqual(['Ice', 60]);
      const context = { gen: battle.gen, gameType: doubles ? 'Doubles' as const : 'Singles' as const };
      expect(calcSingleDamageRange(starmie, lando, option('Hidden Power'), context).range, format)
        .toBe(calcSingleDamageRange(starmie, lando, option('Hidden Power Ice'), context).range);
    }
  });
});

describe('damage-calc-hit-counts', () => {
  const set = setFromDamageCalcHitCounts;
  const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
  const gear = (species: string, ability = '', item = '') => ({ species, ability, item });

  function shares(values: readonly number[]): HitCount[] {
    const counts = new Map<number, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a - b).map(([hits, count]) => ({ hits, chance: count / values.length }));
  }

  function hitsInTurn(format: string, attacker: PokemonSet, defender: PokemonSet, id: string, seed: string): number {
    return powerInTurn(battleOf(format, [attacker], [defender], seed), { p1: 'move 1', p2: 'move 1' }, id).length;
  }

  describe('the hit counts the preview prices are the simulator\'s', () => {
    test('2 to 5 hits: the array the hit loop samples, in every generation', () => {
      for (let gen = 1; gen <= 9; gen++) {
        const format = `gen${gen}customgame`;
        const ability = gen >= 3 ? 'No Ability' : undefined;
        const battle = battleOf(format, [set('Jolteon', ['pinmissile'], { ability })], [splash('Snorlax', { ability })]);
        const sampled: number[][] = [];
        const sample = battle.sample.bind(battle);
        battle.sample = <T>(items: readonly T[]): T => {
          if (items.every(item => typeof item === 'number')) sampled.push(items as unknown as number[]);
          return sample(items);
        };
        battle.choose('p1', 'move 1');
        battle.choose('p2', 'move 1');
        expect(sampled.length, format).toBe(1);
        expect(hitCounts(rulesDex(gen), gear('Jolteon'), 'Pin Missile'), format).toEqual(shares(sampled[0]));
      }
    });

    test('Loaded Dice: a 2 to 5 hit move lands 4 or 5, Population Bomb 4 to 10, at the shares the simulator draws', () => {
      const seeds = Array.from({ length: 280 }, (_, index) => `${index + 1},2,3,4`);
      for (const id of ['bulletseed', 'populationbomb']) {
        const dice = set('Maushold', [id], { item: 'Loaded Dice' });
        // Shuckle outlasts ten hits; a turn whose first hit misses lands none and is left out.
        const counted = seeds.map(seed => hitsInTurn('gen9customgame', dice, splash('Shuckle'), id, seed)).filter(hits => hits > 0);
        const mirrored = hitCounts(rulesDex(9), gear('Maushold', '', 'Loaded Dice'), id)!;
        const seen = shares(counted);
        expect(seen.map(entry => entry.hits), id).toEqual(mirrored.map(entry => entry.hits));
        for (const [index, entry] of seen.entries()) {
          // Three standard errors of a share over this many turns.
          const tolerance = 3 * Math.sqrt(mirrored[index].chance * (1 - mirrored[index].chance) / counted.length);
          expect(Math.abs(entry.chance - mirrored[index].chance), `${id} ${entry.hits} hits`).toBeLessThan(tolerance);
        }
      }
      expect(hitCounts(rulesDex(9), gear('Maushold', '', 'Loaded Dice'), 'Bullet Seed')).toEqual([{ hits: 4, chance: 0.5 }, { hits: 5, chance: 0.5 }]);
    });

    test("an ability that sets the count gives the simulator's count: Skill Link the top, Battle Bond three", () => {
      const link = battleOf('gen9customgame', [set('Cinccino', ['bulletseed'], { ability: 'Skill Link' })], [splash('Snorlax')]);
      const linkHits = powerInTurn(link, { p1: 'move 1', p2: 'move 1' }, 'bulletseed').length;
      expect(linkHits).toBe(5);
      expect(hitCounts(rulesDex(9), gear('Cinccino', 'Skill Link'), 'Bullet Seed')).toEqual([{ hits: linkHits, chance: 1 }]);
      // Battle Bond's own onModifyMove gives Ash-Greninja's Water Shuriken three hits; plain Greninja draws 2 to 5.
      const ash = set('Greninja-Ash', ['watershuriken'], { ability: 'Battle Bond' });
      const drawn = Array.from({ length: 12 }, (_, index) => hitsInTurn('gen7customgame', ash, splash('Snorlax'), 'watershuriken', `${index + 1},2,3,4`));
      expect(new Set(drawn)).toEqual(new Set([3]));
      expect(hitCounts(rulesDex(7), gear('Greninja-Ash', 'Battle Bond'), 'Water Shuriken')).toEqual([{ hits: 3, chance: 1 }]);
      expect(hitCounts(rulesDex(7), gear('Greninja', 'Torrent'), 'Water Shuriken')?.map(entry => entry.hits)).toEqual([2, 3, 4, 5]);
    });

    test('fixed counts from the Dex leave the calc its own single count', () => {
      for (const name of ['Double Hit', 'Surging Strikes', 'Triple Dive', 'Dragon Darts', 'Population Bomb', 'Earthquake']) {
        expect(hitCounts(rulesDex(9), gear('Garchomp'), name), name).toBeNull();
      }
    });
  });
});

describe('damage-calc-ko', () => {
  const gen9 = Generations.get(9);
  const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

  function mon(species: string, overrides: Partial<SimPokemonInfo> = {}): SimPokemonInfo {
    const evs = overrides.evs ?? { ...STATS, hp: 252, atk: 252 };
    const maxhp = new Pokemon(gen9, species, { level: overrides.level ?? 100, evs }).maxHP();
    return {
      name: species, species, hp: maxhp, maxhp, hpPercent: 100, status: '', fainted: false, isActive: true, activeSlot: 0,
      moves: [], ability: '', item: '', stats: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 'Hardy', evs,
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, gender: '', teraType: '', boosts: {}, level: 100,
      types: [], ...overrides,
    };
  }

  const move = (name: string, targetType = 'normal'): BranchMoveOption =>
    ({ name, activeSlot: 0, slot: 1, pp: 16, maxpp: 16, disabled: false, type: '', targetType, requiresTarget: false, targetOptions: [] });

  function calcVerdict(attacker: SimPokemonInfo, defender: SimPokemonInfo, name: string, gameType: 'Singles' | 'Doubles' = 'Singles') {
    const poke = (info: SimPokemonInfo) => new Pokemon(gen9, info.species, {
      level: info.level, ability: info.ability || undefined, item: info.item || undefined, nature: info.nature,
      evs: info.evs, ivs: info.ivs, curHP: info.hp,
    });
    return calculate(gen9, poke(attacker), poke(defender), new Move(gen9, name), new Field({ gameType })).kochance(false);
  }

  describe('the KO text reads the defender\'s current HP', () => {
    const garchomp = mon('Garchomp');
    const snorlax = mon('Snorlax', { evs: { ...STATS, hp: 252, def: 252 } });

    test('a damaged target the hit finishes reads as a guaranteed KO, as the calc says', () => {
      const full = calcSingleDamageRange(garchomp, snorlax, move('Earthquake', 'allAdjacent'));
      expect(full.maxPercent).toBeLessThan(50);
      const lowHp = Math.floor(snorlax.maxhp * full.minPercent / 100) - 1;
      const damaged = { ...snorlax, hp: lowHp };
      expect(calcVerdict(garchomp, damaged, 'Earthquake')).toMatchObject({ n: 1, chance: 1 });
      expect(calcSingleDamageRange(garchomp, damaged, move('Earthquake', 'allAdjacent')).koChance).toBe(calcVerdict(garchomp, damaged, 'Earthquake').text);
    });

    test('every HP the target can stand at reads the calc\'s verdict, up to a 4HKO', () => {
      for (const share of [1, 0.9, 0.75, 0.6, 0.45, 0.4, 0.35, 0.2]) {
        const damaged = { ...snorlax, hp: Math.max(1, Math.round(snorlax.maxhp * share)) };
        const verdict = calcVerdict(garchomp, damaged, 'Earthquake');
        const expected = verdict.n >= 1 && verdict.n <= 4 ? verdict.text : '';
        expect(calcSingleDamageRange(garchomp, damaged, move('Earthquake', 'allAdjacent')).koChance).toBe(expected);
      }
    });

    test('doubles: a spread hit into a damaged target reads the calc\'s verdict for the spread damage', () => {
      const blissey = mon('Blissey');
      const damaged = { ...snorlax, hp: Math.round(snorlax.maxhp * 0.2) };
      const verdict = calcVerdict(garchomp, damaged, 'Earthquake', 'Doubles');
      expect(verdict.n).toBe(1);
      const result = calcSingleDamageRange(garchomp, damaged, move('Earthquake', 'allAdjacent'),
        { gameType: 'Doubles', defenderPartner: blissey, attackerPartnerAlive: true });
      expect(result.koChance).toBe(verdict.text);
    });

    test('a status move has no KO text', () => {
      expect(calcSingleDamageRange(garchomp, snorlax, move('Swords Dance', 'self')).koChance).toBe('');
    });
  });
});

describe('damage-gen', () => {
  function mon(overrides: Partial<SimPokemonInfo> & { species: string }): SimPokemonInfo {
    return {
      name: overrides.species,
      hp: 300,
      maxhp: 300,
      hpPercent: 100,
      status: '',
      fainted: false,
      isActive: true,
      activeSlot: 0,
      moves: [],
      ability: '',
      item: '',
      stats: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      nature: 'Hardy',
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      gender: '',
      teraType: '',
      boosts: {},
      level: 100,
      ...overrides,
    };
  }

  function move(name: string, type: string): BranchMoveOption {
    return {
      name,
      activeSlot: 0,
      slot: 1,
      pp: 16,
      maxpp: 16,
      disabled: false,
      type,
      targetType: 'normal',
      requiresTarget: false,
      targetOptions: [],
    };
  }

  describe('damage calc follows the replay generation (B5)', () => {
    test('gen 3 Explosion halves defense while gen 9 does not', () => {
      const registeel = mon({ species: 'Registeel', evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 }, nature: 'Adamant' });
      const swampert = mon({ species: 'Swampert', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 } });

      const gen9 = calcSingleDamageRange(registeel, swampert, move('Explosion', 'Normal'), { gen: 9 });
      const gen3 = calcSingleDamageRange(registeel, swampert, move('Explosion', 'Normal'), { gen: 3 });

      expect(gen9.maxPercent).toBeGreaterThan(0);
      // Gen 3 Explosion halves the target's defense — roughly double damage.
      expect(gen3.maxPercent).toBeGreaterThan(gen9.maxPercent * 1.7);
    });

    test('gen 3 Dragon Claw is special (physical/special split by type)', () => {
      const salamence = mon({ species: 'Salamence', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, nature: 'Adamant' });
      const swampert = mon({ species: 'Swampert', evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } });

      const gen9 = calcSingleDamageRange(salamence, swampert, move('Dragon Claw', 'Dragon'), { gen: 9 });
      const gen3 = calcSingleDamageRange(salamence, swampert, move('Dragon Claw', 'Dragon'), { gen: 3 });

      expect(gen3.maxPercent).toBeGreaterThan(0);
      expect(gen3.maxPercent).toBeLessThan(gen9.maxPercent);
    });
  });

  describe('damage calc applies the sim set modifiers (B6)', () => {
    test('Technician boosts low-power moves by 1.5x', () => {
      const base = { species: 'Scizor', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, nature: 'Adamant' } as const;
      const garchomp = mon({ species: 'Garchomp' });

      const withTechnician = calcSingleDamageRange(mon({ ...base, ability: 'Technician' }), garchomp, move('Bullet Punch', 'Steel'), {});
      const withoutTechnician = calcSingleDamageRange(mon({ ...base, ability: 'Light Metal' }), garchomp, move('Bullet Punch', 'Steel'), {});

      expect(withTechnician.maxPercent / withoutTechnician.maxPercent).toBeGreaterThan(1.4);
    });

    test('Life Orb boosts damage by 1.3x', () => {
      const base = { species: 'Hydreigon', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 }, nature: 'Timid' } as const;
      const froslass = mon({ species: 'Froslass' });

      const withOrb = calcSingleDamageRange(mon({ ...base, item: 'Life Orb' }), froslass, move('Dark Pulse', 'Dark'), {});
      const withoutOrb = calcSingleDamageRange(mon({ ...base }), froslass, move('Dark Pulse', 'Dark'), {});

      expect(withOrb.maxPercent / withoutOrb.maxPercent).toBeGreaterThan(1.25);
    });
  });

  describe('damage calc respects field conditions', () => {
    test('Reflect halves physical damage on the defender side', () => {
      const garchomp = mon({ species: 'Garchomp', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, nature: 'Jolly' });
      const tyranitar = mon({ species: 'Tyranitar' });

      const noScreen = calcSingleDamageRange(garchomp, tyranitar, move('Earthquake', 'Ground'), {});
      const withReflect = calcSingleDamageRange(garchomp, tyranitar, move('Earthquake', 'Ground'), {
        defenderSideConditions: ['reflect'],
      });

      expect(withReflect.maxPercent).toBeLessThan(noScreen.maxPercent * 0.6);
    });

    test('rain boosts water moves', () => {
      const pelipper = mon({ species: 'Pelipper', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 }, nature: 'Modest' });
      const garchomp = mon({ species: 'Garchomp' });

      const clear = calcSingleDamageRange(pelipper, garchomp, move('Hydro Pump', 'Water'), {});
      const rain = calcSingleDamageRange(pelipper, garchomp, move('Hydro Pump', 'Water'), { weather: 'raindance' });

      expect(rain.maxPercent / clear.maxPercent).toBeGreaterThan(1.4);
    });
  });
});
