import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildSolveContext, keyOf, observationError, rollRange, spreadFor, type SolveContext } from '../src/spreads/fit';
import type { ReadObservation } from '../src/spreads/observation-read';
import type { DamageObservation } from '../src/types';
import { FORMAT, KINDS, alone, damagingTurns, hit, isDoubles, scaled, scenesOf, set, splash, team, type FieldScene, type Kind, type Scene } from './fit-field-scenes';

const DRAGONITE = () => set('Dragonite', '', 'Inner Focus', ['Splash'], 'Hardy', { hp: 252, def: 252 });
const GENGAR = (moves: string[]) => set('Gengar', '', 'Cursed Body', [...moves, 'Splash'], 'Modest', { hp: 252, spa: 252 });
const stepsOf = (doubles: boolean, setup: string, strike: string) => [
  { p1: alone(doubles, hit(doubles, setup)), p2: alone(doubles, splash()) },
  { p1: alone(doubles, hit(doubles, strike)), p2: alone(doubles, splash()) },
];

const statusScene = (title: string, setup: string, strike: string): FieldScene => ({
  title, p1: team(GENGAR([setup, strike])), p2: team(DRAGONITE()), attacker: 'Gengar', defender: 'Dragonite',
  steps: doubles => stepsOf(doubles, setup, strike), kinds: KINDS, hitLine: true, allowStatus: true,
});

const SCENES = [
  statusScene('Hex into a burned foe', 'Will-O-Wisp', 'Hex'),
  statusScene('Hex into a sleeping foe', 'Spore', 'Hex'),
  statusScene('Venoshock into a poisoned foe', 'Poison Gas', 'Venoshock'),
  statusScene('Venoshock into a badly poisoned foe', 'Toxic', 'Venoshock'),
];

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

const stale = (obs: ReadObservation): ReadObservation => {
  const rest: Record<string, unknown> = { ...obs };
  delete rest.defenderStatus;
  return rest as unknown as ReadObservation;
};

describe('the defender\'s status reaches the calculator', () => {
  for (const scene of SCENES) {
    for (const kind of scene.kinds) {
      test(`${kind}: ${scene.title}`, () => {
        const scenes = scenesOf(kind, scene, 3);
        expect(scenes.length).toBeGreaterThanOrEqual(2);
        for (const played of scenes) {
          const ctx = contextOf(scene, kind, hitsOf(scene, played));
          const obs = (ctx.byMon.get(keyOf('p2', scene.defender)) ?? []).at(-1)!;
          const damage = damagingTurns(played).at(-1)!;
          expect(obs.defenderStatus, 'the status at the hit').toBeTruthy();
          expect(containsDamage(ctx, scene, obs, damage, played.maxHp), `the hit: sim ${damage}`).toBe(true);
          expect(observationError(ctx, obs, keyOf('p2', scene.defender), spreadFor(ctx, 'p2', scene.defender))).toBe(0);
          expect(containsDamage(ctx, scene, stale(obs), damage, played.maxHp), 'the stale reading prices the plain power').toBe(false);
        }
      });
    }
  }

  test('a healthy defender books no status', () => {
    const healthy = statusScene('Hex into a healthy foe', 'Splash', 'Hex');
    for (const kind of ['singles', 'doubles'] as const) {
      const [played] = scenesOf(kind, healthy, 1);
      expect(hitsOf(healthy, played)[0].defenderStatus).toBeUndefined();
    }
  });
});

describe('the Dex moves whose handler reads the target\'s status are the ones the calculator reads', () => {
  const readers = (dex: ReturnType<typeof Dex.forGen>) => dex.moves.all().filter(move => {
    const handlers = ['basePowerCallback', 'onBasePower', 'onModifyDamage', 'onModifyMove'] as const;
    return handlers.some(key => /\btarget\.(status|hasStatus)\b/.test(String((move as unknown as Record<string, unknown>)[key] ?? '')));
  }).map(move => move.id).sort();

  test('gen 9', () => {
    // Smelling Salts and Wake-Up Slap also cure the status: the calculator prices the hit with the status it had.
    expect(readers(Dex.forGen(9))).toEqual(expect.arrayContaining(['hex', 'infernalparade', 'venoshock']));
  });
});
