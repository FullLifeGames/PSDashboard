/**
 * Lazy-load boundary: the app reaches this module through import() so it
 * stays out of the entry chunk. Re-exports only; the package barrel is the API.
 */
// The damage judge travels with the inference: the infos it reads and the judge arrive in one load (T130).
export { inferOpponentTeam, judgeItemsByDamage } from '@fulllifegames/replay-core';
