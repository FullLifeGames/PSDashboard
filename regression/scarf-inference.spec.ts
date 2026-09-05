import { test, expect, describe } from 'vitest';
import { buildTeamsFromReplay, solveReplaySpreads } from '../packages/replay-core/src/team-builder';
import { inferOpponentTeam } from '../packages/replay-core/src/opponent-inferrer';
import { parseReplayLogWithObservations } from '../packages/replay-core/src/protocol-parser';
import { applyInferredSpreads, INFERRED_ITEM_DETAIL, RULED_OUT_ITEM_DETAIL } from '../packages/replay-core/src/team-info';
import type { SmogonUsageStats } from '../packages/replay-core/src/smogon/stats-types';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '../packages/replay-core/src/types';
import { sourceLabel } from '../src/lib/provenance-labels';
import { buildSensitivityTargets } from '../src/lib/team-knowledge';

/**
 * Round 37: the Choice Scarf the solver infers from a move order (or drops
 * from a guessed set) reaches the built set AND the stats panel overlay
 * with the same value, so the sim and the panel never disagree on an item.
 */
describe('Choice Scarf inference reaches the build and the panel', () => {
  const log = (extra: string[] = []) => [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|8', '|tier|[Gen 8] OU',
    '|poke|p1|Magnezone|', '|poke|p1|Garchomp, M|', '|poke|p2|Corviknight, M|',
    '|start', '|switch|p1a: Magnezone|Magnezone|100/100', '|switch|p2a: Corviknight|Corviknight, M|100/100', '|turn|1',
    ...extra,
  ].join('\n');
  const scarfIn = new Map([
    ['p1:magnezone', { evs: { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 }, nature: 'Timid', item: 'Choice Scarf', itemReason: 'moved-first' as const }],
  ]);
  const scarfOut = new Map([
    ['p1:garchomp', { evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, nature: 'Jolly', item: 'Leftovers', itemReason: 'moved-second' as const }],
  ]);
  const item = (species: string, info: OpponentTeamInfo) => info.pokemon.find(mon => mon.species === species)!.item;

  test('an inferred Choice Scarf reaches the built set and the panel overlay as "inferred"', () => {
    const { p1Team } = buildTeamsFromReplay(log(), { inferredSpreads: scarfIn });
    expect(p1Team.find(set => set.species === 'Magnezone')?.item).toBe('Choice Scarf');
    const magnezone = item('Magnezone', applyInferredSpreads(inferOpponentTeam(log(), 'p1'), 'p1', scarfIn));
    expect(magnezone.value).toBe('Choice Scarf');
    expect(magnezone.sourceDetail).toBe(INFERRED_ITEM_DETAIL);
    expect(sourceLabel(magnezone.source, magnezone.probability, magnezone.sourceDetail)).toBe('inferred');
  });

  test('a revealed item beats an inferred one in the set and the overlay', () => {
    const revealed = log(['|-enditem|p1a: Magnezone|Air Balloon', '|turn|2']);
    const { p1Team } = buildTeamsFromReplay(revealed, { inferredSpreads: scarfIn });
    expect(p1Team.find(set => set.species === 'Magnezone')?.item).toBe('Air Balloon');
    const magnezone = item('Magnezone', applyInferredSpreads(inferOpponentTeam(revealed, 'p1'), 'p1', scarfIn));
    expect(magnezone.source).toBe('revealed');
    expect(magnezone.sourceDetail).not.toBe(INFERRED_ITEM_DETAIL);
  });

  test('a dropped Scarf is replaced by the same item in set and overlay', () => {
    const { p1Team } = buildTeamsFromReplay(log(), { inferredSpreads: scarfOut });
    expect(p1Team.find(set => set.species === 'Garchomp')?.item).toBe('Leftovers');
    const garchomp = item('Garchomp', applyInferredSpreads(inferOpponentTeam(log(), 'p1'), 'p1', scarfOut));
    expect(garchomp.value).toBe('Leftovers');
    expect(garchomp.sourceDetail).toBe(RULED_OUT_ITEM_DETAIL);
    expect(sourceLabel(garchomp.source, garchomp.probability, garchomp.sourceDetail)).toBe('guessed');
  });

  test('an unresolved drop never lets the usage Scarf back into the set', () => {
    // The solver's raw '' (no builder pass resolved it): the set gets the next usage item, never the Scarf.
    const usage: SmogonUsageStats = {
      format: 'gen8ou', month: '2026-08', source: 'test',
      pokemon: {
        garchomp: {
          species: 'Garchomp', rawCount: 100, abilities: [], moves: [], spreads: [],
          items: [
            { value: 'Choice Scarf', probability: 0.5, sourceDetail: 'test' },
            { value: 'Rocky Helmet', probability: 0.3, sourceDetail: 'test' },
          ],
        },
      },
    };
    const raw = new Map([['p1:garchomp', { ...scarfOut.get('p1:garchomp')!, item: '' }]]);
    const { p1Team } = buildTeamsFromReplay(log(), { inferredSpreads: raw, usageStats: usage });
    expect(p1Team.find(set => set.species === 'Garchomp')?.item).toBe('Rocky Helmet');
  });

  test('the app path carries a Scarf decision the full solve forfeited on misfit damage', () => {
    // 750540: Darkrai moved before Deoxys-Speed (impossible without a Scarf), and its damage lines contradict each
    // other, so the full solve forfeits Darkrai back to the prior. The speed-only pre-solve decided the Scarf; the
    // app's solved map must still say so, or the app builds Life Orb while the harness builds the Scarf.
    const raceLog = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU',
      '|poke|p1|Deoxys-Speed|', '|poke|p2|Darkrai|',
      '|start', '|switch|p1a: Deoxys|Deoxys-Speed|100/100', '|switch|p2a: Darkrai|Darkrai|100/100', '|turn|1',
      '|move|p2a: Darkrai|Dark Pulse|p1a: Deoxys', '|-damage|p1a: Deoxys|0 fnt', '|faint|p1a: Deoxys', '|turn|2',
    ].join('\n');
    const { speedOrders } = parseReplayLogWithObservations(raceLog);
    expect(speedOrders).toHaveLength(1);
    const contradictory = ['0.10', '0.60'].map(fraction => ({
      attackerSpecies: 'Darkrai', defenderSpecies: 'Deoxys-Speed', attackerSide: 'p2' as const, moveId: 'darkpulse',
      observedFraction: Number(fraction), lethal: false, attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    }));
    const solved = solveReplaySpreads(raceLog, contradictory, { speedOrders });
    expect(solved.get('p2:darkrai')?.item).toBe('Choice Scarf');
    const { p2Team } = buildTeamsFromReplay(raceLog, { inferredSpreads: solved });
    expect(p2Team.find(set => set.species === 'Darkrai')?.item).toBe('Choice Scarf');
  });

  test('sensitivity probes skip an inferred Scarf and keep a dropped one out of the alternatives', () => {
    const usage: SmogonUsageStats = {
      format: 'gen8ou', month: '2026-08', source: 'test',
      pokemon: {
        magnezone: {
          species: 'Magnezone', rawCount: 100, abilities: [], moves: [], spreads: [],
          items: [
            { value: 'Choice Specs', probability: 0.5, sourceDetail: 'test' },
            { value: 'Leftovers', probability: 0.3, sourceDetail: 'test' },
            { value: 'Choice Scarf', probability: 0.1, sourceDetail: 'test' },
          ],
        },
        garchomp: {
          species: 'Garchomp', rawCount: 100, abilities: [], moves: [], spreads: [],
          items: [
            { value: 'Choice Scarf', probability: 0.5, sourceDetail: 'test' },
            { value: 'Leftovers', probability: 0.3, sourceDetail: 'test' },
            { value: 'Rocky Helmet', probability: 0.1, sourceDetail: 'test' },
          ],
        },
      },
    };
    const mon = (species: string, value: string, sourceDetail: string): RevealedPokemonInfo => ({
      species, moves: [], ability: { value: '', source: 'unknown' },
      item: { value, source: 'guessed', sourceDetail },
      teraType: { value: '', source: 'unknown' },
      evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' }, level: 100, gender: '',
    });
    const info: OpponentTeamInfo = { pokemon: [
      mon('Magnezone', 'Choice Scarf', INFERRED_ITEM_DETAIL),
      mon('Garchomp', 'Leftovers', RULED_OUT_ITEM_DETAIL),
    ] };
    expect(buildSensitivityTargets(info, usage)).toEqual([{ species: 'Garchomp', items: ['Rocky Helmet'] }]);
  });
});
