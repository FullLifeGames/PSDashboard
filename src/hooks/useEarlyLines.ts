import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EvalLine, EvalPreferences, EvalResult, EvalSettings, StaticRuleset, TeraAllowance, TurnAnalysis } from '@fulllifegames/eval-engine';
import { earlyLineJobs, earlyLineProgress, earlyLineSettings } from '../components/eval/early-lines';
import type { EvalGraphState } from './evaluation/graph-sweep';
import { keptPlayed } from './evaluation/sweep-core';

export interface EarlyLinesInputs {
  replayId: string | null;
  /** The report's own per-turn analyses (`gameAnalyses`); null until the report exists. */
  analyses: readonly (TurnAnalysis | null)[] | null;
  graph: EvalGraphState;
  /** The engine preference: only Auto and the tree's own turns reach this stage (an explicit matrix mode keeps the user's choice). */
  prefsMode: EvalPreferences['mode'];
  tera: TeraAllowance;
  sleepClause?: boolean;
  ruleset: StaticRuleset;
  /** One tree search on the shared pool; resolves with the lines it kept. Rejects with "cancelled" when anything cancels the pool. */
  searchLines(position: string, settings: EvalSettings & { ruleset: StaticRuleset }): Promise<EvalLine[]>;
  /** Writes the lines into the stored result `base` of `turn` (graph, memory and store); false when the result moved on. */
  attachLines(turn: number, base: EvalResult, lines: EvalLine[], cacheKey: string): boolean;
  cancel(): void;
  positionFor(turn: number): Promise<string>;
  cacheKeyFor(turn: number): string;
}

export interface EarlyLinesProgress { done: number; total: number; stop(): void }

/** What a turn without lines waits for: the stage that searches it after the report, or the sweep that has not ended (lines may follow). */
export type LineComing = 'stage' | 'sweep' | null;

const isCancelled = (error: unknown): boolean => error instanceof Error && error.message === 'cancelled';

/** The turns one after the other: a search already fans out to the whole pool, so a second one would only slow the first. */
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
      // a cancelled pool ends the stage; a turn whose search failed stays without lines and the next turn goes on
      if (signal.aborted || isCancelled(error)) return;
    }
  }
}

/**
 * After the game report this stage runs one tree search per graded turn and keeps only `lines` (score, grade and ranking stay the
 * sweep's), because early singles turns run the matrix, which keeps no lines. The search carries the line pass (extra iterations aimed
 * at the rows the card shows); the stage covers the tree turns of singles and every turn of doubles and VGC. Auto mode only. A new
 * sweep, a new replay and a Stop end the stage; the next analysis picks up the turns without the pass.
 */
export function useEarlyLines(inputs: EarlyLinesInputs): { progress: EarlyLinesProgress | null; lineComing: (turn: number) => LineComing } {
  const { replayId, analyses, graph, prefsMode } = inputs;
  const latest = useRef(inputs);
  useEffect(() => {
    latest.current = inputs;
  });
  const [running, setRunning] = useState(false);
  // The turn loop has ended for this replay (all turns done, a failed turn skipped, a Stop): `pending` may stay true for the turns left.
  const [finishedFor, setFinishedFor] = useState<string | null>(null);
  const enabled = replayId !== null && prefsMode === 'auto' && analyses !== null && !graph.running;
  const pending = enabled && earlyLineJobs({ analyses, results: graph.results, settings: graph.settings }).length > 0;
  // A new sweep or a new analysis starts the stage afresh: reconciled during render, never in an effect.
  if (!pending && finishedFor !== null) setFinishedFor(null);
  const active = pending && finishedFor !== replayId;

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    void (async () => {
      // the first await keeps the state write out of the effect's own body
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
  // The feedback harness waits for the stage before it takes its dump (`test/e2e-feedback/sweep-wait.ts`): the stage starts the
  // moment the sweep ends, so a dump at any other point holds the lines of however many turns it had reached.
  useEffect(() => {
    (window as Window & { __psEarlyLines?: unknown }).__psEarlyLines = { active, done: counts.done, total: counts.total };
  }, [active, counts.done, counts.total]);
  const stop = inputs.cancel;
  const progress = useMemo(() => (pending && running ? { ...counts, stop } : null), [pending, running, counts, stop]);
  // The card of a turn the stage is about to search says so instead of sending the user to analyze it again.
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
