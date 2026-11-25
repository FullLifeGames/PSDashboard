import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import { answerDie, scriptRoll } from '../dice/answer.ts';
import { DrawNamer } from '../dice/namer.ts';
import type { DieName, Draw } from '../dice/types.ts';
import type { DieQuantiles } from '../search/root-quantile.ts';

// A script is a request, not a promise: it answers only the move's own accuracy, crit, damage roll and secondary dice.
// The attacker's status checks (paralysis, infatuation, confusion, thaw) look the same and draw from the seed.

export interface RollScript {
  hit?: boolean;
  crit?: boolean;
  /** The damage roll random(16): 0 is the maximum roll, 15 the minimum. */
  roll?: number;
  /** By effect id (`secondaryEffectId`): true lets the entry happen, false stops it. */
  secondary?: Record<string, boolean>;
  first?: 'p1' | 'p2';
}

/** Scripts keyed `${sideId}:${moveId}`, e.g. `p1:thunder`. */
export type RollScripts = ReadonlyMap<string, RollScript>;

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

/** Scripts that record: pass one (an empty map will do) as the fork's `scripts`, read `secondaries` after. */
export class DiceSink extends Map<string, RollScript> {
  readonly secondaries: SecondaryRecord[] = [];
}

/** A sink whose named dice the root quantiles also answer (`search/root-quantile.ts`); a script outranks a quantile. */
export class QuantileSink extends DiceSink {
  readonly quantiles: DieQuantiles;

  constructor(quantiles: DieQuantiles) {
    super();
    this.quantiles = quantiles;
  }
}

interface Answered { accuracy: boolean; crit: boolean; roll: boolean; secondary: Set<string> }
interface MoveLike { choice?: string; pokemon?: { side: { id: string } } }

function isMoveRange(items: unknown[], start: number, end: number): boolean {
  if (end - start < 2) return false;
  for (let index = start; index < end; index++) {
    const action = items[index] as MoveLike | undefined;
    if (!action || action.choice !== 'move' || !action.pokemon) return false;
  }
  return true;
}

// An answered die consumes no draw of the stream (a quantile answer draws the natural number first).
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

  release(): void {
    this.namer?.release();
    this.namer = null;
  }

  private active(name: DieName | null): { script: RollScript; state: Answered } | null {
    if (!name) return null;
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

  private quantile(name: DieName | null, draw: Draw): number | boolean | undefined {
    if (!name || !(this.scripts instanceof QuantileSink)) return undefined;
    return this.scripts.quantiles.answer(name, draw);
  }

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
    const natural = this.delegate(() => super.randomChance(numerator, denominator));
    const answered = this.quantile(name, draw);
    return typeof answered === 'boolean' ? answered : natural;
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
    const natural = super.random(from, to);
    const answered = this.quantile(name, draw);
    return typeof answered === 'number' ? answered : natural;
  }

  /** Gens 1 and 2: the entry's `chance(n, 256)`. */
  private secondaryChance(name: DieName, draw: Draw, numerator: number, denominator: number): boolean {
    const answered = this.secondaryAnswer(name, draw);
    let happened: boolean;
    if (answered !== undefined) {
      happened = answered < numerator;
    } else {
      const natural = this.delegate(() => super.randomChance(numerator, denominator));
      const quantile = this.quantile(name, draw);
      happened = typeof quantile === 'boolean' ? quantile : natural;
    }
    this.note(name, numerator / denominator, happened);
    return happened;
  }

  /** Gens 3 and up: the entry's `random(100)`, compared with its percent by the simulator. */
  private secondaryRandom(name: DieName, draw: Draw): number {
    const scripted = this.secondaryAnswer(name, draw);
    const value = scripted ?? this.drawnSecondary(name, draw);
    const chance = draw.chance ?? 1;
    this.note(name, chance, value < Math.round(chance * 1e6) / 1e4);
    return value;
  }

  private drawnSecondary(name: DieName, draw: Draw): number {
    const natural = super.random(draw.from, draw.to);
    const answered = this.quantile(name, draw);
    return typeof answered === 'number' ? answered : natural;
  }

  /** The damage roll, or Gen 2's crit (`random(256)` against a threshold). */
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
    const draw: Draw = { call: 'sample', from: items.length, items };
    const name = this.namer?.name(draw) ?? null;
    const natural = this.delegate(() => super.sample(items));
    const answered = this.quantile(name, draw);
    return typeof answered === 'number' ? items[answered] : natural;
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

  /** The base class calls random() from randomChance/sample/shuffle; those inner calls are not the damage roll. */
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
