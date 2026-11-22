/**
 * Feature flags (round 89, ruling 49): two features of release 1.2.0 are built and tested but ship switched off, and return in 1.2.1.
 * This module owns both flags; every other place asks it.
 *
 * Both flags are OFF in every build (dev server, nightly, release). A build turns one on through a Vite env variable, read when the
 * app starts: `VITE_FEATURE_GAME_REVIEW=1` and `VITE_FEATURE_OPPONENT_READS=1` (also `true`). Any other value, or none, is off.
 *
 * - Game review: the section "Game review · what the engine would have played" under the game report, the marks it puts on the game
 *   graph and the legend of those marks. Off: none of them is drawn and no text names the section. The early-lines stage after the
 *   game report still runs, because the turn card's Lines fold reads the lines it keeps.
 * - Opponent reads my move: the Setup checkbox, the note "Opponent reads your move" with "Turn off" in the turn dock, and the
 *   `hardMode` preference behind them. Off: the checkbox and the note are not drawn, a `hardMode: true` stored by an earlier
 *   nightly is ignored (the app reads the preference as unset and keeps the stored value as it was), and the opponent plays its
 *   top choice everywhere.
 *
 * The flags are functions, not constants, so a spec can switch one with `vi.stubEnv`. The vitest config and `scripts/run-e2e.mjs`
 * switch both on for the existing specs of the two features.
 */
const on = (value: unknown): boolean => value === '1' || value === 'true';

/** The Game review section, its graph marks and the marks' legend. */
export const gameReviewEnabled = (): boolean => on(import.meta.env.VITE_FEATURE_GAME_REVIEW);

/** The Setup checkbox "Opponent reads my move" and everything that reads `EvalPreferences.hardMode`. */
export const opponentReadsEnabled = (): boolean => on(import.meta.env.VITE_FEATURE_OPPONENT_READS);
