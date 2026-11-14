import type { WinStep } from '@fulllifegames/eval-engine';

/**
 * Round 89 (#130, G8b): what the Game review and the turn card need of the win-path job. The job runs on a worker of its own, one at
 * a time; `run` is the one the panel shows (the turn the user asked for), with the steps that have arrived.
 */
export type WinPathsSide = 'p1' | 'p2';

export interface WinPathsRun {
  turn: number;
  side: WinPathsSide;
  /** The steps that have arrived, in the order of the job. */
  steps: WinStep[];
  /** `positioning`: the position of the turn is being rebuilt; `searching`: the worker runs; then `done` or `failed` (the job itself broke). */
  status: 'positioning' | 'searching' | 'done' | 'failed';
}

export interface WinPathsHost {
  /** The side that lost and the turns its endgame holds (three bodies or fewer at the turn's start), in order; null without a loser or an endgame. */
  endgame: { loser: WinPathsSide; turns: number[] } | null;
  /** The search the panel shows; null when none is open. */
  run: WinPathsRun | null;
  /** Why the search cannot start now (the sets are still loading); null when it can. */
  unavailable: string | null;
  /** The label of the choice the loser played at a turn, when the log shows it. */
  playedLabel(turn: number): string | null;
  /** Search the turn for the loser (a turn of the endgame). */
  show(turn: number): void;
  /** Close the panel and stop the search. */
  hide(): void;
}
