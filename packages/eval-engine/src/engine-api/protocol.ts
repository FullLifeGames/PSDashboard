/** The engine protocol version (ENGINES.md); wire values are win expectations on [-1, 1]; a break gets a new string. */
export const ENGINE_PROTOCOL = 'ps-dashboard-engine/1' as const;

/** One legal choice of a side. */
export interface EngineOption {
  /** The dashboard's id of the choice; the response names choices by it. */
  id: string;
  label: string;
  /** As a Showdown client sends it: "move closecombat", "switch 5", in doubles "move 1 1 terastallize, move 2 -1". */
  command: string;
  /** A pivot move's switch-in ("switch 3" after U-turn), sent when the simulator asks for it. */
  then?: string;
}

/** What the dashboard sends an engine: the position (`log`, `requests` for a bot; `state` for a simulator), options. */
export interface EngineRequest {
  protocol: typeof ENGINE_PROTOCOL;
  /** The replay's format as Showdown names it: "gen9ou", "gen9vgc2026regi", "gen9championsvgc2026regmb". */
  format: string;
  /** The format `state` runs on: "genNdoublesou" for VGC and Doubles OU, Champions formats, custom if unknown. */
  simFormat: string;
  gen: number;
  gameType: 'singles' | 'doubles';
  /** The turn about to be played (the log's last |turn| line). */
  turn: number;
  /** The battle log up to this position as a spectator sees it: protocol lines, no hidden information. */
  log: string[];
  /** Each side's |request| JSON as the simulator sends it to that player; null when the side has nothing to choose. */
  requests: { p1: unknown | null; p2: unknown | null };
  /** The legal options the dashboard considers for each side; the response values exactly these. */
  options: { p1: EngineOption[]; p2: EngineOption[] };
  /** The whole battle as @pkmn/sim serializes it (State.serialize): teams as built, field, PRNG. */
  state: string;
  /** How long the dashboard waits for the answer, in milliseconds. */
  budgetMs: number;
}

/** What an engine answers: the position's value and a value for every option, optionally the matrix of option pairs. */
export interface EngineResponse {
  protocol: typeof ENGINE_PROTOCOL;
  /** The position's value from p1's side. */
  score: number;
  /** A value for every option of both sides, each from its own side's view. */
  values: { p1: Record<string, number>; p2: Record<string, number> };
  /** Optional: every option pair's value from p1's side, rows in `p1` order, columns in `p2` order. */
  matrix?: { p1: string[]; p2: string[]; values: number[][] };
  /** Optional: the build that answered; the dashboard records the version with the result (EvalResult.engine). */
  engine?: { name?: string; version?: string };
}
