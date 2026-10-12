import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildCalcPokemon } from '../src/calc-build';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, keyOf, rollRange, spreadFor, type SolveContext } from '../src/spreads/fit';
import type { ReadObservation } from '../src/spreads/observation-read';
import { boostedStatOf, paradoxError } from '../src/spreads/paradox';
import type { SpreadCandidate } from '../src/spreads/ladder';
import type { DamageObservation } from '../src/types';
import {
  ATTACK_BOOSTED, FORMAT, INTIMIDATE_BEFORE_ACTIVATION, KINDS, QUARK_DRIVE, SWORDS_AFTER_ACTIVATION, scenesOf, set, sp,
  type Kind, type Scene, type SceneSpec,
} from './paradox-scenes';

/**
 * Round 69 (T167, spec decision 10): Protosynthesis and Quark Drive raise the best stat, and the activation line names it. The
 * simulator picks it with `getBestStat(false, true)`: the stored stats with their stages (no item or ability modifier), the first
 * of the stats in the game's order on a tie. A spread whose best stat is another contradicts the log, so the solver prices that
 * as it prices a move order the body breaks, and it hands the calculator the named stat so the damage carries the 1.3 boost.
 * The oracle is the simulator: its own `getBestStat` for the rule, real Gen 9 singles and doubles battles for the hits.
 */

const STATS = Dex.stats.ids().filter(stat => stat !== 'hp');

/** A deterministic stream of integers for the random cases. */
function stream(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % below;
  };
}

describe('the stat the log names is the simulator\'s rule', () => {
  const battle = new Battle({
    formatid: toID('gen9ou'), seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack([set('Roaring Moon', '', 'Protosynthesis', ['Splash'], 'Adamant', {})]) },
    p2: { name: 'Beta', team: Teams.pack([set('Torkoal', '', 'Drought', ['Splash'], 'Impish', {})]) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  const mon = battle.p1.active[0];
  const simBest = (stats: Record<string, number>, stages: Record<string, number>) => {
    mon.storedStats = { ...stats } as typeof mon.storedStats;
    mon.boosts = { ...Object.fromEntries(STATS.map(stat => [stat, 0])), ...stages } as typeof mon.boosts;
    return mon.getBestStat(false, true);
  };

  test('200 random spreads, stage sets and ties agree with Pokemon.getBestStat', () => {
    const next = stream(7);
    for (let round = 0; round < 200; round++) {
      // Few distinct values, so ties and near-ties after the stages are common.
      const stats = Object.fromEntries(STATS.map(stat => [stat, 100 + next(4) * 50 + next(3)]));
      const stages = Object.fromEntries(STATS.map(stat => [stat, next(3) === 0 ? next(13) - 6 : 0]));
      expect(boostedStatOf(stats, stages), JSON.stringify({ stats, stages })).toBe(simBest(stats, stages));
    }
  });

  test('a tie goes to the first stat of the game\'s order', () => {
    const flat = Object.fromEntries(STATS.map(stat => [stat, 200]));
    expect(boostedStatOf(flat, {})).toBe(simBest(flat, {}));
    expect(boostedStatOf(flat, {})).toBe(STATS[0]);
    const last = { ...flat, spd: 300, spe: 300 };
    expect(boostedStatOf(last, {})).toBe(simBest(last, {}));
    expect(boostedStatOf(last, {})).toBe('spd');
  });

  test('a stage counts: Attack at -1 gives way to a lower stat', () => {
    const stats = { atk: 300, def: 100, spa: 100, spd: 100, spe: 250 };
    expect(boostedStatOf(stats, {})).toBe('atk');
    expect(boostedStatOf(stats, { atk: -1 })).toBe('spe');
    expect(simBest(stats, { atk: -1 })).toBe('spe');
  });
});

const foes = (spec: SceneSpec) => [spec.lead, ...(spec.bench ? [spec.bench] : [])];
const contextOf = (kind: Kind, spec: SceneSpec, observations: DamageObservation[], attacker = spec.attacker): SolveContext =>
  buildSolveContext(observations, { p1: [attacker], p2: foes(spec) }, FORMAT[kind], []);

const observationsOf = (scene: Scene) => parseReplayLogWithObservations(scene.log).observations;
const body = (nature: string, spread: Parameters<typeof sp>[0]): SpreadCandidate => ({ evs: sp(spread), nature });
const statsOf = (ctx: SolveContext, candidate: SpreadCandidate) =>
  buildCalcPokemon(ctx.gen, 'Roaring Moon', { level: 100, nature: candidate.nature, evs: candidate.evs, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } })
    .rawStats as unknown as Record<string, number>;

for (const kind of KINDS) {
  describe(`${kind}: the solver prices a body against the stat the log names`, () => {
    test('the stages count at the activation: a Swords Dance after the sun does not make Attack the best stat', () => {
      for (const scene of scenesOf(kind, SWORDS_AFTER_ACTIVATION, 3)) {
        const observations = observationsOf(scene);
        const ctx = contextOf(kind, SWORDS_AFTER_ACTIVATION, observations);
        const key = keyOf('p1', 'Roaring Moon');
        const played = spreadFor(ctx, 'p1', 'Roaring Moon');
        expect(paradoxError(ctx, key, played)).toBe(0);
        // Read at the hit (Attack +2) the played body would look wrong: that is the reading the simulator does not make.
        expect(boostedStatOf(statsOf(ctx, played), observations[0].attackerBoosts)).toBe('atk');
        // A body whose Attack is the best stat at the activation contradicts the line that names Speed.
        expect(paradoxError(ctx, key, body('Adamant', { atk: 252 }))).toBeGreaterThan(0);
        expect(boostedStatOf(statsOf(ctx, body('Adamant', { atk: 252 })), observations[0].attackerParadox!.stages)).toBe('atk');
      }
    });

    test('an Intimidate before the activation counts: Attack at -1 is not the best stat of the played body', () => {
      for (const scene of scenesOf(kind, INTIMIDATE_BEFORE_ACTIVATION, 3)) {
        const ctx = contextOf(kind, INTIMIDATE_BEFORE_ACTIVATION, observationsOf(scene));
        const key = keyOf('p1', 'Roaring Moon');
        const played = spreadFor(ctx, 'p1', 'Roaring Moon');
        expect(paradoxError(ctx, key, played)).toBe(0);
        expect(boostedStatOf(statsOf(ctx, played), {})).toBe('atk');
        // 252 Attack with an Adamant nature stays ahead of Speed after the drop.
        expect(paradoxError(ctx, key, body('Adamant', { atk: 252 }))).toBeGreaterThan(0);
      }
    });

    test('a body that agrees with the line has no error; an observation without the reading has none either', () => {
      for (const scene of scenesOf(kind, ATTACK_BOOSTED, 3)) {
        const observations = observationsOf(scene);
        const ctx = contextOf(kind, ATTACK_BOOSTED, observations);
        const key = keyOf('p1', 'Roaring Moon');
        expect(paradoxError(ctx, key, spreadFor(ctx, 'p1', 'Roaring Moon'))).toBe(0);
        expect(paradoxError(ctx, key, body('Jolly', { spe: 252 }))).toBeGreaterThan(0);
        const old = contextOf(kind, ATTACK_BOOSTED, observations.map(obs => ({ ...obs, attackerParadox: undefined, defenderParadox: undefined })));
        expect(paradoxError(old, key, body('Jolly', { spe: 252 }))).toBe(0);
      }
    });

    test('the calculator carries the boost the line names: the rolls contain the simulator\'s damage, without it they do not', () => {
      for (const spec of [ATTACK_BOOSTED, QUARK_DRIVE, SWORDS_AFTER_ACTIVATION, INTIMIDATE_BEFORE_ACTIVATION]) {
        for (const scene of scenesOf(kind, spec, 3)) {
          const observations = observationsOf(scene);
          const ctx = contextOf(kind, spec, observations);
          const hits = scene.damage.filter(lost => lost > 0);
          expect(observations).toHaveLength(hits.length);
          const contains = (obs: ReadObservation, damage: number) => {
            const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', spec.attacker.species), spreadFor(ctx, 'p2', spec.target));
            expect(range).not.toBeNull();
            return Math.round(range!.min * scene.maxHp) <= damage && damage <= Math.round(range!.max * scene.maxHp);
          };
          observations.forEach((obs, index) => {
            expect(contains(obs, hits[index])).toBe(true);
          });
          // The scenes whose line names the offense stat lose the 1.3 without the reading.
          if (spec === ATTACK_BOOSTED || spec === QUARK_DRIVE) {
            const bare = { ...observations[0], attackerParadox: undefined };
            expect(contains(bare, hits[0])).toBe(false);
          }
        }
      }
    });
  });
}

describe('the solve repairs a prior the line contradicts', () => {
  for (const kind of KINDS) {
    for (const [title, spec, priorSet] of [
      ['Speed named after a Swords Dance', SWORDS_AFTER_ACTIVATION, { nature: 'Adamant', evs: sp({ atk: 252, spe: 4 }) }],
      ['Speed named after an Intimidate', INTIMIDATE_BEFORE_ACTIVATION, { nature: 'Adamant', evs: sp({ atk: 252 }) }],
    ] as [string, SceneSpec, Partial<PokemonSet>][]) {
      test(`${kind}: ${title}`, () => {
        for (const scene of scenesOf(kind, spec, 3)) {
          const observations = observationsOf(scene);
          const prior: PokemonSet = { ...spec.attacker, ...priorSet };
          const ctx = contextOf(kind, spec, observations, prior);
          const key = keyOf('p1', 'Roaring Moon');
          expect(paradoxError(ctx, key, spreadFor(ctx, 'p1', 'Roaring Moon'))).toBeGreaterThan(0);
          const solved = inferSpreads(observations, { p1: [prior], p2: foes(spec) }, FORMAT[kind], []).get(key);
          expect(solved).toBeDefined();
          expect(paradoxError(ctx, key, solved!)).toBe(0);
          expect(boostedStatOf(statsOf(ctx, solved!), observations[0].attackerParadox!.stages)).toBe(observations[0].attackerParadox!.stat);
        }
      });
    }

    test(`${kind}: a prior the line agrees with stays a prior the line agrees with`, () => {
      for (const scene of scenesOf(kind, ATTACK_BOOSTED, 3)) {
        const observations = observationsOf(scene);
        const ctx = contextOf(kind, ATTACK_BOOSTED, observations);
        const key = keyOf('p1', 'Roaring Moon');
        const solved = inferSpreads(observations, { p1: [ATTACK_BOOSTED.attacker], p2: foes(ATTACK_BOOSTED) }, FORMAT[kind], []).get(key);
        expect(paradoxError(ctx, key, solved ?? spreadFor(ctx, 'p1', 'Roaring Moon'))).toBe(0);
      }
    });
  }
});
