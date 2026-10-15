import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { residualReader, residualStats } from '../src/score/residuals';
import { statusResidual } from '../src/score/races';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf, fingerprint } from './power-oracle';

/**
 * 13.10.2026 (the Swords Dance report on gen9draft-2058494320): the per-turn HP a body in a race gains or loses at
 * the end of the turn, from the simulator and not from a list of names. The reader plays three end-of-turns on a
 * copy of the battle (the HP of the actives set to 3/4 before each, so that no cap bends the reading) and gives the
 * mean loss per turn as a fraction of each active's max HP. Every scene is held to the simulator's own idle turns on a
 * second copy of the same board: Leech Seed (the seeded body loses, the active of the seeder's side heals), item
 * regeneration, weather, terrain, the statuses, in Scarlet and Violet, on the Champions mod and in an old generation.
 */

await loadSimMods('gen9championscustomgame');

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const CHAMPIONS = 'gen9championscustomgame';
const mon = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

const actives = (battle: Battle): Pokemon[] => battle.sides.flatMap(side => side.active.filter((entry): entry is Pokemon => !!entry));

/** The simulator's own idle turns: HP back to 3/4 before each of three turns, everybody Splashing; the mean loss per turn. */
function played(battle: Battle): number[] {
  const bodies = actives(battle);
  const lost = bodies.map(() => 0);
  const doubles = battle.gameType === 'doubles';
  for (let turn = 0; turn < 3; turn++) {
    const before = bodies.map(body => { body.sethp(Math.floor((body.maxhp * 3) / 4)); return body.hp; });
    battle.choose('p1', doubles ? 'move 1, move 1' : 'move 1');
    battle.choose('p2', doubles ? 'move 1, move 1' : 'move 1');
    bodies.forEach((body, index) => { lost[index] += (before[index] - body.hp) / body.maxhp; });
  }
  return lost.map(sum => sum / 3);
}

/** What the reader says for every active of a fresh copy, against the idle turns of another. */
function readAgainstSimulator(build: () => Battle): { read: number[]; real: number[] } {
  const battle = build();
  const reader = residualReader(battle);
  return { read: actives(battle).map(body => reader(body) as number), real: played(build()) };
}

function expectSimulator(build: () => Battle): number[] {
  const { read, real } = readAgainstSimulator(build);
  expect(read.length).toBe(real.length);
  read.forEach((value, index) => expect(value, `active ${index}`).toBeCloseTo(real[index], 12));
  return read;
}

const seeded = (format = SINGLES, seederExtra: Partial<PokemonSet> = {}, targetExtra: Partial<PokemonSet> = {}) => () => {
  const battle = battleOf(format, [mon('Chansey', seederExtra)], [mon('Snorlax', targetExtra)]);
  battle.sides[1].active[0]!.addVolatile('leechseed', battle.sides[0].active[0]!);
  return battle;
};

describe('the end of the turn, played on a copy', () => {
  test('Leech Seed: the seeded body loses 1/8 of its max HP, the active of the seeder\'s side gains the same HP', () => {
    const [seeder, target] = expectSimulator(seeded());
    const battle = seeded()();
    const [chansey, snorlax] = actives(battle);
    expect(target).toBeCloseTo(1 / 8, 2);
    expect(seeder).toBeCloseTo(-(snorlax.maxhp / 8 / chansey.maxhp), 2);
    expect(seeder).toBeLessThan(0);
  });

  test('Leech Seed under Magic Guard: no damage, so the seeder heals nothing', () => {
    const [seeder, target] = expectSimulator(seeded(SINGLES, {}, { ability: 'Magic Guard' }));
    expect(target).toBe(0);
    expect(seeder).toBe(0);
  });

  test('Leech Seed in doubles: the seed heals the body in the seeder\'s slot, whoever stands there', () => {
    const build = () => {
      const battle = battleOf(DOUBLES, [mon('Chansey'), mon('Garchomp')], [mon('Snorlax'), mon('Clefable')]);
      battle.sides[1].active[1]!.addVolatile('leechseed', battle.sides[0].active[1]!);
      return battle;
    };
    const rates = expectSimulator(build);
    // p1 slot 0 Chansey, slot 1 Garchomp (the seeder), p2 slot 0 Snorlax, slot 1 Clefable (seeded).
    expect(rates[0]).toBe(0);
    expect(rates[1]).toBeLessThan(0);
    expect(rates[2]).toBe(0);
    expect(rates[3]).toBeCloseTo(1 / 8, 2);
  });

  test('Leftovers heal 1/16 (a negative loss); Black Sludge heals a Poison type 1/16 and costs anybody else 1/8', () => {
    const [leftovers] = expectSimulator(() => battleOf(SINGLES, [mon('Snorlax', { item: 'leftovers' })], [mon('Snorlax')]));
    expect(leftovers).toBeCloseTo(-1 / 16, 2);
    const [poison, other] = expectSimulator(() => battleOf(SINGLES, [mon('Tentacruel', { item: 'blacksludge' })], [mon('Snorlax', { item: 'blacksludge' })]));
    expect(poison).toBeCloseTo(-1 / 16, 2);
    expect(other).toBeCloseTo(1 / 8, 2);
  });

  test('weather: sandstorm costs 1/16 and spares the Rock type, Rain Dish heals 1/16 in the rain', () => {
    const sand = () => {
      const battle = battleOf(SINGLES, [mon('Snorlax')], [mon('Tyranitar')]);
      battle.field.setWeather('sandstorm', 'debug');
      return battle;
    };
    const [chip, spared] = expectSimulator(sand);
    expect(chip).toBeCloseTo(1 / 16, 2);
    expect(spared).toBe(0);
    const rain = () => {
      const battle = battleOf(SINGLES, [mon('Snorlax', { ability: 'Rain Dish' })], [mon('Snorlax')]);
      battle.field.setWeather('raindance', 'debug');
      return battle;
    };
    expect(expectSimulator(rain)[0]).toBeCloseTo(-1 / 16, 2);
  });

  test('a weather on its last turn still counts: the reading is the steady state of the conditions', () => {
    const last = () => {
      const battle = battleOf(SINGLES, [mon('Snorlax')], [mon('Snorlax')]);
      battle.field.setWeather('sandstorm', 'debug');
      battle.field.weatherState.duration = 1;
      return battle;
    };
    const battle = last();
    expect(residualReader(battle)(battle.sides[0].active[0]!)).toBeCloseTo(1 / 16, 2);
    expect(battle.field.weatherState.duration).toBe(1);
  });

  test('terrain: Grassy Terrain heals a grounded body 1/16 and not a flier', () => {
    const grass = () => {
      const battle = battleOf(SINGLES, [mon('Snorlax')], [mon('Pidgeot')]);
      battle.field.setTerrain('grassyterrain', 'debug');
      return battle;
    };
    const [grounded, flier] = expectSimulator(grass);
    expect(grounded).toBeCloseTo(-1 / 16, 2);
    expect(flier).toBe(0);
  });

  test('statuses: burn 1/16 and poison 1/8 in Scarlet and Violet, toxic the mean of its next three turns (1/16, 2/16, 3/16)', () => {
    const statused = (status: string, format = SINGLES, species = 'Snorlax') => () => {
      const battle = battleOf(format, [mon(species)], [mon('Snorlax')]);
      battle.sides[0].active[0]!.setStatus(status);
      return battle;
    };
    expect(expectSimulator(statused('brn'))[0]).toBeCloseTo(1 / 16, 2);
    expect(expectSimulator(statused('psn'))[0]).toBeCloseTo(1 / 8, 2);
    expect(expectSimulator(statused('tox'))[0]).toBeCloseTo(1 / 8, 2);
  });

  test('the statuses agree with the table of the race where the table holds (every generation it is proved for)', () => {
    for (const gen of [3, 4, 5, 6, 7, 8, 9]) {
      for (const status of ['brn', 'psn'] as const) {
        const battle = battleOf(`gen${gen}customgame`, [mon('Chansey')], [mon('Chansey')]);
        const body = battle.sides[0].active[0]!;
        body.setStatus(status);
        expect(residualReader(battle)(body), `gen ${gen} ${status}`).toBeCloseTo(statusResidual(body), 2);
      }
    }
  });

  test('generations 1 and 2 have no reading: their status damage comes after the move of the body, not at the end of the turn, so the race keeps the table', () => {
    for (const gen of [1, 2]) {
      const battle = battleOf(`gen${gen}customgame`, [mon('Chansey')], [mon('Chansey')]);
      const body = battle.sides[0].active[0]!;
      body.setStatus('brn');
      expect(residualReader(battle)(body), `gen ${gen}`).toBeUndefined();
      expect(statusResidual(body), `gen ${gen}`).toBeGreaterThan(0);
    }
  });

  test('the Champions mod: Leech Seed and Leftovers on a copy of a Champions battle', () => {
    const SP = { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 };
    const [seeder, target] = expectSimulator(() => {
      const battle = battleOf(CHAMPIONS, [set('Chansey', ['splash'], { item: 'leftovers', evs: SP, level: 50 })], [set('Snorlax', ['splash'], { evs: SP, level: 50 })]);
      battle.sides[1].active[0]!.addVolatile('leechseed', battle.sides[0].active[0]!);
      return battle;
    });
    expect(target).toBeCloseTo(1 / 8, 2);
    expect(seeder).toBeLessThan(-1 / 16);
  });
});

describe('the reader leaves the battle alone and answers for the actives', () => {
  test('the log, the dice, the queues and every body are as before; a bench body and a fainted active have no reading', () => {
    const battle = battleOf(SINGLES, [mon('Chansey'), mon('Garchomp')], [mon('Snorlax')]);
    battle.sides[1].active[0]!.addVolatile('leechseed', battle.sides[0].active[0]!);
    const everyone = [...battle.sides[0].pokemon, ...battle.sides[1].pokemon];
    const before = fingerprint(battle, everyone, 'splash');
    const reader = residualReader(battle);
    expect(reader(battle.sides[1].active[0]!)).toBeCloseTo(1 / 8, 2);
    expect(reader(battle.sides[0].pokemon[1])).toBeUndefined();
    expect(fingerprint(battle, everyone, 'splash')).toBe(before);
    expect(battle.sides[1].active[0]!.volatiles['leechseed']).toBeTruthy();
    const down = battleOf(SINGLES, [mon('Chansey')], [mon('Snorlax')]);
    const fainted = down.sides[1].active[0]!;
    fainted.faint();
    expect(residualReader(down)(fainted)).toBeUndefined();
  });

  test('the answer is a function of the board: HP does not move it, an item taken or a status given does', () => {
    const build = (hp: number, item: string, status = '') => {
      const battle = battleOf(SINGLES, [mon('Snorlax', { item })], [mon('Snorlax')]);
      const body = battle.sides[0].active[0]!;
      body.sethp(Math.max(1, Math.floor(body.maxhp * hp)));
      if (status) body.setStatus(status);
      return { battle, body };
    };
    const read = (scene: ReturnType<typeof build>) => residualReader(scene.battle)(scene.body)!;
    const full = read(build(1, 'leftovers'));
    expect(read(build(0.05, 'leftovers'))).toBe(full);
    expect(read(build(0.5, 'leftovers'))).toBe(full);
    expect(read(build(1, ''))).toBe(0);
    expect(read(build(1, 'leftovers', 'brn'))).toBeCloseTo(full + 1 / 16, 2);
  });

  test('a board seen before is answered from the memo; a board with another item is played again', () => {
    const board = (item: string) => {
      const battle = battleOf(SINGLES, [mon('Gengar', { item, ability: 'Cursed Body' })], [mon('Gengar', { item: 'lifeorb', ability: 'Cursed Body' })]);
      return battle;
    };
    const first = board('shellbell');
    residualReader(first)(first.sides[0].active[0]!);
    const plays = residualStats.plays;
    const hits = residualStats.hits;
    const again = board('shellbell');
    again.sides[0].active[0]!.sethp(10);
    expect(residualReader(again)(again.sides[0].active[0]!)).toBe(residualReader(first)(first.sides[0].active[0]!));
    expect(residualStats.plays).toBe(plays);
    expect(residualStats.hits).toBeGreaterThan(hits);
    const other = board('rockyhelmet');
    residualReader(other)(other.sides[0].active[0]!);
    expect(residualStats.plays).toBe(plays + 1);
  });

  test('the reader plays nothing until it is asked, and asked twice it plays once', () => {
    const board = battleOf(SINGLES, [mon('Gyarados', { item: 'sitrusberry' })], [mon('Gyarados', { item: 'lumberry' })]);
    const plays = residualStats.plays;
    const reader = residualReader(board);
    expect(residualStats.plays).toBe(plays);
    reader(board.sides[0].active[0]!);
    reader(board.sides[1].active[0]!);
    reader(board.sides[0].active[0]!);
    expect(residualStats.plays).toBe(plays + 1);
  });
});
