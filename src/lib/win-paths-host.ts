import type { WinStep } from '@fulllifegames/eval-engine';

export type WinPathsSide = 'p1' | 'p2';

export type WinPathsFrom = 'card' | 'review';

export interface WinPathsRun {
  turn: number;
  side: WinPathsSide;
  steps: WinStep[];
  status: 'positioning' | 'searching' | 'done' | 'failed';
  from: WinPathsFrom;
}

export interface WinPathsHost {
  /** Endgame turns (three bodies or fewer) for the Game review; `offered` adds turns the loser reads behind. */
  endgame: { loser: WinPathsSide; turns: number[] } | null;
  offered: { loser: WinPathsSide; turns: number[] } | null;
  run: WinPathsRun | null;
  /** Why the search cannot start now (the sets are still loading); null when it can. */
  unavailable: string | null;
  playedLabel(turn: number): string | null;
  /** The loser was knocked out before it moved at a turn: its `playedLabel` is a stand-in, not a logged choice. */
  playedNeverActed?(turn: number): boolean;
  show(turn: number, from: WinPathsFrom): void;
  hide(): void;
}
