import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EvalLine, EvalPreferences, EvalResult, EvalSettings, StaticRuleset, TeraAllowance, TurnAnalysis } from '@fulllifegames/eval-engine';
import { earlyLineJobs, earlyLineProgress, earlyLineSettings } from '../components/eval/early-lines';
import type { EvalGraphState } from './evaluation/graph-sweep';
import { keptPlayed } from './evaluation/sweep-core';

export interface EarlyLinesInputs {
  replayId: string | null;
  /** The report's per-turn analyses; null until the report exists. */
  analyses: readonly (TurnAnalysis | null)[] | null;
  graph: EvalGraphState;
  /** Only Auto and the tree's own turns reach this stage; an explicit matrix mode keeps the user's choice. */
  prefsMode: EvalPreferences['mode'];
  tera: TeraAllowance;
  sleepClause?: boolean;
  ruleset: StaticRuleset;
  /** One tree search on the shared pool; rejects with "cancelled" when anything cancels the pool. */
  searchLines(position: string, settings: EvalSettings & { ruleset: StaticRuleset }): Promise<EvalLine[]>;
  /** Writes the lines into the stored result `base` of `turn`; false when the result moved on. */
  attachLines(turn: number, base: EvalResult, lines: EvalLine[], cacheKey: string): boolean;
  cancel(): void;
  positionFor(turn: number): Promise<string>;
  cacheKeyFor(turn: number): string;
}

export interface EarlyLinesProgress { done: number; total: number; stop(): void }

/** What a turn without lines waits for: the stage that searches it after the report, or the unfinished sweep. */
export type LineComing = 'stage' | 'sweep' | null;

const isCancelled = (error: unknown): boolean => error instanceof Error && error.message === 'cancelled';

async function searchTurns(inputs: { current: EarlyLinesInputs }, signal: AbortSignal): Promise<void> {
  const turns = earlyLineJobs({ analyses: inputs.current.analyses, results: inputs.current.graph.results, settings: inputs.current.graph.settings }).map(job => job.turn);
  for (const turn of turns) {
    if (signal.aborted) return;
    const now = inputs.current;
    const base = now.graph.results[turn - 1];
    const job = earlyLineJobs({ analyses: now.analyses, results: now.graph.results, settings: now.graph.settings }).find(entry => entry.turn === turn);
    if (!base || !job) continue;
    try {
      const position = await now.positionFor(turn);
      if (signal.aborted) return;
      const settings = earlyLineSettings(job, { tera: now.tera, sleepClause: now.sleepClause, ruleset: now.ruleset, keepPlayed: keptPlayed(now.graph.played[turn - 1] ?? null) });
      const lines = await now.searchLines(position, settings);
      if (signal.aborted) return;
      inputs.current.attachLines(turn, base, lines, now.cacheKeyFor(turn));
    } catch (error) {
      if (signal.aborted || isCancelled(error)) return;
    }
  }
}

/** After the report, one tree search per graded turn keeps only `lines`; score, grade and ranking stay the sweep's. */
export function useEarlyLines(inputs: EarlyLinesInputs): { progress: EarlyLinesProgress | null; lineComing: (turn: number) => LineComing } {
  const { replayId, analyses, graph, prefsMode } = inputs;
  const latest = useRef(inputs);
  useEffect(() => {
    latest.current = inputs;
  });
  const [running, setRunning] = useState(false);
  const [finishedFor, setFinishedFor] = useState<string | null>(null);
  const enabled = replayId !== null && prefsMode === 'auto' && analyses !== null && !graph.running;
  const pending = enabled && earlyLineJobs({ analyses, results: graph.results, settings: graph.settings }).length > 0;
  if (!pending && finishedFor !== null) setFinishedFor(null);
  const active = pending && finishedFor !== replayId;

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setRunning(true);
      await searchTurns(latest, controller.signal);
      if (!controller.signal.aborted) {
        setRunning(false);
        setFinishedFor(replayId);
      }
    })();
    return () => controller.abort();
  }, [pending, replayId]);

  const counts = useMemo(() => earlyLineProgress({ analyses, results: graph.results, settings: graph.settings }), [analyses, graph.results, graph.settings]);
  // The feedback harness waits for the stage before its dump (`test/e2e-feedback/sweep-wait.ts`).
  useEffect(() => {
    (window as Window & { __psEarlyLines?: unknown }).__psEarlyLines = { active, done: counts.done, total: counts.total };
  }, [active, counts.done, counts.total]);
  const stop = inputs.cancel;
  const progress = useMemo(() => (pending && running ? { ...counts, stop } : null), [pending, running, counts, stop]);
  const searching = useMemo(
    () => (active ? new Set(earlyLineJobs({ analyses, results: graph.results, settings: graph.settings }).map(job => job.turn)) : null),
    [active, analyses, graph.results, graph.settings],
  );
  const sweeping = replayId !== null && prefsMode === 'auto' && graph.running;
  const lineComing = useCallback((turn: number): LineComing => {
    if (searching?.has(turn)) return 'stage';
    return sweeping && graph.settings[turn - 1]?.mode === 'matrix' ? 'sweep' : null;
  }, [searching, sweeping, graph.settings]);
  return { progress, lineComing };
}
