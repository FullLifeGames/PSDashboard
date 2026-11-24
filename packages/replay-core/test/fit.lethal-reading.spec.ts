import './champions-mod';
import { describe, expect, test } from 'vitest';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, observationError, rollRange, spreadFor, keyOf, type SolveContext } from '../src/spreads/fit';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import type { DamageObservation, PokemonEvs } from '../src/types';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import {
  FORMAT,
  alone,
  hit,
  isDoubles,
  scaled,
  scenesOf,
  set,
  splash,
  team,
  damagingTurns,
  type FieldScene,
  type Kind,
  type Scene,
  BEADS_OF_RUIN,
  BOOSTED_HIT,
  ERUPTION,
  FLASH_FIRE,
  GAS_ON_THE_PARTNER,
  GASTRO_ACID,
  GASTRO_ACID_THEN_SWITCH,
  GRAVITY,
  HELPING_HAND,
  MULTISCALE,
  SUPREME_OVERLORD,
  TERA_ATTACKER,
  TERA_DEFENDER,
  TERRAIN_PULSE,
  WEATHER_BALL,
} from './fit-field-scenes';
import { Dex, type PokemonSet } from '@pkmn/sim';
import type { ReadObservation } from '../src/spreads/observation-read';

// A knockout reads the shown HP by the game's own display. The log prints the defender's HP before the hit as a text (`75/100`); the real HP behind
// it lies in the range the rounding of the battle's mode allows (Scarlet/Violet rounds the percentage up, the Champions mod down, the pixel bar down,
// an exact text is exact; hp-display.ts, held to the simulator by hp-display-sweep.spec.ts). A rung whose best roll stays below the lowest HP the text
// allows is refuted with no slack; the slack of two percent stays for readings that are not knockouts. The rows build every observation from the
// maximum roll of the built attacker, so the edge sits at one HP point: the text one step above is refuted, the text of that very HP is not. The display
// rules are written out in the rows (ceil, floor, 48ths) and never taken from hp-display.ts.
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

/**
 * The prior attacker (a bulky-offense guess) and the defender of every row: Garchomp's Stone Edge (one target in doubles too) hits a Clefable that holds no
 * investment and no Defense nature (no defender rung is weaker, so the defender cannot absorb the refutation).
 */
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

// The top-up spends the offense stat while the mon's lines "fit as well as at the winning rung". When the winning rung is a coarse one (Special Attack 0)
// that a knockout refutes, its own error is the knockout's shortfall and the tolerance lets a clean line on the same mon overshoot by as much (gen9ou-2658671254,
// Iron Valiant: the stat ran to 180 where the lines fit best between 32 and 56). The top-up measures from the cheapest spread that reaches every knockout.
describe('the top-up never ends on an offense the lines fit worse than the cheapest spread that reaches every knockout', () => {
  for (const world of WORLDS) {
    describe(world.name, () => {
      const step = world.max === 252 ? 4 : 1;
      // The prior carries Speed only and a neutral nature (a guess without a boost), so the defender has nothing to absorb and the scene stays on the attacker.
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

const HATTERENE = () => set('Hatterene', '', 'Magic Bounce', ['Expanding Force', 'Splash'], 'Modest', { hp: 252, spa: 252 });
const GARDEVOIR = () => set('Gardevoir', '', 'Trace', ['Psychic Terrain', 'Splash'], 'Timid', { spe: 252 });
const TERAPAGOS = () => set('Terapagos', '', 'Tera Shift', ['Tera Starstorm', 'Splash'], 'Modest', { hp: 252, spa: 252 }, 'Stellar');
const WALL = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252, spd: 252 });
const PARTNER = () => set('Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });
const BOMB = () => set('Magikarp', '', 'Swift Swim', ['Explosion', 'Splash'], 'Hardy', {});
const AWAY = 'move splash, pass';
const FIRST = (lone: boolean) => (lone ? 'move splash, move explosion' : 'move splash, move splash');
const THEN = (lone: boolean) => (lone ? AWAY : 'move splash, move splash');

const expandingForce = (lone: boolean): FieldScene => ({
  title: `Expanding Force in Psychic Terrain into ${lone ? 'a lone foe' : 'two foes'}`,
  p1: () => [HATTERENE(), GARDEVOIR()],
  p2: () => [WALL(), lone ? BOMB() : PARTNER()],
  attacker: 'Hatterene', defender: 'Blissey',
  steps: () => [
    { p1: 'move splash, move psychicterrain', p2: FIRST(lone) },
    { p1: 'move expandingforce 1, move splash', p2: THEN(lone) },
  ],
  kinds: ['doubles', 'champions doubles'],
});

const teraStarstorm = (lone: boolean): FieldScene => ({
  title: `Tera Starstorm after the click into ${lone ? 'a lone foe' : 'two foes'}`,
  p1: team(TERAPAGOS()),
  p2: () => [WALL(), lone ? BOMB() : PARTNER()],
  attacker: 'Terapagos', defender: 'Blissey',
  steps: doubles => [
    { p1: alone(doubles, splash()), p2: FIRST(lone) },
    { p1: alone(doubles, hit(doubles, 'Tera Starstorm', true)), p2: THEN(lone) },
  ],
  kinds: ['doubles'],
});

function contextOf(scene: FieldScene, kind: Kind, log: string) {
  const { observations } = parseReplayLogWithObservations(log);
  const found = observations.filter(obs => obs.defenderSpecies === scene.defender && obs.attackerSpecies.startsWith(scene.attacker));
  const body = (side: 'p1' | 'p2', species: string) => scaled((side === 'p1' ? scene.p1 : scene.p2)(isDoubles(kind)).find(entry => entry.species === species)!, kind);
  const ctx = buildSolveContext(found, { p1: [body('p1', scene.attacker)], p2: [body('p2', scene.defender)] }, FORMAT[kind], []);
  return { found, ctx, reads: ctx.byMon.get(keyOf('p2', scene.defender)) ?? [] };
}

describe('a forced spread on a lone foe gives the solver no reading (doubles)', () => {
  for (const make of [expandingForce, teraStarstorm]) {
    const lone = make(true);
    for (const kind of lone.kinds) {
      test(`${kind}: ${lone.title}`, () => {
        const played = scenesOf(kind, lone, 2);
        expect(played.length).toBeGreaterThanOrEqual(1);
        for (const scene of played) {
          const { found, ctx, reads } = contextOf(lone, kind, scene.log);
          expect(found).toHaveLength(1);
          expect(found[0]).toMatchObject({ doubles: true });
          expect(found[0].spread, 'the log prints no spread mark').toBeFalsy();
          expect(reads).toHaveLength(1);
          const range = rollRange(ctx, reads[0], spreadFor(ctx, 'p1', lone.attacker), spreadFor(ctx, 'p2', lone.defender));
          expect(range, 'no reading').toBeNull();
          expect(observationError(ctx, reads[0], keyOf('p2', lone.defender), spreadFor(ctx, 'p2', lone.defender))).toBe(0);
        }
      });
    }

    const two = make(false);
    for (const kind of two.kinds) {
      test(`${kind}: ${two.title} keeps its reading, and it holds the simulator's damage`, () => {
        const played = scenesOf(kind, two, 2);
        expect(played.length).toBeGreaterThanOrEqual(1);
        for (const scene of played) {
          const { found, ctx, reads } = contextOf(two, kind, scene.log);
          expect(found[0].spread, 'two foes: the log prints the spread mark').toBe(true);
          const range = rollRange(ctx, reads[0], spreadFor(ctx, 'p1', two.attacker), spreadFor(ctx, 'p2', two.defender));
          expect(range).not.toBeNull();
          const damage = damagingTurns(scene).at(-1)!;
          expect(Math.round(range!.min * scene.maxHp)).toBeLessThanOrEqual(damage);
          expect(Math.round(range!.max * scene.maxHp)).toBeGreaterThanOrEqual(damage);
        }
      });
    }
  }
});

/** Singles: the foe sets the terrain itself; the hit has one target in the game and in the calculator's Singles field. */
const SINGLES: FieldScene = {
  title: 'Expanding Force in Psychic Terrain',
  p1: () => [HATTERENE()],
  p2: () => [set('Blissey', '', 'Natural Cure', ['Psychic Terrain', 'Splash'], 'Calm', { hp: 252, spd: 252 })],
  attacker: 'Hatterene', defender: 'Blissey',
  steps: () => [{ p1: 'move splash', p2: 'move psychicterrain' }, { p1: 'move expandingforce', p2: 'move splash' }],
  kinds: ['singles', 'champions singles'],
};

describe('singles: nothing spreads, the reading stays and holds the simulator damage', () => {
  for (const kind of SINGLES.kinds) {
    test(`${kind}: ${SINGLES.title}`, () => {
      const played = scenesOf(kind, SINGLES, 2);
      expect(played.length).toBeGreaterThanOrEqual(1);
      for (const scene of played) {
        const { found, ctx, reads } = contextOf(SINGLES, kind, scene.log);
        expect(found[0].doubles).toBeFalsy();
        const range = rollRange(ctx, reads[0], spreadFor(ctx, 'p1', SINGLES.attacker), spreadFor(ctx, 'p2', SINGLES.defender));
        expect(range).not.toBeNull();
        const damage = damagingTurns(scene).at(-1)!;
        expect(Math.round(range!.min * scene.maxHp)).toBeLessThanOrEqual(damage);
        expect(Math.round(range!.max * scene.maxHp)).toBeGreaterThanOrEqual(damage);
      }
    });
  }
});

describe('partner-ability-hits', () => {
  const GARCHOMP = (move: string) => set('Garchomp', '', 'Rough Skin', [move, 'Splash'], 'Hardy', { hp: 252, [Dex.moves.get(move).category === 'Special' ? 'spa' : 'atk']: 252 });
  /** A weak attacker: under the boost of Flower Gift the strong one would knock out the Blissey. */
  const WEAK_GARCHOMP = (move: string) => set('Garchomp', '', 'Rough Skin', [move, 'Splash'], 'Hardy', { hp: 252 });
  const BLISSEY = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252, spd: 252 });
  const CHANSEY = () => set('Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });
  const splashing = (species: string, ability: string, extra: string[] = []) => set(species, '', ability, ['Splash', ...extra], 'Hardy', { hp: 252 });

  interface PartnerScene extends FieldScene {
    solverSets: () => { p1: PokemonSet[]; p2: PokemonSet[] };
    fact: string;
    partnerSide: 'attacker' | 'defender';
  }

  const hit = (move: string, doubles: boolean) => (doubles ? `move ${move} 1, move splash` : `move ${move}`);
  const idle = 'move splash, move splash';

  const attackerPartner = (title: string, partner: PokemonSet, move: string, fact: string, solverPartner: boolean, attacker = GARCHOMP(move)): PartnerScene => {
    return {
      title, p1: () => [attacker, partner], p2: () => [BLISSEY(), CHANSEY()], attacker: 'Garchomp', defender: 'Blissey',
      steps: () => [{ p1: hit(move.toLowerCase().replace(/\s/g, ''), true), p2: idle }], kinds: ['doubles'],
      solverSets: () => ({ p1: solverPartner ? [attacker, partner] : [attacker], p2: [BLISSEY()] }), fact, partnerSide: 'attacker',
    };
  };

  const SCENES: PartnerScene[] = [
    attackerPartner('Battery of Charjabug, a species with one ability', splashing('Charjabug', 'Battery'), 'Dragon Pulse', 'battery', false),
    attackerPartner('Power Spot of Stonjourner, a species with one ability', splashing('Stonjourner', 'Power Spot'), 'Dragon Claw', 'powerspot', false, WEAK_GARCHOMP('Dragon Claw')),
    attackerPartner('Steely Spirit of Perrserker, a species with several abilities: its set decides', splashing('Perrserker', 'Steely Spirit'), 'Iron Head', 'steelyspirit', true),
    {
      title: 'Friend Guard of Clefairy next to the defender, a species with several abilities: its set decides',
      p1: () => [GARCHOMP('Dragon Pulse'), CHANSEY()], p2: () => [BLISSEY(), splashing('Clefairy', 'Friend Guard')], attacker: 'Garchomp', defender: 'Blissey',
      steps: () => [{ p1: hit('dragonpulse', true), p2: idle }], kinds: ['doubles'],
      solverSets: () => ({ p1: [GARCHOMP('Dragon Pulse')], p2: [BLISSEY(), splashing('Clefairy', 'Friend Guard')] }), fact: 'friendguard', partnerSide: 'defender',
    },
    {
      title: 'Flower Gift of a Cherrim in sun, shown by its forme change, beside the attacker',
      p1: () => [WEAK_GARCHOMP('Dragon Claw'), splashing('Cherrim', 'Flower Gift')], p2: () => [BLISSEY(), splashing('Torkoal', 'Drought')], attacker: 'Garchomp', defender: 'Blissey',
      steps: () => [{ p1: hit('dragonclaw', true), p2: idle }], kinds: ['doubles'],
      solverSets: () => ({ p1: [WEAK_GARCHOMP('Dragon Claw')], p2: [BLISSEY()] }), fact: 'flowergift', partnerSide: 'attacker',
    },
    {
      title: 'Friend Guard of Vivillon next to the defender (the one Champions family with a partner ability)',
      p1: () => [GARCHOMP('Dragon Pulse'), CHANSEY()], p2: () => [BLISSEY(), splashing('Vivillon', 'Friend Guard')], attacker: 'Garchomp', defender: 'Blissey',
      steps: () => [{ p1: hit('dragonpulse', true), p2: idle }], kinds: ['doubles', 'champions doubles'],
      solverSets: () => ({ p1: [GARCHOMP('Dragon Pulse')], p2: [BLISSEY(), splashing('Vivillon', 'Friend Guard')] }), fact: 'friendguard', partnerSide: 'defender',
    },
    {
      title: 'Flower Gift of a Cherrim in sun beside the defender',
      p1: () => [GARCHOMP('Dragon Pulse'), splashing('Torkoal', 'Drought')], p2: () => [BLISSEY(), splashing('Cherrim', 'Flower Gift')], attacker: 'Garchomp', defender: 'Blissey',
      steps: () => [{ p1: hit('dragonpulse', true), p2: idle }], kinds: ['doubles'],
      solverSets: () => ({ p1: [GARCHOMP('Dragon Pulse')], p2: [BLISSEY()] }), fact: 'defenderflowergift', partnerSide: 'defender',
    },
  ];

  function contextOf(scene: PartnerScene, kind: Kind, observations: DamageObservation[]): SolveContext {
    const sets = scene.solverSets();
    return buildSolveContext(observations, { p1: sets.p1.map(body => scaled(body, kind)), p2: sets.p2.map(body => scaled(body, kind)) }, FORMAT[kind], []);
  }


  function hitsOf(scene: PartnerScene, played: Scene): DamageObservation[] {
    const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.defenderSpecies === scene.defender && obs.attackerSpecies === scene.attacker);
    expect(found).toHaveLength(damagingTurns(played).length);
    return found;
  }

  const readsOf = (ctx: SolveContext, scene: PartnerScene): ReadObservation[] => ctx.byMon.get(keyOf('p2', scene.defender)) ?? [];

  function containsDamage(ctx: SolveContext, scene: PartnerScene, obs: ReadObservation, damage: number, maxHp: number): boolean {
    const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', scene.attacker), spreadFor(ctx, 'p2', scene.defender));
    expect(range).not.toBeNull();
    return Math.round(range!.min * maxHp) <= damage && damage <= Math.round(range!.max * maxHp);
  }

  /** The observation without the partner reading and the partner fact. */
  const stale = (obs: ReadObservation, fact: string): ReadObservation => {
    const rest: Record<string, unknown> = { ...obs };
    for (const field of ['attackerAlly', 'defenderAlly', 'attackerAllyAbility', 'defenderAllyAbility']) delete rest[field];
    return { ...(rest as unknown as ReadObservation), fieldFacts: (obs.fieldFacts ?? []).filter(id => id !== fact) };
  };

  describe('the partner field ability reaches the calculator (doubles)', () => {
    for (const scene of SCENES) {
      for (const kind of scene.kinds) {
        test(`${kind}: ${scene.title}`, () => {
          const scenes = scenesOf(kind, scene, 3);
          expect(scenes.length).toBeGreaterThanOrEqual(2);
          for (const played of scenes) {
            const observations = hitsOf(scene, played);
            const ctx = contextOf(scene, kind, observations);
            const reads = readsOf(ctx, scene);
            expect(reads).toHaveLength(observations.length);
            const damages = damagingTurns(played);
            const spread = spreadFor(ctx, 'p2', scene.defender);
            reads.forEach((obs, index) => {
              expect(obs.fieldFacts ?? [], 'the fact the partner books').toContain(scene.fact);
              expect(containsDamage(ctx, scene, obs, damages[index], played.maxHp), `hit ${index + 1}`).toBe(true);
              expect(observationError(ctx, obs, keyOf('p2', scene.defender), spread)).toBe(0);
            });
            // Read without the partner, at least one hit misses the simulator's damage: the scene shows something.
            expect(reads.some((obs, index) => !containsDamage(ctx, scene, stale(obs, scene.fact), damages[index], played.maxHp)), 'a hit the stale reading misses').toBe(true);
          }
        });
      }
    }

    test('the observation names the partner, with its ability only when the log showed it', () => {
      const battery = SCENES[0];
      const friendGuard = SCENES[3];
      const [played] = scenesOf('doubles', battery, 1);
      expect(hitsOf(battery, played)[0].attackerAlly).toMatchObject({ species: 'Charjabug', unrevealed: true });
      const [guarded] = scenesOf('doubles', friendGuard, 1);
      const [obs] = hitsOf(friendGuard, guarded);
      expect(obs.defenderAlly).toMatchObject({ species: 'Clefairy', unrevealed: true });
      expect(obs.attackerAlly?.species).toBe('Chansey');
    });
  });

  describe('a partner with a hidden ability that is no field ability changes nothing', () => {
    test('doubles: Chansey beside the attacker books no fact', () => {
      const scene = SCENES[3];
      const [played] = scenesOf('doubles', scene, 1);
      const ctx = contextOf(scene, 'doubles', hitsOf(scene, played));
      expect((readsOf(ctx, scene)[0].fieldFacts ?? []).filter(id => id !== 'friendguard')).toEqual([]);
    });
  });
});

describe('spread-fit-field', () => {
  const T86_FIELDS = [
    'moveName', 'terrain', 'attackerTera', 'defenderTera', 'attackerHp', 'defenderHp', 'attackerFallen', 'attackerAbility', 'defenderAbility',
    'attackerAbilityOn', 'attackerSuppressed', 'defenderSuppressed', 'fieldFacts',
  ] as const;

  const stale = (obs: ReadObservation): ReadObservation => {
    const rest: Record<string, unknown> = { ...obs };
    for (const field of T86_FIELDS) delete rest[field];
    return rest as unknown as ReadObservation;
  };

  const bodyOf = (scene: FieldScene, kind: Kind, side: 'p1' | 'p2', species: string) =>
    scaled((side === 'p1' ? scene.p1 : scene.p2)(isDoubles(kind)).find(body => body.species === species)!, kind);

  function contextOf(scene: FieldScene, kind: Kind, observations: DamageObservation[]): SolveContext {
    return buildSolveContext(
      observations, { p1: [bodyOf(scene, kind, 'p1', scene.attacker)], p2: [bodyOf(scene, kind, 'p2', scene.defender)] }, FORMAT[kind], [],
    );
  }

  function hitsOf(scene: FieldScene, played: Scene): DamageObservation[] {
    const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.defenderSpecies === scene.defender);
    expect(found).toHaveLength(damagingTurns(played).length);
    return found;
  }

  const readsOf = (ctx: SolveContext, scene: FieldScene): ReadObservation[] => ctx.byMon.get(keyOf('p2', scene.defender)) ?? [];

  function containsDamage(ctx: SolveContext, scene: FieldScene, obs: ReadObservation, damage: number, maxHp: number): boolean {
    const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', scene.attacker), spreadFor(ctx, 'p2', scene.defender));
    expect(range).not.toBeNull();
    const slack = scene.barNoise ?? 0;
    return Math.round(range!.min * maxHp * (1 - slack)) <= damage && damage <= Math.round(range!.max * maxHp * (1 + slack));
  }

  /** Scenes the stale reading (without the field facts) gets wrong: every hit is in the rolls with them, and at least one is not in the rolls without. */
  const FIELD_SCENES: FieldScene[] = [
    WEATHER_BALL, TERRAIN_PULSE, MULTISCALE, SUPREME_OVERLORD, TERA_ATTACKER, TERA_DEFENDER, ERUPTION, GASTRO_ACID, GAS_ON_THE_PARTNER, GRAVITY,
    FLASH_FIRE, HELPING_HAND, BEADS_OF_RUIN,
  ];

  describe('the rolls of a hit contain the simulator\'s damage with the field the log shows', () => {
    for (const scene of FIELD_SCENES) {
      for (const kind of scene.kinds) {
        test(`${kind}: ${scene.title}`, () => {
          const scenes = scenesOf(kind, scene, 3);
          expect(scenes.length).toBeGreaterThanOrEqual(2);
          for (const played of scenes) {
            const observations = hitsOf(scene, played);
            const ctx = contextOf(scene, kind, observations);
            const reads = readsOf(ctx, scene);
            expect(reads).toHaveLength(observations.length);
            const damages = damagingTurns(played);
            const spread = spreadFor(ctx, 'p2', scene.defender);
            reads.forEach((obs, index) => {
              expect(containsDamage(ctx, scene, obs, damages[index], played.maxHp), `hit ${index + 1} of ${damages.length}`).toBe(true);
              expect(observationError(ctx, obs, keyOf('p2', scene.defender), spread), `error of hit ${index + 1}`).toBe(0);
            });
            // The reading before the Champions fix gets at least one hit wrong, or the scene shows nothing.
            expect(reads.some((obs, index) => !containsDamage(ctx, scene, stale(obs), damages[index], played.maxHp)), 'a hit the stale reading misses').toBe(true);
          }
        });
      }
    }
  });

  describe('a hit on a plain field reads as it did', () => {
    for (const kind of BOOSTED_HIT.kinds) {
      test(`${kind}: a boosted hit has the same rolls with and without the new fields`, () => {
        for (const played of scenesOf(kind, BOOSTED_HIT, 3)) {
          const observations = hitsOf(BOOSTED_HIT, played);
          const ctx = contextOf(BOOSTED_HIT, kind, observations);
          for (const obs of readsOf(ctx, BOOSTED_HIT)) {
            expect(obs.attackerBoosts.atk).toBe(2);
            const attacker = spreadFor(ctx, 'p1', BOOSTED_HIT.attacker);
            const defender = spreadFor(ctx, 'p2', BOOSTED_HIT.defender);
            expect(rollRange(ctx, obs, attacker, defender)).toEqual(rollRange(ctx, stale(obs), attacker, defender));
            expect(containsDamage(ctx, BOOSTED_HIT, obs, damagingTurns(played)[0], played.maxHp)).toBe(true);
          }
        }
      });
    }
  });

  describe('the observation names the field at the hit', () => {
    const observationsOf = (scene: FieldScene, kind: Kind) => {
      const [played] = scenesOf(kind, scene, 1);
      return hitsOf(scene, played);
    };
    const kinds = (scene: FieldScene) => scene.kinds.filter(kind => !kind.startsWith('champions'));

    for (const kind of ['singles', 'doubles'] as const) {
      test(`${kind}: the move name, the weather and the terrain`, () => {
        expect(observationsOf(WEATHER_BALL, kind)[0]).toMatchObject({ moveId: 'weatherball', moveName: 'Weather Ball', weather: 'Rain', terrain: '' });
        expect(observationsOf(TERRAIN_PULSE, kind)[0]).toMatchObject({ moveName: 'Terrain Pulse', terrain: 'Electric' });
      });

      test(`${kind}: the HP of both sides before the hit`, () => {
        const [first, second] = observationsOf(MULTISCALE, kind);
        expect(first).toMatchObject({ attackerHp: 1, defenderHp: 1 });
        expect(second.attackerHp).toBe(1);
        expect(second.defenderHp).toBeLessThan(1);
        const [full, hurt] = observationsOf(ERUPTION, kind);
        expect(full.attackerHp).toBe(1);
        expect(hurt.attackerHp).toBeLessThan(0.9);
      });

      test(`${kind}: the fallen Supreme Overlord counts, as the ability's own start line says`, () => {
        const [only] = observationsOf(SUPREME_OVERLORD, kind);
        expect(only).toMatchObject({ attackerFallen: 2, attackerAbility: 'supremeoverlord' });
      });

      test(`${kind}: the Terastallized type of each side`, () => {
        for (const obs of observationsOf(TERA_ATTACKER, kind)) expect(obs).toMatchObject({ attackerTera: 'Fire' });
        for (const obs of observationsOf(TERA_ATTACKER, kind)) expect(obs.defenderTera).toBeUndefined();
        for (const obs of observationsOf(TERA_DEFENDER, kind)) expect(obs).toMatchObject({ defenderTera: 'Dark' });
      });

      test(`${kind}: a suppressed ability, and an ability that is on`, () => {
        expect(observationsOf(GASTRO_ACID, kind)[0]).toMatchObject({ defenderSuppressed: true });
        expect(observationsOf(GASTRO_ACID, kind)[0].attackerSuppressed).toBeUndefined();
        // The ability comes back with the switch.
        expect(observationsOf(GASTRO_ACID_THEN_SWITCH, kind)[0].defenderSuppressed).toBeUndefined();
        const [flashed] = observationsOf(FLASH_FIRE, kind);
        expect(flashed).toMatchObject({ attackerAbility: 'flashfire', attackerAbilityOn: true });
        expect(observationsOf(MULTISCALE, kind)[0].defenderSuppressed).toBeUndefined();
        expect(observationsOf(MULTISCALE, kind)[0].attackerAbilityOn).toBeFalsy();
      });

      test(`${kind}: a plain field carries no field fact`, () => {
        for (const obs of observationsOf(BOOSTED_HIT, kind)) {
          expect(obs.fieldFacts ?? []).toEqual([]);
          expect(obs.attackerFallen).toBeUndefined();
          expect(obs.attackerTera).toBeUndefined();
          expect(obs.terrain).toBe('');
        }
      });
    }

    test('doubles: the partner\'s Helping Hand and Beads of Ruin are field facts', () => {
      expect(observationsOf(HELPING_HAND, 'doubles')[0].fieldFacts).toEqual(['helpinghand']);
      expect(observationsOf(BEADS_OF_RUIN, 'doubles')[0].fieldFacts).toEqual(['beadsofruin']);
      expect(observationsOf(GAS_ON_THE_PARTNER, 'doubles')[0]).toMatchObject({ defenderSuppressed: true });
      expect(observationsOf(GRAVITY, 'doubles')[0].fieldFacts).toEqual(['gravity']);
      for (const scene of [HELPING_HAND, BEADS_OF_RUIN, GAS_ON_THE_PARTNER]) expect(kinds(scene)).toEqual(['doubles']);
    });
  });
});
