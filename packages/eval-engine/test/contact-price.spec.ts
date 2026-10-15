import { describe, expect, test } from 'vitest';
import { MAX_PRICED_HITS, priceHit } from '../src/score/contact-price';
import { raceClocks } from '../src/score/races';
import { NO_COST, type HitCost, type StatusCost } from '../src/score/contact';

/**
 * 13.10.2026 (the Swords Dance report on gen9draft-2058494320, the contact punishments): how the reading of one hit
 * (score/contact.ts) enters a race. The chip of a hit is paid right after the hit, for every hit: the side that moves
 * first has paid t chips when the other side lands its t-th hit, the side that moves second t - 1 (a buffer of one chip of
 * HP gives the clock of that). A status chance compounds over the hits: a status that lands on hit j takes its chip at the
 * end of the turns j to the turn before the other side's last hit and changes the damage of the hits after j. The oracle
 * here lists every way the statuses can land, hit by hit, with its probability; the clock tests hold the chip to the
 * exact turn-by-turn race of two sides.
 */

const status = (name: string, chance: number, chip: number, output: number): StatusCost => ({ status: name, chance, chip, output });

/** Every history of the hits: the status that lands first (or none) and the hit it lands on, with its probability. */
function expected(cost: HitCost, own: number, other: number, ownFirst: boolean) {
  const landing = Math.min(own, MAX_PRICED_HITS);
  const turns = Math.min(other, MAX_PRICED_HITS);
  const chance = cost.statuses.reduce((sum, entry) => sum + entry.chance, 0);
  let output = landing;
  let chips = 0;
  for (const entry of cost.statuses) {
    for (let landed = 1; landed <= MAX_PRICED_HITS; landed++) {
      const probability = (1 - chance) ** (landed - 1) * entry.chance;
      if (landed <= landing) output += probability * (entry.output - 1) * (landing - landed);
      for (let turn = landed; turn <= turns - 1; turn++) chips += probability * entry.chip;
    }
  }
  return { residual: cost.chip + chips / turns, output: output / landing, buffer: ownFirst ? 0 : cost.chip };
}

const BURN: HitCost = { chip: 0, statuses: [status('brn', 0.3, 1 / 16, 0.5)] };
const SPORE: HitCost = { chip: 0.1, statuses: [status('slp', 0.1, 0, 1), status('par', 0.1, 0, 1), status('psn', 0.1, 1 / 8, 1)] };

describe('a hit that costs nothing prices nothing', () => {
  test.each([[1, 1], [2, 3], [3, 2], [Infinity, Infinity]])('%s hits against %s turns', (own, other) => {
    expect(priceHit(NO_COST, own, other, true)).toEqual({ residual: 0, output: 1, buffer: 0 });
    expect(priceHit(NO_COST, own, other, false)).toEqual({ residual: 0, output: 1, buffer: 0 });
  });
});

describe('the chip of a hit is paid for every hit, and the side that moves second is a chip better off', () => {
  const chip: HitCost = { chip: 0.12, statuses: [] };

  test.each([1, 2, 3, 6, Infinity])('the first mover pays the chip every turn and gets nothing back (%s turns to live)', turns => {
    expect(priceHit(chip, 2, turns, true)).toEqual({ residual: 0.12, output: 1, buffer: 0 });
  });

  test.each([1, 2, 3, 6, Infinity])('the second mover pays the same chip and gets one back as HP (%s turns to live)', turns => {
    expect(priceHit(chip, 2, turns, false)).toEqual({ residual: 0.12, output: 1, buffer: 0.12 });
  });

  /**
   * The race turn by turn: Y hits X for `hit` a turn and X pays `chip` after each hit of its own, `first` says who moves
   * first. The turn Y kills X is the first t where X's HP is gone before X's next action.
   */
  function turnsToKill(hp: number, hit: number, chip: number, xFirst: boolean): number {
    for (let turn = 1; turn < 100; turn++) {
      const chipsPaid = xFirst ? turn : turn - 1;
      if (hp - turn * hit - chipsPaid * chip <= 1e-12) return turn;
    }
    return Infinity;
  }

  test.each([
    [0.66, 0.3, 0.1667, false], [0.66, 0.3, 0.1667, true], [0.3, 0.15, 0.1667, false], [0.3, 0.15, 0.1667, true],
    [0.9, 0.2, 0.05, false], [0.9, 0.2, 0.05, true], [0.5, 0.5, 0.3, false], [0.5, 0.5, 0.3, true], [1, 0.12, 0.08, false],
  ])('the clock of the other side on HP %s at %s a hit and a chip of %s (the payer moves first: %s) is the turn-by-turn race', (hp, hit, amount, first) => {
    const price = priceHit({ chip: amount, statuses: [] }, 2, 3, first);
    const payer = { hp: hp + price.buffer, frac: 0.4, residual: price.residual, healRate: 0, healAbsorb: 0, ppBudget: 99 };
    const other = { hp: 1, frac: hit, residual: 0, healRate: 0, healAbsorb: 0, ppBudget: 99 };
    expect(raceClocks(payer, other).turnsB).toBe(turnsToKill(hp, hit, amount, first));
  });

  test('a second mover that KOs in one hit is not KO\'d by a chip it has not paid yet: the Weavile\'s first hit leaves it standing', () => {
    // 0.3 of HP 0.66 is no KO; a residual of the whole chip (the plain table) would have the clock at 1 for 0.3 + 0.4 >= 0.66.
    const price = priceHit({ chip: 0.4, statuses: [] }, 1, 3, false);
    const payer = { hp: 0.66 + price.buffer, frac: 0.5, residual: price.residual, healRate: 0, healAbsorb: 0, ppBudget: 99 };
    const other = { hp: 1, frac: 0.3, residual: 0, healRate: 0, healAbsorb: 0, ppBudget: 99 };
    expect(raceClocks(payer, other).turnsB).toBe(2);
    expect(raceClocks({ ...payer, hp: 0.66, residual: 0.4 }, other).turnsB).toBe(1);
  });
});

describe('a status chance compounds over the hits', () => {
  test('one hit that decides the race at once has no end of turn to burn at: nothing to price', () => {
    expect(priceHit(BURN, 1, 1, true)).toEqual({ residual: 0, output: 1, buffer: 0 });
  });

  test.each([[2, 2, true], [2, 3, true], [3, 3, false], [3, 2, true], [4, 5, false], [2, Infinity, true], [Infinity, 3, false]] as const)(
    'Flame Body at %s hits and %s turns (the payer moves first: %s) equals the sum over every hit the burn can land on',
    (own, other, first) => {
      const price = priceHit(BURN, own, other, first);
      const oracle = expected(BURN, own, other, first);
      expect(price.residual).toBeCloseTo(oracle.residual, 12);
      expect(price.output).toBeCloseTo(oracle.output, 12);
      expect(price.buffer).toBe(0);
    },
  );

  test('two hits against two turns, by hand: 30% to be burned after the first, 1/16 at the end of that turn, the second hit at half power', () => {
    const price = priceHit(BURN, 2, 2, true);
    expect(price.residual).toBeCloseTo((0.3 / 16) / 2, 12);
    expect(price.output).toBeCloseTo((1 + (1 - 0.3 * 0.5)) / 2, 12);
  });

  test('two hits against three turns, by hand: the burn of the first hit chips twice, that of the second once, the second hit at half power after the first', () => {
    const price = priceHit(BURN, 2, 3, true);
    expect(price.residual).toBeCloseTo((0.3 * 2 + 0.7 * 0.3 * 1) / 16 / 3, 12);
    expect(price.output).toBeCloseTo((1 + (1 - 0.3 * 0.5)) / 2, 12);
  });

  test('the burn costs more the longer the race: output falls and the residual rises with the hits', () => {
    const prices = [2, 3, 4, 5, 6].map(hits => priceHit(BURN, hits, hits, true));
    for (let at = 1; at < prices.length; at++) {
      expect(prices[at].output).toBeLessThan(prices[at - 1].output);
      expect(prices[at].residual).toBeGreaterThan(prices[at - 1].residual);
    }
  });

  test('several statuses on one hit: the first to land stays (Effect Spore with a chip of its own); chip and statuses add', () => {
    for (const [own, other, first] of [[2, 3, true], [3, 3, false], [4, 2, true]] as const) {
      const price = priceHit(SPORE, own, other, first);
      const oracle = expected(SPORE, own, other, first);
      expect(price.residual).toBeCloseTo(oracle.residual, 12);
      expect(price.output).toBeCloseTo(oracle.output, 12);
      expect(price.buffer).toBe(first ? 0 : 0.1);
    }
  });

  test('a status that heals (Poison Heal) is a gain, and one that lifts the damage (Guts) raises the output', () => {
    const gain: HitCost = { chip: 0, statuses: [status('psn', 0.3, -1 / 8, 1)] };
    const guts: HitCost = { chip: 0, statuses: [status('brn', 0.3, 1 / 16, 1.5)] };
    expect(priceHit(gain, 3, 3, true).residual).toBeLessThan(0);
    expect(priceHit(guts, 3, 3, true).output).toBeGreaterThan(1);
    expect(priceHit(gain, 3, 3, true).residual).toBeCloseTo(expected(gain, 3, 3, true).residual, 12);
    expect(priceHit(guts, 3, 3, true).output).toBeCloseTo(expected(guts, 3, 3, true).output, 12);
  });

  test('a certain status is a status from the second hit on', () => {
    const sure: HitCost = { chip: 0, statuses: [status('brn', 1, 1 / 16, 0.5)] };
    expect(priceHit(sure, 3, 3, true).output).toBeCloseTo((1 + 0.5 + 0.5) / 3, 12);
    expect(priceHit(sure, 3, 3, true).residual).toBeCloseTo((2 / 16) / 3, 12);
  });
});

describe('a race that never ends is priced over a finite horizon', () => {
  test('infinite clocks price like the longest race, and a longer finite race too', () => {
    expect(priceHit(BURN, Infinity, Infinity, false)).toEqual(priceHit(BURN, MAX_PRICED_HITS, MAX_PRICED_HITS, false));
    expect(priceHit(BURN, MAX_PRICED_HITS + 5, MAX_PRICED_HITS + 5, true)).toEqual(priceHit(BURN, MAX_PRICED_HITS, MAX_PRICED_HITS, true));
    expect(Number.isFinite(priceHit({ chip: 0.1, statuses: [] }, Infinity, Infinity, false).residual)).toBe(true);
  });

  test('a fraction of a hit prices as the whole hits below it, and a clock under one as one', () => {
    expect(priceHit(BURN, 2.7, 2.7, true)).toEqual(priceHit(BURN, 2, 2, true));
    expect(priceHit(BURN, 0.4, 0.4, true)).toEqual(priceHit(BURN, 1, 1, true));
  });
});
