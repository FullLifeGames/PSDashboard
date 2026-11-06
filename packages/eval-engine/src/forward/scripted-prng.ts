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
 *
 * Round 86 (T305): a secondary die (the entry of the move's `secondaries` the simulator draws after a hit) is named too. A script
 * answers it by effect id (`secondary`), and a `DiceSink` as the scripts map records every secondary die of the turn with the
 * result it had, answered or drawn, so a class draw reads which effects came true from the dice, not from the log.
 */
export interface RollScript {
  /** The accuracy roll: true connects, false misses. */
  hit?: boolean;
  /** The critical-hit roll. */
  crit?: boolean;
  /** The damage roll random(16): 0 is the maximum roll, 15 the minimum (randomizer: base × (100 − roll) / 100). */
  roll?: number;
  /** The secondary dice by effect id (`secondaryEffectId`): true lets the entry happen, false stops it. An id the script leaves out draws from the seed. */
  secondary?: Record<string, boolean>;
  /** Speed tie: the side whose move acts first. */
  first?: 'p1' | 'p2';
}

/** Scripts keyed `${sideId}:${moveId}`, e.g. `p1:thunder`. */
export type RollScripts = ReadonlyMap<string, RollScript>;

/** A secondary die of a turn: whose move, against whom, which entry, its chance and whether it came true. */
export interface SecondaryRecord {
  slot: string;
  moveId: string;
  targetSlot?: string;
  effectId: string;
  /** 0 to 1: the entry's chance (a Gen 1 or 2 entry draws n in 256: the fraction of the draw). */
  chance: number;
  happened: boolean;
  /** `battle.log.length` when the die was drawn. */
  logIndex: number;
}

/**
 * Scripts that record. A class draw passes a sink (an empty map is fine) as the fork's `scripts`; `forkBattle` builds the recording
 * `ScriptedPRNG` for it, and the caller reads `secondaries` after the advance.
 */
export class DiceSink extends Map<string, RollScript> {
  readonly secondaries: SecondaryRecord[] = [];
}

interface Answered { accuracy: boolean; crit: boolean; roll: boolean; secondary: Set<string> }
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
    if (!name) return null;
    // the move's own accuracy, crit and damage roll carry no effect; a secondary die always does
    const own = name.kind === 'secondary' ? name.effectId !== undefined : name.effectId === undefined
      && (name.kind === 'accuracy' || name.kind === 'crit' || name.kind === 'damage-roll');
    if (!own) return null;
    const move = this.battle?.activeMove;
    if (!move) return null;
    const script = this.scripts.get(`${name.slot.slice(0, 2)}:${name.moveId}`);
    if (!script) return null;
    let state = this.answered.get(move);
    if (!state) {
      state = { accuracy: false, crit: false, roll: false, secondary: new Set() };
      this.answered.set(move, state);
    }
    return { script, state };
  }

  /**
   * What the script says about a secondary die, once per target and effect of the move in flight: the raw value to return, or
   * undefined when the script is silent (the seed answers).
   */
  private secondaryAnswer(name: DieName, draw: Draw): number | undefined {
    const hit = this.active(name);
    const happens = hit?.script.secondary?.[name.effectId!];
    if (!hit || happens === undefined) return undefined;
    const key = `${name.targetSlot}|${name.effectId}`;
    if (hit.state.secondary.has(key)) return undefined;
    hit.state.secondary.add(key);
    const answer = answerDie('secondary', { happens }, draw, this.battle!.gen);
    return answer && 'value' in answer ? answer.value : undefined;
  }

  /** The sink's record of a secondary die and the result it had. */
  private note(name: DieName, chance: number, happened: boolean): void {
    if (!(this.scripts instanceof DiceSink)) return;
    this.scripts.secondaries.push({
      slot: name.slot, moveId: name.moveId, targetSlot: name.targetSlot, effectId: name.effectId!, chance, happened, logIndex: this.battle!.log.length,
    });
  }

  override randomChance(numerator: number, denominator: number): boolean {
    const draw: Draw = { call: 'chance', from: denominator, numerator };
    const name = this.namer?.name(draw) ?? null;
    if (name?.kind === 'secondary') return this.secondaryChance(name, draw, numerator, denominator);
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
    if (name?.kind === 'secondary') return this.secondaryRandom(name, draw);
    const hit = this.active(name);
    if (hit) {
      const answer = this.answerRandom(name!, hit, draw);
      if (answer !== undefined) return answer;
    }
    return super.random(from, to);
  }

  /** Gens 1 and 2: the entry's `chance(n, 256)`. */
  private secondaryChance(name: DieName, draw: Draw, numerator: number, denominator: number): boolean {
    const answered = this.secondaryAnswer(name, draw);
    const happened = answered === undefined ? this.delegate(() => super.randomChance(numerator, denominator)) : answered < numerator;
    this.note(name, numerator / denominator, happened);
    return happened;
  }

  /** Gens 3 and up: the entry's `random(100)`, compared with its percent by the simulator (`draw.chance` is the naming's reading of the entry). */
  private secondaryRandom(name: DieName, draw: Draw): number {
    const value = this.secondaryAnswer(name, draw) ?? super.random(draw.from, draw.to);
    const chance = draw.chance ?? 1;
    this.note(name, chance, value < Math.round(chance * 1e6) / 1e4);
    return value;
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
