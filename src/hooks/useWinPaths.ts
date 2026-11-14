import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReplayData } from '@fulllifegames/replay-core';
import type { AppController } from './useAppController';
import { EvalWorkerClient } from '../lib/eval/worker-client';
import { endgameTurns, loserOf } from '../lib/endgame-scope';
import { winPathsRequest } from '../lib/win-paths-request';
import type { WinPathsHost, WinPathsRun } from '../lib/win-paths-host';

/** The run the panel shows, with the replay and the call it belongs to (a run of another replay is gone without an effect). */
interface Held { replayId: string; call: number; run: WinPathsRun }

/** The side that lost and the turns of its endgame (null when the game has no loser or never reached an endgame). */
function useEndgame(app: AppController, replayData: ReplayData): WinPathsHost['endgame'] {
  const { snapshots } = app.ctx.replay;
  const { analyzableTurns } = app.board.timeline;
  const loser = useMemo(() => loserOf(replayData.log, replayData.players), [replayData.log, replayData.players]);
  return useMemo(() => {
    const turns = loser ? endgameTurns(snapshots, analyzableTurns) : [];
    return loser && turns.length > 0 ? { loser, turns } : null;
  }, [loser, snapshots, analyzableTurns]);
}

/**
 * Round 89 (#130, G8b): the win-path job of the Game review and the turn card. One search is open at a time. The position of the
 * turn is the healed main-line position the evaluation acquires (`makeReplayAcquire`: stored or rebuilt in a worker); the job runs on
 * a worker of its own (`EvalWorkerClient.winPaths`), so a sweep in progress never waits for it and the sweep's cancel never ends it.
 * The client keeps the newest answers (its memo), so opening a turn again shows its steps at once. The steps are recorded as they
 * arrive; closing the panel, asking for another turn, another replay or leaving the page stops the worker. This hook is the only
 * caller of the job: the sweep never starts one.
 */
export function useWinPaths(app: AppController, replayData: ReplayData): WinPathsHost {
  const endgame = useEndgame(app, replayData);
  const { graph } = app.ctx.evaluation;
  const analyses = app.analysis.gameAnalyses;
  const { makeReplayAcquire } = app.engine.acquire;
  const { effectiveTera, effectiveSleepClause, effectiveRuleset } = app.engine.evalView;
  const unavailable = app.engine.smogonPending ? 'Waiting for Smogon data: the position would be built without the guessed sets.' : null;

  const clientRef = useRef<EvalWorkerClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const calls = useRef(0);
  const [held, setHeld] = useState<Held | null>(null);
  const replayId = replayData.id;

  // the worker and the client end with the page or the replay
  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, [replayId]);
  useEffect(() => () => {
    clientRef.current?.dispose();
    clientRef.current = null;
  }, []);

  const hide = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    calls.current += 1;
    setHeld(null);
  }, []);

  const show = useCallback((turn: number) => {
    if (!endgame) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const call = ++calls.current;
    const { loser: side } = endgame;
    const update = (change: (run: WinPathsRun) => WinPathsRun) => setHeld(current => (current && current.call === call ? { ...current, run: change(current.run) } : current));
    setHeld({ replayId, call, run: { turn, side, steps: [], status: 'positioning' } });
    const request = winPathsRequest({
      side, turn, result: graph.results[turn - 1], analysis: analyses?.[turn - 1],
      tera: effectiveTera, sleepClause: effectiveSleepClause, ruleset: effectiveRuleset,
    });
    void (async () => {
      try {
        const position = await makeReplayAcquire(turn)(() => {});
        if (controller.signal.aborted) return;
        update(run => ({ ...run, status: 'searching' }));
        clientRef.current ??= new EvalWorkerClient();
        await clientRef.current.winPaths(position, request, effectiveRuleset, {
          signal: controller.signal,
          onStep: step => update(run => ({ ...run, steps: [...run.steps, step] })),
        });
        update(run => ({ ...run, status: 'done' }));
      } catch {
        if (!controller.signal.aborted) update(run => ({ ...run, status: 'failed' }));
      }
    })();
  }, [endgame, replayId, graph.results, analyses, effectiveTera, effectiveSleepClause, effectiveRuleset, makeReplayAcquire]);

  const playedLabel = useCallback((turn: number) => (endgame ? analyses?.[turn - 1]?.[endgame.loser].played?.label ?? null : null), [endgame, analyses]);
  const run = held && held.replayId === replayId ? held.run : null;
  return useMemo(() => ({ endgame, run, unavailable, playedLabel, show, hide }), [endgame, run, unavailable, playedLabel, show, hide]);
}
