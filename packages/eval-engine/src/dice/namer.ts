import type { Battle } from '@pkmn/sim';
import { recognize } from './recognize.ts';
import type { DieName, Draw } from './types.ts';
import { watchBattle, type BattleWatch } from './watch.ts';

/**
 * Names the draws of a scripted PRNG (the tree's `forward/scripted-prng.ts`, `pair/prng.ts`) by the simulator's own hook (ADR 0002), the way
 * `dice/prng.ts` does. The PRNG asks once per simulator call, also for a draw it answers itself (a skipped draw leaves the watch's queue of
 * secondary entries behind the stream), and before it draws: the name reads the battle's state, never the value. After `release()` a draw has no name.
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
