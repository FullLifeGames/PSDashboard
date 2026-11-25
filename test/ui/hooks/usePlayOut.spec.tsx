import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EvalResult, RankedChoice } from '@fulllifegames/eval-engine';
import { usePlayOut, type PlayOutInputs } from '../../../src/hooks/usePlayOut';
import { useTransients } from '../../../src/hooks/controller/transients';
import type { useEvaluation } from '../../../src/hooks/useEvaluation';
import { evalResult, rankedChoice, evalGraph } from '../fixtures/eval-result';
import { useRef, useState } from 'react';
import { replayFixture } from '../fixtures/replay';
import { useEvalView } from '../../../src/hooks/useEvalView';
import type { TeamBuildSources } from '../../../src/lib/eval-acquire';
import type { FormatKind } from '../fixtures/sim-state';

type Evaluation = ReturnType<typeof useEvaluation>;

interface EvalShape {
  status: Evaluation['status'];
  result: EvalResult | null;
  resultTag: string | null;
  error: string | null;
  auto: boolean;
}

function evaluationOf(shape: Partial<EvalShape>, setPrefs = vi.fn(), setEngineOverride = vi.fn()) {
  const prefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: shape.auto ?? false, autoAnalyze: false, tera: 'auto' as const };
  return {
    evaluation: {
      prefs, setPrefs, setEngineOverride,
      status: shape.status ?? 'idle', result: shape.result ?? null, resultTag: shape.resultTag ?? null, error: shape.error ?? null,
    } as unknown as Evaluation,
    setPrefs,
    setEngineOverride,
  };
}

type Wiring = Omit<PlayOutInputs, 'playOut' | 'setPlayOut' | 'setPlayOutNotice' | 'playOutProcessedRef' | 'playOutRef' | 'stopPlayOutRef' | 'evaluation'>;

function wiring(overrides: Partial<Wiring> = {}): Wiring {
  return {
    tip: { key: 'variation:3' }, tipEvalStatus: 'idle', liveTip: true, viewingVariation: true, atEndPosition: false,
    viewT0: false, viewTurn: 3, tipTurn: 3, fastPlayOut: false,
    navigateTo: vi.fn(), holdTipFollow: vi.fn(), setNavSeek: vi.fn(), executing: false, branchPreparing: false,
    getBattle: vi.fn(() => ({ ended: false }) as unknown as ReturnType<PlayOutInputs['getBattle']>),
    executeTurn: vi.fn(async () => {}), executeError: null, handleEvaluate: vi.fn(), applyEvalChoice: vi.fn(() => true),
    requestDeviation: vi.fn(),
    startLeadVariation: vi.fn((_leads, opts) => opts?.onStart?.()),
    leadPicksRef: { current: null }, setVariationNotice: vi.fn(),
    ...overrides,
  };
}

interface Props { evaluation: Evaluation; wiring: Wiring }

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

  test('starting off the live tip goes through the deviation flow first and arms only when it starts; the end sentinel only asks', () => {
    const { evaluation, setPrefs } = evaluationOf({});
    const wired = wiring({ liveTip: false, viewingVariation: false });
    const { result } = setup(evaluation, wired);
    act(() => result.current.playOut.startPlayOut());
    expect(wired.requestDeviation).toHaveBeenCalledWith(null, { onStart: expect.any(Function) });
    expect(result.current.transients.playOut).toBeNull();
    expect(setPrefs).not.toHaveBeenCalled();
    expect(wired.handleEvaluate).not.toHaveBeenCalled();

    const onStart = (wired.requestDeviation as ReturnType<typeof vi.fn>).mock.calls[0][1].onStart as () => void;
    act(() => onStart());
    expect(result.current.transients.playOut).toEqual({ active: true, executed: 0, turns: 0, startTurn: 3, prevAuto: false });
    expect(setPrefs).toHaveBeenCalledWith(expect.objectContaining({ auto: true }));
    expect(wired.handleEvaluate).not.toHaveBeenCalled();

    const atEnd = wiring({ liveTip: false, viewingVariation: false, atEndPosition: true });
    const ended = setup(evaluation, atEnd);
    act(() => ended.result.current.playOut.startPlayOut());
    expect(atEnd.requestDeviation).toHaveBeenCalledWith(null);
    expect(ended.result.current.transients.playOut).toBeNull();
  });

  test('a finished evaluation on the tip plays both top choices; the next evaluation is left to the Auto pref', async () => {
    const { evaluation } = evaluationOf({ auto: true });
    const { result, rerender, wired } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());

    const done = evalResult('singles');
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: done, resultTag: 'variation:3' }).evaluation, wiring: wired });
    expect(wired.applyEvalChoice).toHaveBeenCalledWith('p1', done.perSide.p1[0]);
    expect(wired.applyEvalChoice).toHaveBeenCalledWith('p2', done.perSide.p2[0]);
    expect(result.current.transients.playOut).toMatchObject({ executed: 1, turns: 1 });
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
    // Two calls at the start (the arm, and the kick of this mock, status idle); none after the executed turn.
    await act(async () => {});
    expect(wired.handleEvaluate).toHaveBeenCalledTimes(2);

    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: done, resultTag: 'variation:3' }).evaluation, wiring: wired });
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
  });

  test('a refused turn ends the run with the refusal instead of waiting for an evaluation that never comes', async () => {
    const { evaluation } = evaluationOf({ auto: true });
    const wired = wiring({ executeTurn: vi.fn(async () => 'Earthquake is disabled for Garchomp right now.') });
    const { result, rerender } = setup(evaluation, wired);
    act(() => result.current.playOut.startPlayOut());
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: evalResult(), resultTag: 'variation:3' }).evaluation, wiring: wired });
    await act(async () => {});
    expect(result.current.transients.playOut).toBeNull();
    expect(result.current.transients.playOutNotice?.text).toBe('Play-out stopped after 0 turns: the turn could not be played (Earthquake is disabled for Garchomp right now).');
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

  test.each([
    ['singles', [true], [true]],
    ['doubles', [true, false], [false, true]],
  ] as const)('%s: a pair that replaces on both sides executes but counts no turn', (kind, p1Force, p2Force) => {
    const side = (forceSwitch: readonly boolean[]) => ({ active: forceSwitch.map(() => ({})), activeRequest: { forceSwitch } });
    const bothReplace = vi.fn(() => ({ ended: false, sides: [side(p1Force), side(p2Force)] }) as unknown as ReturnType<PlayOutInputs['getBattle']>);
    const { evaluation } = evaluationOf({ auto: true });
    const { result, rerender, wired } = setup(evaluation, wiring({ getBattle: bothReplace }));
    act(() => result.current.playOut.startPlayOut());
    const done = evalResult(kind);
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: done, resultTag: 'variation:3' }).evaluation, wiring: wired });
    expect(wired.applyEvalChoice).toHaveBeenCalledTimes(2);
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
    expect(result.current.transients.playOut).toMatchObject({ executed: 1, turns: 0 });
  });

  test('an ended battle finishes the run, restores the auto setting, and leaves the frame where it stands after played turns', async () => {
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
    expect(wired.navigateTo).toHaveBeenCalledWith({ turn: 3, line: 'variation' }, { seek: false, internal: true, toFrame: true });
    expect((wired.navigateTo as ReturnType<typeof vi.fn>).mock.calls.every(([, opts]) => opts?.seek !== true)).toBe(true);
  });

  test('a run that played no turn leaves the pointer alone and a navigation interrupt moves nothing', () => {
    const { evaluation } = evaluationOf({ auto: true });
    const { result, wired } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());
    act(() => result.current.transients.stopPlayOutRef.current?.({ navigated: true }));
    expect(result.current.transients.playOut).toBeNull();
    expect(wired.navigateTo).not.toHaveBeenCalled();
  });

  test('an unplayable engine choice and a failed evaluation end the run with their reasons', () => {
    const { evaluation } = evaluationOf({ auto: true });
    const wired = wiring({ applyEvalChoice: vi.fn(() => false) });
    const { result, rerender } = setup(evaluation, wired);
    act(() => result.current.playOut.startPlayOut());
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: evalResult(), resultTag: 'variation:3' }).evaluation, wiring: wired });
    expect(result.current.transients.playOutNotice?.text).toBe("Play-out stopped after 0 turns: the engine's choice was not playable at this position.");

    rerender({ evaluation: evaluationOf({ auto: true, status: 'error', error: 'worker crashed' }).evaluation, wiring: wired });
    act(() => result.current.playOut.startPlayOut());
    expect(result.current.transients.playOutNotice?.text).toBe('Play-out stopped after 0 turns: the evaluation failed here (worker crashed).');
    expect(result.current.transients.playOut).toBeNull();
  });

  test('stopPlayOut ends the run by hand and watchFrom seeks the frame after the pointer moved', () => {
    vi.useFakeTimers();
    const { evaluation } = evaluationOf({ auto: true });
    const { result, wired } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());
    act(() => result.current.transients.stopPlayOutRef.current?.());
    expect(result.current.transients.playOut).toBeNull();
    expect(result.current.transients.playOutNotice?.text).toBe('Play-out stopped: 0 turns played (they stay in the variation).');

    act(() => result.current.playOut.watchFrom(2));
    expect(wired.navigateTo).toHaveBeenCalledWith({ turn: 2, line: 'variation' }, { seek: false, internal: true, toFrame: 2 });
    expect(wired.setNavSeek).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    const updater = (wired.setNavSeek as ReturnType<typeof vi.fn>).mock.calls[0][0] as (prev: null) => unknown;
    expect(updater(null)).toEqual({ turn: 2, seq: 1, play: true });
  });

  test('watchFrom turn 0 asks for the frame position of turn 0 and seeks turn 0', () => {
    vi.useFakeTimers();
    const { evaluation } = evaluationOf({ auto: true });
    const { result, wired } = setup(evaluation);
    act(() => result.current.playOut.watchFrom(0));
    expect(wired.navigateTo).toHaveBeenCalledWith({ turn: 0, line: 'variation' }, { seek: false, internal: true, toFrame: 0 });
    act(() => vi.advanceTimersByTime(250));
    const updater = (wired.setNavSeek as ReturnType<typeof vi.fn>).mock.calls[0][0] as (prev: null) => unknown;
    expect(updater(null)).toEqual({ turn: 0, seq: 1, play: true });
  });

  test('stopping hands the view back and holds the tip-follow of the timeline for the turn in flight, user stop and navigation alike', () => {
    const { evaluation } = evaluationOf({ auto: true });
    const { result, wired } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());
    act(() => result.current.transients.stopPlayOutRef.current?.());
    expect(wired.holdTipFollow).toHaveBeenCalledTimes(1);

    const again = setup(evaluation);
    act(() => again.result.current.playOut.startPlayOut());
    act(() => again.result.current.transients.stopPlayOutRef.current?.({ navigated: true }));
    expect(again.wired.holdTipFollow).toHaveBeenCalledTimes(1);
  });

  describe('a stop with a turn in flight', () => {
    const inFlight = () => {
      const { evaluation } = evaluationOf({ auto: true });
      const hook = setup(evaluation);
      act(() => hook.result.current.playOut.startPlayOut());
      const done = evaluationOf({ auto: true, status: 'done', result: evalResult(), resultTag: 'variation:3' }).evaluation;
      hook.rerender({ evaluation: done, wiring: hook.wired });
      hook.rerender({ evaluation: done, wiring: { ...hook.wired, executing: true } });
      return { ...hook, done };
    };

    test('keeps the run active and holds the tip-follow, then finishes when the turn landed', () => {
      const { result, rerender, wired, done } = inFlight();
      act(() => result.current.transients.stopPlayOutRef.current?.());
      expect(result.current.transients.playOut).toMatchObject({ active: true, turns: 1, stopping: { navigated: false } });
      expect(result.current.transients.playOutNotice).toBeNull();
      expect(result.current.transients.playOutRef.current).toEqual(expect.objectContaining({ active: true }));
      expect(wired.holdTipFollow).toHaveBeenCalledTimes(1);
      expect(wired.navigateTo).not.toHaveBeenCalled();

      rerender({ evaluation: done, wiring: wired });
      expect(result.current.transients.playOut).toBeNull();
      expect(result.current.transients.playOutNotice).toEqual({ text: 'Play-out stopped: 1 turn played (they stay in the variation).', watchTurn: 3 });
      expect(wired.navigateTo).toHaveBeenCalledTimes(1);
      expect(wired.navigateTo).toHaveBeenCalledWith({ turn: 3, line: 'variation' }, { seek: false, internal: true, toFrame: true });
    });

    test('a navigation during the stop, or one that stops the run itself, finishes it without moving the pointer', () => {
      const first = inFlight();
      act(() => first.result.current.transients.stopPlayOutRef.current?.());
      act(() => first.result.current.transients.stopPlayOutRef.current?.({ navigated: true }));
      first.rerender({ evaluation: first.done, wiring: first.wired });
      expect(first.result.current.transients.playOut).toBeNull();
      expect(first.wired.navigateTo).not.toHaveBeenCalled();

      const second = inFlight();
      act(() => second.result.current.transients.stopPlayOutRef.current?.({ navigated: true }));
      expect(second.result.current.transients.playOut).toMatchObject({ active: true, stopping: { navigated: true } });
      expect(second.wired.holdTipFollow).toHaveBeenCalledTimes(1);
      second.rerender({ evaluation: second.done, wiring: second.wired });
      expect(second.result.current.transients.playOut).toBeNull();
      expect(second.result.current.transients.playOutNotice?.text).toBe('Play-out stopped: 1 turn played (they stay in the variation).');
      expect(second.wired.navigateTo).not.toHaveBeenCalled();
    });

    test('plays nothing more while it waits: a finished evaluation is left alone', () => {
      const { result, rerender, wired } = inFlight();
      act(() => result.current.transients.stopPlayOutRef.current?.());
      const calls = (wired.applyEvalChoice as ReturnType<typeof vi.fn>).mock.calls.length;
      const next = evaluationOf({ auto: true, status: 'done', result: evalResult('doubles'), resultTag: 'variation:3' }).evaluation;
      rerender({ evaluation: next, wiring: { ...wired, executing: false } });
      expect(wired.applyEvalChoice).toHaveBeenCalledTimes(calls);
      expect(wired.executeTurn).toHaveBeenCalledTimes(1);
      expect(result.current.transients.playOut).toBeNull();
    });

    test('a refused turn that lands during the stop ends the run once, with the refusal', async () => {
      const { evaluation } = evaluationOf({ auto: true });
      let refuse: (message: string) => void = () => {};
      const wired = wiring({ executeTurn: vi.fn(() => new Promise<string | void>(resolve => { refuse = resolve; })) });
      const { result, rerender } = setup(evaluation, wired);
      act(() => result.current.playOut.startPlayOut());
      const done = evaluationOf({ auto: true, status: 'done', result: evalResult(), resultTag: 'variation:3' }).evaluation;
      rerender({ evaluation: done, wiring: wired });
      rerender({ evaluation: done, wiring: { ...wired, executing: true } });
      act(() => result.current.transients.stopPlayOutRef.current?.({ navigated: true }));
      await act(async () => { refuse('Earthquake is disabled for Garchomp right now.'); });
      expect(result.current.transients.playOut).toBeNull();
      expect(result.current.transients.playOutNotice?.text).toContain('the turn could not be played');
      expect(wired.navigateTo).not.toHaveBeenCalled();
    });
  });

  test('the fast option pins the run to the depth-1 matrix before its first evaluation and releases the engine when the run ends', () => {
    const { evaluation, setPrefs, setEngineOverride } = evaluationOf({});
    const wired = wiring({ fastPlayOut: true });
    const { result, rerender } = setup(evaluation, wired);
    act(() => result.current.playOut.startPlayOut());
    expect(setEngineOverride).toHaveBeenCalledWith({ depth: 1, samples: 1, mode: 'matrix' });
    const pinnedAt = setEngineOverride.mock.invocationCallOrder[0];
    expect(pinnedAt).toBeLessThan((wired.handleEvaluate as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);

    (wired.getBattle as ReturnType<typeof vi.fn>).mockReturnValue({ ended: true });
    rerender({ evaluation: evaluationOf({ status: 'done', result: evalResult(), resultTag: 'variation:3' }, setPrefs, setEngineOverride).evaluation, wiring: wired });
    expect(result.current.transients.playOut).toBeNull();
    expect(setEngineOverride).toHaveBeenLastCalledWith(null);
  });

  test('without the fast option the run never pins an engine', () => {
    const { evaluation, setEngineOverride } = evaluationOf({});
    const { result } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());
    expect(setEngineOverride.mock.calls.every(([override]) => override === null)).toBe(true);
  });

  describe('from turn 0', () => {
    const singlesPicks = { p1: ['Talonflame'], p2: ['Weavile'] };
    const vgcPicks = { p1: ['Incineroar', 'Amoonguss', 'Urshifu', 'Rillaboom'], p2: ['Tornadus', 'Kingambit', 'Chi-Yu', 'Pelipper'], bring: true };

    test.each([
      ['singles', singlesPicks],
      ['doubles with a bring of four', vgcPicks],
    ])('%s: the picker selection starts a lead variation and the run arms after the start', (_name, picks) => {
      const { evaluation } = evaluationOf({ auto: true });
      const wired = wiring({
        viewT0: true, liveTip: false, viewingVariation: false, leadPicksRef: { current: picks },
        startLeadVariation: vi.fn(),
      });
      const { result } = setup(evaluation, wired);
      act(() => result.current.playOut.startPlayOut());
      expect(wired.startLeadVariation).toHaveBeenCalledWith(picks, { onStart: expect.any(Function) });
      expect(result.current.transients.playOut).toBeNull();
      const onStart = (wired.startLeadVariation as ReturnType<typeof vi.fn>).mock.calls[0][1].onStart as () => void;
      act(() => onStart());
      expect(result.current.transients.playOut).toMatchObject({ active: true, startTurn: 0 });
    });

    test.each([
      ['singles', singlesPicks],
      ['doubles with a bring of four', vgcPicks],
    ])('%s: the finish notice offers Watch from turn 0 and Watch seeks the frame to turn 0', (_name, picks) => {
      vi.useFakeTimers();
      const { evaluation } = evaluationOf({ auto: true });
      const wired = wiring({ viewT0: true, liveTip: false, viewingVariation: false, leadPicksRef: { current: picks } });
      const { result, rerender } = setup(evaluation, wired);
      act(() => result.current.playOut.startPlayOut());
      act(() => result.current.transients.stopPlayOutRef.current?.());
      expect(result.current.transients.playOutNotice).toEqual({ text: 'Play-out stopped: 0 turns played (they stay in the variation).', watchTurn: 0 });
      rerender({ evaluation, wiring: wired });
      act(() => result.current.playOut.watchFrom(result.current.transients.playOutNotice?.watchTurn ?? -1));
      expect(wired.navigateTo).toHaveBeenCalledWith({ turn: 0, line: 'variation' }, { seek: false, internal: true, toFrame: 0 });
      act(() => vi.advanceTimersByTime(250));
      const updater = (wired.setNavSeek as ReturnType<typeof vi.fn>).mock.calls[0][0] as (prev: null) => unknown;
      expect(updater(null)).toEqual({ turn: 0, seq: 1, play: true });
    });

    test('an unfinished picker starts nothing and says why', () => {
      const { evaluation, setPrefs } = evaluationOf({});
      const wired = wiring({ viewT0: true, liveTip: false, viewingVariation: false, leadPicksRef: { current: null } });
      const { result } = setup(evaluation, wired);
      act(() => result.current.playOut.startPlayOut());
      expect(wired.startLeadVariation).not.toHaveBeenCalled();
      expect(wired.setVariationNotice).toHaveBeenCalledWith('Finish the lead picks above before the engine plays from turn 0.');
      expect(result.current.transients.playOut).toBeNull();
      expect(setPrefs).not.toHaveBeenCalled();
    });
  });
});

describe('usePlayOut, a step that fails', () => {
  const REFUSED = 'Ogerpon (Ogerpon-Teal-Tera) is no longer available to switch in.';
  test.each(['singles', 'doubles'] as const)('%s: a forced replacement that fails ends the run with its reason instead of waiting', kind => {
    const { evaluation, setPrefs } = evaluationOf({});
    const { result, rerender, wired } = setup(evaluation);
    act(() => result.current.playOut.startPlayOut());
    const base = evalResult(kind);
    const forced = evalResult(kind, { perSide: { p1: base.perSide.p1, p2: waitOnly() } });
    rerender({ evaluation: evaluationOf({ status: 'done', result: forced, resultTag: 'variation:3' }, setPrefs).evaluation, wiring: wired });
    expect(wired.applyEvalChoice).toHaveBeenCalledWith('p1', forced.perSide.p1[0]);
    expect(result.current.transients.playOut).toMatchObject({ executed: 1, turns: 0 });
    rerender({ evaluation: evaluationOf({ status: 'done', result: forced, resultTag: 'variation:3' }, setPrefs).evaluation, wiring: { ...wired, executeError: REFUSED } });
    expect(result.current.transients.playOut).toBeNull();
    expect(result.current.transients.playOutNotice).toEqual({
      text: 'Play-out stopped after 0 turns: the forced replacement could not be played (Ogerpon (Ogerpon-Teal-Tera) is no longer available to switch in).',
      watchTurn: 3,
    });
    expect(setPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ auto: false }));
  });

  test('a forced replacement that lands cleanly keeps the run going, and an error left from before the run does not end it', () => {
    const { evaluation } = evaluationOf({ auto: true });
    const { result, rerender, wired } = setup(evaluation, wiring({ executeError: 'Left over from a click before the run.' }));
    act(() => result.current.playOut.startPlayOut());
    expect(result.current.transients.playOut).toMatchObject({ active: true });
    const forced = evalResult('singles', { perSide: { p1: evalResult().perSide.p1, p2: waitOnly() } });
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: forced, resultTag: 'variation:3' }).evaluation, wiring: { ...wired, executeError: null } });
    expect(result.current.transients.playOut).toMatchObject({ active: true, executed: 1 });
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: evalResult(), resultTag: 'variation:3' }).evaluation, wiring: { ...wired, executeError: null } });
    expect(result.current.transients.playOut).toMatchObject({ active: true, executed: 2, turns: 1 });
  });

  test.each(['singles', 'doubles'] as const)('%s: a turn that fails after played turns ends the run and names the count', async kind => {
    const { evaluation } = evaluationOf({ auto: true });
    const executeTurn = vi.fn(async () => null as string | null).mockResolvedValueOnce(null).mockResolvedValueOnce('Spore is disabled for Amoonguss right now.');
    const wired = wiring({ executeTurn });
    const { result, rerender } = setup(evaluation, wired);
    act(() => result.current.playOut.startPlayOut());
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: evalResult(kind), resultTag: 'variation:3' }).evaluation, wiring: wired });
    await act(async () => {});
    expect(result.current.transients.playOut).toMatchObject({ active: true, turns: 1 });
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: evalResult(kind), resultTag: 'variation:3' }).evaluation, wiring: wired });
    await act(async () => {});
    expect(result.current.transients.playOut).toBeNull();
    expect(result.current.transients.playOutNotice?.text).toBe('Play-out stopped after 1 turn: the turn could not be played (Spore is disabled for Amoonguss right now).');
  });
});

type Status = Evaluation['status'];

const START_TURN = 3;

const sources = {
  teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null },
  hpEvidence: [], getInferredSpreads: async () => undefined,
} as unknown as TeamBuildSources;

// Mirrors execute.ts: an executed turn lands as one history entry plus the end of `executing` in one tick.
function useRunHarness(kind: FormatKind, forcedAt: number[], endAfterTurns: number) {
  const { replayData, snapshots } = replayFixture(kind === 'doubles' ? 'doubles' : 'singles');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<EvalResult | null>(null);
  const [resultTag, setResultTag] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [entries, setEntries] = useState(0);
  const [turns, setTurns] = useState(0);
  const counts = useRef({ evaluate: 0, tags: [] as (string | null)[], acquires: [] as unknown[], pendingTag: null as string | null });
  const [pointerBehind, setPointerBehind] = useState(false);
  const tipTurn = START_TURN + turns;
  const viewTurn = pointerBehind ? tipTurn - 1 : tipTurn;
  const liveTip = !pointerBehind;
  const evalViewKey = `variation:${viewTurn}`;
  const tip = { key: `variation:${tipTurn}`, turn: tipTurn, variation: true };
  const evaluation = {
    prefs: { depth: 1, samples: 1, mode: 'matrix', auto, autoAnalyze: false, tera: 'auto' },
    setPrefs: (next: { auto: boolean }) => setAuto(next.auto),
    setEngineOverride: vi.fn(), runGraphSweep: vi.fn(), reset: vi.fn(), clearGraph: vi.fn(),
    markStale: () => setStatus(previous => (previous === 'done' ? 'stale' : previous)),
    evaluate: (params: { tag?: string | null; acquire?: unknown }) => {
      counts.current.evaluate += 1;
      counts.current.acquires.push(params.acquire);
      counts.current.tags.push(params.tag ?? null);
      counts.current.pendingTag = params.tag ?? null;
      setStatus('reconstructing');
      setResult(null);
      setResultTag(params.tag ?? null);
    },
    status, result, resultTag, error: null,
    graph: evalGraph(kind, { scores: Array(10).fill(null), results: Array(10).fill(null), settings: Array(10).fill(null) }),
  } as unknown as Evaluation;
  const liveEvalStatus: Status = status === 'done' && resultTag !== evalViewKey ? 'stale' : status;
  const tipEvalStatus: Status = status === 'done' && resultTag !== tip.key ? 'stale' : status;
  const [acquireBranchPosition] = useState(() => vi.fn());
  const transients = useTransients('gen9ou-1');
  const land = (kindOfEntry: 'turn' | 'forced') => {
    setExecuting(true);
    void Promise.resolve().then(() => {
      setEntries(count => count + 1);
      if (kindOfEntry === 'turn') setTurns(count => count + 1);
      setExecuting(false);
    });
  };
  const handleEvaluate = useEvalView({
    replayData, snapshots, evaluation, replayGameType: kind === 'doubles' ? 'doubles' : 'singles', evalIsDoubles: kind === 'doubles',
    viewTurn, viewLine: 'variation', viewingVariation: true, liveTip, liveEvalView: true, evalViewKey,
    serializedAtView: pointerBehind ? `{"turn":${viewTurn}}` : null,
    liveEvalStatus, tip, tipEvalStatus, analysisTurn: viewTurn, analyzableTurns: 6, branching: true, executing, branchPreparing: false,
    playOutActive: transients.playOut?.active ?? false, smogonPending: false,
    acquire: { acquireBranchPosition, acquireReplayPosition: vi.fn(), makeReplayAcquire: vi.fn(), makeSweepAcquireAll: vi.fn(() => vi.fn()) },
    sources, bringOnlyLists: null, setsFingerprint: 'fp', sensitivityTargetsFor: () => [], editedP1Info: null, editedP2Info: null,
    historyLength: entries, setVariationScores: vi.fn(),
  }).handleEvaluate;
  const playOut = usePlayOut({
    playOut: transients.playOut, setPlayOut: transients.setPlayOut, setPlayOutNotice: transients.setPlayOutNotice,
    playOutProcessedRef: transients.playOutProcessedRef, playOutRef: transients.playOutRef, stopPlayOutRef: transients.stopPlayOutRef,
    evaluation, fastPlayOut: false, tip, tipEvalStatus, liveTip, viewingVariation: true, atEndPosition: false,
    viewT0: false, viewTurn, tipTurn, holdTipFollow: vi.fn(), navigateTo: vi.fn(), setNavSeek: vi.fn(),
    executing, executeError: null, branchPreparing: false,
    getBattle: () => ({ ended: turns >= endAfterTurns }) as never,
    executeTurn: async () => { land('turn'); await Promise.resolve(); return null; },
    handleEvaluate,
    applyEvalChoice: () => { if (forcedAt.includes(entries) && !executing) land('forced'); return true; },
    requestDeviation: vi.fn(), startLeadVariation: vi.fn(), leadPicksRef: { current: null }, setVariationNotice: vi.fn(),
  });
  const deliver = () => {
    const oneSided = forcedAt.includes(entries);
    const base = evalResult(kind);
    setResult(oneSided ? { ...base, perSide: { p1: base.perSide.p1, p2: [{ ...base.perSide.p2[0], choice: 'wait' }] } } : base);
    setResultTag(counts.current.pendingTag);
    setStatus('done');
  };
  return { counts, playOut, transients, deliver, status, turns, entries, acquireBranchPosition, setPointerBehind };
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function runToEnd(kind: FormatKind, forcedAt: number[], endAfterTurns: number, pointerBehind = false) {
  const hook = renderHook(() => useRunHarness(kind, forcedAt, endAfterTurns));
  act(() => hook.result.current.playOut.startPlayOut());
  if (pointerBehind) act(() => hook.result.current.setPointerBehind(true));
  for (let guard = 0; guard < 40 && hook.result.current.transients.playOut?.active; guard += 1) {
    if (hook.result.current.status === 'reconstructing') act(() => hook.result.current.deliver());
    await settle();
  }
  return hook.result.current;
}

describe('a play-out evaluates every position once', () => {
  test.each(['singles', 'doubles'] as const)('%s: one evaluation for the start and one after every executed turn', async kind => {
    const done = await runToEnd(kind, [], 3);
    expect(done.transients.playOut).toBeNull();
    expect(done.turns).toBe(3);
    // The start position, then the positions after turns 1, 2 and 3 (the last one only tells that the battle ended).
    expect(done.counts.current.evaluate).toBe(4);
    expect(done.counts.current.tags).toEqual(['variation:3', 'variation:4', 'variation:5', 'variation:6']);
  });

  test.each(['singles', 'doubles'] as const)('%s: a forced replacement is a position of its own and is evaluated once', async kind => {
    const done = await runToEnd(kind, [1], 3);
    expect(done.transients.playOut).toBeNull();
    expect(done.turns).toBe(3);
    expect(done.entries).toBe(4);
    // Start, after turn 1, after the forced entry, after turns 2 and 3.
    expect(done.counts.current.evaluate).toBe(5);
    expect(done.counts.current.tags).toEqual(['variation:3', 'variation:4', 'variation:4', 'variation:5', 'variation:6']);
  });

  test.each(['singles', 'doubles'] as const)('%s: a pointer behind the tip does not stop the run or send an evaluation of the clicked turn', async kind => {
    const done = await runToEnd(kind, [], 3, true);
    expect(done.transients.playOut).toBeNull();
    expect(done.turns).toBe(3);
    expect(done.counts.current.evaluate).toBe(4);
    expect(done.counts.current.tags).toEqual(['variation:3', 'variation:4', 'variation:5', 'variation:6']);
    expect(done.counts.current.acquires.every(acquire => acquire === done.acquireBranchPosition)).toBe(true);
  });
});
