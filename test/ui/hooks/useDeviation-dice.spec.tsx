import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { BranchSlotChoice, ForcedDie } from '@fulllifegames/eval-engine';
import { useBranch } from '../../../src/hooks/useBranch';
import { useDeviation, type DeviationInputs } from '../../../src/hooks/useDeviation';
import type { TeamBuildSources } from '../../../src/lib/eval-acquire';
import { replayFixture, type ReplayKind } from '../fixtures/replay';

/**
 * Round 82 (forced dice), step A7b: Execute from a viewed replay position. The draft there holds the user's picks and their forced
 * dice (they ride on the slot choices, ADR 0001); `handleExecuteDraft` rebuilds the branch at the viewed turn and executes the
 * draft as the branch's first turn. The dice must reach that turn: the history entry keeps them, the report names them, and the
 * log's own results of the turn (gate answer 19a) join them without entering the user's report.
 */
const sources = {
  teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null },
  hpEvidence: [], getInferredSpreads: async () => undefined,
} as unknown as TeamBuildSources;

const CASES: { kind: ReplayKind; turn: number }[] = [{ kind: 'singles', turn: 2 }, { kind: 'doubles', turn: 1 }, { kind: 'vgc', turn: 1 }];

type Picks = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

describe.each(CASES)('Execute from a viewed position, $kind', ({ kind, turn }) => {
  const fixture = replayFixture(kind);

  /** The hook over a viewed position of the fixture, and the picks a user could click there (one move per slot and side). */
  async function viewedPosition() {
    const { result } = renderHook(() => {
      const branch = useBranch();
      const [draft, setDraft] = useState<Picks>({ p1: [], p2: [] });
      const inputs: DeviationInputs = {
        replayData: fixture.replayData, snapshots: fixture.snapshots, observations: fixture.observations, sources,
        bringOnlyLists: null, bringCount: null, replayGameType: kind === 'singles' ? 'singles' : 'doubles',
        timeline: {
          viewTurnRef: { current: turn }, viewTurn: turn, viewLine: 'main', endSnapshotTurn: null, variationSpan: null,
          setVariationScores: vi.fn(), setViewTurn: vi.fn(), setViewLine: vi.fn(), liveTip: false, restorePointer: vi.fn(), followNextTip: vi.fn(),
        },
        branch, acquireRuntime: undefined as never, branchWindowOpenRef: { current: false }, setPendingConfirm: vi.fn(),
        draftChoices: draft, setDraftChoices: setDraft,
      };
      return { branch, deviation: useDeviation(inputs), draft, setDraft };
    });

    // The viewed position's moves: one throwaway branch at the turn shows what the picker would offer there.
    await act(async () => { await result.current.deviation.rebuildAt({ turn, line: 'main' }, null); });
    await waitFor(() => expect(result.current.branch.simState).not.toBeNull(), { timeout: 120_000 });
    const before = result.current.branch.simState!;
    const click = (side: 'p1' | 'p2', slot: number): BranchSlotChoice => {
      const move = (side === 'p1' ? before.p1MovesBySlot : before.p2MovesBySlot)[slot].find(option => !option.disabled)!;
      return { kind: 'move', moveId: move.name.toLowerCase().replace(/[^a-z0-9]/g, ''), moveName: move.name };
    };
    const slots = before.p1MovesBySlot.length;
    const p1 = Array.from({ length: slots }, (_, slot) => click('p1', slot));
    const p2 = Array.from({ length: slots }, (_, slot) => click('p2', slot));
    const die: ForcedDie = { name: { slot: 'p1a', moveId: p1[0].moveId, targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: false } };
    act(() => result.current.branch.stopBranch());
    return { result, p1, p2, die };
  }

  test('the draft\'s forced die reaches the first turn of the branch', async () => {
    const { result, p1, p2, die } = await viewedPosition();

    // The user forces the die in the draft, then presses Execute at the viewed position.
    act(() => result.current.setDraft({ p1: p1.map((choice, slot) => (slot === 0 ? { ...choice, dice: [die] } : choice)), p2 }));
    act(() => result.current.deviation.handleExecuteDraft());
    await waitFor(() => expect(result.current.branch.history).toHaveLength(1), { timeout: 120_000 });

    expect(result.current.branch.executeError).toBeNull();
    const entry = result.current.branch.history[0];
    expect(entry.p1SlotChoices![0]).toMatchObject({ dice: [die] });
    // the user's report holds the user's die alone: the log's own results joined the turn but stay out of the user's view
    expect(entry.diceReport?.forced.map(report => report.die)).toEqual([die]);
    expect(['applied', 'no-draw', 'no-chance', 'blocked']).toContain(entry.diceReport!.forced[0].took);
  }, 300_000);

  test('Execute sends the effective choices it is given, seed included, and not the bare draft (round 84, turn dock)', async () => {
    // The dock's seed is derived, not stored in the draft: the caller hands the merge of seed and draft to Execute.
    const { result, p1, p2 } = await viewedPosition();
    expect(result.current.draft).toEqual({ p1: [], p2: [] });
    act(() => result.current.deviation.handleExecuteDraft({ p1, p2 }));
    await waitFor(() => expect(result.current.branch.history).toHaveLength(1), { timeout: 120_000 });

    expect(result.current.branch.executeError).toBeNull();
    const entry = result.current.branch.history[0];
    expect(entry.p1SlotChoices).toEqual(p1);
    expect(entry.p2SlotChoices).toEqual(p2);
  }, 300_000);
});
