/**
 * The dice seed every reconstruction and every new game starts on unless the caller names another. It lives in a module of its
 * own: the app's start page reads it (the saved game's record), and a module that imports the battle runtime would put that
 * runtime into the start load (round 89, CI run 43380926565; `test/regression/start-load-graph.spec.ts`).
 */
export const DEFAULT_GAME_SEED = '1,2,3,4';
