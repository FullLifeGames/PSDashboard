import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EvalResult, RankedChoice } from '@fulllifegames/eval-engine';
import { usePlayOut, type PlayOutInputs } from '../../src/hooks/usePlayOut';
import { useTransients } from '../../src/hooks/controller/transients';
import type { useEvaluation } from '../../src/hooks/useEvaluation';
import { evalResult, rankedChoice } from '../fixtures/eval-result';

type Evaluation = ReturnType<typeof useEvaluation>;

interface EvalShape {
  status: Evaluation['status'];
  result: EvalResult | null;
  resultTag: string | null;
  error: string | null;
  auto: boolean;
}

/** The slice of the evaluation surface the play-out reads, plus a spy on the preference writes. */
function evaluationOf(shape: Partial<EvalShape>, setPrefs = vi.fn()) {
  const prefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: shape.auto ?? false, autoAnalyze: false, tera: 'auto' as const };
  return {
    evaluation: { prefs, setPrefs, status: shape.status ?? 'idle', result: shape.result ?? null, resultTag: shape.resultTag ?? null, error: shape.error ?? null } as unknown as Evaluation,
    setPrefs,
  };
}

type Wiring = Omit<PlayOutInputs, 'playOut' | 'setPlayOut' | 'setPlayOutNotice' | 'playOutProcessedRef' | 'playOutRef' | 'stopPlayOutRef' | 'evaluation'>;

function wiring(overrides: Partial<Wiring> = {}): Wiring {
  return {
    evalViewKey: 'variation:3', liveEvalStatus: 'idle', liveTip: true, viewingVariation: true, atEndPosition: false,
    viewT0: false, viewTurn: 3, variationSpan: null, tipTurn: 3,
    navigateTo: vi.fn(), setNavSeek: vi.fn(), setVariationScores: vi.fn(), executing: false, branchPreparing: false,
    getBattle: vi.fn(() => ({ ended: false }) as unknown as ReturnType<PlayOutInputs['getBattle']>),
    executeTurn: vi.fn(async () => {}), handleEvaluate: vi.fn(), applyEvalChoice: vi.fn(() => true),
    rebuildAt: vi.fn(async () => {}), requestDeviation: vi.fn(),
    startLeadVariation: vi.fn((_leads, opts) => opts?.onStart?.()),
    defaultLeadSelection: vi.fn(() => ({ p1: ['Garchomp'], p2: ['Ferrothorn'] })),
    ...overrides,
  };
}

interface Props { evaluation: Evaluation; wiring: Wiring }

/** The real transients next to the hook, so the loop's own state changes drive its effects. */
function setup(evaluation: Evaluation, wired: Wiring = wiring()) {
  const hook = renderHook((props: Props) => {
    const transients = useTransients('gen9ou-1');
    const playOut = usePlayOut({
      playOut: transients.playOut, setPlayOut: transients.setPlayOut, setPlayOutNotice: transients.setPlayOutNotice,
      playOutProcessedRef: transients.playOutProcessedRef, playOutRef: transients.playOutRef, stopPlayOutRef: transients.stopPlayOutRef,
      evaluation: props.evaluation, ...props.wiring,
    });
    return { transients, playOut };
  }, { initialProps: { evaluation, wiring: wired } });
  return { ...hook, wired };
}

const waitOnly = (): RankedChoice[] => [rankedChoice('wait', 'wait', 0)];

afterEach(() => {
  vi.useRealTimers();
});

describe('usePlayOut', () => {
  test('starting on the live tip arms the run, switches auto on, and evaluates', () => {
    const { evaluation, setPrefs } = evaluationOf({});
    const { result, wired } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());
    expect(result.current.transients.playOut).toEqual({ active: true, executed: 0, turns: 0, startTurn: 3, prevAuto: false });
    expect(result.current.transients.playOutNotice).toBeNull();
    expect(setPrefs).toHaveBeenCalledWith(expect.objectContaining({ auto: true }));
    expect(wired.handleEvaluate).toHaveBeenCalled();
    expect(result.current.transients.playOutRef.current).toEqual(expect.objectContaining({ active: true }));
  });

  test('starting off the live tip goes through the deviation flow first; the end sentinel only asks', () => {
    const { evaluation } = evaluationOf({ auto: true });
    const wired = wiring({ liveTip: false, viewingVariation: false });
    const { result } = setup(evaluation, wired);
    act(() => result.current.playOut.startPlayOut());
    expect(wired.requestDeviation).toHaveBeenCalledWith(null);
    expect(result.current.transients.playOut?.active).toBe(true);
    expect(wired.handleEvaluate).not.toHaveBeenCalled();

    const atEnd = wiring({ liveTip: false, viewingVariation: false, atEndPosition: true });
    const ended = setup(evaluation, atEnd);
    act(() => ended.result.current.playOut.startPlayOut());
    expect(atEnd.requestDeviation).toHaveBeenCalledWith(null);
    expect(ended.result.current.transients.playOut).toBeNull();
  });

  test('a finished evaluation on the tip plays both top choices and re-evaluates after the turn', async () => {
    const { evaluation } = evaluationOf({ auto: true });
    const { result, rerender, wired } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());

    const done = evalResult('singles');
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: done, resultTag: 'variation:3' }).evaluation, wiring: wired });
    expect(wired.applyEvalChoice).toHaveBeenCalledWith('p1', done.perSide.p1[0]);
    expect(wired.applyEvalChoice).toHaveBeenCalledWith('p2', done.perSide.p2[0]);
    expect(result.current.transients.playOut).toMatchObject({ executed: 1, turns: 1 });
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
    // Two evaluations at the start (the arm and the idle kick), one more after the executed turn.
    await act(async () => {});
    expect(wired.handleEvaluate).toHaveBeenCalledTimes(3);

    // The same result again is not played twice.
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: done, resultTag: 'variation:3' }).evaluation, wiring: wired });
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
  });

  test('a result tagged for another position is left alone', () => {
    const { evaluation } = evaluationOf({ auto: true });
    const { result, rerender, wired } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: evalResult(), resultTag: 'main:2' }).evaluation, wiring: wired });
    expect(wired.applyEvalChoice).not.toHaveBeenCalled();
    expect(result.current.transients.playOut).toMatchObject({ executed: 0 });
  });

  test('a one-sided position submits the forced side only and counts no turn', () => {
    const { evaluation } = evaluationOf({ auto: true });
    const { result, rerender, wired } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());
    const forced = evalResult('singles', { perSide: { p1: evalResult().perSide.p1, p2: waitOnly() } });
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: forced, resultTag: 'variation:3' }).evaluation, wiring: wired });
    expect(wired.applyEvalChoice).toHaveBeenCalledTimes(1);
    expect(wired.applyEvalChoice).toHaveBeenCalledWith('p1', forced.perSide.p1[0]);
    expect(wired.executeTurn).not.toHaveBeenCalled();
    expect(result.current.transients.playOut).toMatchObject({ executed: 1, turns: 0 });
  });

  test('an ended battle finishes the run, restores the auto setting, and returns to the start after played turns', async () => {
    const { evaluation, setPrefs } = evaluationOf({});
    const { result, rerender, wired } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());
    rerender({ evaluation: evaluationOf({ status: 'done', result: evalResult(), resultTag: 'variation:3' }, setPrefs).evaluation, wiring: wired });
    expect(result.current.transients.playOut?.turns).toBe(1);

    (wired.getBattle as ReturnType<typeof vi.fn>).mockReturnValue({ ended: true });
    rerender({ evaluation: evaluationOf({ status: 'done', result: evalResult('doubles'), resultTag: 'variation:3' }, setPrefs).evaluation, wiring: wired });
    expect(result.current.transients.playOut).toBeNull();
    expect(result.current.transients.playOutNotice).toEqual({ text: 'Play-out finished: the battle ended after 1 turn.', watchTurn: 3 });
    expect(setPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ auto: false }));
    expect(wired.navigateTo).toHaveBeenCalledWith({ turn: 3, line: 'variation' }, { seek: true, internal: true });
  });

  test('an unplayable engine choice and a failed evaluation end the run with their reasons', () => {
    const { evaluation } = evaluationOf({ auto: true });
    const wired = wiring({ applyEvalChoice: vi.fn(() => false) });
    const { result, rerender } = setup(evaluation, wired);
    act(() => result.current.playOut.startPlayOut());
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: evalResult(), resultTag: 'variation:3' }).evaluation, wiring: wired });
    expect(result.current.transients.playOutNotice?.text).toBe("Play-out stopped after 0 turns: the engine's choice was not playable at this position.");

    // A run armed while the evaluation has already failed ends at once with the failure.
    rerender({ evaluation: evaluationOf({ auto: true, status: 'error', error: 'worker crashed' }).evaluation, wiring: wired });
    act(() => result.current.playOut.startPlayOut());
    expect(result.current.transients.playOutNotice?.text).toBe('Play-out stopped after 0 turns: the evaluation failed here (worker crashed).');
    expect(result.current.transients.playOut).toBeNull();
  });

  test('stopPlayOut ends the run by hand and watchFrom seeks the frame after the tip lands', () => {
    vi.useFakeTimers();
    const { evaluation } = evaluationOf({ auto: true });
    const { result, wired } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());
    act(() => result.current.transients.stopPlayOutRef.current?.());
    expect(result.current.transients.playOut).toBeNull();
    expect(result.current.transients.playOutNotice?.text).toBe('Play-out stopped: 0 turns played (they stay in the variation).');

    act(() => result.current.playOut.watchFrom(2));
    expect(wired.navigateTo).toHaveBeenCalledWith({ turn: 3, line: 'variation' }, { seek: false, internal: true });
    expect(wired.setNavSeek).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    const updater = (wired.setNavSeek as ReturnType<typeof vi.fn>).mock.calls[0][0] as (prev: null) => unknown;
    expect(updater(null)).toEqual({ turn: 2, seq: 1, play: true });
  });

  test('from turn 0 the run includes the lead decision: a default lead variation is seeded first', () => {
    const { evaluation } = evaluationOf({ auto: true });
    const wired = wiring({ viewT0: true, liveTip: false, viewingVariation: false });
    const { result } = setup(evaluation, wired);
    act(() => result.current.playOut.startPlayOut());
    expect(wired.startLeadVariation).toHaveBeenCalledWith({ p1: ['Garchomp'], p2: ['Ferrothorn'] }, expect.objectContaining({ onStart: expect.any(Function) }));
    expect(result.current.transients.playOut).toMatchObject({ active: true, startTurn: 1 });

    // A standing lead variation is kept from its turn 0 and rebuilt at turn 1.
    const standing = wiring({ viewT0: true, liveTip: false, viewingVariation: false, variationSpan: { startTurn: 0, length: 2 } });
    const again = setup(evaluation, standing);
    act(() => again.result.current.playOut.startPlayOut());
    expect(standing.rebuildAt).toHaveBeenCalledWith({ turn: 1, line: 'variation' }, null);
    expect(standing.startLeadVariation).not.toHaveBeenCalled();
  });
});
