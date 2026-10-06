import { describe, expect, test } from 'vitest';
import { Generations, Pokemon } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay, solveReplaySpreads } from '../src/team-builder';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import type { SmogonUsageStats } from '../src/smogon/stats-types';
import type { DamageObservation } from '../src/types';

/**
 * Round 53 (T66): the two-stage solve hands the speed-only pre-solve to the
 * full solve as its prior. A mon the full solve forfeits on misfit damage
 * falls back to THAT prior, not to the usage guess underneath it
 * (gen9ou-2658663776: Gliscor moved before Volcanion four times, the
 * pre-solve took Volcanion's Speed EVs out, the forfeit put all 252 back).
 */
const gen = Generations.get(9);
const speedOf = (set: PokemonSet) =>
  new Pokemon(gen, set.species, { level: set.level, nature: set.nature, evs: set.evs, ivs: set.ivs }).stats.spe;
const find = (team: PokemonSet[], species: string) => team.find(set => set.species === species)!;

/** Two readings of one pairing no spread satisfies at once: the full solve forfeits both mons. */
const contradictory = (attackerSpecies: string, defenderSpecies: string, moveId: string): DamageObservation[] =>
  [0.10, 0.60].map(observedFraction => ({
    attackerSpecies, defenderSpecies, attackerSide: 'p1' as const, moveId, observedFraction, lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  }));

describe('the two-stage solve keeps the move orders its pre-solve repaired', () => {
  test('singles: a forfeited mon keeps the pre-solve\'s Speed', () => {
    // The species-shaped guess fields both at 252 Spe: Garchomp 303, Gliscor 289. The log says Gliscor moved first.
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU',
      '|poke|p1|Garchomp, M|', '|poke|p2|Gliscor, M|',
      '|start', '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p2a: Gliscor|Gliscor, M|100/100', '|turn|1',
      '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
      '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
    ].join('\n');
    const { speedOrders } = parseReplayLogWithObservations(log);
    expect(speedOrders).toHaveLength(1);

    const guess = buildTeamsFromReplay(log);
    expect(speedOf(find(guess.p2Team, 'Gliscor'))).toBeLessThan(speedOf(find(guess.p1Team, 'Garchomp')));

    const preSolved = buildTeamsFromReplay(log, { speedOrders });
    expect(speedOf(find(preSolved.p2Team, 'Gliscor'))).toBeGreaterThanOrEqual(speedOf(find(preSolved.p1Team, 'Garchomp')));

    const solved = solveReplaySpreads(log, contradictory('Garchomp', 'Gliscor', 'dragonclaw'), { speedOrders });
    const built = buildTeamsFromReplay(log, { inferredSpreads: solved });
    expect(speedOf(find(built.p2Team, 'Gliscor'))).toBeGreaterThanOrEqual(speedOf(find(built.p1Team, 'Garchomp')));
    // Forfeited to the pre-solve, not past it: the app's build is the pre-solve's build.
    expect(built).toEqual(preSolved);
  });

  test('doubles: a forfeited mon keeps the pre-solve\'s Speed', () => {
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|gametype|doubles', '|tier|[Gen 9] Doubles OU',
      '|poke|p1|Garchomp, M|', '|poke|p1|Amoonguss, M|', '|poke|p2|Gliscor, M|', '|poke|p2|Dondozo, M|',
      '|start',
      '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p1b: Amoonguss|Amoonguss, M|100/100',
      '|switch|p2a: Gliscor|Gliscor, M|100/100', '|switch|p2b: Dondozo|Dondozo, M|100/100', '|turn|1',
      '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
      '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
    ].join('\n');
    const { speedOrders } = parseReplayLogWithObservations(log);
    expect(speedOrders).toHaveLength(1);

    const preSolved = buildTeamsFromReplay(log, { speedOrders });
    const solved = solveReplaySpreads(log, contradictory('Garchomp', 'Gliscor', 'dragonclaw'), { speedOrders });
    const built = buildTeamsFromReplay(log, { inferredSpreads: solved });
    expect(speedOf(find(built.p2Team, 'Gliscor'))).toBeGreaterThanOrEqual(speedOf(find(built.p1Team, 'Garchomp')));
    expect(built).toEqual(preSolved);
  });

  /** The scene of the carry tests: Gliscor moves before Garchomp, each hits the other once. */
  const scene = [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU',
    '|poke|p1|Garchomp, M|', '|poke|p2|Gliscor, M|',
    '|start', '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p2a: Gliscor|Gliscor, M|100/100', '|turn|1',
    '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
    '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
  ].join('\n');
  /** A usage spread that runs Garchomp at 0 Speed with half the EV budget open (252 Atk only). */
  const slowGarchomp: SmogonUsageStats = {
    format: 'gen9ou', month: 'test', source: 'test',
    pokemon: {
      Garchomp: {
        species: 'Garchomp', rawCount: 1, abilities: [], items: [], moves: [],
        spreads: [{
          value: 'Adamant:0/252/0/0/0/0', probability: 1, sourceDetail: 'test', nature: 'Adamant',
          evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 },
        }],
      },
    },
  };

  test('a mon the full solve keeps is still solved by the full solve', () => {
    // Clean damage lines do not forfeit: the carry must not overwrite the full solve's answer.
    // The usage guess already runs Garchomp (240) under Gliscor (289), so no order needs repair
    // (round 63); the pre-solve tops the open half of the budget up into HP, the full solve's
    // damage lines take it back.
    const log = scene;
    const { observations, speedOrders } = parseReplayLogWithObservations(log);
    const doubled = [...observations, ...observations];
    const usageStats = slowGarchomp;
    const solved = solveReplaySpreads(log, doubled, { speedOrders, usageStats });
    const oneStage = buildTeamsFromReplay(log, { observations: doubled, speedOrders, usageStats });
    const preSolved = buildTeamsFromReplay(log, { speedOrders, usageStats });
    const built = buildTeamsFromReplay(log, { inferredSpreads: solved, usageStats });
    expect(speedOf(find(built.p2Team, 'Gliscor'))).toBeGreaterThanOrEqual(speedOf(find(built.p1Team, 'Garchomp')));
    expect(speedOf(find(oneStage.p2Team, 'Gliscor'))).toBeGreaterThanOrEqual(speedOf(find(oneStage.p1Team, 'Garchomp')));
    // Garchomp is the mon an overwriting carry would destroy: the full solve
    // fits its damage with less HP than the pre-solve topped the freed Speed
    // up into (round 64: only the HP the damage lines allow, not 0).
    expect(built).toEqual(oneStage);
    expect(built).not.toEqual(preSolved);
    expect(find(built.p1Team, 'Garchomp').evs.hp).toBeLessThan(find(preSolved.p1Team, 'Garchomp').evs.hp);
    expect(find(preSolved.p1Team, 'Garchomp').evs.hp).toBe(252);
  });

  test('the two chains agree on the settled Garchomp (round 63 path pin, T122): HP 60 both ways', () => {
    // The species-shaped guesses run Garchomp (303) over Gliscor (289), which moved first. The
    // settling (T117) frees only 60 Speed EVs (Garchomp 288); the pre-solve tops them up into HP, and
    // the full solve keeps that HP because the damage lines fit it as well as none. Round 63 pinned
    // the one-stage build at HP 0 (it left the 60 EVs open); since round 64 the full solve tops its
    // open budget up wherever the damage lines still fit, so both chains land on HP 60.
    const { observations, speedOrders } = parseReplayLogWithObservations(scene);
    const doubled = [...observations, ...observations];
    const built = buildTeamsFromReplay(scene, { inferredSpreads: solveReplaySpreads(scene, doubled, { speedOrders }) });
    const oneStage = buildTeamsFromReplay(scene, { observations: doubled, speedOrders });
    expect([find(built.p1Team, 'Garchomp').evs.hp, find(built.p1Team, 'Garchomp').evs.spe]).toEqual([60, 192]);
    expect([find(oneStage.p1Team, 'Garchomp').evs.hp, find(oneStage.p1Team, 'Garchomp').evs.spe]).toEqual([60, 192]);
    expect(speedOf(find(built.p2Team, 'Gliscor'))).toBeGreaterThan(speedOf(find(built.p1Team, 'Garchomp')));
  });
});
