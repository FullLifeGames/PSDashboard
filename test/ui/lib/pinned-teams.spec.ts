import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PokemonSet } from '@pkmn/sim';
import { buildReplayTeams, type TeamBuildSources } from '../../../src/lib/eval-acquire';
import { usePinnedTeams } from '../../../src/hooks/usePinnedTeams';
import { replayFixture } from '../fixtures/replay';

const kyurem = { name: 'PBA S 2 3 & 5', species: 'Kyurem', moves: ['Ice Beam', 'Freeze-Dry'], ability: 'Pressure', item: '', nature: 'Timid', evs: {}, ivs: {} } as unknown as PokemonSet;
const cobalion = { name: 'Steel Shadow', species: 'Cobalion', moves: ['Close Combat'], ability: 'Justified', item: '', nature: 'Jolly', evs: {}, ivs: {} } as unknown as PokemonSet;

describe('pinned teams (round 77, user gate 28.10.2026: a reproduction plays with the reported sets)', () => {
  const { replayData } = replayFixture('singles');
  const sources = (pinnedTeams: TeamBuildSources['pinnedTeams']): TeamBuildSources => ({
    teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null },
    hpEvidence: [], getInferredSpreads: async () => { throw new Error('a pinned build never solves spreads'); }, pinnedTeams,
  } as unknown as TeamBuildSources);

  test('the one team build returns copies of the pinned teams; an edit override builds as before', async () => {
    const pinned = { p1Team: [kyurem], p2Team: [cobalion] };
    const built = await buildReplayTeams(replayData, sources(pinned));
    expect(built).toEqual(pinned);
    built.p1Team[0].moves.push('Earth Power');
    expect(pinned.p1Team[0].moves).toEqual(['Ice Beam', 'Freeze-Dry']);
    await expect(buildReplayTeams(replayData, sources(pinned), { p1: null, p2: null })).rejects.toThrow('never solves spreads');
  });

  test('a pin carries a fingerprint marker and belongs to its replay', () => {
    const { result, rerender } = renderHook((id: string | null) => usePinnedTeams(id), { initialProps: 'replay-a' });
    expect(result.current.teams).toBeNull();
    expect(result.current.marker).toBeNull();
    act(() => result.current.setTeams({ p1Team: [kyurem], p2Team: [cobalion] }));
    expect(result.current.teams?.p1Team[0].species).toBe('Kyurem');
    expect(result.current.marker).toMatch(/^[0-9a-f]{8}$/);
    const marker = result.current.marker;
    act(() => result.current.setTeams({ p1Team: [cobalion], p2Team: [kyurem] }));
    expect(result.current.marker).not.toBe(marker);
    rerender('replay-b');
    expect(result.current.teams).toBeNull();
    expect(result.current.marker).toBeNull();
  });
});
