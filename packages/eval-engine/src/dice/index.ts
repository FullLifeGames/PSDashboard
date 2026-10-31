/**
 * Round 82 (forced dice): the dice module's barrel. The package barrel exports it in step A6; the app loads it with a
 * dynamic import only when a branch turn carries a forced die (decision D11).
 */
export { answerDie, type Answered } from './answer.ts';
export { playForcedTurn, type ForcedTurnInput } from './play.ts';
export { ForcedDicePRNG, RecordingPRNG, type DieNote } from './prng.ts';
export { genShape, recognize } from './recognize.ts';
export {
  dieKey,
  type Answer, type DiceReport, type DieKind, type DieName, type DieReport, type DieResult, type DieTook, type Draw,
  type ForcedDie, type NaturalRecord,
} from './types.ts';
export { watchBattle, type ArmedHook, type BattleWatch } from './watch.ts';
