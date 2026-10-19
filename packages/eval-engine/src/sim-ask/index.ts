/**
 * Round 72 (T239): the one module that asks the simulator. A stand-in factory per format (`twinBattle`, `twinFormat`),
 * copy-and-play with fixed dice (`copyOf`, `FixedDice`, `playOnCopy`), a handler call with a throwaway `this`
 * (`callHandler`, `isolated`) and the development check that proves the live battle unchanged (`fingerprint`,
 * `setAskCheck`). Not part of the package barrel: the engine's own files import it.
 */
export { askCheckOn, AskLeak, fingerprint, guarded, setAskCheck } from './guard.ts';
export { copyOf, FixedDice, playOnCopy } from './copy.ts';
export type { DiceSpec } from './copy.ts';
export { callHandler } from './handler.ts';
export type { HandlerResult } from './handler.ts';
export { isolated, NeedsMore } from './isolated.ts';
export { twinBattle, twinFormat } from './twin.ts';
