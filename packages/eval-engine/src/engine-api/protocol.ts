/** The version string of the engine protocol (ENGINES.md); every value on the wire is a win expectation on [-1, 1], and a change that breaks an engine gets a new string. */
export const ENGINE_PROTOCOL = 'ps-dashboard-engine/1' as const;

/** One legal choice of a side. */
export interface EngineOption {
  /** The dashboard's id of the choice; the response names choices by it. */
  id: string;
  /** What the dashboard shows: "Close Combat", "→ Mandibuzz", "U-turn → Kyurem". */
  label: string;
  /**
   * The choice as a Showdown client sends it ("move closecombat", "switch 5", in doubles
   * "move 1 1 terastallize, move 2 -1").
   */
  command: string;
  /** A pivot move's switch-in ("switch 3" after U-turn), sent when the simulator asks for it. */
  then?: string;
}

/** What the dashboard sends an engine: the position (the spectator log and each side's request for a bot, the whole battle in `state` for a simulator engine) and its options. */
export interface EngineRequest {
  protocol: typeof ENGINE_PROTOCOL;
  /** The game's format as Showdown names it (the replay's): "gen9ou", "gen9vgc2026regi", "gen9championsvgc2026regmb". */
  format: string;
  /**
   * The format the simulator state runs on: the dashboard rebuilds VGC and Doubles OU games as
   * "genNdoublesou", Champions games on the Champions formats, an unknown singles format as a custom game.
   */
  simFormat: string;
  gen: number;
  gameType: 'singles' | 'doubles';
  /** The turn about to be played (the log's last |turn| line). */
  turn: number;
  /** The battle log up to this position as a spectator sees it: protocol lines, no hidden information. */
  log: string[];
  /** Each side's request as the simulator sends it to that player (the |request| JSON), null when the side has nothing to choose. */
  requests: { p1: unknown | null; p2: unknown | null };
  /** The legal options the dashboard considers for each side; the response values exactly these. */
  options: { p1: EngineOption[]; p2: EngineOption[] };
  /**
   * The whole battle as @pkmn/sim serializes it (State.serialize): both teams as the dashboard
   * built them from the replay and Smogon's sets, the field, the PRNG.
   */
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
  /**
   * Optional: the value of every pair of options from p1's side, rows in the order of `p1`, columns
   * in the order of `p2`. With it the dashboard solves the game as for its own engine: floors,
   * punishers, the equilibrium and reads. Without it the analysis shows values and verdict tiers.
   */
  matrix?: { p1: string[]; p2: string[]; values: number[][] };
  /** Optional: the build that answered; the dashboard records the version with the result (EvalResult.engine). */
  engine?: { name?: string; version?: string };
}
