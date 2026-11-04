import type { Battle } from '@pkmn/sim';
import { recognize } from './recognize.ts';
import type { DieName, Draw } from './types.ts';
import { watchBattle, type BattleWatch } from './watch.ts';

/**
 * Round 86 (the engine reads the dice), T299: the module's naming for a PRNG that is not a forced turn's. The tree's scripted
 * PRNGs (`forward/scripted-prng.ts`, `pair/prng.ts`) ask a namer which die a draw is, by the simulator's own hook
 * (docs/adr/0002), instead of reading the numbers of the call. A namer owns one watch on one battle and calls `recognize` and
 * `settle` the way `dice/prng.ts` does, so the two name every draw alike.
 *
 * The PRNG asks exactly once per call of the simulator (a chance, a sample, a shuffle, a bare draw), also for a draw it answers
 * itself: a skipped draw would leave the watch's queue of secondary entries behind the stream. It asks before it draws; the
 * name reads the battle's state and never the value.
 *
 * `release()` puts the battle back as it was; a draw after it has no name, so a PRNG that outlives its turn answers from the stream.
 */
export class DrawNamer {
  private watch: BattleWatch | null;

  constructor(battle: Battle) {
    this.watch = watchBattle(battle);
  }

  /** The die of this draw, or null when nothing names it (or the namer was released). */
  name(draw: Draw): DieName | null {
    const watch = this.watch;
    if (!watch) return null;
    const name = recognize(draw, watch, watch.battle.gen);
    watch.settle();
    return name;
  }

  release(): void {
    this.watch?.uninstall();
    this.watch = null;
  }
}
