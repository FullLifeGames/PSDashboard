import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildSolveContext, keyOf, observationError, rollRange, spreadFor, type SolveContext } from '../src/spreads/fit';
import type { ReadObservation } from '../src/spreads/observation-read';
import type { DamageObservation } from '../src/types';
import {
  BEADS_OF_RUIN, BOOSTED_HIT, ERUPTION, FLASH_FIRE, FORMAT, GAS_ON_THE_PARTNER, GASTRO_ACID, GRAVITY, HELPING_HAND, isDoubles, MULTISCALE, SUPREME_OVERLORD,
  TERA_ATTACKER, TERA_DEFENDER, TERRAIN_PULSE, WEATHER_BALL, damagingTurns, scaled, scenesOf,
  type FieldScene, type Kind, type Scene,
} from './fit-field-scenes';

/**
 * Round 69 (T86, spec decision 11): the spread solver priced every hit on a plain field. It gave the calculator the move's id
 * (Weather Ball, Terrain Pulse, Techno Blast and Multi-Attack key on the name), no terrain, no Terastallization, full HP on both
 * sides (Multiscale always halved, Eruption always at 150), no Supreme Overlord count, the set's ability where the log shows
 * another or shows it suppressed, and none of the field facts the log holds (a Helping Hand, Beads of Ruin on the partner). The
 * parser now reads each of them off the client battle at the damage line, and the solver hands them on. The oracle is the
 * simulator: real battles, singles and doubles, where the calculator's rolls under the observation must contain the simulator's
 * exact damage of every hit, and the observation as the solver read it before the change (without the new fields) must not.
 */

/** What T86 added to DamageObservation: stripped, an observation reads as it did in round 68. */
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

/** The observations of the hits into the defender, in step order, as the parser reads the scene's public log. */
function hitsOf(scene: FieldScene, played: Scene): DamageObservation[] {
  const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.defenderSpecies === scene.defender);
  expect(found).toHaveLength(damagingTurns(played).length);
  return found;
}

/** The solver's read of the observations of the hits (the forme and side they resolve to). */
const readsOf = (ctx: SolveContext, scene: FieldScene): ReadObservation[] => ctx.byMon.get(keyOf('p2', scene.defender)) ?? [];

/** Whether the calculator's rolls of the hit, under the sets' own spreads, contain the simulator's exact damage. */
function containsDamage(ctx: SolveContext, scene: FieldScene, obs: ReadObservation, damage: number, maxHp: number): boolean {
  const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', scene.attacker), spreadFor(ctx, 'p2', scene.defender));
  expect(range).not.toBeNull();
  const slack = scene.barNoise ?? 0;
  return Math.round(range!.min * maxHp * (1 - slack)) <= damage && damage <= Math.round(range!.max * maxHp * (1 + slack));
}

/** Scenes that read wrong before T86: every hit is in the rolls after, and at least one is not in the rolls of the stale reading. */
const FIELD_SCENES: FieldScene[] = [
  WEATHER_BALL, TERRAIN_PULSE, MULTISCALE, SUPREME_OVERLORD, TERA_ATTACKER, TERA_DEFENDER, ERUPTION, GASTRO_ACID, GAS_ON_THE_PARTNER, GRAVITY,
  FLASH_FIRE, HELPING_HAND, BEADS_OF_RUIN,
];

describe('the rolls of a hit contain the simulator\'s damage with the field the log shows (T86)', () => {
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
          // The reading of round 68 gets at least one hit wrong, or the scene shows nothing.
          expect(reads.some((obs, index) => !containsDamage(ctx, scene, stale(obs), damages[index], played.maxHp)), 'a hit the stale reading misses').toBe(true);
        }
      });
    }
  }
});

describe('a hit on a plain field reads as it did (T86)', () => {
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

describe('the observation names the field at the hit (T86)', () => {
  /** The observations of a scene's first clean battle on the kind. */
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
