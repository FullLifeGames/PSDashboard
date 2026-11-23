/** The dice seed every reconstruction and new game starts on unless the caller names another. It lives alone because the app's start page reads it: a module that imports the battle runtime would pull that runtime into the start load. */
export const DEFAULT_GAME_SEED = '1,2,3,4';
