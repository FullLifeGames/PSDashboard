/**
 * Lazy-load boundary: the app reaches this module through import() so it
 * stays out of the entry chunk. Re-exports only; the package barrel is the API.
 */
export { serializeLiveBattle } from '@fulllifegames/eval-engine';
