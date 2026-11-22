import { registerBlockedEffectsSweep } from './blocked-effects-sweep-body';

/**
 * Part 1 of 2 of the blocked-effects sweep (D9b, #125; the sweep is described in `blocked-effects-sweep-body.ts`): the Champions mod, Generation 8,
 * Generation 5 and Generation 3. Part 2 is `blocked-effects-sweep-2.spec.ts`; the two together play every realm once, about 1,500 seconds each under
 * `DICE_SWEEPS=full`.
 */
registerBlockedEffectsSweep(['Champions mod', 'Generation 8', 'Generation 5', 'Generation 3']);
