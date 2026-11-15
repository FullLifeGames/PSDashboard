import type { StaticRuleset } from '../../score/weights.ts';
import type { EvalLine, TeraAllowance } from '../../types.ts';

/** Round 89 (#130): the types of the win paths (kept beside their module; `types.ts` is at its line limit). */

/**
 * Round 89 (#130): the work a win-path step may spend, counted and never timed, so a step answers the same on every machine. `cells`
 * are the matrix cells the engine's first choice prices (one per pair of options, `oneTurnMatrix`), `turns` the simulator turns the
 * dice search plays on copies. A step stops when either count reaches its cap.
 */
export interface WinBudget { cells: number; turns: number }

/** What the step asks of the engine: the side that lost, the turns to look ahead and the rules the simulator plays by. */
export interface WinPathsRequest {
  side: 'p1' | 'p2';
  /** The turn the position is the start of (the label of the answer, no rule reads it). */
  turn?: number;
  /** The turns a path may take (default 3); a replacement after a faint or a pivot is a step of the line and no turn. */
  turns?: number;
  /** The turn's ranking of the side, best first (choice strings): the order a stronger play tries its candidates in. */
  rootOrder?: string[];
  /** The choice the side played at the turn (a choice string), when the log shows it: the mass of a stronger play is read beside its own. */
  played?: string;
  /** The engine's first choice at the root by side (the turn's ranking's best row); a side without one takes the one-turn matrix's. */
  first?: { p1?: string; p2?: string };
  /** The opponent's ranking at the root, best first (choice string and its value from the opponent's own view): the order and the size of its mistakes. A mistake step without it reads the one-turn matrix. */
  foeRanking?: { choice: string; ev: number }[];
  tera?: TeraAllowance;
  sleepClause?: boolean;
  ruleset?: StaticRuleset;
  budget?: Partial<WinBudget>;
  /** The chance below which a luck path is not searched (gate question 4; default 1 in 1,000). */
  floor?: number;
}

/**
 * One answer of #130. `found`: the line ends in the side's win within the turns asked, with the chance of its dice (`luck`) or the
 * mass a proof gives (`stronger`); `none`: the search covered every path above the floor and found no win; `stopped`: the budget ran
 * out first (the line, if any, is the best partial path and no win). `spent` is the work the step took. The job adds `failed` (the step
 * threw; `error` is the technical message, for logs, never a line of the app).
 */
export interface WinStep {
  kind: 'stronger' | 'luck' | 'mistake';
  status: 'found' | 'none' | 'stopped' | 'failed';
  line?: EvalLine;
  chance?: number;
  played?: number;
  deviation?: { turn: number; label: string; rank: number };
  error?: string;
  spent: { cells: number; turns: number };
}

export interface WinPaths { side: 'p1' | 'p2'; turn: number; steps: WinStep[] }
