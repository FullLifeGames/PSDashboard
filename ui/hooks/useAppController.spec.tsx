import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { singlesReplay } from '../fixtures/replay';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

const { useAppController } = await import('../../src/hooks/useAppController');

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  stubReplayFetch([singlesReplay()]);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAppController', () => {
  test('composes the four layers and the analysis surface around no replay', () => {
    const { result } = renderHook(() => useAppController());
    const app = result.current;
    expect(app.ctx.replay.replayData).toBeNull();
    expect(app.transients.playOut).toBeNull();
    expect(app.board.timeline.viewTurn).toBe(1);
    expect(app.engine.evalView.evalAvailable).toBe(false);
    expect(app.analysis).toMatchObject({ showBranch: false, simLog: '', latestBranchHistoryEntry: null, branchReloadKey: '0:0', gameReport: null, turnAnalysis: null });
  });

  test('a hypothetical move edits the team and queues a refresh that rebuilds the branch with the move seeded', async () => {
    const replay = singlesReplay();
    const { result } = renderHook(() => useAppController());
    await act(async () => { await result.current.ctx.replay.loadReplay(replay.id); });
    await waitFor(() => expect(result.current.engine.smogonPending).toBe(false));
    act(() => result.current.board.timeline.navigateTo({ turn: 2, line: 'main' }));

    const lead = result.current.ctx.knowledge.effectiveP1Info!.pokemon[0];
    act(() => result.current.handleHypotheticalMove('p1', 0, { species: lead.species, move: 'Protect', replace: null }));
    const edited = result.current.ctx.knowledge.editedP1Info!;
    expect(edited.pokemon[0].moves.map(move => move.name)).toContain('Protect');
    expect(edited.pokemon[0].moves.find(move => move.name === 'Protect')?.source).toBe('manual');

    await waitFor(() => expect(result.current.ctx.branch.branching).toBe(true), { timeout: 60_000 });
    await waitFor(() => expect(result.current.ctx.refreshQueue.pendingBranchRefresh).toBeNull());
    expect(result.current.ctx.branch.variationStartTurn).toBe(2);
    expect(result.current.ctx.branch.simState?.p1Choices[0]).toEqual({ kind: 'move', moveId: 'protect', moveName: 'Protect' });
    expect(result.current.ctx.branch.simState?.p1MovesBySlot[0].map(move => move.name)).toContain('Protect');
    expect(result.current.analysis.showBranch).toBe(true);
    expect(result.current.analysis.simLog).toContain('|turn|');
    expect(result.current.analysis.branchReloadKey).toMatch(/^\d+:2$/);
  }, 90_000);

  test('the branch log the frame receives carries no chat or debug lines', async () => {
    const replay = singlesReplay();
    const { result } = renderHook(() => useAppController());
    await act(async () => { await result.current.ctx.replay.loadReplay(replay.id); });
    await waitFor(() => expect(result.current.engine.smogonPending).toBe(false));
    act(() => result.current.board.timeline.navigateTo({ turn: 2, line: 'main' }));
    act(() => result.current.board.deviation.requestDeviation(null));
    await waitFor(() => expect(result.current.analysis.showBranch).toBe(true), { timeout: 60_000 });
    const lines = result.current.analysis.simLog.split('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some(line => line.startsWith('|c|') || line.startsWith('|debug|') || line.startsWith('|split|'))).toBe(false);

    await act(async () => { await result.current.handleExecuteTurn(); });
    expect(result.current.ctx.branch.history).toHaveLength(0);
  }, 90_000);
});
