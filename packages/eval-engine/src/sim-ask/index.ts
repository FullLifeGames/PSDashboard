// The one module that asks the simulator; not in the package barrel.
export { askCheckOn, AskLeak, fingerprint, guarded, setAskCheck } from './guard.ts';
export { copyOf, FixedDice, playOnCopy } from './copy.ts';
export { queuePlace, actionPriority, actionsTie, activated } from './action-order.ts';
export { aimThatFailsAsLogged, hidesItsTarget } from './hidden-aim.ts';
export { callHandler } from './handler.ts';
export { bodyInView, isolated } from './isolated.ts';
export { protectorStops } from './protector.ts';
export { twinBattle, twinFormat } from './twin.ts';
export { firstTurnOnly, refusedByBody } from './own-state.ts';
