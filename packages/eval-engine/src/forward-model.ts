/**
 * The forward model's facade: positions, serialization, legal choices, and
 * seeded advances live in forward/; this module keeps the public names.
 */

export { deserializeBattleExact, restoreSideInvariants, serializeBattleStable } from './forward/serialize.ts';
export { createRootPosition, positionBattle } from './forward/position.ts';
export type { ChoiceOption, SimPosition } from './forward/position.ts';
export { legalChoices } from './forward/choices.ts';
export { advancePosition, advancePositionWithLog, trialAdvanceLog } from './forward/advance.ts';
