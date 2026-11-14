import { useEffect, useMemo, useRef, useState } from 'react';
import type { EvalLine, EvalPreferences, EvalResult, EvalSettings, StaticRuleset, TeraAllowance, TurnAnalysis } from '@fulllifegames/eval-engine';
import { earlyLineJobs, earlyLineProgress, earlyLineSettings } from '../components/eval/early-lines';
import type { EvalGraphState } from './evaluation/graph-sweep';
import { keptPlayed } from './evaluation/sweep-core';

/** What the stage reads of the app: the report's analyses, the graph, the evaluation's two calls and the position of a turn. */
export interface EarlyLinesInputs {
  replayId: string | null;
  /** Doubles and VGC run the tree from turn 1, so every turn already holds lines: only singles have early matrix turns. */
  doubles: boolean;
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
  /** Stops the pool's running search (the evaluation's cancel). */
  cancel(): void;
  positionFor(turn: number): Promise<string>;
  cacheKeyFor(turn: number): string;
}

export interface EarlyLinesProgress { done: number; total: number; stop(): void }

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
 * Round 89 (#104), step G13 (ruling G2b, kept by G7a): the early singles turns run the matrix, which keeps no lines. After the game
 * report (the sweep is over, the analyses exist) this stage runs one tree search per graded matrix turn and keeps only `lines` (the
 * score, the grade and the ranking of the turn stay the matrix's), so every graded turn of the Game review has its lines. Auto mode
 * and singles only; an explicit matrix mode keeps the user's choice and doubles already hold lines. A new sweep, a new replay and
 * a Stop end the stage; the next analysis picks up the turns still without lines.
 */
export function useEarlyLines(inputs: EarlyLinesInputs): { progress: EarlyLinesProgress | null } {
  const { replayId, doubles, analyses, graph, prefsMode } = inputs;
  const latest = useRef(inputs);
  useEffect(() => {
    latest.current = inputs;
  });
  const [running, setRunning] = useState(false);
  const enabled = replayId !== null && !doubles && prefsMode === 'auto' && analyses !== null && !graph.running;
  const pending = enabled && earlyLineJobs({ analyses, results: graph.results, settings: graph.settings }).length > 0;

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    void (async () => {
      // the first await keeps the state write out of the effect's own body
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setRunning(true);
      await searchTurns(latest, controller.signal);
      if (!controller.signal.aborted) setRunning(false);
    })();
    return () => controller.abort();
  }, [pending, replayId]);

  const counts = useMemo(() => earlyLineProgress({ analyses, results: graph.results, settings: graph.settings }), [analyses, graph.results, graph.settings]);
  const stop = inputs.cancel;
  const progress = useMemo(() => (pending && running ? { ...counts, stop } : null), [pending, running, counts, stop]);
  return { progress };
}
