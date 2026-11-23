/** Lazy-load boundary: the app reaches these re-exports through import(), so they stay out of the entry chunk. */
// The damage judge travels with the inference: the infos it reads and the judge arrive in one load.
export { inferOpponentTeam, judgeItemsByDamage } from '@fulllifegames/replay-core';
