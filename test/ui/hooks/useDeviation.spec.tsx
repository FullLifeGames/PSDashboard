import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import { useDeviation, type DeviationInputs } from '../../../src/hooks/useDeviation';
import type { BranchHistoryEntry } from '../../../src/hooks/useBranch';
import type { TeamBuildSources } from '../../../src/lib/eval-acquire';
import { replayFixture } from '../fixtures/replay';

const { replayData, snapshots, observations } = replayFixture('singles');

const sources = {
  teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null },
  hpEvidence: [], getInferredSpreads: async () => undefined,
} as unknown as TeamBuildSources;

const entry = (turnNumber: number, kind?: 'turn' | 'forced'): BranchHistoryEntry => ({
  turnNumber, p1Choice: 'move earthquake', p2Choice: 'move leechseed', p1Active: null, p1ActiveSlots: [], p2Active: null,
  p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [], ...(kind ? { kind } : {}),
});

type Timeline = DeviationInputs['timeline'];
type BranchSurface = DeviationInputs['branch'];

function timelineAt(turn: number, overrides: Partial<Timeline> = {}): Timeline {
  return {
    viewTurnRef: { current: turn }, viewTurn: turn, viewLine: 'main', endSnapshotTurn: null, variationSpan: null,
    setVariationScores: vi.fn(), setViewTurn: vi.fn(), setViewLine: vi.fn(), liveTip: false, restorePointer: vi.fn(),
    followNextTip: vi.fn(), ...overrides,
  };
}

function branchSurface(overrides: Partial<BranchSurface> = {}): BranchSurface {
  return {
    startBranch: vi.fn(async () => {}), getBattle: vi.fn(() => null), executeTurn: vi.fn(async () => null), setChoice: vi.fn(),
    history: [], stopBranch: vi.fn(), ...overrides,
  };
}

function inputs(overrides: Partial<DeviationInputs> = {}): DeviationInputs {
  return {
    replayData, snapshots, observations, sources, bringOnlyLists: null, bringCount: null, replayGameType: 'singles',
    timeline: timelineAt(3), branch: branchSurface(), acquireRuntime: vi.fn(), branchWindowOpenRef: { current: false },
    setPendingConfirm: vi.fn(), draftChoices: { p1: [], p2: [] }, setDraftChoices: vi.fn(),
    ...overrides,
  };
}

const startCalls = (wired: DeviationInputs) => (wired.branch.startBranch as ReturnType<typeof vi.fn>).mock.calls;

describe('useDeviation', () => {
  test('a first deviation on the main line opens a variation at the viewed turn and lands the pointer there', async () => {
    const wired = inputs();
    const { result } = renderHook(() => useDeviation(wired));
    expect(result.current.branchPreparing).toBe(false);

    act(() => result.current.requestDeviation(null));
    expect(wired.timeline.setVariationScores).toHaveBeenCalledWith([]);
    expect(wired.timeline.followNextTip).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.branchPreparing).toBe(true));
    await waitFor(() => expect(startCalls(wired)).toHaveLength(1), { timeout: 30_000 });

    const [format, p1Team, p2Team, log, turn, snapshot, options] = startCalls(wired)[0];
    expect(format).toBe(getBranchSimulatorFormat(replayData));
    expect(p1Team.length).toBeGreaterThan(0);
    expect(p2Team.length).toBeGreaterThan(0);
    expect(log).toBe(replayData.log);
    expect(turn).toBe(3);
    expect(snapshot).toBe(snapshots[2]);
    expect(options).toMatchObject({ replayHistory: [], p1Choices: [], p2Choices: [], acquireRuntime: wired.acquireRuntime });

    await waitFor(() => expect(result.current.branchPreparing).toBe(false));
    expect(wired.branchWindowOpenRef.current).toBe(true);
    expect(wired.timeline.setViewTurn).toHaveBeenCalledWith(3);
    expect(wired.timeline.setViewLine).toHaveBeenCalledWith('main');
    expect(result.current.branchDivergence).toBeNull();
    expect(wired.branch.executeTurn).not.toHaveBeenCalled();
  }, 60_000);

  test('a deviation with prefilled choices executes them once the rebuild landed', async () => {
    const wired = inputs();
    const { result } = renderHook(() => useDeviation(wired));
    const prefill = { p1Choices: [{ kind: 'move' as const, moveId: 'earthquake', moveName: 'Earthquake' }], p2Choices: [] };
    act(() => result.current.requestDeviation(prefill));
    await waitFor(() => expect(wired.branch.executeTurn).toHaveBeenCalledTimes(1), { timeout: 30_000 });
    expect(startCalls(wired)[0][6]).toMatchObject({ p1Choices: prefill.p1Choices });
  }, 60_000);

  // Round 77 (swarm A-2): the executor refuses the picked turn after the rebuild replaced the variation.
  describe('a refused execute after the rebuild', () => {
    const prefill = { p1Choices: [{ kind: 'move' as const, moveId: 'toxicspikes', moveName: 'Toxic Spikes' }], p2Choices: [] };

    test('next to a standing variation it restores that variation and the pointer, and says why', async () => {
      const history = [entry(2), entry(3)];
      const wired = inputs({
        timeline: timelineAt(3, { variationSpan: { startTurn: 2, length: 2 } }),
        branch: branchSurface({ history, executeTurn: vi.fn(async () => 'Toxic Spikes is disabled for Toxapex right now.') }),
      });
      const { result } = renderHook(() => useDeviation(wired));
      act(() => result.current.requestDeviation(prefill));
      const confirm = (wired.setPendingConfirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as { proceed: () => void };
      act(() => confirm.proceed());
      await waitFor(() => expect(startCalls(wired)).toHaveLength(2), { timeout: 30_000 });

      // The first start replaced the variation at the viewed turn; the second brings the old one back whole.
      expect(startCalls(wired)[0][4]).toBe(3);
      expect(startCalls(wired)[0][6].replayHistory).toEqual([]);
      expect(startCalls(wired)[1][4]).toBe(2);
      expect(startCalls(wired)[1][6].replayHistory).toEqual(history);
      await waitFor(() => expect(result.current.variationNotice).toBe('Toxic Spikes is disabled for Toxapex right now.'));
      expect(wired.timeline.restorePointer).toHaveBeenCalledWith({ turn: 3, line: 'main' }, { startTurn: 2, length: 2 });
      expect(wired.branch.stopBranch).not.toHaveBeenCalled();
      expect(wired.timeline.setVariationScores).not.toHaveBeenCalled();
    }, 60_000);

    test('without a variation it ends the empty one the rebuild opened', async () => {
      const wired = inputs({
        branch: branchSurface({ executeTurn: vi.fn(async () => 'Swampert no longer knows Earthquake.') }),
      });
      const { result } = renderHook(() => useDeviation(wired));
      act(() => result.current.requestDeviation(prefill));
      await waitFor(() => expect(result.current.variationNotice).toBe('Swampert no longer knows Earthquake.'), { timeout: 30_000 });
      expect(startCalls(wired)).toHaveLength(1);
      expect(wired.branch.stopBranch).toHaveBeenCalledTimes(1);
      expect(wired.branchWindowOpenRef.current).toBe(false);
      expect(wired.timeline.restorePointer).not.toHaveBeenCalled();
    }, 60_000);

    test('an executed turn keeps the new variation and drops the old overlay', async () => {
      const wired = inputs({ timeline: timelineAt(3, { variationSpan: { startTurn: 2, length: 2 } }), branch: branchSurface({ history: [entry(2), entry(3)] }) });
      const { result } = renderHook(() => useDeviation(wired));
      act(() => result.current.requestDeviation(prefill));
      act(() => ((wired.setPendingConfirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as { proceed: () => void }).proceed());
      await waitFor(() => expect(wired.timeline.setVariationScores).toHaveBeenCalledWith([]), { timeout: 30_000 });
      expect(startCalls(wired)).toHaveLength(1);
      expect(result.current.variationNotice).toBeNull();
      expect(wired.timeline.restorePointer).not.toHaveBeenCalled();
    }, 60_000);
  });

  // Round 77 (swarm D1): a rebuild that keeps no turn leaves no variation and no phantom message.
  test('a rebuild that keeps no turn ends the variation: the notice names it and the pointer stays on the main line', async () => {
    const notice = 'The variation from turn 2 (2 turns) ended: Swampert no longer knows Earthquake.';
    const history = [entry(2), entry(3)];
    const wired = inputs({
      timeline: timelineAt(4, { viewLine: 'variation', variationSpan: { startTurn: 2, length: 2 } }),
      branch: branchSurface({ history, startBranch: vi.fn(async () => ({ endedNotice: notice })) }),
    });
    const { result } = renderHook(() => useDeviation(wired));
    act(() => result.current.requestDeviation(null));
    await waitFor(() => expect(result.current.variationNotice).toBe(notice), { timeout: 30_000 });
    expect(wired.timeline.setViewLine).toHaveBeenCalledWith('main');
    expect(wired.timeline.setVariationScores).toHaveBeenCalledWith([]);
    expect(wired.branchWindowOpenRef.current).toBe(false);
    expect(wired.timeline.setViewTurn).not.toHaveBeenCalledWith(2);
    expect(result.current.branchDivergence).toBeNull();
  }, 60_000);

  test('the end position refuses with a notice instead of rebuilding', () => {
    const wired = inputs({ timeline: timelineAt(5, { endSnapshotTurn: 5 }) });
    const { result } = renderHook(() => useDeviation(wired));
    act(() => result.current.requestDeviation(null));
    expect(result.current.branchDivergence).toBe('The battle is already over at the end position: pick an earlier turn to play from.');
    expect(startCalls(wired)).toHaveLength(0);
  });

  test('a main-line deviation next to a standing variation asks first; proceeding replaces it', async () => {
    const wired = inputs({ timeline: timelineAt(3, { variationSpan: { startTurn: 2, length: 2 } }) });
    const { result } = renderHook(() => useDeviation(wired));
    act(() => result.current.requestDeviation(null));
    expect(startCalls(wired)).toHaveLength(0);
    const confirm = (wired.setPendingConfirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as { message: string; proceed: () => void };
    expect(confirm.message).toBe('You are on the main line (turn 3): replace the existing variation from turn 2 (2 turns)?');

    act(() => confirm.proceed());
    expect(wired.setPendingConfirm).toHaveBeenLastCalledWith(null);
    expect(wired.timeline.setVariationScores).toHaveBeenCalledWith([]);
    await waitFor(() => expect(startCalls(wired)).toHaveLength(1), { timeout: 30_000 });
    expect(startCalls(wired)[0][4]).toBe(3);
  }, 60_000);

  // Round 77 (C4): a caller that arms a run (the play-out) learns when the deviation really starts.
  test('onStart fires when the deviation runs: at once without a variation, after the yes next to one, never on cancel', async () => {
    const wired = inputs();
    const free = renderHook(() => useDeviation(wired));
    const onStart = vi.fn();
    act(() => free.result.current.requestDeviation(null, { onStart }));
    expect(onStart).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(startCalls(wired)).toHaveLength(1), { timeout: 30_000 });

    const standing = inputs({ timeline: timelineAt(3, { variationSpan: { startTurn: 2, length: 2 } }) });
    const asks = renderHook(() => useDeviation(standing));
    const armed = vi.fn();
    act(() => asks.result.current.requestDeviation(null, { onStart: armed }));
    expect(armed).not.toHaveBeenCalled();
    const confirm = (standing.setPendingConfirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as { proceed: () => void };
    // Cancel is the banner dropping the confirm: the proceed callback never runs.
    expect(armed).not.toHaveBeenCalled();
    act(() => confirm.proceed());
    expect(armed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(startCalls(standing)).toHaveLength(1), { timeout: 30_000 });
  }, 60_000);

  // Round 77 (C7): the notice of a finished run belongs to the line it ran on; a deviation ends it.
  test('onDeviate fires when a deviation or a lead variation really starts, and not while the replace confirm waits', async () => {
    const onDeviate = vi.fn();
    const standing = inputs({ timeline: timelineAt(3, { variationSpan: { startTurn: 2, length: 2 } }), onDeviate });
    const { result } = renderHook(() => useDeviation(standing));
    act(() => result.current.requestDeviation(null));
    expect(onDeviate).not.toHaveBeenCalled();
    const confirm = (standing.setPendingConfirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as { proceed: () => void };
    act(() => confirm.proceed());
    expect(onDeviate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(startCalls(standing)).toHaveLength(1), { timeout: 30_000 });

    const free = inputs({ onDeviate });
    const lead = renderHook(() => useDeviation(free));
    act(() => lead.result.current.startLeadVariation({ p1: ['Garchomp'], p2: ['Great Tusk'] }));
    expect(onDeviate).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(startCalls(free)).toHaveLength(1), { timeout: 30_000 });
  }, 60_000);

  test('onStart stays silent when the end position refuses the deviation', () => {
    const wired = inputs({ timeline: timelineAt(5, { endSnapshotTurn: 5 }) });
    const { result } = renderHook(() => useDeviation(wired));
    const onStart = vi.fn();
    act(() => result.current.requestDeviation(null, { onStart }));
    expect(onStart).not.toHaveBeenCalled();
  });

  test('inside the variation a move truncates the tail: the rebuild replays the kept entries from the branch start', async () => {
    const history = [entry(2), entry(2, 'forced'), entry(3), entry(4)];
    const wired = inputs({
      timeline: timelineAt(3, { viewLine: 'variation', variationSpan: { startTurn: 2, length: 3 } }),
      branch: branchSurface({ history }),
    });
    const { result } = renderHook(() => useDeviation(wired));
    act(() => result.current.requestDeviation(null));
    const scores = (wired.timeline.setVariationScores as ReturnType<typeof vi.fn>).mock.calls[0][0] as (previous: (number | null)[]) => (number | null)[];
    expect(scores([0.1, 0.2, 0.3, 0.4, 0.5])).toEqual([0.1, 0.2, 0.3, null, null]);
    await waitFor(() => expect(startCalls(wired)).toHaveLength(1), { timeout: 30_000 });
    const [, , , , turn, , options] = startCalls(wired)[0];
    expect(turn).toBe(2);
    // One executed turn kept, and the forced interlude that belongs to it.
    expect(options.replayHistory).toEqual([history[0], history[1]]);
    expect(wired.timeline.setViewTurn).not.toHaveBeenCalled();
  }, 60_000);

  test('at the tip a move extends: every entry is replayed', async () => {
    const history = [entry(2), entry(3)];
    const wired = inputs({
      timeline: timelineAt(4, { viewLine: 'variation', variationSpan: { startTurn: 2, length: 2 } }),
      branch: branchSurface({ history }),
    });
    const { result } = renderHook(() => useDeviation(wired));
    act(() => result.current.requestDeviation(null));
    await waitFor(() => expect(startCalls(wired)).toHaveLength(1), { timeout: 30_000 });
    expect(startCalls(wired)[0][6].replayHistory).toEqual(history);
  }, 60_000);

  test('choices off the live tip go to the draft; on the tip they reach the sim', () => {
    const wired = inputs({ draftChoices: { p1: [], p2: [null, { kind: 'move', moveId: 'spore', moveName: 'Spore' }] } });
    const { result } = renderHook(() => useDeviation(wired));
    const choice = { kind: 'switch' as const, speciesId: 'heatran', pokemonName: 'Heatran' };
    act(() => result.current.handleSetChoice('p1', choice, 1));
    expect(wired.setDraftChoices).toHaveBeenCalledWith({ p1: [undefined, choice], p2: [null, { kind: 'move', moveId: 'spore', moveName: 'Spore' }] });
    expect(wired.branch.setChoice).not.toHaveBeenCalled();

    const live = inputs({ timeline: timelineAt(3, { liveTip: true }) });
    const onTip = renderHook(() => useDeviation(live));
    act(() => onTip.result.current.handleSetChoice('p2', choice));
    expect(live.branch.setChoice).toHaveBeenCalledWith('p2', choice, undefined);
    expect(live.setDraftChoices).not.toHaveBeenCalled();
  });

  test('a lead variation starts from turn 0 with the picked leads; a standing variation asks first', async () => {
    const wired = inputs();
    const { result } = renderHook(() => useDeviation(wired));
    const onStart = vi.fn();
    act(() => result.current.startLeadVariation({ p1: ['Garchomp'], p2: ['Great Tusk'] }, { onStart }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(wired.timeline.setVariationScores).toHaveBeenCalledWith([]);
    // Round 80: the new game's tip is followed even when its span matches the one it replaces.
    expect(wired.timeline.followNextTip).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(startCalls(wired)).toHaveLength(1), { timeout: 30_000 });
    const [, , , , turn, , options] = startCalls(wired)[0];
    expect(turn).toBe(0);
    expect(options.leadOverride).toEqual({ p1: ['Garchomp'], p2: ['Great Tusk'] });
    expect(options.bringOnly).toBeUndefined();

    const standing = inputs({ timeline: timelineAt(1, { variationSpan: { startTurn: 2, length: 1 } }) });
    const asks = renderHook(() => useDeviation(standing));
    act(() => asks.result.current.startLeadVariation({ p1: ['Garchomp'], p2: ['Great Tusk'] }));
    const confirm = (standing.setPendingConfirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as { message: string };
    expect(confirm.message).toBe('Start a new game from turn 0: replace the existing variation from turn 2 (1 turn)?');
  }, 60_000);

  test('the default lead selection follows the real game and the bring count', () => {
    const singles = renderHook(() => useDeviation(inputs()));
    const picked = singles.result.current.defaultLeadSelection();
    expect(picked.p1).toHaveLength(1);
    expect(picked.p2).toHaveLength(1);
    expect(picked.bring).toBeUndefined();
    expect(singles.result.current.leadOptions.p1.some(option => option.wasLead)).toBe(true);

    const bringFour = renderHook(() => useDeviation(inputs({ bringCount: 4 })));
    const brought = bringFour.result.current.defaultLeadSelection();
    expect(brought.bring).toBe(true);
    expect(brought.p1.length).toBeLessThanOrEqual(4);
  });

  test('a diverged rebuild reports the notice from the sim', async () => {
    const wired = inputs({ branch: branchSurface({ getBattle: vi.fn(() => ({ ended: true, winner: 'Alice', turn: 3 }) as unknown as ReturnType<BranchSurface['getBattle']>) }) });
    const { result } = renderHook(() => useDeviation(wired));
    act(() => result.current.requestDeviation(null));
    await waitFor(() => expect(result.current.branchDivergence).toMatch(/already ended \(Alice won the simulated line\)/), { timeout: 30_000 });
  }, 60_000);
});
