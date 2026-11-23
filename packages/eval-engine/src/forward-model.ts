// The forward model's facade: the public names of forward/.

export { deserializeBattleExact, restoreSideInvariants, serializeBattleStable } from './forward/serialize.ts';
export { createRootPosition, positionBattle } from './forward/position.ts';
export type { ChoiceOption, SimPosition } from './forward/position.ts';
export { legalChoices } from './forward/choices.ts';
export { advancePosition, advancePositionWithLog, trialAdvanceLog } from './forward/advance.ts';
