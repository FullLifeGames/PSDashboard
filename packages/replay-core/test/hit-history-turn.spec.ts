import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildSolveContext, keyOf, observationError, rollRange, spreadFor, type SolveContext } from '../src/spreads/fit';
import type { ReadObservation } from '../src/spreads/observation-read';
import type { DamageObservation } from '../src/types';
import {
  FORMAT, alone, damagingTurns, hit, isDoubles, scaled, scenesOf, set, splash, team,
  type FieldScene, type Kind, type Scene,
} from './fit-field-scenes';

/**
 * Round 73 (T210, group 3): Stakeout doubles the hit on a target that came in this turn, Analytic lifts the hit of the last mover of
 * the turn. The simulator reads `defender.activeTurns` and `queue.willMove`. The calculator takes Stakeout from the attacker's
 * `abilityOn` (the solver never set it) and decides Analytic from the speeds of the candidate spreads, which is wrong when a
 * priority move or a Speed boost put the order against the speeds. The observation carries the two facts of the hit (the target
 * switched in this turn; every other active has moved), and the solver sets the ability's state from them: Stakeout on, Analytic
 * on when the user moved last and dropped for the hit when it did not. The oracle is the simulator's damage.
 */

const DRAGONITE = () => set('Dragonite', '', 'Inner Focus', ['Splash'], 'Jolly', { hp: 252, spe: 252 });
/** A partner that outruns the attacker, so that the attacker is the last mover of a doubles turn when the foes are faster too. */
const FAST = () => set('Regieleki', '', 'Transistor', ['Splash'], 'Timid', { spe: 252 });
const SKARMORY = () => set('Skarmory', '', 'Sturdy', ['Splash'], 'Impish', { hp: 252, def: 252 });

interface Kit { species: string; ability: string; hits: string[]; priority: string }
const STAKEOUT: Kit = { species: 'Gumshoos', ability: 'Stakeout', hits: ['Body Slam', 'Splash'], priority: 'Quick Attack' };
const ANALYTIC_GEN9: Kit = { species: 'Magnezone', ability: 'Analytic', hits: ['Iron Head', 'Splash'], priority: 'Bullet Punch' };
const ANALYTIC_CHAMPIONS: Kit = { species: 'Watchog', ability: 'Analytic', hits: ['Body Slam', 'Splash'], priority: 'Quick Attack' };

const attackerOf = (kit: Kit, ...extra: string[]) => set(kit.species, '', kit.ability, [...kit.hits, kit.priority, ...extra], 'Adamant', { hp: 252, atk: 252 });

/** Stakeout: the foe switches Skarmory in and the attacker hits it that turn, then hits it again on the next turn (no boost). */
const stakeout = (kinds: Kind[]): FieldScene => ({
  title: 'Stakeout on the turn the target came in, and the turn after',
  p1: team(attackerOf(STAKEOUT)),
  p2: doubles => (doubles ? [DRAGONITE(), set('Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 }), SKARMORY()] : [DRAGONITE(), SKARMORY()]),
  attacker: 'Gumshoos', defender: 'Skarmory',
  steps: doubles => [
    { p1: alone(doubles, hit(doubles, 'Splash')), p2: alone(doubles, splash()) },
    { p1: alone(doubles, hit(doubles, 'Body Slam')), p2: doubles ? 'switch 3, move splash' : 'switch 2' },
    { p1: alone(doubles, hit(doubles, 'Body Slam')), p2: alone(doubles, splash()) },
  ],
  kinds, hitLine: true,
});

/** Analytic: the foe is faster (it moves first), so the hit is the last mover's; or the attacker's priority move goes first and gets no boost. */
const analytic = (kit: Kit, kinds: Kind[], priority: boolean): FieldScene => ({
  title: `Analytic ${priority ? 'moving first on priority' : 'moving last'} (${kit.species})`,
  p1: doubles => [attackerOf(kit), ...(doubles ? [FAST()] : [])],
  p2: doubles => [DRAGONITE(), ...(doubles ? [FAST()] : [])],
  attacker: kit.species, defender: 'Dragonite',
  steps: doubles => [{ p1: alone(doubles, hit(doubles, priority ? kit.priority : kit.hits[0])), p2: alone(doubles, splash()) }],
  kinds, hitLine: true,
});

const bodyOf = (scene: FieldScene, kind: Kind, side: 'p1' | 'p2', species: string) =>
  scaled((side === 'p1' ? scene.p1 : scene.p2)(isDoubles(kind)).find(body => body.species === species)!, kind);

function contextOf(scene: FieldScene, kind: Kind, observations: DamageObservation[]): SolveContext {
  return buildSolveContext(observations, { p1: [bodyOf(scene, kind, 'p1', scene.attacker)], p2: [bodyOf(scene, kind, 'p2', scene.defender)] }, FORMAT[kind], []);
}

function hitsOf(scene: FieldScene, played: Scene): DamageObservation[] {
  const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.defenderSpecies === scene.defender && obs.attackerSpecies === scene.attacker);
  expect(found.length).toBeGreaterThan(0);
  return found;
}

function containsDamage(ctx: SolveContext, scene: FieldScene, obs: ReadObservation, damage: number, maxHp: number): boolean {
  const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', scene.attacker), spreadFor(ctx, 'p2', scene.defender));
  expect(range).not.toBeNull();
  return Math.round(range!.min * maxHp) <= damage && damage <= Math.round(range!.max * maxHp);
}

/** The observation with the opposite turn facts: the reading of a solver that took the order of the turn from the speeds alone and got it wrong. */
const flipped = (obs: ReadObservation): ReadObservation => {
  const rest: Record<string, unknown> = { ...obs };
  delete rest.defenderNewlyIn;
  delete rest.lastToMove;
  return { ...(rest as unknown as ReadObservation), ...(obs.defenderNewlyIn ? {} : { defenderNewlyIn: true }), ...(obs.lastToMove ? {} : { lastToMove: true }) };
};

const GEN9: Kind[] = ['singles', 'doubles'];
const CHAMPIONS: Kind[] = ['champions singles', 'champions doubles'];

// The foe is faster in the first Analytic scenes (the speed order agrees with the game); the priority move goes first against the speeds.
const CASES: FieldScene[] = [
  stakeout(GEN9),
  analytic(ANALYTIC_GEN9, GEN9, false),
  analytic(ANALYTIC_CHAMPIONS, CHAMPIONS, false),
  analytic(ANALYTIC_GEN9, GEN9, true),
  analytic(ANALYTIC_CHAMPIONS, CHAMPIONS, true),
];

describe('the turn facts of the hit set the ability\'s state (T210 group 3)', () => {
  for (const scene of CASES) {
    for (const kind of scene.kinds) {
      test(`${kind}: ${scene.title}`, () => {
        const scenes = scenesOf(kind, scene, 3);
        expect(scenes.length).toBeGreaterThanOrEqual(2);
        for (const played of scenes) {
          const ctx = contextOf(scene, kind, hitsOf(scene, played));
          const reads = ctx.byMon.get(keyOf('p2', scene.defender)) ?? [];
          const damages = damagingTurns(played);
          expect(reads).toHaveLength(damages.length);
          reads.forEach((obs, index) => {
            expect(containsDamage(ctx, scene, obs, damages[index], played.maxHp), `hit ${index + 1}: sim ${damages[index]}`).toBe(true);
            expect(observationError(ctx, obs, keyOf('p2', scene.defender), spreadFor(ctx, 'p2', scene.defender))).toBe(0);
          });
          const misses = reads.some((obs, index) => !containsDamage(ctx, scene, flipped(obs), damages[index], played.maxHp));
          expect(misses, 'the opposite facts miss a hit').toBe(true);
        }
      });
    }
  }

  test('the facts are booked only when true', () => {
    const [played] = scenesOf('singles', stakeout(GEN9), 1);
    const [boosted, later] = hitsOf(stakeout(GEN9), played);
    expect(boosted.defenderNewlyIn).toBe(true);
    expect(later.defenderNewlyIn).toBeUndefined();
    const [first] = scenesOf('singles', analytic(ANALYTIC_GEN9, GEN9, true), 1);
    expect(hitsOf(analytic(ANALYTIC_GEN9, GEN9, true), first)[0].lastToMove).toBeUndefined();
    const [last] = scenesOf('singles', analytic(ANALYTIC_GEN9, GEN9, false), 1);
    expect(hitsOf(analytic(ANALYTIC_GEN9, GEN9, false), last)[0].lastToMove).toBe(true);
  });
});
