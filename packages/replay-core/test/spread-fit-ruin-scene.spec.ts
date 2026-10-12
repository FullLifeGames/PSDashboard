import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, keyOf, observationError, rollRange, spreadFor, type SolveContext } from '../src/spreads/fit';
import type { ReadObservation } from '../src/spreads/observation-read';
import type { DamageObservation, PokemonEvs } from '../src/types';
import {
  FORMAT, alone, damagingTurns, hit, isDoubles, scenesOf, set, splash,
  type FieldScene, type Kind, type Scene,
} from './fit-field-scenes';

/**
 * Round 69 (T86 check on the pin gen9vgc2026regi-2630685175, turn 3): the logged Extreme Speed of a Terastallized Normal Dragonite into
 * Calyrex-Ice was the one hit that set the HP of Calyrex-Ice in the fit (the solver cut its HP to 0 EVs), because the solver priced it
 * with no Tera type, without the Sword of Ruin of the Chien-Pao beside Calyrex-Ice and on a field without the Grassy Terrain. The
 * Ruin abilities lower the Defense of every Pokemon on the field but the holder, ally or foe, and the log shows them as abilities,
 * so no list of species is needed. The oracle is the simulator: real Gen 9 battles where the calculator's rolls under the logged
 * field must contain the simulator's exact damage, the rolls of the reading without the new fields must not, and the solver must
 * keep the played body. Champions has no Chien-Pao and the calculator's Champions mechanics has no Ruin ability.
 */

const DRAGONITE = () => set('Dragonite', '', 'Multiscale', ['Extreme Speed', 'Splash'], 'Adamant', { atk: 252, spe: 252 }, 'Normal');
/** A weak Wood Hammer: Bold and no Attack IV, so that a Grassy Terrain hit does not take Calyrex-Ice down. */
const RILLABOOM = () => ({ ...set('Rillaboom', '', 'Grassy Surge', ['Wood Hammer', 'Splash'], 'Bold', {}), ivs: { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 } });
/** The body the pin's usage prior gave Calyrex-Ice: Brave, 252 HP, 252 Attack, 4 Special Defense. */
const CALYREX_ICE = () => set('Calyrex-Ice', '', 'As One (Glastrier)', ['Splash'], 'Brave', { hp: 252, atk: 252, spd: 4 });
const CHIEN_PAO = (moves: string[], nature: string, spread: Partial<PokemonEvs>) => set('Chien-Pao', '', 'Sword of Ruin', moves, nature, spread);

/** The Chien-Pao beside the defender holds the Sword of Ruin (the pin's turn 3). Doubles only. */
const RUIN_ON_THE_PARTNER: FieldScene = {
  title: "the defender's partner holds the Sword of Ruin, the attacker Terastallizes to Normal",
  p1: () => [DRAGONITE(), RILLABOOM()],
  p2: () => [CALYREX_ICE(), CHIEN_PAO(['Splash'], 'Impish', { hp: 252, def: 252 })],
  attacker: 'Dragonite', defender: 'Calyrex-Ice',
  // Two hits, since the solver wants two lines before it moves a body; the Grassy Terrain heals between them.
  steps: () => [
    { p1: `${hit(true, 'Extreme Speed', true)}, ${splash()}`, p2: `${splash()}, ${splash()}` },
    { p1: `${hit(true, 'Extreme Speed')}, ${splash()}`, p2: `${splash()}, ${splash()}` },
  ],
  kinds: ['doubles'],
  hitLine: true,
};

/** The defender holds the Sword of Ruin itself: the ability does not lower its own Defense, whatever the other holders do. Doubles only. */
const RUIN_ON_THE_DEFENDER: FieldScene = {
  title: 'the defender holds the Sword of Ruin',
  p1: () => [DRAGONITE(), RILLABOOM()],
  p2: () => [CHIEN_PAO(['Splash'], 'Impish', { hp: 252, def: 252 }), CALYREX_ICE()],
  attacker: 'Dragonite', defender: 'Chien-Pao',
  steps: () => [{ p1: `${hit(true, 'Extreme Speed', true)}, ${splash()}`, p2: `${splash()}, ${splash()}` }],
  kinds: ['doubles'],
  hitLine: true,
};

/** The attacker holds the Sword of Ruin: the target's Defense falls by a quarter. Singles and doubles. */
const RUIN_ON_THE_ATTACKER: FieldScene = {
  title: 'the attacker holds the Sword of Ruin',
  p1: doubles => [CHIEN_PAO(['Crunch', 'Splash'], 'Hardy', {}), ...(doubles ? [RILLABOOM()] : [])],
  p2: doubles => [CALYREX_ICE(), ...(doubles ? [set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 })] : [])],
  attacker: 'Chien-Pao', defender: 'Calyrex-Ice',
  steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Crunch')), p2: alone(doubles, splash()) }],
  kinds: ['singles', 'doubles'],
  hitLine: true,
};

/** A Grassy Surge lead hits with Wood Hammer, which the terrain lifts by a third, and the terrain heals the defender at the end of the turn. */
const GRASSY_HIT: FieldScene = {
  title: 'Wood Hammer in Grassy Terrain',
  p1: doubles => [RILLABOOM(), ...(doubles ? [set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 })] : [])],
  p2: doubles => [CALYREX_ICE(), ...(doubles ? [CHIEN_PAO(['Splash'], 'Impish', { hp: 252, def: 252 })] : [])],
  attacker: 'Rillaboom', defender: 'Calyrex-Ice',
  steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Wood Hammer')), p2: alone(doubles, splash()) }],
  kinds: ['singles', 'doubles'],
  hitLine: true,
};

/** What T86 added to DamageObservation: stripped, an observation reads as it did in round 68. */
const T86_FIELDS = [
  'moveName', 'terrain', 'attackerTera', 'defenderTera', 'attackerHp', 'defenderHp', 'attackerFallen', 'attackerAbility', 'defenderAbility',
  'attackerAbilityOn', 'attackerSuppressed', 'defenderSuppressed', 'fieldFacts',
] as const;
const stale = <T extends DamageObservation>(obs: T): T => {
  const rest: Record<string, unknown> = { ...obs };
  for (const field of T86_FIELDS) delete rest[field];
  return rest as unknown as T;
};

const bodyOf = (scene: FieldScene, doubles: boolean, side: 'p1' | 'p2', species: string) =>
  (side === 'p1' ? scene.p1 : scene.p2)(doubles).find(body => body.species === species)!;

function contextOf(scene: FieldScene, kind: Kind, observations: DamageObservation[]): SolveContext {
  const doubles = isDoubles(kind);
  return buildSolveContext(
    observations, { p1: [bodyOf(scene, doubles, 'p1', scene.attacker)], p2: [bodyOf(scene, doubles, 'p2', scene.defender)] }, FORMAT[kind], [],
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
  return Math.round(range!.min * maxHp) <= damage && damage <= Math.round(range!.max * maxHp);
}

describe('the Ruin abilities and the Grassy Terrain are in the rolls of a hit (T86 check)', () => {
  for (const scene of [RUIN_ON_THE_PARTNER, RUIN_ON_THE_DEFENDER, RUIN_ON_THE_ATTACKER, GRASSY_HIT]) {
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
          reads.forEach((obs, index) => {
            expect(containsDamage(ctx, scene, obs, damages[index], played.maxHp), `hit ${index + 1}`).toBe(true);
            expect(observationError(ctx, obs, keyOf('p2', scene.defender), spreadFor(ctx, 'p2', scene.defender)), `error of hit ${index + 1}`).toBe(0);
          });
          // The reading of round 68 misses the hit, except where the calculator reads the Ruin off the two bodies: the defender's own
          // Sword of Ruin lowers nothing, and the attacker's comes with the ability of its set.
          if (scene !== RUIN_ON_THE_DEFENDER && scene !== RUIN_ON_THE_ATTACKER) {
            expect(reads.some((obs, index) => !containsDamage(ctx, scene, stale(obs), damages[index], played.maxHp)), 'a hit the stale reading misses').toBe(true);
          }
        }
      });
    }
  }

  test('doubles: the Sword of Ruin is a field fact that the log shows, and the Grassy Terrain a terrain', () => {
    const [partner] = scenesOf('doubles', RUIN_ON_THE_PARTNER, 1);
    expect(hitsOf(RUIN_ON_THE_PARTNER, partner)[0]).toMatchObject({ fieldFacts: ['swordofruin'], terrain: 'Grassy', attackerTera: 'Normal' });
    const [grassy] = scenesOf('singles', GRASSY_HIT, 1);
    expect(hitsOf(GRASSY_HIT, grassy)[0]).toMatchObject({ terrain: 'Grassy' });
  });

  test('doubles: a Sword of Ruin held by the defender itself lowers nothing of its own Defense', () => {
    for (const played of scenesOf('doubles', RUIN_ON_THE_DEFENDER, 3)) {
      const observations = hitsOf(RUIN_ON_THE_DEFENDER, played);
      const ctx = contextOf(RUIN_ON_THE_DEFENDER, 'doubles', observations);
      const attacker = spreadFor(ctx, 'p1', 'Dragonite');
      const defender = spreadFor(ctx, 'p2', 'Chien-Pao');
      for (const obs of readsOf(ctx, RUIN_ON_THE_DEFENDER)) {
        expect(obs.fieldFacts).toContain('swordofruin');
        expect(obs.defenderAbility).toBe('swordofruin');
        expect(rollRange(ctx, obs, attacker, defender)).toEqual(rollRange(ctx, { ...obs, fieldFacts: [] }, attacker, defender));
      }
    }
  });
});

describe('the solver keeps the body the pin hit measures (T86 check)', () => {
  test('doubles: Calyrex-Ice keeps its HP under the logged field, and the prior misses the hit under the blind one', () => {
    const doubles = true;
    const kind: Kind = 'doubles';
    const scene = RUIN_ON_THE_PARTNER;
    const teams = { p1: scene.p1(doubles), p2: scene.p2(doubles) };
    const key = keyOf('p2', 'Calyrex-Ice');
    for (const played of scenesOf(kind, scene, 3)) {
      const observations = hitsOf(scene, played);
      const solved = inferSpreads(observations, teams, FORMAT[kind], []).get(key);
      const ctx = buildSolveContext(observations, teams, FORMAT[kind], []);
      // The prior explains the hit exactly; the solver has nothing to move.
      const body = solved ?? spreadFor(ctx, 'p2', 'Calyrex-Ice');
      expect(body.evs.hp).toBeGreaterThanOrEqual(156);
      expect(observationError(ctx, readsOf(ctx, scene)[0], key, body)).toBe(0);

      // Without Tera, Sword of Ruin and terrain the prior misses the hit (the pin's solver then took the least bad body, HP 0).
      const blind = observations.map(stale);
      const blindCtx = buildSolveContext(blind, teams, FORMAT[kind], []);
      expect(observationError(blindCtx, readsOf(blindCtx, scene)[0], key, spreadFor(blindCtx, 'p2', 'Calyrex-Ice'))).toBeGreaterThan(0);
    }
  });
});
