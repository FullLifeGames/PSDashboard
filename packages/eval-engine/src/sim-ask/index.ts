/**
 * Round 72 (T239): the one module that asks the simulator. A stand-in factory per format (`twinBattle`, `twinFormat`),
 * copy-and-play with fixed dice (`copyOf`, `FixedDice`, `playOnCopy`), a handler call with a throwaway `this`
 * (`callHandler`, `isolated`), whether a protector stops a hit (`protectorStops`), the speed tie of two actions (`actionsTie`), the priority and speed of one (`actionPriority`, `queuePlace`, `activated`) and the development check that proves the live battle unchanged (`fingerprint`,
 * `setAskCheck`). Not part of the package barrel: the engine's own files import it.
 */
export { askCheckOn, AskLeak, fingerprint, guarded, setAskCheck } from './guard.ts';
export { copyOf, FixedDice, playOnCopy } from './copy.ts';
export type { DiceSpec } from './copy.ts';
export { queuePlace, actionPriority, actionsTie, activated } from './action-order.ts';
export type { ActionAsk, QueuePlace } from './action-order.ts';
export { callHandler } from './handler.ts';
export type { HandlerResult } from './handler.ts';
export { bodyInView, isolated, NeedsMore } from './isolated.ts';
export { protectorStops } from './protector.ts';
export { twinBattle, twinFormat } from './twin.ts';
