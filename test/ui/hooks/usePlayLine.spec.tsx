import { describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLinesHost, usePlayLine } from '../../../src/hooks/usePlayLine';
import type { AppController } from '../../../src/hooks/useAppController';
import { lineHistory } from '../../../src/lib/line-history';
import { doublesLine, singlesLine } from '../fixtures/lines';

/**
 * Round 89 (#104), step G3: ▶ Play restores the line as a variation through the restore every saved variation takes, asks first
 * when a variation exists (the replace confirm of every other way in), clears the played-out notice and follows the new tip.
 */
function appWith(variationSpan: { startTurn: number; length: number } | null, auto = true) {
  const restoreVariation = vi.fn().mockResolvedValue(undefined);
  const followNextTip = vi.fn();
  const setVariationScores = vi.fn();
  const setPendingConfirm = vi.fn();
  const setPlayOutNotice = vi.fn();
  const setPrefs = vi.fn();
  const app = {
    board: { deviation: { restoreVariation }, timeline: { variationSpan, followNextTip, setVariationScores } },
    transients: { setPendingConfirm, setPlayOutNotice },
    ctx: { evaluation: { prefs: { depth: 1, samples: 1, auto, tera: 'auto' }, setPrefs } },
  } as unknown as AppController;
  return { app, restoreVariation, followNextTip, setVariationScores, setPendingConfirm, setPlayOutNotice, setPrefs };
}

describe('usePlayLine', () => {
  test('with no variation the click restores the line at once, from the graded turn, and follows the tip', () => {
    const stub = appWith(null);
    const { result } = renderHook(() => usePlayLine(stub.app));
    result.current(singlesLine, 20);
    expect(stub.setPendingConfirm).not.toHaveBeenCalled();
    expect(stub.restoreVariation).toHaveBeenCalledTimes(1);
    expect(stub.restoreVariation).toHaveBeenCalledWith({
      startTurn: 20, history: lineHistory(singlesLine, 20), prefill: { p1Choices: [], p2Choices: [] }, pinnedTeams: null,
    });
    expect(stub.followNextTip).toHaveBeenCalled();
    expect(stub.setVariationScores).toHaveBeenCalledWith([]);
    expect(stub.setPlayOutNotice).toHaveBeenCalledWith(null);
    expect(stub.setPrefs).not.toHaveBeenCalled();
  });

  test('a doubles line restores with its replacement entry', () => {
    const stub = appWith(null);
    const { result } = renderHook(() => usePlayLine(stub.app));
    result.current(doublesLine, 4);
    const [{ history }] = stub.restoreVariation.mock.calls[0];
    expect(history.map((entry: { kind: string }) => entry.kind)).toEqual(['turn', 'forced', 'turn']);
  });

  test('an existing variation is replaced only after the confirm, which names it', () => {
    const stub = appWith({ startTurn: 12, length: 3 });
    const { result } = renderHook(() => usePlayLine(stub.app));
    result.current(singlesLine, 20);
    expect(stub.restoreVariation).not.toHaveBeenCalled();
    const [confirm] = stub.setPendingConfirm.mock.calls[0];
    expect(confirm.message).toBe('Play this line from turn 20: replace the existing variation from turn 12 (3 turns)?');
    confirm.proceed();
    expect(stub.setPendingConfirm).toHaveBeenLastCalledWith(null);
    expect(stub.restoreVariation).toHaveBeenCalledTimes(1);
  });

  test('the engine view switches Auto on, as a click on an engine row does', () => {
    const stub = appWith(null, false);
    const { result } = renderHook(() => usePlayLine(stub.app));
    result.current(singlesLine, 20);
    expect(stub.setPrefs).toHaveBeenCalledWith(expect.objectContaining({ auto: true }));
  });
});

describe('useLinesHost', () => {
  test('the host reads the start snapshot of any turn, so the Game review words the dice of a turn that is not the selected one', () => {
    const stub = appWith(null);
    const snapshots = [{ turn: 1 }, { turn: 2 }, { turn: 3 }];
    const app = {
      ...stub.app,
      ctx: { ...stub.app.ctx, replay: { snapshots } },
      board: { ...stub.app.board, timeline: { ...stub.app.board.timeline, analysisTurn: 2 } },
    } as unknown as AppController;
    const replay = { log: '|gen|9\n|gametype|singles', players: ['a', 'b'] } as unknown as Parameters<typeof useLinesHost>[1];
    const { result } = renderHook(() => useLinesHost(app, replay));
    expect(result.current.snapshot).toBe(snapshots[1]);
    expect(result.current.snapshotAt?.(3)).toBe(snapshots[2]);
    expect(result.current.snapshotAt?.(9)).toBe(snapshots[2]);
    expect(result.current.onPlay).toBeTypeOf('function');
  });
});
