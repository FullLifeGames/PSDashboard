import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildSolveContext, keyOf, observationError, rollRange, spreadFor, type SolveContext } from '../src/spreads/fit';
import type { ReadObservation } from '../src/spreads/observation-read';
import type { DamageObservation } from '../src/types';
import { FORMAT, damagingTurns, scaled, scenesOf, set, type FieldScene, type Kind, type Scene } from './fit-field-scenes';

/**
 * Round 73 (T210, group 4): Plus and Minus lift the user's Special Attack by half while an ally has Plus or Minus (the simulator
 * asks `pokemon.allies()` and `hasAbility`). The calculator takes the lift from the attacker's `abilityOn`, which the solver never
 * set. The partner's ability comes the way T203 reads it: the ability the log showed, else the Dex's for a species with one
 * ability, else the built set's. The observation carries the partner; the solver switches the ability on when the partner has
 * Plus or Minus. The oracle is the simulator's damage. Singles has no ally: the control scene must not move.
 */

const BLISSEY = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252, spd: 252 });
const CHANSEY = () => set('Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });
const user = (species: string, ability: string) => set(species, '', ability, ['Thunderbolt', 'Splash'], 'Modest', { hp: 252, spa: 252 });
const partner = (species: string, ability: string) => set(species, '', ability, ['Splash'], 'Hardy', { hp: 252 });

interface AllyScene extends FieldScene {
  /** The sets the solver gets: the attacker, the defender and the partner whose ability is a guess. */
  solverSets: () => { p1: PokemonSet[]; p2: PokemonSet[] };
  /** Whether the user's ability is on: an ally has Plus or Minus. */
  boosted: boolean;
}

const sceneOf = (title: string, kinds: Kind[], lead: PokemonSet, ally: (() => PokemonSet) | null, boosted: boolean): AllyScene => ({
  title, kinds, boosted,
  p1: doubles => [lead, ...(doubles ? [ally ? ally() : CHANSEY()] : [])],
  p2: doubles => [BLISSEY(), ...(doubles ? [CHANSEY()] : [])],
  attacker: lead.species, defender: 'Blissey',
  steps: doubles => [{ p1: doubles ? 'move thunderbolt 1, move splash' : 'move thunderbolt', p2: doubles ? 'move splash, move splash' : 'move splash' }],
  solverSets: () => ({ p1: ally && ally().species ? [lead, ally()] : [lead], p2: [BLISSEY()] }),
});

const SCENES: AllyScene[] = [
  sceneOf('Plus beside Minus (Minun has two abilities: its set decides)', ['doubles'], user('Plusle', 'Plus'), () => partner('Minun', 'Minus'), true),
  sceneOf('Plus beside Plus (Plusle has the one ability slot)', ['doubles'], user('Plusle', 'Plus'), () => partner('Plusle', 'Plus'), true),
  sceneOf('Minus beside Plus', ['doubles'], user('Minun', 'Minus'), () => partner('Plusle', 'Plus'), true),
  sceneOf('Plus beside a partner without Plus or Minus', ['doubles'], user('Plusle', 'Plus'), null, false),
  sceneOf('Plus alone in singles', ['singles'], user('Plusle', 'Plus'), null, false),
  sceneOf('Plus beside Minus in the Champions roster (Ampharos and Manectric)', ['champions doubles'], user('Ampharos', 'Plus'), () => partner('Manectric', 'Minus'), true),
];

const bodyOf = (sets: PokemonSet[], kind: Kind) => sets.map(body => scaled(body, kind));

function contextOf(scene: AllyScene, kind: Kind, observations: DamageObservation[]): SolveContext {
  const sets = scene.solverSets();
  return buildSolveContext(observations, { p1: bodyOf(sets.p1, kind), p2: bodyOf(sets.p2, kind) }, FORMAT[kind], []);
}

function hitsOf(scene: AllyScene, played: Scene): DamageObservation[] {
  const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.defenderSpecies === scene.defender && obs.attackerSpecies === scene.attacker);
  expect(found.length).toBeGreaterThan(0);
  return found;
}

function containsDamage(ctx: SolveContext, scene: AllyScene, obs: ReadObservation, damage: number, maxHp: number): boolean {
  const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', scene.attacker), spreadFor(ctx, 'p2', scene.defender));
  expect(range).not.toBeNull();
  return Math.round(range!.min * maxHp) <= damage && damage <= Math.round(range!.max * maxHp);
}

/** The observation without the partner: the reading of a solver that never looked at the ally. */
const withoutAlly = (obs: ReadObservation): ReadObservation => {
  const rest: Record<string, unknown> = { ...obs };
  delete rest.attackerAlly;
  delete rest.attackerAllyAbility;
  return rest as unknown as ReadObservation;
};

describe('an ally with Plus or Minus switches the user\'s ability on (T210 group 4)', () => {
  for (const scene of SCENES) {
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
          // Without the ally the reading misses exactly where the lift is real.
          const misses = reads.some((obs, index) => !containsDamage(ctx, scene, withoutAlly(obs), damages[index], played.maxHp));
          expect(misses, 'the reading without the ally').toBe(scene.boosted);
        }
      });
    }
  }
});
