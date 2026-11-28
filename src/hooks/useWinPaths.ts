import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StaticRuleset, WinPathsRequest } from '@fulllifegames/eval-engine';
import type { ReplayData } from '@fulllifegames/replay-core';
import type { AppController } from './useAppController';
import { EvalWorkerClient } from '../lib/eval/worker-client';
import { endgameTurns, loserOf, offeredTurns } from '../lib/endgame-scope';
import { winPathsRequest } from '../lib/win-paths-request';
import { loadStoredWinPaths, saveStoredWinPaths, winPathsStoreKey } from '../lib/eval-cache-store';
import { turnCacheKey } from './useEvalView';
import type { WinPathsFrom, WinPathsHost, WinPathsQuestion, WinPathsRun, WinPathsSide } from '../lib/win-paths-host';

interface Held { replayId: string; call: number; run: WinPathsRun }

function useTurnScope(app: AppController, replayData: ReplayData): Pick<WinPathsHost, 'endgame' | 'offered'> {
  const { snapshots } = app.ctx.replay;
  const { analyzableTurns } = app.board.timeline;
  const { results } = app.ctx.evaluation.graph;
  const loser = useMemo(() => loserOf(replayData.log, replayData.players), [replayData.log, replayData.players]);
  return useMemo(() => {
    if (!loser) return { endgame: null, offered: null };
    const turns = endgameTurns(snapshots, analyzableTurns);
    const offered = offeredTurns(turns, results, loser);
    return { endgame: turns.length > 0 ? { loser, turns } : null, offered: offered.length > 0 ? { loser, turns: offered } : null };
  }, [loser, snapshots, analyzableTurns, results]);
}

interface Answering {
  controller: AbortController;
  update(change: (run: WinPathsRun) => WinPathsRun): void;
  client(): EvalWorkerClient;
  position(onProgress: () => void): Promise<string>;
}

async function answer(key: string, request: WinPathsRequest, ruleset: StaticRuleset, { controller, update, client, position }: Answering): Promise<void> {
  try {
    const kept = await loadStoredWinPaths(key);
    if (controller.signal.aborted) return;
    if (kept) {
      update(run => ({ ...run, steps: kept.paths.steps, status: 'done' }));
      return;
    }
    const serialized = await position(() => {});
    if (controller.signal.aborted) return;
    update(run => ({ ...run, status: 'searching' }));
    const paths = await client().winPaths(serialized, request, ruleset, {
      signal: controller.signal,
      onStep: step => update(run => ({ ...run, steps: [...run.steps, step] })),
    });
    update(run => ({ ...run, status: 'done' }));
    void saveStoredWinPaths({ key, kind: 'winPaths', paths, savedAt: Date.now() });
  } catch {
    if (!controller.signal.aborted) update(run => ({ ...run, status: 'failed' }));
  }
}

/** The win-path job of the Game review and the turn card: one search at a time, on its own worker. */
export function useWinPaths(app: AppController, replayData: ReplayData): WinPathsHost {
  const { endgame, offered } = useTurnScope(app, replayData);
  const { graph } = app.ctx.evaluation;
  const { snapshots } = app.ctx.replay;
  const { setsFingerprint } = app.ctx.knowledge;
  const analyses = app.analysis.gameAnalyses;
  const { makeReplayAcquire } = app.engine.acquire;
  const { effectiveTera, effectiveSleepClause, effectiveRuleset } = app.engine.evalView;
  const unavailable = app.engine.smogonPending ? 'Waiting for Smogon data: the position would be built without the guessed sets.' : null;

  const clientRef = useRef<EvalWorkerClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const calls = useRef(0);
  const [held, setHeld] = useState<Held | null>(null);
  const replayId = replayData.id;

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

  const proofAt = useCallback((turn: number) => {
    const forced = graph.results[turn - 1]?.forcedWin;
    return forced ? { side: forced.side, turns: forced.turns } : null;
  }, [graph.results]);

  const show = useCallback((turn: number, from: WinPathsFrom, question: WinPathsQuestion = 'lost') => {
    const side = question === 'proof' ? proofAt(turn)?.side : offered?.loser;
    if (!side) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const call = ++calls.current;
    const update = (change: (run: WinPathsRun) => WinPathsRun) => setHeld(current => (current && current.call === call ? { ...current, run: change(current.run) } : current));
    setHeld({ replayId, call, run: { turn, side, steps: [], status: 'positioning', from, question } });
    const request = winPathsRequest({
      side, turn, result: graph.results[turn - 1], analysis: analyses?.[turn - 1],
      tera: effectiveTera, sleepClause: effectiveSleepClause, ruleset: effectiveRuleset, proof: question === 'proof',
    });
    const key = winPathsStoreKey(turnCacheKey(replayId, turn, snapshots.length, setsFingerprint), effectiveRuleset, request);
    void answer(key, request, effectiveRuleset, { controller, update, client: () => (clientRef.current ??= new EvalWorkerClient()), position: makeReplayAcquire(turn) });
  }, [offered, proofAt, replayId, snapshots.length, setsFingerprint, graph.results, analyses, effectiveTera, effectiveSleepClause, effectiveRuleset, makeReplayAcquire]);

  const playedLabel = useCallback((turn: number, side: WinPathsSide) => analyses?.[turn - 1]?.[side].played?.label ?? null, [analyses]);
  const playedNeverActed = useCallback((turn: number, side: WinPathsSide) => analyses?.[turn - 1]?.[side].neverActed === true, [analyses]);
  const run = held && held.replayId === replayId ? held.run : null;
  return useMemo(() => ({ endgame, offered, run, unavailable, proofAt, playedLabel, playedNeverActed, show, hide }), [endgame, offered, run, unavailable, proofAt, playedLabel, playedNeverActed, show, hide]);
}
