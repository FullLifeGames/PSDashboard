import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, keyOf, observationError, rollRange, spreadFor } from '../src/spreads/fit';
import type { DamageObservation } from '../src/types';
import { FORMAT, alone, hit, isDoubles, playScene, set, type FieldScene, type Kind } from './fit-field-scenes';

/**
 * Round 69 (diagnosis of bundle a1, rows 6 and 9): a hit the defender survives at 1 HP through an item or an ability that fires inside
 * the move (Focus Sash `-enditem`, Sturdy `-ability`, Endure `-activate`, Focus Band `-activate`) is no reading of the damage but a
 * lower bound, as a knock-out is. The marker comes before the defender's damage line, so the parser reads it off the protocol and
 * names no item. The oracle is the simulator: the same Drill Run that leaves the Sash holder at 1 percent is a knock-out for the
 * holder without the marker, and the rolls of the played spread are at or above the shown fraction.
 */

const KINDS: Kind[] = ['singles', 'doubles'];
const GARCHOMP = () => set('Garchomp', '', 'Rough Skin', ['Drill Run', 'Splash'], 'Jolly', { atk: 252, spe: 252 });
const BLISSEY = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });
const CHANSEY = () => set('Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });

/** Garchomp's Drill Run into one defender, which answers with its own choice (Endure goes first). */
function drillRun(title: string, defender: ReturnType<typeof set>, answer = 'move splash'): FieldScene {
  return {
    title,
    p1: doubles => [GARCHOMP(), ...(doubles ? [BLISSEY()] : [])],
    p2: doubles => [defender, ...(doubles ? [CHANSEY()] : [])],
    attacker: 'Garchomp', defender: defender.species,
    steps: doubles => [{ p1: alone(doubles, hit(doubles, 'Drill Run')), p2: alone(doubles, answer) }],
    kinds: KINDS,
  };
}

const SASH = drillRun('a Focus Sash holder at full HP', set('Gengar', 'Focus Sash', 'Cursed Body', ['Splash'], 'Timid', {}));
const STURDY = drillRun('Sturdy at full HP', set('Magnezone', '', 'Sturdy', ['Splash'], 'Timid', {}));
const ENDURE = drillRun('Endure', set('Gengar', '', 'Cursed Body', ['Endure'], 'Timid', {}), 'move endure');
/** The control: the same hit is a knock-out for a holder without a marker. */
const NO_MARKER = drillRun('the same hit without a marker', set('Gengar', '', 'Cursed Body', ['Splash'], 'Timid', {}));
/** The control: a Shuca Berry ends inside the move, before the damage line, and the holder keeps most of its HP. */
const BERRY = drillRun('a berry that weakens the hit', set('Gengar', 'Shuca Berry', 'Cursed Body', ['Splash'], 'Timid', {}));

/** The observation of the Drill Run on the first clean seed of the scene (a crit is no reading and the scene skips it). */
function observationOf(kind: Kind, scene: FieldScene): DamageObservation {
  for (let seed = 1; seed <= 200; seed++) {
    const played = playScene(kind, scene, seed);
    if (played.reject && played.reject !== 'fainted') continue;
    const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.moveId === 'drillrun');
    if (found.length === 1) return found[0];
  }
  throw new Error(`no clean battle of ${scene.title} on ${kind}`);
}

describe('a hit the defender survives at 1 HP through a marker is a lower bound', () => {
  for (const kind of KINDS) {
    for (const scene of [SASH, STURDY, ENDURE]) {
      test(`${kind}: ${scene.title}`, () => {
        const obs = observationOf(kind, scene);
        expect(obs.observedFraction).toBeCloseTo(0.99, 5);
        expect(obs.lethal).toBe(true);
      });
    }

    test(`${kind}: a knock-out without a marker is a lower bound, as before`, () => {
      const obs = observationOf(kind, NO_MARKER);
      expect(obs.observedFraction).toBe(1);
      expect(obs.lethal).toBe(true);
    });

    test(`${kind}: a marker with most of the HP left stays a reading`, () => {
      const obs = observationOf(kind, BERRY);
      expect(obs.defenderItem).toBe('shucaberry');
      expect(obs.observedFraction).toBeGreaterThan(0.3);
      expect(obs.observedFraction).toBeLessThan(0.9);
      expect(obs.lethal).toBe(false);
    });
  }
});

describe('the solver reads the surviving hit as a lower bound', () => {
  for (const kind of KINDS) {
    test(`${kind}: the played spreads have error 0 and the attacker keeps its offense`, () => {
      const doubles = isDoubles(kind);
      const observations = [SASH, STURDY].map(scene => observationOf(kind, scene));
      const teams = { p1: [GARCHOMP(), ...(doubles ? [BLISSEY()] : [])], p2: [SASH.p2(doubles)[0], STURDY.p2(doubles)[0]] };
      const ctx = buildSolveContext(observations, teams, FORMAT[kind], []);
      for (const obs of observations) {
        const range = rollRange(ctx, ctx.byMon.get(keyOf('p2', obs.defenderSpecies))![0], spreadFor(ctx, 'p1', 'Garchomp'), spreadFor(ctx, 'p2', obs.defenderSpecies))!;
        // The hit would have taken all of the HP, the log shows only the part up to the Sash.
        expect(range.min, obs.defenderSpecies).toBeGreaterThan(obs.observedFraction);
        expect(observationError(ctx, ctx.byMon.get(keyOf('p2', obs.defenderSpecies))![0], keyOf('p2', obs.defenderSpecies), spreadFor(ctx, 'p2', obs.defenderSpecies)), obs.defenderSpecies).toBe(0);
      }
      const solved = inferSpreads(observations, teams, FORMAT[kind], []).get(keyOf('p1', 'Garchomp'));
      expect(solved?.evs.atk ?? 252, 'the offense the lines cannot measure').toBe(252);
    });
  }
});
