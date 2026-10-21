import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildSolveContext, keyOf, observationError, rollRange, spreadFor, type SolveContext } from '../src/spreads/fit';
import type { ReadObservation } from '../src/spreads/observation-read';
import type { DamageObservation } from '../src/types';
import { FORMAT, damagingTurns, isDoubles, scaled, scenesOf, set, type FieldScene, type Kind, type Scene } from './fit-field-scenes';

/**
 * Round 73 (T210, group 1): Last Respects and Rage Fist take their power from the battle's history, the fallen of the attacker's
 * side and the hits the attacker took. The Dex gives the calculator the plain 50, so the solver priced a hit of 150 power at 50.
 * The observation carries the two counts the client battle holds at the damage line, and the solver asks the Dex move's own
 * `basePowerCallback` for the power (spreads/hit-power.ts); no move name decides it. The oracle is the simulator's damage:
 * singles and doubles (the Champions roster holds neither move's users, the census spec states it).
 */

const GARCHOMP = () => set('Garchomp', '', 'Rough Skin', ['Crunch', 'Dragon Claw', 'Splash'], 'Hardy', { hp: 252, def: 252, spd: 4 });
const DRAGONITE = () => set('Dragonite', '', 'Inner Focus', ['Crunch', 'Dragon Claw', 'Splash'], 'Hardy', { hp: 252 });
/** One HP, and a Dark move is super effective on it: every Crunch knocks it out. */
const FODDER = (nickname: string) => ({ ...set('Shedinja', '', 'Wonder Guard', ['Splash'], 'Hardy', {}), name: nickname });
const BASCULEGION = () => set('Basculegion', '', 'Swift Swim', ['Last Respects', 'Splash'], 'Adamant', { hp: 252, atk: 252 });
const ANNIHILAPE = () => set('Annihilape', '', 'Defiant', ['Rage Fist', 'Splash'], 'Adamant', { hp: 252, atk: 252 });
const BLISSEY = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252, spd: 252 });

/** Two teammates of Basculegion fall to the foes' Crunch before it uses Last Respects. */
const LAST_RESPECTS: FieldScene = {
  title: 'Last Respects after two fallen',
  p1: doubles => (doubles ? [FODDER('Shed1'), FODDER('Shed2'), BASCULEGION(), BLISSEY()] : [FODDER('Shed1'), FODDER('Shed2'), BASCULEGION()]),
  p2: doubles => (doubles ? [GARCHOMP(), DRAGONITE()] : [GARCHOMP()]),
  attacker: 'Basculegion', defender: 'Garchomp',
  steps: doubles => (doubles
    ? [
      { p1: 'move splash, move splash', p2: 'move crunch 1, move crunch 2' },
      { p1: 'switch 3, switch 4' },
      { p1: 'move lastrespects 1, move splash', p2: 'move splash, move splash' },
    ]
    : [
      { p1: 'move splash', p2: 'move crunch' },
      { p1: 'switch 2' },
      { p1: 'move splash', p2: 'move crunch' },
      { p1: 'switch 3' },
      { p1: 'move lastrespects', p2: 'move splash' },
    ]),
  kinds: ['singles', 'doubles'],
};

/** Annihilape takes two hits of Dragon Claw before its Rage Fist. */
const RAGE_FIST: FieldScene = {
  title: 'Rage Fist after two hits taken',
  p1: doubles => (doubles ? [ANNIHILAPE(), BLISSEY()] : [ANNIHILAPE()]),
  p2: doubles => (doubles ? [GARCHOMP(), DRAGONITE()] : [GARCHOMP()]),
  attacker: 'Annihilape', defender: 'Garchomp',
  steps: doubles => (doubles
    ? [
      { p1: 'move splash, move splash', p2: 'move dragonclaw 1, move splash' },
      { p1: 'move splash, move splash', p2: 'move dragonclaw 1, move splash' },
      { p1: 'move ragefist 1, move splash', p2: 'move splash, move splash' },
    ]
    : [
      { p1: 'move splash', p2: 'move dragonclaw' },
      { p1: 'move splash', p2: 'move dragonclaw' },
      { p1: 'move ragefist', p2: 'move splash' },
    ]),
  kinds: ['singles', 'doubles'],
};

const SCENES = [LAST_RESPECTS, RAGE_FIST];

const bodyOf = (scene: FieldScene, kind: Kind, side: 'p1' | 'p2', species: string) =>
  scaled((side === 'p1' ? scene.p1 : scene.p2)(isDoubles(kind)).find(body => body.species === species)!, kind);

function contextOf(scene: FieldScene, kind: Kind, observations: DamageObservation[]): SolveContext {
  return buildSolveContext(observations, { p1: [bodyOf(scene, kind, 'p1', scene.attacker)], p2: [bodyOf(scene, kind, 'p2', scene.defender)] }, FORMAT[kind], []);
}

/** The hits of the scene's attacker into the defender. */
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

/** The observation as the solver read it before T210 group 1: no history count. */
const stale = (obs: ReadObservation): ReadObservation => {
  const rest: Record<string, unknown> = { ...obs };
  delete rest.attackerFainted;
  delete rest.attackerTimesAttacked;
  return rest as unknown as ReadObservation;
};

describe('a history power reaches the calculator through the Dex callback (T210 group 1)', () => {
  for (const scene of SCENES) {
    for (const kind of scene.kinds) {
      test(`${kind}: ${scene.title}`, () => {
        const scenes = scenesOf(kind, scene, 3);
        expect(scenes.length).toBeGreaterThanOrEqual(2);
        for (const played of scenes) {
          const observations = hitsOf(scene, played);
          const ctx = contextOf(scene, kind, observations);
          const reads = ctx.byMon.get(keyOf('p2', scene.defender)) ?? [];
          expect(reads).toHaveLength(observations.length);
          // The last damage of the scene is the history hit.
          const damage = damagingTurns(played).at(-1)!;
          const obs = reads.at(-1)!;
          expect(containsDamage(ctx, scene, obs, damage, played.maxHp), `the history hit sim ${damage}`).toBe(true);
          expect(observationError(ctx, obs, keyOf('p2', scene.defender), spreadFor(ctx, 'p2', scene.defender))).toBe(0);
          expect(containsDamage(ctx, scene, stale(obs), damage, played.maxHp), 'the stale reading prices the plain 50').toBe(false);
        }
      });
    }
  }

  test('the observation carries the two counts, and only when they are above zero', () => {
    const [lastRespects] = scenesOf('singles', LAST_RESPECTS, 1);
    expect(hitsOf(LAST_RESPECTS, lastRespects).at(-1)).toMatchObject({ attackerFainted: 2 });
    const [rageFist] = scenesOf('singles', RAGE_FIST, 1);
    expect(hitsOf(RAGE_FIST, rageFist).at(-1)).toMatchObject({ attackerTimesAttacked: 2 });
    const [plain] = scenesOf('singles', RAGE_FIST, 1);
    expect(hitsOf(RAGE_FIST, plain)[0].attackerFainted).toBeUndefined();
  });
});
