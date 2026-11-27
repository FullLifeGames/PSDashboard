import type { StaticRuleset } from '../../score/weights.ts';
import type { EvalLine, TeraAllowance } from '../../types.ts';

/** The work a win-path step may spend: `cells` are matrix cells of the first choice, `turns` simulator turns. */
export interface WinBudget { cells: number; turns: number }

/** What the step asks of the engine: the side that lost, the turns to look ahead and the simulator's rules. */
export interface WinPathsRequest {
  side: 'p1' | 'p2';
  /** The turn the position starts (the answer's label; no rule reads it). */
  turn?: number;
  /** The turns a path may take (default 3); a replacement after a faint or a pivot is a step, not a turn. */
  turns?: number;
  /** The turn's ranking of the side, best first (choice strings). */
  rootOrder?: string[];
  /** The choice the side played at the turn (a choice string), when the log shows it. */
  played?: string;
  /** The engine's first choice at the root by side; a side without one takes the one-turn matrix's. */
  first?: { p1?: string; p2?: string };
  /** The opponent's ranking at the root, best first (choice, value from its own view); else the matrix. */
  foeRanking?: { choice: string; ev: number }[];
  tera?: TeraAllowance;
  sleepClause?: boolean;
  ruleset?: StaticRuleset;
  budget?: Partial<WinBudget>;
  /** Proof mode: the stronger step alone, trying `choice` (a sure strike the search's list lacks) first. */
  proof?: { choice?: string };
  /** The chance below which a luck path is not searched (default 1 in 1,000). */
  floor?: number;
}

/** One answer of a win-path step. */
export interface WinStep {
  kind: 'stronger' | 'luck' | 'mistake';
  /** found: a win in the turns asked; none: all paths above the floor searched; stopped: budget out, `line` partial. */
  status: 'found' | 'none' | 'stopped' | 'failed';
  line?: EvalLine;
  /** For `found`: the chance of the line's dice (`luck`) or the mass a proof gives (`stronger`). */
  chance?: number;
  played?: number;
  deviation?: { turn: number; label: string; rank: number };
  /** For `failed`: the technical message, never a line of the app. */
  error?: string;
  spent: { cells: number; turns: number };
}

/** The steps of the win-path job for one side at one turn. */
export interface WinPaths { side: 'p1' | 'p2'; turn: number; steps: WinStep[] }
