// Off in every build unless a Vite env variable turns one on; functions, so a spec can switch one with `vi.stubEnv`.
const on = (value: unknown): boolean => value === '1' || value === 'true';

/** The Game review section; the early-lines stage still runs when it is off (the turn card's Lines fold reads it). */
export const gameReviewEnabled = (): boolean => on(import.meta.env.VITE_FEATURE_GAME_REVIEW);

/** The "Opponent reads my move" checkbox and `hardMode`; off, a stored `hardMode: true` reads as unset. */
export const opponentReadsEnabled = (): boolean => on(import.meta.env.VITE_FEATURE_OPPONENT_READS);
