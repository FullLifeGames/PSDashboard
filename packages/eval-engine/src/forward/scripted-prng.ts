import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';

/**
 * Round 43: the simulator's dice on demand. A scripted PRNG answers the
 * rolls of ONE named move (side + move id) the way a script says, so an
 * outcome class the seeds never showed (the 5% miss, the crit-only
 * knock-out) can be drawn directly instead of chased with probe seeds.
 * The sim's own call sites pin the interception: hitStepAccuracy rolls
 * randomChance(accuracy, 100) once per target, getDamage rolls
 * randomChance(1, critMult) with denominators 24/16/8/4/3/2, randomizer
 * rolls random(16), and speedSort shuffles tied actions via prng.shuffle.
 * Everything the script does not name delegates to the seed, and the log
 * still decides the class (classifyChild), so a script is a request, not
 * a promise.
 */
export interface RollScript {
  /** The accuracy roll: true connects, false misses. */
  hit?: boolean;
  /** The critical-hit roll. */
  crit?: boolean;
  /** The damage roll random(16): 0 is the maximum roll, 15 the minimum (randomizer: base × (100 − roll) / 100). */
  roll?: number;
  /** Speed tie: the side whose move acts first. */
  first?: 'p1' | 'p2';
}

/** Scripts keyed `${sideId}:${moveId}`, e.g. `p1:thunder`. */
export type RollScripts = ReadonlyMap<string, RollScript>;

const CRIT_DENOMINATORS = new Set([24, 16, 8, 4, 3, 2]);

interface Answered { accuracy: boolean; crit: boolean; roll: boolean }
interface MoveLike { choice?: string; pokemon?: { side: { id: string } } }

/** Every item of the range is a move action with an acting Pokémon (speedSort's tie shuffle). */
function isMoveRange(items: unknown[], start: number, end: number): boolean {
  if (end - start < 2) return false;
  for (let index = start; index < end; index++) {
    const action = items[index] as MoveLike | undefined;
    if (!action || action.choice !== 'move' || !action.pokemon) return false;
  }
  return true;
}

export class ScriptedPRNG extends PRNG {
  private battle: Battle | null = null;
  private readonly scripts: RollScripts;
  private readonly answered = new WeakMap<object, Answered>();
  private delegating = false;

  constructor(seed: PRNGSeed, scripts: RollScripts) {
    super(seed);
    this.scripts = scripts;
  }

  attach(battle: Battle): void {
    this.battle = battle;
  }

  /** The script and the answer state of the move the sim is executing, when one is scripted. */
  private active(): { script: RollScript; state: Answered } | null {
    const move = this.battle?.activeMove;
    const pokemon = this.battle?.activePokemon;
    if (!move || !pokemon) return null;
    const script = this.scripts.get(`${pokemon.side.id}:${move.id}`);
    if (!script) return null;
    let state = this.answered.get(move);
    if (!state) {
      state = { accuracy: false, crit: false, roll: false };
      this.answered.set(move, state);
    }
    return { script, state };
  }

  override randomChance(numerator: number, denominator: number): boolean {
    const hit = this.active();
    if (hit) {
      const { script, state } = hit;
      if (denominator === 100 && !state.accuracy) {
        state.accuracy = true;
        if (script.hit !== undefined) return script.hit;
      } else if (numerator === 1 && CRIT_DENOMINATORS.has(denominator) && !state.crit) {
        state.crit = true;
        if (script.crit !== undefined) return script.crit;
      }
    }
    return this.delegate(() => super.randomChance(numerator, denominator));
  }

  override random(from?: number, to?: number): number {
    if (!this.delegating && from === 16 && to === undefined) {
      const hit = this.active();
      if (hit && !hit.state.roll) {
        hit.state.roll = true;
        if (hit.script.roll !== undefined) return hit.script.roll;
      }
    }
    return super.random(from, to);
  }

  override sample<T>(items: readonly T[]): T {
    return this.delegate(() => super.sample(items));
  }

  override shuffle<T>(items: T[], start = 0, end = items.length): void {
    const wanted = this.firstSide();
    if (wanted && isMoveRange(items, start, end)) {
      const rank = (item: T) => ((item as MoveLike).pokemon?.side.id === wanted ? 0 : 1);
      const ordered = [...items.slice(start, end)].sort((a, b) => rank(a) - rank(b));
      ordered.forEach((item, index) => { items[start + index] = item; });
      return;
    }
    this.delegate(() => super.shuffle(items, start, end));
  }

  /** The base class reaches random() from randomChance/sample/shuffle; those inner calls must not be read as the damage roll. */
  private delegate<R>(call: () => R): R {
    this.delegating = true;
    try {
      return call();
    } finally {
      this.delegating = false;
    }
  }

  private firstSide(): 'p1' | 'p2' | undefined {
    for (const script of this.scripts.values()) if (script.first) return script.first;
    return undefined;
  }
}
