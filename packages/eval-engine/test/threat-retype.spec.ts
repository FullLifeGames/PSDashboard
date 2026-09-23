import { test, expect, describe } from 'vitest';
import { pairThreat, singleMoveFraction } from '../src/score/threat';
import { active, clickTera, set, singles } from './move-oracle';

/**
 * Round 57 (T73): the static prices a move with the type it has at use.
 * Anchor: smogtours-gen9doublesou-937926 turn 2, Hyper Voice of a Liquid
 * Voice Primarina into a Sneasler that terastallized to Ghost read 0 while
 * the damage calc read 71 to 84 % (the pair is an unplayed option).
 */
describe('body retypes in the static (round 57)', () => {
  test('Liquid Voice Hyper Voice hits a Tera-Ghost Sneasler', () => {
    const battle = singles('gen9customgame',
      [set('Sneasler', ['splash'], { teraType: 'Ghost' })],
      [set('Primarina', ['splash', 'hypervoice'], { ability: 'Liquid Voice' })]);
    clickTera(battle, 0);
    expect(singleMoveFraction(active(battle, 1), active(battle, 0), 'hypervoice', battle)).toBeGreaterThan(0.2);
  });

  test('Wellspring Ivy Cudgel is absorbed by Water Absorb', () => {
    const battle = singles('gen9customgame',
      [set('Ogerpon-Wellspring', ['ivycudgel'], { item: 'Wellspring Mask', ability: 'Water Absorb' })],
      [set('Vaporeon', ['splash'], { ability: 'Water Absorb' })]);
    expect(singleMoveFraction(active(battle, 0), active(battle, 1), 'ivycudgel', battle)).toBe(0);
  });

  test('Pixilate Hyper Voice hits a Ghost and lands in the special bucket', () => {
    const battle = singles('gen9customgame', [set('Sylveon', ['hypervoice'], { ability: 'Pixilate' })], [set('Gengar', ['splash'])]);
    expect(pairThreat(active(battle, 0), active(battle, 1), battle).special).toBeGreaterThan(0.2);
  });

  test("Scrappy and Mind's Eye hit Ghosts with Normal and Fighting moves", () => {
    const scrappy = singles('gen9customgame', [set('Kangaskhan', ['doubleedge', 'drainpunch'], { ability: 'Scrappy' })], [set('Gengar', ['splash'])]);
    expect(singleMoveFraction(active(scrappy, 0), active(scrappy, 1), 'doubleedge', scrappy)).toBeGreaterThan(0.2);
    expect(singleMoveFraction(active(scrappy, 0), active(scrappy, 1), 'drainpunch', scrappy)).toBeGreaterThan(0.05);
    const eye = singles('gen9customgame', [set('Ursaluna-Bloodmoon', ['bloodmoon'], { ability: "Mind's Eye" })], [set('Gengar', ['splash'])]);
    expect(singleMoveFraction(active(eye, 0), active(eye, 1), 'bloodmoon', eye)).toBeGreaterThan(0.2);
    const plain = singles('gen9customgame', [set('Kangaskhan', ['doubleedge'], { ability: 'Early Bird' })], [set('Gengar', ['splash'])]);
    expect(singleMoveFraction(active(plain, 0), active(plain, 1), 'doubleedge', plain)).toBe(0);
  });
});

describe('field retypes in the static (round 57)', () => {
  test('Weather Ball in rain hits a Ghost (gen9ou-2658663604 turn 11)', () => {
    const battle = singles('gen9customgame', [set('Pelipper', ['weatherball'], { ability: 'Drizzle' })], [set('Gengar', ['splash'])]);
    expect(singleMoveFraction(active(battle, 0), active(battle, 1), 'weatherball', battle)).toBeGreaterThan(0.2);
  });
});

describe('Tera retypes in the static (round 57)', () => {
  test('Tera-Fairy Tera Blast lands in the physical bucket against a Dragon', () => {
    const battle = singles('gen9customgame', [set('Dragonite', ['splash', 'terablast'], { teraType: 'Fairy', nature: 'Adamant' })], [set('Garchomp', ['splash'])]);
    const before = pairThreat(active(battle, 0), active(battle, 1), battle);
    clickTera(battle, 0);
    const after = pairThreat(active(battle, 0), active(battle, 1), battle);
    expect(after.physical).toBeGreaterThan(before.special * 2);
  });

  test('a Stellar Tera Blast hits a terastallized target twice as hard', () => {
    const battle = singles('gen9customgame', [set('Garchomp', ['splash', 'terablast'], { teraType: 'Stellar' })], [set('Snorlax', ['splash'], { teraType: 'Normal' })]);
    clickTera(battle, 0);
    const plain = singleMoveFraction(active(battle, 0), active(battle, 1), 'terablast', battle);
    clickTera(battle, 1);
    expect(singleMoveFraction(active(battle, 0), active(battle, 1), 'terablast', battle)).toBeCloseTo(plain * 2, 5);
  });
});
