/**
 * The two feature flags, off in every build unless a Vite env variable turns one on (`VITE_FEATURE_GAME_REVIEW=1`,
 * `VITE_FEATURE_OPPONENT_READS=1`, also `true`). They are functions so a spec can switch one with `vi.stubEnv`.
 */
const on = (value: unknown): boolean => value === '1' || value === 'true';

/** The Game review section, its graph marks and their legend; the early-lines stage still runs when it is off (the turn card's Lines fold reads it). */
export const gameReviewEnabled = (): boolean => on(import.meta.env.VITE_FEATURE_GAME_REVIEW);

/** The Setup checkbox "Opponent reads my move" and everything that reads `EvalPreferences.hardMode`; off, a stored `hardMode: true` reads as unset. */
export const opponentReadsEnabled = (): boolean => on(import.meta.env.VITE_FEATURE_OPPONENT_READS);
