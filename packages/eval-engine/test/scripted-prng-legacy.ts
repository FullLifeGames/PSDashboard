import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import type { RollScript, RollScripts } from '../src/forward/scripted-prng';

// Frozen copy of `ScriptedPRNG` that told a draw by its numbers: do not edit.

const LEGACY_CRIT_DENOMINATORS = new Set([24, 16, 8, 4, 3, 2]);

interface LegacyAnswered { accuracy: boolean; crit: boolean; roll: boolean }
interface LegacyMoveLike { choice?: string; pokemon?: { side: { id: string } } }

function legacyIsMoveRange(items: unknown[], start: number, end: number): boolean {
  if (end - start < 2) return false;
  for (let index = start; index < end; index++) {
    const action = items[index] as LegacyMoveLike | undefined;
    if (!action || action.choice !== 'move' || !action.pokemon) return false;
  }
  return true;
}

export class LegacyScriptedPRNG extends PRNG {
  private battle: Battle | null = null;
  private readonly scripts: RollScripts;
  private readonly answered = new WeakMap<object, LegacyAnswered>();
  private delegating = false;

  constructor(seed: PRNGSeed, scripts: RollScripts) {
    super(seed);
    this.scripts = scripts;
  }

  attach(battle: Battle): void {
    this.battle = battle;
  }

  private active(): { script: RollScript; state: LegacyAnswered } | null {
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
      } else if (numerator === 1 && LEGACY_CRIT_DENOMINATORS.has(denominator) && !state.crit) {
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
    if (wanted && legacyIsMoveRange(items, start, end)) {
      const rank = (item: T) => ((item as LegacyMoveLike).pokemon?.side.id === wanted ? 0 : 1);
      const ordered = [...items.slice(start, end)].sort((a, b) => rank(a) - rank(b));
      ordered.forEach((item, index) => { items[start + index] = item; });
      return;
    }
    this.delegate(() => super.shuffle(items, start, end));
  }

  /** The base class reaches random() from randomChance/sample/shuffle; those calls are no damage roll. */
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
