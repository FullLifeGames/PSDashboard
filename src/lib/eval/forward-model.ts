/**
 * The forward model's facade: positions, serialization, legal choices, and
 * seeded advances live in forward/; this module keeps the public names.
 */

export { deserializeBattleExact, serializeBattleStable } from './forward/serialize';
export { createRootPosition, positionBattle } from './forward/position';
export type { ChoiceOption, SimPosition } from './forward/position';
export { legalChoices } from './forward/choices';
export { advancePosition, advancePositionWithLog, trialAdvanceLog } from './forward/advance';
export type { TrialAdvanceResult } from './forward/advance';
