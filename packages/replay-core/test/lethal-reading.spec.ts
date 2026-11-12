import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, observationError, rollRange, spreadFor } from '../src/spreads/fit';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import type { DamageObservation, PokemonEvs } from '../src/types';
import './champions-mod';

/**
 * Round 89 (#75 step 1, ruling 27.4): a knockout reads the shown HP by the game's own display. The log prints the defender's HP before the hit as
 * a text (`75/100`); the real HP behind it lies in the range the rounding of the battle's mode allows (Scarlet/Violet rounds the percentage up,
 * the Champions mod down, the pixel bar down, an exact text is exact: `hp-display.ts`, held to the simulator by `hp-display-sweep.spec.ts`).
 * A rung whose best roll stays below the lowest HP the text allows is refuted, with no slack: the game itself refutes it. The slack of two
 * percent stays for the readings that are not knockouts. The rows build every observation from the maximum roll of the built attacker, so the
 * edge sits at one HP point: the text one step above is refuted, the text of that very HP is not. The display rules are written out in the rows
 * (ceil, floor, 48ths) and never taken from `hp-display.ts`.
 */
const WORLDS = [
  { name: 'Scarlet/Violet singles', formatid: 'gen9ou', gen: calcGenerationFor(9), level: 100, max: 252, doubles: false, round: 'up' },
  { name: 'Scarlet/Violet doubles', formatid: 'gen9vgc2025regi', gen: calcGenerationFor(9), level: 50, max: 252, doubles: true, round: 'up' },
  { name: 'Champions singles', formatid: 'gen9championsou', gen: calcGenerationFor(0), level: 50, max: 32, doubles: false, round: 'down' },
  { name: 'Champions doubles', formatid: 'gen9championsvgc2026regma', gen: calcGenerationFor(0), level: 50, max: 32, doubles: true, round: 'down' },
] as const;
type World = (typeof WORLDS)[number];

const evs = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const asSet = (species: string, nature: string, spread: PokemonEvs, level: number, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature, evs: spread,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
});

/** The prior attacker (a bulky-offense guess) and the defender of every row: Garchomp's Stone Edge (one target in doubles too) hits a Clefable that holds no investment and no Defense nature (no defender rung is weaker, so the defender cannot absorb the refutation). */
function scene(world: World, attackerAtk: number, defender = 'Clefable', move = 'Stone Edge') {
  const sets = {
    p1: [asSet(defender, 'Hardy', evs({}), world.level, ['Moonblast'])],
    // The prior spends the whole budget (Atk, full HP, the rest in Speed), as a build does: the top-up has nothing left to hand to the offense.
    p2: [asSet('Garchomp', 'Adamant', evs({ atk: attackerAtk, hp: world.max, spe: (world.max === 252 ? 508 : 66) - world.max - attackerAtk }), world.level, [move])],
  };
  const base: DamageObservation = {
    attackerSpecies: 'Garchomp', defenderSpecies: defender, attackerSide: 'p2', moveId: move.toLowerCase(), observedFraction: 0.5, lethal: true,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '', ...(world.doubles ? { doubles: true } : {}),
  };
  const ctx = buildSolveContext([base, base], sets, world.formatid, []);
  const prior = spreadFor(ctx, 'p2', 'Garchomp');
  const maxHp = buildCalcPokemon(world.gen, defender, { level: world.level, nature: 'Hardy', evs: evs({}) }).maxHP();
  const best = Math.round(rollRange(ctx, base, prior, spreadFor(ctx, 'p1', defender))!.max * maxHp);
  return { sets, base, ctx, prior, maxHp, best };
}

/** A lethal hit on the defender shown at `hp` of `maxhp` before it, as the protocol records it. */
const lethalAt = (base: DamageObservation, hp: number, maxhp: number, after?: { hp: number; maxhp: number }): DamageObservation => ({
  ...base, lethal: true, observedFraction: hp / maxhp - (after ? after.hp / after.maxhp : 0), defenderShown: { before: { hp, maxhp }, ...(after ? { after } : {}) },
});

describe('a knockout is refuted when the best roll stays below the lowest HP the shown text allows', () => {
  for (const world of WORLDS) {
    describe(world.name, () => {
      const { base, ctx, prior, maxHp, best } = scene(world, 252);
      const error = (obs: DamageObservation) => observationError(ctx, obs, 'p2:garchomp', prior);
      // The text of the best roll's own HP: the lowest HP it allows is at most the best roll. One step higher, every HP it allows is above it.
      const printedOk = world.round === 'up' ? Math.ceil(100 * best / maxHp) : Math.floor(100 * best / maxHp);

      test('the scene sits inside the percentage scale (a body of 100 or more HP, a best roll below full)', () => {
        expect(maxHp).toBeGreaterThanOrEqual(100);
        expect(best).toBeLessThan(maxHp);
      });

      test('the text of the best roll\'s own HP is no refutation', () => {
        expect(error(lethalAt(base, printedOk, 100))).toBe(0);
      });

      test('the text one step above is refuted, though it lies inside the slack of two percent', () => {
        const bad = lethalAt(base, printedOk + 1, 100);
        expect(bad.observedFraction - best / maxHp).toBeLessThanOrEqual(0.02);
        expect(error(bad)).toBeGreaterThan(0);
      });

      test('a text far below is no refutation, and a text far above is refuted by more', () => {
        expect(error(lethalAt(base, Math.max(1, printedOk - 20), 100))).toBe(0);
        expect(error(lethalAt(base, Math.min(100, printedOk + 6), 100))).toBeGreaterThan(error(lethalAt(base, printedOk + 1, 100)));
      });

      test('a Sturdy or Focus Sash survivor reads the lowest HP before the hit less the highest HP left', () => {
        // Left at the text 1/100: the real HP left is 1 to the highest HP that prints 1.
        const highestLeft = world.round === 'up' ? Math.floor(maxHp / 100) : Math.ceil(2 * maxHp / 100) - 1;
        const lowestBefore = (shown: number) => (world.round === 'up' ? Math.floor((shown - 1) * maxHp / 100) + 1 : Math.ceil(shown * maxHp / 100));
        let bad = 2;
        while (bad < 100 && lowestBefore(bad) - highestLeft <= best) bad += 1;
        expect(bad).toBeLessThan(100);
        const survivor = (shown: number) => lethalAt(base, shown, 100, { hp: 1, maxhp: 100 });
        expect(error(survivor(bad))).toBeGreaterThan(0);
        expect(error(survivor(bad - 1))).toBe(0);
      });

      test('an exact text (a player\'s own view) pins the HP: one point above the best roll is refuted', () => {
        expect(maxHp).not.toBe(100);
        expect(error(lethalAt(base, best, maxHp))).toBe(0);
        const bad = lethalAt(base, best + 1, maxHp);
        expect(bad.observedFraction - best / maxHp).toBeLessThan(0.02);
        expect(error(bad)).toBeGreaterThan(0);
      });

      test('a full body (100/100) is read as full: a best roll below the maximum HP is refuted', () => {
        expect(error(lethalAt(base, 100, 100))).toBeGreaterThan(0);
      });

      test('an observation from before the text was kept (no defenderShown) reads as it did: the two percent slack holds', () => {
        const legacy: DamageObservation = { ...base, observedFraction: best / maxHp + 0.015 };
        expect(error(legacy)).toBe(0);
        expect(error({ ...base, observedFraction: best / maxHp + 0.05 })).toBeGreaterThan(0);
      });

      test('a hit that did not knock out keeps its slack', () => {
        const clean: DamageObservation = { ...base, lethal: false, observedFraction: best / maxHp + 0.015, defenderShown: { before: { hp: 100, maxhp: 100 } } };
        expect(error(clean)).toBe(0);
      });
    });
  }

  test('the pixel bar rounds down: a text one 48th above the best roll is refuted', () => {
    const world = WORLDS[0];
    const { base, ctx, prior, maxHp, best } = scene(world, 252);
    const ok = Math.floor(48 * best / maxHp);
    expect(observationError(ctx, lethalAt(base, ok, 48), 'p2:garchomp', prior)).toBe(0);
    expect(observationError(ctx, lethalAt(base, ok + 1, 48), 'p2:garchomp', prior)).toBeGreaterThan(0);
  });
});

describe('an attacker seen only in knockouts opens its offense when the game refutes the prior, and keeps it otherwise', () => {
  for (const world of WORLDS) {
    describe(world.name, () => {
      // The prior carries 100 Atk EVs (12 Stat Points in Champions); the two knockouts read the text one step above its best roll, which an Atk of 252 reaches.
      const priorAtk = world.max === 252 ? 100 : 12;
      const { sets, base, best, maxHp } = scene(world, priorAtk);
      const reach = scene(world, world.max);
      const printedOk = world.round === 'up' ? Math.ceil(100 * best / maxHp) : Math.floor(100 * best / maxHp);
      const solve = (shown: number) => {
        const observations = [lethalAt(base, shown, 100), lethalAt(base, shown, 100)];
        return inferSpreads(observations, sets, world.formatid).get('p2:garchomp');
      };

      test('the 252 Atk body reaches the refuting text (the scene is solvable)', () => {
        const lowest = world.round === 'up' ? Math.floor(printedOk * maxHp / 100) + 1 : Math.ceil((printedOk + 1) * maxHp / 100);
        expect(reach.best).toBeGreaterThanOrEqual(lowest);
      });

      test('the prior the game refutes gives way to the nearest rung that reaches', () => {
        const solved = solve(printedOk + 1);
        expect(solved?.evs.atk).toBe(world.max);
        expect(solved?.origin).toBe('damage');
      });

      test('a prior the game allows keeps its offense (a lower bound measures no ceiling)', () => {
        const solved = solve(printedOk);
        expect(solved?.evs.atk ?? priorAtk).toBe(priorAtk);
      });

      test('a knockout no rung reaches opens nothing: the prior stands', () => {
        // The Atk 252 roll tops out below full (the scene's own check), so a defender shown at 100/100 is out of every rung's reach.
        expect(reach.best).toBeLessThan(reach.maxHp);
        const solved = solve(100);
        expect(solved?.evs.atk ?? priorAtk).toBe(priorAtk);
      });
    });
  }
});

/**
 * Round 89 (D9, gen9ou-2658671254, Iron Valiant): the top-up spends the offense stat while the mon's lines "fit as well as at the winning rung". When the winning
 * rung is a coarse one (Special Attack 0) that a knockout refutes, its own error is the knockout's shortfall, and the tolerance it gives lets a clean line on
 * the same mon overshoot by as much: the stat ran to 180 where the lines fit best between 32 and 56 (a hit on Moltres that shows 74 beside a knockout that needs
 * 301 HP). The rule: the top-up measures from the cheapest spread that reaches every knockout of the mon, so it never ends on a spread the lines fit worse than that one.
 */
describe('the top-up never ends on an offense the lines fit worse than the cheapest spread that reaches every knockout', () => {
  for (const world of WORLDS) {
    describe(world.name, () => {
      const step = world.max === 252 ? 4 : 1;
      // The prior carries Speed only and a neutral nature (a guess without a boost, the rest of the budget open), so the defender has nothing to absorb and the scene stays on the attacker.
      const start = scene(world, 0);
      const sets = { p1: start.sets.p1, p2: start.sets.p2.map(set => ({ ...set, nature: 'Hardy', evs: evs({ spe: world.max }) })) };
      const { base, maxHp } = start;
      const ctx = buildSolveContext([base, base], sets, world.formatid, []);
      const prior = spreadFor(ctx, 'p2', 'Garchomp');
      const foe = spreadFor(ctx, 'p1', 'Clefable');
      const rollAt = (atk: number) => rollRange(ctx, base, { ...prior, evs: { ...prior.evs, atk } }, foe)!;
      // The knockout needs the best roll of a quarter of the budget: the exact text of that HP (a player's own view), so no rounding hides it.
      const quarter = Math.round(world.max / 4 / step) * step;
      const knockout = lethalAt(base, Math.floor(rollAt(quarter).max * maxHp), maxHp);
      // A clean line at the lowest roll of Atk 0: it fits every spread to the quarter and starts to overshoot above it.
      const clean: DamageObservation = { ...base, lethal: false, observedFraction: rollAt(0).min };
      const lines = [clean, clean, knockout];
      // The defender's maximum HP is the log's (an exact text and switch line), so its HP EVs cannot drift into the hit the attacker answers.
      const solved = inferSpreads(lines, sets, world.formatid, [], new Map(), new Map([['p1:clefable', { maxhp: maxHp, level: world.level }]]));
      const mine = solved.get('p2:garchomp')!;
      // The lines priced against the defender as the solve left it, the solved attacker's Atk swapped.
      const priced = buildSolveContext(lines, sets, world.formatid, []);
      priced.solved = new Map(solved);
      const spread = (atk: number) => ({ ...mine, evs: { ...mine.evs, atk } });
      const total = (atk: number) => lines.reduce((sum, obs) => sum + observationError(priced, obs, 'p2:garchomp', spread(atk)), 0);
      const knockoutError = (atk: number) => observationError(priced, knockout, 'p2:garchomp', spread(atk));
      const cheapest = Array.from({ length: world.max / step + 1 }, (_, i) => i * step).find(atk => knockoutError(atk) === 0);

      test('the scene: Atk 0 is refuted by the knockout, the quarter of the budget reaches it, and the clean line beside it fits there', () => {
        const builtError = (obs: DamageObservation, atk: number) => observationError(ctx, obs, 'p2:garchomp', { ...prior, evs: { ...prior.evs, atk } });
        expect(builtError(knockout, 0)).toBeGreaterThan(0);
        expect(builtError(knockout, quarter)).toBe(0);
        expect(builtError(clean, quarter), "a hair of the slack at most").toBeLessThan(1e-5);
        expect(builtError(clean, world.max)).toBeGreaterThan(builtError(knockout, 0));
      });

      test('the solve leaves the knockout reachable and its own spread on the reach', () => {
        expect(cheapest).toBeDefined();
        expect(cheapest!).toBeLessThanOrEqual(mine.evs.atk);
      });

      test('the solved spread reaches the knockout and fits the lines as well as the cheapest spread that does', () => {
        expect(knockoutError(mine.evs.atk), 'the knockout is reached').toBe(0);
        expect(total(mine.evs.atk), `Atk ${mine.evs.atk} (${mine.nature}) against the cheapest reach ${cheapest}`).toBeLessThanOrEqual(total(cheapest!) + 1e-12);
      });
    });
  }
});
