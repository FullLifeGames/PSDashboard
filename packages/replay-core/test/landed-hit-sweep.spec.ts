import { registerLandedHitSweep } from './landed-hit-sweep-body';

/**
 * Part 1 of 3 of the landed-hit sweep (D9b, #125; the sweep is described in `landed-hit-sweep-body.ts`): the Champions mod, Generation 5 and Generation 3,
 * and the powder check, which reads no realm. Parts 2 and 3 are `landed-hit-sweep-2.spec.ts` and `landed-hit-sweep-3.spec.ts`; the three together play every
 * realm once, about 1,500 seconds each under `DICE_SWEEPS=full`.
 */
registerLandedHitSweep(['Champions mod', 'Generation 5', 'Generation 3'], true);
