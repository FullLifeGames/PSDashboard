import type { Battle } from '@pkmn/sim';
import { recognize } from './recognize.ts';
import type { DieName, Draw } from './types.ts';
import { watchBattle, type BattleWatch } from './watch.ts';

/** Names a scripted PRNG's draws by the simulator's own hook (ADR 0002); the name reads the state, never the value. */
export class DrawNamer {
  private watch: BattleWatch | null;

  constructor(battle: Battle) {
    this.watch = watchBattle(battle);
  }

  /** null when nothing names the draw, or after `release()`. */
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
