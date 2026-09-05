import { describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import { useBranchRefresh, type BranchRefreshRequest } from '../../src/hooks/useBranchRefresh';
import type { BranchSession } from '../../src/hooks/useDeviation';
import type { TeamBuildSources } from '../../src/lib/eval-acquire';
import { replayFixture } from '../fixtures/replay';
import { teamInfo } from '../fixtures/team-info';

type Args = Parameters<typeof useBranchRefresh>[0];

const { replayData, snapshots, observations } = replayFixture('singles');

const sources = {
  teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null },
  hpEvidence: [], getInferredSpreads: async () => undefined,
} as unknown as TeamBuildSources;

/** A branch session whose handles are spies; `isPreparing` mirrors begin/end. */
function fakeSession(): BranchSession {
  let preparing = false;
  return {
    begin: vi.fn(() => { preparing = true; return new AbortController(); }),
    end: vi.fn(() => { preparing = false; }),
    reportProgress: vi.fn(),
    bumpSession: vi.fn(),
    cancelPreparation: vi.fn(),
    isPreparing: () => preparing,
    branchAbortRef: { current: null },
  };
}

function args(overrides: Partial<Args> = {}): Args {
  return {
    replayData, snapshots, observations, sources, bringOnlyLists: null, branching: false, variationStartTurn: null,
    startBranch: vi.fn(async () => {}), acquireRuntime: vi.fn(), viewTurn: 3, session: fakeSession(),
    branchWindowOpenRef: { current: false }, request: null, clearRequest: vi.fn(),
    ...overrides,
  };
}

const request = (): BranchRefreshRequest => ({
  p1Info: teamInfo('singles', 'p1'), p2Info: teamInfo('singles', 'p2'),
  history: [], p1Choices: [{ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }], p2Choices: [],
});

describe('useBranchRefresh', () => {
  test('without a request nothing rebuilds', () => {
    const wired = args();
    renderHook(() => useBranchRefresh(wired));
    expect(wired.startBranch).not.toHaveBeenCalled();
    expect(wired.session.begin).not.toHaveBeenCalled();
  });

  test('a request rebuilds the branch with the edited teams at the viewed turn and hands the pending choices on', async () => {
    const wired = args({ request: request() });
    renderHook(() => useBranchRefresh(wired));
    await waitFor(() => expect(wired.startBranch).toHaveBeenCalledTimes(1), { timeout: 30_000 });

    const [format, p1Team, p2Team, log, turn, snapshot, options] = (wired.startBranch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(format).toBe(getBranchSimulatorFormat(replayData));
    expect(p1Team.length).toBeGreaterThan(0);
    expect(p2Team.length).toBeGreaterThan(0);
    expect(log).toBe(replayData.log);
    expect(turn).toBe(3);
    expect(snapshot).toBe(snapshots[2]);
    expect(options).toMatchObject({
      replayHistory: [], p1Choices: request().p1Choices, p2Choices: [], playerNames: [replayData.players[0], replayData.players[1]],
      acquireRuntime: wired.acquireRuntime, bringOnly: undefined,
    });
    expect(options.choiceLocks).toBeDefined();
    expect(options.abort).toBeInstanceOf(AbortSignal);

    expect(wired.session.begin).toHaveBeenCalledTimes(1);
    expect(wired.session.bumpSession).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(wired.session.end).toHaveBeenCalledTimes(1));
    expect(wired.clearRequest).toHaveBeenCalledTimes(1);
    expect(wired.branchWindowOpenRef.current).toBe(true);
  }, 60_000);

  test('a standing variation refreshes at its own start turn and keeps the bring trim', async () => {
    const history = [{ turnNumber: 2, p1Choice: 'move earthquake', p2Choice: 'move leechseed', p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [] }];
    const wired = args({ request: { ...request(), history }, branching: true, variationStartTurn: 2, viewTurn: 4, bringOnlyLists: { p1: ['Garchomp'], p2: ['Great Tusk'] } });
    renderHook(() => useBranchRefresh(wired));
    await waitFor(() => expect(wired.startBranch).toHaveBeenCalledTimes(1), { timeout: 30_000 });
    const [, , , , turn, , options] = (wired.startBranch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(turn).toBe(2);
    expect(options.replayHistory).toBe(history);
    expect(options.bringOnly).toEqual({ p1: ['Garchomp'], p2: ['Great Tusk'] });
  }, 60_000);

  test('a request that arrives while the inputs change is cancelled before it lands', async () => {
    const wired = args({ request: request() });
    const { rerender } = renderHook((props: Args) => useBranchRefresh(props), { initialProps: wired });
    rerender({ ...wired, request: null });
    await new Promise(resolve => setTimeout(resolve, 50));
    // The cancelled run neither ends the session nor clears a request it no longer owns.
    expect(wired.session.end).not.toHaveBeenCalled();
    expect(wired.clearRequest).not.toHaveBeenCalled();
  });
});
