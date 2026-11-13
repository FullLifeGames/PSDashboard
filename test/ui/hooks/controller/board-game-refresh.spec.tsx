import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { stubReplayFetch } from '../../fixtures/network';
import { realReplayWorkerClient } from '../../fixtures/worker';
import { playedRecord } from '../../fixtures/played-game';
import { SIX_FULL, picks } from '../../fixtures/new-game';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

const { useReplayContext } = await import('../../../../src/hooks/controller/replay-context');
const { useTransients } = await import('../../../../src/hooks/controller/transients');
const { useTimelineController } = await import('../../../../src/hooks/controller/board-controller');

function useBoardHarness() {
  const ctx = useReplayContext();
  const transients = useTransients(ctx.replay.replayData?.id);
  const board = useTimelineController(ctx, transients);
  return { ctx, transients, board };
}

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  stubReplayFetch([]);
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllGlobals(); });

/**
 * Round 89 (lane H, #105): the seed of a game reaches every path that builds a battle for it. A variation of a game from turn 0 starts
 * the game's own battle; the refresh after a team edit rebuilds it from turn 0 again and must start the same battle, so the dice of
 * the variation do not change under an edit that leaves the moves alone (the other callers: `useDeviation` and `useRestoreVariation`
 * pass the seed through `executeRebuild`; the game's main line rebuilds from its record, which holds the seed).
 */
const norm = (log: unknown) => JSON.stringify(log).replace(/\|t:\|\d+/g, '');

describe('a variation of a game from turn 0 after a team edit', () => {
  const cases = [
    { name: 'singles', format: 'gen9ou', leads: { p1: ['Gengar'], p2: ['Snorlax'] } },
    { name: 'doubles', format: 'gen9doublesou', leads: { p1: ['Gengar', 'Garchomp'], p2: ['Snorlax', 'Dragonite'] } },
  ];
  test.each(cases)('$name: the refresh starts the battle on the game\'s seed, so the dice of the played turn come out the same', async ({ format, leads }) => {
    const record = await playedRecord(2, format, SIX_FULL);
    expect(record.seed).not.toBe('1,2,3,4');
    const { result } = renderHook(() => useBoardHarness());
    await act(async () => { await result.current.ctx.newGame.openRecord(record); });
    await waitFor(() => expect(result.current.board.timeline.maxTurn).toBe(3));

    act(() => result.current.board.deviation.startLeadVariation(leads));
    await waitFor(() => expect(result.current.ctx.branch.branching).toBe(true), { timeout: 60_000 });
    await waitFor(() => expect(result.current.board.deviation.branchPreparing).toBe(false));
    expect(result.current.ctx.branch.variationStartTurn).toBe(0);

    const state = result.current.ctx.branch.simState!;
    await act(async () => {
      for (const side of ['p1', 'p2'] as const) picks(state, side).forEach((choice, slot) => { if (choice) result.current.ctx.branch.setChoice(side, choice, slot); });
    });
    await act(async () => { await result.current.ctx.branch.executeTurn(); });
    await waitFor(() => expect(result.current.ctx.branch.executing).toBe(false));
    expect(result.current.ctx.branch.history).toHaveLength(2);
    const before = result.current.ctx.branch.getBattle()!.prng.getSeed();
    const logBefore = norm(result.current.ctx.branch.getLog());

    // A team edit that changes nothing in the sets (the team knowledge as it stands): the refresh replays the lead entry and the turn, so the
    // dice are the same exactly when the rebuilt battle starts on the game's own seed. (A restore of the same history passes without the fix.)
    const { effectiveP1Info, effectiveP2Info } = result.current.ctx.knowledge;
    act(() => result.current.ctx.refreshQueue.handleTeamsEdited({ p1: effectiveP1Info!, p2: effectiveP2Info! }));
    await waitFor(() => expect(result.current.ctx.refreshQueue.pendingBranchRefresh).toBeNull(), { timeout: 60_000 });
    await waitFor(() => expect(result.current.ctx.branch.executing).toBe(false));
    expect(result.current.ctx.branch.history).toHaveLength(2);
    expect(norm(result.current.ctx.branch.getLog())).toBe(logBefore);
    expect(result.current.ctx.branch.getBattle()!.prng.getSeed()).toEqual(before);
  }, 180_000);
});
