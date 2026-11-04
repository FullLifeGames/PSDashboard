import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import { answerDie, scriptRoll } from '../dice/answer.ts';
import { DrawNamer } from '../dice/namer.ts';
import type { DieName, Draw } from '../dice/types.ts';

/**
 * Round 43: the simulator's dice on demand. A scripted PRNG answers the
 * rolls of ONE named move (side + move id) the way a script says, so an
 * outcome class the seeds never showed (the 5% miss, the crit-only
 * knock-out) can be drawn directly instead of chased with probe seeds.
 * Everything the script does not name delegates to the seed, and the log
 * still decides the class (classifyChild), so a script is a request, not
 * a promise. A speed tie is answered through prng.shuffle.
 *
 * Round 86 (T299): the PRNG no longer tells a draw by its numbers. A `DrawNamer`
 * (dice/namer.ts, the module's naming by the simulator's own hook, docs/adr/0002)
 * names each call before the PRNG answers, and the script answers only the
 * move's own accuracy, crit and damage roll. A status check of the attacker
 * (full paralysis, infatuation, the confusion check and its self-hit, the thaw)
 * has the shape of a crit or an accuracy and draws from the seed; Gens 1 and 2,
 * which draw accuracy and crit in 256ths and the roll as random(217, 256), are
 * reached too. An answer consumes no draw, as before.
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
  private namer: DrawNamer | null = null;
  private readonly scripts: RollScripts;
  private readonly answered = new WeakMap<object, Answered>();
  private delegating = false;

  constructor(seed: PRNGSeed, scripts: RollScripts) {
    super(seed);
    this.scripts = scripts;
  }

  attach(battle: Battle): void {
    this.battle = battle;
    this.namer?.release();
    this.namer = new DrawNamer(battle);
  }

  /** Puts the battle back as the simulator made it (`toPosition` calls this when the turn is over). After it, every draw comes from the seed. */
  release(): void {
    this.namer?.release();
    this.namer = null;
  }

  /** The script and the answer state of the move the sim is executing, when this die is one of its own and a script names the move. */
  private active(name: DieName | null): { script: RollScript; state: Answered } | null {
    if (!name || name.effectId !== undefined) return null;
    if (name.kind !== 'accuracy' && name.kind !== 'crit' && name.kind !== 'damage-roll') return null;
    const move = this.battle?.activeMove;
    if (!move) return null;
    const script = this.scripts.get(`${name.slot.slice(0, 2)}:${name.moveId}`);
    if (!script) return null;
    let state = this.answered.get(move);
    if (!state) {
      state = { accuracy: false, crit: false, roll: false };
      this.answered.set(move, state);
    }
    return { script, state };
  }

  override randomChance(numerator: number, denominator: number): boolean {
    const name = this.namer?.name({ call: 'chance', from: denominator, numerator }) ?? null;
    const hit = this.active(name);
    if (hit) {
      const { script, state } = hit;
      if (name!.kind === 'accuracy' && !state.accuracy) {
        state.accuracy = true;
        if (script.hit !== undefined) return script.hit;
      } else if (name!.kind === 'crit' && !state.crit) {
        state.crit = true;
        if (script.crit !== undefined) return script.crit;
      }
    }
    return this.delegate(() => super.randomChance(numerator, denominator));
  }

  override random(from?: number, to?: number): number {
    if (this.delegating) return super.random(from, to);
    const draw: Draw = { call: 'random', from, to };
    const name = this.namer?.name(draw) ?? null;
    const hit = this.active(name);
    if (hit) {
      const answer = this.answerRandom(name!, hit, draw);
      if (answer !== undefined) return answer;
    }
    return super.random(from, to);
  }

  /** The value a script gives a `random` call: the damage roll, or Gen 2's crit (`random(256)` against a threshold). */
  private answerRandom(name: DieName, { script, state }: { script: RollScript; state: Answered }, draw: Draw): number | undefined {
    const gen = this.battle!.gen;
    if (name.kind === 'damage-roll' && !state.roll) {
      state.roll = true;
      if (script.roll !== undefined) return scriptRoll(gen, script.roll);
    } else if (name.kind === 'crit' && !state.crit) {
      state.crit = true;
      const answer = script.crit === undefined ? null : answerDie('crit', { happens: script.crit }, draw, gen);
      if (answer && 'value' in answer) return answer.value;
    }
    return undefined;
  }

  override sample<T>(items: readonly T[]): T {
    this.namer?.name({ call: 'sample', from: items.length, items });
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
    this.namer?.name({ call: 'shuffle', from: start, to: end });
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
