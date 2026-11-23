import type { WinStep } from '@fulllifegames/eval-engine';

/**
 * What the Game review and the turn card need of the win-path job: it runs on a worker of its own, one at a time; `run` is the one the
 * panel shows, with the steps that have arrived.
 */
export type WinPathsSide = 'p1' | 'p2';

export type WinPathsFrom = 'card' | 'review';

export interface WinPathsRun {
  turn: number;
  side: WinPathsSide;
  steps: WinStep[];
  /** `positioning`: the position of the turn is being rebuilt; `searching`: the worker runs; then `done` or `failed` (the job itself broke). */
  status: 'positioning' | 'searching' | 'done' | 'failed';
  from: WinPathsFrom;
}

export interface WinPathsHost {
  /** The side that lost and the turns its endgame holds (three bodies or fewer at the turn's start), in order; null without a loser or an endgame. */
  endgame: { loser: WinPathsSide; turns: number[] } | null;
  run: WinPathsRun | null;
  /** Why the search cannot start now (the sets are still loading); null when it can. */
  unavailable: string | null;
  /** The label of the choice the loser played at a turn, when the log shows it. */
  playedLabel(turn: number): string | null;
  /** The loser was knocked out before it moved at a turn: its `playedLabel` is a stand-in, not a choice the log shows. */
  playedNeverActed?(turn: number): boolean;
  show(turn: number, from: WinPathsFrom): void;
  hide(): void;
}
