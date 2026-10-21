import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildSolveContext, keyOf, observationError, rollRange, spreadFor } from '../src/spreads/fit';
import {
  FORMAT, alone, hit, isDoubles, scaled, scenesOf, set, splash, team, damagingTurns,
  type FieldScene, type Kind,
} from './fit-field-scenes';

/**
 * Round 73 (T202): the calculator forces the spread target for Expanding Force in Psychic Terrain (a grounded user) and Tera Starstorm
 * of Terapagos-Stellar. Against a lone foe the simulator plays one target, and the move line prints no `[spread]`: the calculator's
 * Doubles field still cuts the hit to 0.75 and the fit read a hit 25 percent too low (Hatterene against Clefable: 322 damage in the
 * simulator). The observation drops out of the solver when the calculator's own result names a spread target that the log does not
 * show; no move name decides it. The hit with two foes keeps its reading. The oracle is the simulator's damage.
 */

const HATTERENE = () => set('Hatterene', '', 'Magic Bounce', ['Expanding Force', 'Splash'], 'Modest', { hp: 252, spa: 252 });
const GARDEVOIR = () => set('Gardevoir', '', 'Trace', ['Psychic Terrain', 'Splash'], 'Timid', { spe: 252 });
const TERAPAGOS = () => set('Terapagos', '', 'Tera Shift', ['Tera Starstorm', 'Splash'], 'Modest', { hp: 252, spa: 252 }, 'Stellar');
const WALL = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252, spd: 252 });
const PARTNER = () => set('Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });
/** The second foe of a lone-foe scene: it explodes on the first turn and the first foe stands alone. */
const BOMB = () => set('Magikarp', '', 'Swift Swim', ['Explosion', 'Splash'], 'Hardy', {});
const AWAY = 'move splash, pass';
const FIRST = (lone: boolean) => (lone ? 'move splash, move explosion' : 'move splash, move splash');
const THEN = (lone: boolean) => (lone ? AWAY : 'move splash, move splash');

/** Hatterene in Psychic Terrain into a lone Blissey (`lone`), or into two foes. */
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

/** Terapagos after the Tera click into a lone Blissey, or into two foes. */
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
