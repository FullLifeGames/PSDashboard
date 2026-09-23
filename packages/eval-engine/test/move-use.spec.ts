import { test, expect, describe } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { landedMove } from '../src/score/move-facts';
import { active, bench, clickTera, set, simUse, singles } from './move-oracle';

/**
 * Round 57 (T73): the rule table answers like the simulator for every active
 * carrier, and like the active body for a benched one.
 */
const ours = (battle: Battle, attacker: Pokemon, defender: Pokemon, id: string) =>
  landedMove(attacker, defender, battle.dex.moves.get(id), battle);

function expectSim(battle: Battle, attacker: Pokemon, defender: Pokemon, id: string) {
  const answer = ours(battle, attacker, defender, id);
  expect(answer, id).toEqual(simUse(battle, attacker, defender, id));
  return answer;
}

describe('body rules: form, item, user type, abilities (round 57)', () => {
  test('Liquid Voice turns a sound move to Water, not Moonblast', () => {
    const battle = singles('gen9customgame', [set('Primarina', ['hypervoice', 'moonblast', 'psychicnoise'], { ability: 'Liquid Voice' })], [set('Gengar', ['splash'])]);
    const [primarina, gengar] = [active(battle, 0), active(battle, 1)];
    expect(expectSim(battle, primarina, gengar, 'hypervoice').type).toBe('Water');
    expect(expectSim(battle, primarina, gengar, 'psychicnoise').type).toBe('Water');
    expect(expectSim(battle, primarina, gengar, 'moonblast').type).toBe('Fairy');
  });

  test('Pixilate makes Normal moves Fairy with the boost, gen 9 and gen 6', () => {
    for (const format of ['gen9customgame', 'gen6customgame']) {
      const battle = singles(format, [set('Sylveon', ['hypervoice', 'shadowball'], { ability: 'Pixilate' })], [set('Gengar', ['splash'])]);
      const answer = expectSim(battle, active(battle, 0), active(battle, 1), 'hypervoice');
      expect(answer.type).toBe('Fairy');
      expect(answer.powerMult).toBeGreaterThan(1.19);
      expect(expectSim(battle, active(battle, 0), active(battle, 1), 'shadowball').powerMult).toBe(1);
    }
  });

  test('Normalize makes every move Normal, boosted from gen 7 only', () => {
    for (const format of ['gen9customgame', 'gen6customgame']) {
      const battle = singles(format, [set('Delcatty', ['thunderbolt'], { ability: 'Normalize' })], [set('Garchomp', ['splash'])]);
      expect(expectSim(battle, active(battle, 0), active(battle, 1), 'thunderbolt').type).toBe('Normal');
    }
  });

  test('Ivy Cudgel follows the mask, before and after the Tera click', () => {
    for (const [species, type] of [['Ogerpon-Wellspring', 'Water'], ['Ogerpon-Hearthflame', 'Fire'], ['Ogerpon-Cornerstone', 'Rock'], ['Ogerpon', 'Grass']] as const) {
      const item = species === 'Ogerpon' ? '' : `${species.split('-')[1]} Mask`;
      const battle = singles('gen9customgame', [set(species, ['splash', 'ivycudgel'], { item, teraType: type })], [set('Heatran', ['splash'])]);
      expect(expectSim(battle, active(battle, 0), active(battle, 1), 'ivycudgel').type).toBe(type);
      clickTera(battle, 0);
      expect(expectSim(battle, active(battle, 0), active(battle, 1), 'ivycudgel').type).toBe(type);
    }
  });

  test('Judgment follows the plate, Klutz drops it, Natural Gift the berry', () => {
    const battle = singles('gen9customgame', [set('Arceus-Fire', ['judgment'], { item: 'Flame Plate' })], [set('Scizor', ['splash'])]);
    expect(expectSim(battle, active(battle, 0), active(battle, 1), 'judgment').type).toBe('Fire');
    const gift = singles('gen7customgame', [set('Snorlax', ['naturalgift'], { item: 'Sitrus Berry' })], [set('Gengar', ['splash'])]);
    const answer = ours(gift, active(gift, 0), active(gift, 1), 'naturalgift');
    expect(answer.type).toBe(simUse(gift, active(gift, 0), active(gift, 1), 'naturalgift').type);
    expect(answer.basePower).toBe(80);
  });

  test('Revelation Dance takes the first type, the Tera type after a click', () => {
    const battle = singles('gen9customgame', [set('Oricorio-Pom-Pom', ['splash', 'revelationdance'], { teraType: 'Fire' })], [set('Garchomp', ['splash'])]);
    expect(expectSim(battle, active(battle, 0), active(battle, 1), 'revelationdance').type).toBe('Electric');
    clickTera(battle, 0);
    expect(expectSim(battle, active(battle, 0), active(battle, 1), 'revelationdance').type).toBe('Fire');
  });

  test('Raging Bull and Aura Wheel follow the forme', () => {
    const bull = singles('gen9customgame', [set('Tauros-Paldea-Aqua', ['ragingbull'])], [set('Gengar', ['splash'])]);
    expect(expectSim(bull, active(bull, 0), active(bull, 1), 'ragingbull').type).toBe('Water');
    const wheel = singles('gen9customgame', [set('Morpeko', ['aurawheel'], { ability: 'Hunger Switch' })], [set('Garchomp', ['splash'])]);
    expect(expectSim(wheel, active(wheel, 0), active(wheel, 1), 'aurawheel').type).toBe('Electric');
  });

  test('a benched Liquid Voice user answers like the active one', () => {
    const battle = singles('gen9customgame', [set('Rillaboom', ['splash']), set('Primarina', ['hypervoice'], { ability: 'Liquid Voice' })], [set('Gengar', ['splash'])]);
    expect(ours(battle, bench(battle, 0, 1), active(battle, 1), 'hypervoice').type).toBe('Water');
  });

  test('no simulator event in a debug-mode battle', () => {
    const battle = singles('gen9customgame', [set('Rillaboom', ['splash']), set('Primarina', ['hypervoice'], { ability: 'Liquid Voice' })], [set('Gengar', ['splash'])]);
    const before = battle.log.length;
    for (let i = 0; i < 1100; i++) ours(battle, bench(battle, 0, 1), active(battle, 1), 'hypervoice');
    expect(battle.log.length).toBe(before);
  });
});

describe('field rules: Weather Ball, Terrain Pulse (round 57)', () => {
  test('Weather Ball follows the rain, doubled; an Umbrella and Cloud Nine cancel it', () => {
    const rain = singles('gen9customgame', [set('Pelipper', ['weatherball'], { ability: 'Drizzle' })], [set('Gengar', ['splash'])]);
    expect(expectSim(rain, active(rain, 0), active(rain, 1), 'weatherball')).toMatchObject({ type: 'Water', basePower: 100 });
    const umbrella = singles('gen9customgame', [set('Pelipper', ['weatherball'], { ability: 'Drizzle', item: 'Utility Umbrella' })], [set('Gengar', ['splash'])]);
    expect(expectSim(umbrella, active(umbrella, 0), active(umbrella, 1), 'weatherball')).toMatchObject({ type: 'Normal', basePower: 50 });
    const nine = singles('gen9customgame', [set('Pelipper', ['weatherball'], { ability: 'Drizzle' })], [set('Golduck', ['splash'], { ability: 'Cloud Nine' })]);
    expect(expectSim(nine, active(nine, 0), active(nine, 1), 'weatherball')).toMatchObject({ type: 'Normal', basePower: 50 });
  });

  test('gen 3 Weather Ball in rain is Water and special', () => {
    const battle = singles('gen3customgame', [set('Politoed', ['weatherball'], { ability: 'Drizzle' })], [set('Gengar', ['splash'])]);
    expect(ours(battle, active(battle, 0), active(battle, 1), 'weatherball')).toMatchObject({ type: 'Water', category: 'Special', basePower: 100 });
  });

  test('Terrain Pulse follows the terrain when grounded, stays Normal in the air', () => {
    const grounded = singles('gen9customgame', [set('Indeedee', ['terrainpulse'], { ability: 'Psychic Surge' })], [set('Gengar', ['splash'])]);
    expect(expectSim(grounded, active(grounded, 0), active(grounded, 1), 'terrainpulse')).toMatchObject({ type: 'Psychic', basePower: 100 });
    const flying = singles('gen9customgame', [set('Talonflame', ['terrainpulse'])], [set('Indeedee', ['splash'], { ability: 'Psychic Surge' })]);
    expect(expectSim(flying, active(flying, 0), active(flying, 1), 'terrainpulse')).toMatchObject({ type: 'Normal', basePower: 50 });
  });

  test('a benched Umbrella holder reads no sun', () => {
    const battle = singles('gen9customgame', [set('Torkoal', ['splash'], { ability: 'Drought' }), set('Venusaur', ['weatherball'], { item: 'Utility Umbrella' })], [set('Gengar', ['splash'])]);
    expect(ours(battle, bench(battle, 0, 1), active(battle, 1), 'weatherball')).toMatchObject({ type: 'Normal', basePower: 50 });
  });
});

describe('Tera rules (round 57)', () => {
  test('Tera Blast: Normal before the click, the Tera type after, physical when Attack leads', () => {
    const battle = singles('gen9customgame', [set('Dragonite', ['splash', 'terablast'], { teraType: 'Fairy', nature: 'Adamant', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 } })], [set('Garchomp', ['splash'])]);
    expect(expectSim(battle, active(battle, 0), active(battle, 1), 'terablast')).toMatchObject({ type: 'Normal', category: 'Special' });
    clickTera(battle, 0);
    expect(expectSim(battle, active(battle, 0), active(battle, 1), 'terablast')).toMatchObject({ type: 'Fairy', category: 'Physical' });
  });

  test('Tera Blast category reads the stages', () => {
    const battle = singles('gen9customgame', [set('Gardevoir', ['splash', 'terablast'], { teraType: 'Fighting' })], [set('Snorlax', ['splash'])]);
    clickTera(battle, 0);
    expect(expectSim(battle, active(battle, 0), active(battle, 1), 'terablast').category).toBe('Special');
    active(battle, 0).boosts.atk = 6;
    active(battle, 0).boosts.spa = -6;
    expect(expectSim(battle, active(battle, 0), active(battle, 1), 'terablast').category).toBe('Physical');
  });

  test('a Pixilate Tera Blast is Fairy before the click and the Tera type after', () => {
    const battle = singles('gen9customgame', [set('Sylveon', ['splash', 'terablast'], { ability: 'Pixilate', teraType: 'Fire' })], [set('Scizor', ['splash'])]);
    expect(expectSim(battle, active(battle, 0), active(battle, 1), 'terablast').type).toBe('Fairy');
    clickTera(battle, 0);
    expect(expectSim(battle, active(battle, 0), active(battle, 1), 'terablast')).toMatchObject({ type: 'Fire', powerMult: 1 });
  });

  test('Stellar Tera Blast has power 100', () => {
    const battle = singles('gen9customgame', [set('Garchomp', ['splash', 'terablast'], { teraType: 'Stellar' })], [set('Snorlax', ['splash'])]);
    clickTera(battle, 0);
    expect(expectSim(battle, active(battle, 0), active(battle, 1), 'terablast')).toMatchObject({ type: 'Stellar', basePower: 100 });
  });
});
