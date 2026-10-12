import { describe, expect, test } from 'vitest';
import { buildTeamsFromReplay, solveReplaySpreads } from '../src/team-builder';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import type { DamageObservation } from '../src/types';

/**
 * Round 69 (B13, D8): the one-stage chain (raw observations and orders in
 * one buildTeamsFromReplay call, the fit corpus's and the retired bank
 * build) and the app's two-stage chain (solveReplaySpreads, then the build)
 * must agree set for set. A mon whose damage lines misfit its prior
 * (forfeit) falls back to the speed-only pre-solve in the app chain; the
 * one-stage chain used to fall back to the usage guess underneath it and
 * broke the move orders the pre-solve held (912045 Rillaboom).
 */

/** Two readings of one pairing no spread satisfies at once: the full solve forfeits both mons. */
const contradictory = (attackerSpecies: string, defenderSpecies: string, moveId: string): DamageObservation[] =>
  [0.10, 0.60].map(observedFraction => ({
    attackerSpecies, defenderSpecies, attackerSide: 'p1' as const, moveId, observedFraction, lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  }));

const singlesLog = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU',
  '|poke|p1|Garchomp, M|', '|poke|p2|Gliscor, M|',
  '|start', '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p2a: Gliscor|Gliscor, M|100/100', '|turn|1',
  '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
  '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
].join('\n');

const doublesLog = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|gametype|doubles', '|tier|[Gen 9] Doubles OU',
  '|poke|p1|Garchomp, M|', '|poke|p1|Amoonguss, M|', '|poke|p2|Gliscor, M|', '|poke|p2|Dondozo, M|',
  '|start',
  '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p1b: Amoonguss|Amoonguss, M|100/100',
  '|switch|p2a: Gliscor|Gliscor, M|100/100', '|switch|p2b: Dondozo|Dondozo, M|100/100', '|turn|1',
  '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
  '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
].join('\n');

describe('the one-stage chain carries the pre-solve at a forfeit', () => {
  test.each([['singles', singlesLog], ['doubles', doublesLog]])('%s: raw observations build what the app chain builds', (_, log) => {
    const { speedOrders } = parseReplayLogWithObservations(log);
    expect(speedOrders).toHaveLength(1);
    const observations = contradictory('Garchomp', 'Gliscor', 'dragonclaw');

    const app = buildTeamsFromReplay(log, { inferredSpreads: solveReplaySpreads(log, observations, { speedOrders }) });
    const oneStage = buildTeamsFromReplay(log, { observations, speedOrders });
    expect(oneStage).toEqual(app);
    // The pre-solve is the fallback of both chains.
    expect(oneStage).toEqual(buildTeamsFromReplay(log, { speedOrders }));
  });
});
