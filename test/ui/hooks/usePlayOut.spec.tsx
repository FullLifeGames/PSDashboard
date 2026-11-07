import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EvalResult, RankedChoice } from '@fulllifegames/eval-engine';
import { usePlayOut, type PlayOutInputs } from '../../../src/hooks/usePlayOut';
import { useTransients } from '../../../src/hooks/controller/transients';
import type { useEvaluation } from '../../../src/hooks/useEvaluation';
import { evalResult, rankedChoice } from '../fixtures/eval-result';

type Evaluation = ReturnType<typeof useEvaluation>;

interface EvalShape {
  status: Evaluation['status'];
  result: EvalResult | null;
  resultTag: string | null;
  error: string | null;
  auto: boolean;
}

/** The slice of the evaluation surface the play-out reads, plus spies on the preference and engine-override writes. */
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
    evalViewKey: 'variation:3', liveEvalStatus: 'idle', liveTip: true, viewingVariation: true, atEndPosition: false,
    viewT0: false, viewTurn: 3, tipTurn: 3, fastPlayOut: false,
    navigateTo: vi.fn(), holdTipFollow: vi.fn(), setNavSeek: vi.fn(), executing: false, branchPreparing: false,
    getBattle: vi.fn(() => ({ ended: false }) as unknown as ReturnType<PlayOutInputs['getBattle']>),
    executeTurn: vi.fn(async () => {}), handleEvaluate: vi.fn(), applyEvalChoice: vi.fn(() => true),
    requestDeviation: vi.fn(),
    startLeadVariation: vi.fn((_leads, opts) => opts?.onStart?.()),
    leadPicksRef: { current: null }, setVariationNotice: vi.fn(),
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

  // Round 77 (C4): the run arms after the deviation started (after the replace confirm's yes), not before.
  test('starting off the live tip goes through the deviation flow first and arms only when it starts; the end sentinel only asks', () => {
    const { evaluation, setPrefs } = evaluationOf({});
    const wired = wiring({ liveTip: false, viewingVariation: false });
    const { result } = setup(evaluation, wired);
    act(() => result.current.playOut.startPlayOut());
    expect(wired.requestDeviation).toHaveBeenCalledWith(null, { onStart: expect.any(Function) });
    // Waiting on the confirm: nothing runs, nothing is changed.
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
    // Two calls at the start (the arm, and the kick of this mock whose status stays idle); none after the executed turn
    // (usePlayOut.evaluations.spec counts the real chain).
    await act(async () => {});
    expect(wired.handleEvaluate).toHaveBeenCalledTimes(2);

    // The same result again is not played twice.
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: done, resultTag: 'variation:3' }).evaluation, wiring: wired });
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
  });

  // The loop no longer re-evaluates after a turn by itself; a turn the simulator refuses must end the run, not stall it.
  test('a refused turn ends the run with the refusal instead of waiting for an evaluation that never comes', async () => {
    const { evaluation } = evaluationOf({ auto: true });
    const wired = wiring({ executeTurn: vi.fn(async () => 'Earthquake is disabled for Garchomp right now.') });
    const { result, rerender } = setup(evaluation, wired);
    act(() => result.current.playOut.startPlayOut());
    rerender({ evaluation: evaluationOf({ auto: true, status: 'done', result: evalResult(), resultTag: 'variation:3' }).evaluation, wiring: wired });
    await act(async () => {});
    expect(result.current.transients.playOut).toBeNull();
    expect(result.current.transients.playOutNotice?.text).toBe('Play-out stopped after 0 turns: the turn could not be played (Earthquake is disabled for Garchomp right now.).');
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

  // Round 88 (T347, #83): the finish leaves the frame where the user watches it; the pointer takes the frame's turn.
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

    // A run armed while the evaluation has already failed ends at once with the failure.
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

    // The pointer takes the variation position of the turn the frame is about to show, never the tip (T347).
    act(() => result.current.playOut.watchFrom(2));
    expect(wired.navigateTo).toHaveBeenCalledWith({ turn: 2, line: 'variation' }, { seek: false, internal: true, toFrame: 2 });
    expect(wired.setNavSeek).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    const updater = (wired.setNavSeek as ReturnType<typeof vi.fn>).mock.calls[0][0] as (prev: null) => unknown;
    expect(updater(null)).toEqual({ turn: 2, seq: 1, play: true });
  });

  // Round 88 (T343 builds on it): the lead variation's Watch from turn 0 reads T1 while the frame plays the leads in.
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

  // Round 77 (C5): a turn in flight lands after the stop; the timeline must not follow it to the tip.
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

  // Round 88 (T347, #83): a turn in flight lands after the stop in the append mode of the run ('hold': no seek, no play,
  // no follow-end), so the frame stays where the user watches it. The run stays active until that turn landed.
  describe('a stop with a turn in flight', () => {
    const inFlight = () => {
      const { evaluation } = evaluationOf({ auto: true });
      const hook = setup(evaluation);
      act(() => hook.result.current.playOut.startPlayOut());
      const done = evaluationOf({ auto: true, status: 'done', result: evalResult(), resultTag: 'variation:3' }).evaluation;
      hook.rerender({ evaluation: done, wiring: hook.wired }); // the run plays its first turn
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

      rerender({ evaluation: done, wiring: wired }); // executing false: the turn landed
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
      // The turn landed: the run finished instead of playing the next result.
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
      expect(wired.navigateTo).not.toHaveBeenCalled(); // the user's own navigation stands
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

  // Round 77 (C2): the T0 run plays from the leads the picker shows, through the same road as "Play from turn 0".
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
      expect(result.current.transients.playOut).toMatchObject({ active: true, startTurn: 1 });
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
