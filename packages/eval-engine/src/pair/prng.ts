import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import { strengthMix } from '../calc/fickle.ts';
import { DrawNamer } from '../dice/namer.ts';
import { answerDie } from '../dice/answer.ts';
import type { DieName, Draw } from '../dice/types.ts';
import type { DieQuantiles } from '../search/root-quantile.ts';
import type { PricedHit } from './kill-table.ts';
import { captureHit, type HitSnapshot } from './snapshot.ts';

/** The doubles pair plan's dice: a recording PRNG books each hit instance's rolls; scripts answer them on demand. */
// An answered roll still draws its number, so what came before replays as without the script.

export interface PairScript {
  hit?: boolean;
  crit?: boolean;
  /** random(16): 0 is the top roll (100 %), 15 the bottom one (85 %). */
  roll?: number;
  /** The strength draw of a move that doubles on a chance (Fickle Beam): true is the stronger strength. */
  doubled?: boolean;
  /** By effect id (`secondaryEffectId`): true lets the entry happen, false stops it; an id left out draws naturally. */
  secondary?: Record<string, boolean>;
}

export type PairScripts = ReadonlyMap<string, PairScript>;

export interface AccuracyRecord {
  kind: 'accuracy';
  key: string;
  instance: number;
  numerator: number;
  hit: boolean;
  logIndex: number;
  /** Taken below 100: a missed hit needs it for the hit it did not get. */
  snapshot: HitSnapshot | null;
}

export interface CritRecord {
  kind: 'crit';
  key: string;
  instance: number;
  denominator: number;
}

export interface RollRecord {
  kind: 'roll';
  key: string;
  instance: number;
  roll: number;
  crit: boolean;
  logIndex: number;
  snapshot: PricedHit;
}

export interface SecondaryRecord {
  kind: 'secondary';
  key: string;
  instance: number;
  effectId: string;
  /** The entry's chance, 0 to 1. */
  chance: number;
  happened: boolean;
  logIndex: number;
}

export type PairRecord = AccuracyRecord | CritRecord | RollRecord | SecondaryRecord | { kind: 'tie' };

interface Instance {
  id: number; key: string; script: PairScript | undefined; accuracy: boolean; crit: boolean; roll: boolean; secondary: Set<string>; strength?: number;
}
interface QueueAction { choice?: string; pokemon?: unknown }

function isMoveRange(items: unknown[], start: number, end: number): boolean {
  if (end - start < 2) return false;
  for (let index = start; index < end; index++) {
    const action = items[index] as QueueAction | undefined;
    if (!action || action.choice !== 'move' || !action.pokemon) return false;
  }
  return true;
}

export class PairPRNG extends PRNG {
  readonly records: PairRecord[] = [];
  private battle: Battle | null = null;
  private namer: DrawNamer | null = null;
  private readonly scripts: PairScripts;
  private readonly usedScripts = new Set<string>();
  private readonly quantiles: DieQuantiles | undefined;
  private readonly instances = new WeakMap<object, Map<string, Instance>>();
  private nextInstance = 0;
  private delegating = false;

  constructor(seed: PRNGSeed, scripts: PairScripts = new Map(), quantiles?: DieQuantiles) {
    super(seed);
    this.scripts = scripts;
    this.quantiles = quantiles;
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

  private static ownDie(name: DieName | null): DieName | null {
    return name && name.effectId === undefined ? name : null;
  }

  private quantile(name: DieName | null, draw: Draw): number | boolean | undefined {
    return name && this.quantiles ? this.quantiles.answer(name, draw) : undefined;
  }

  private chanceValue(name: DieName | null, draw: Draw): boolean {
    const drawn = this.delegate(() => super.randomChance(draw.numerator!, draw.from!));
    const answered = this.quantile(name, draw);
    return typeof answered === 'boolean' ? answered : drawn;
  }

  override randomChance(numerator: number, denominator: number): boolean {
    const draw: Draw = { call: 'chance', from: denominator, numerator };
    const raw = this.namer?.name(draw) ?? null;
    const name = PairPRNG.ownDie(raw);
    const natural = this.chanceValue(raw, draw);
    const hit = this.instance();
    if (!hit) return natural;
    if (name?.kind === 'accuracy' && !hit.accuracy) {
      hit.accuracy = true;
      const result = hit.script?.hit ?? natural;
      const snapshot = numerator < 100 ? captureHit(this.battle!) : null;
      this.records.push({ kind: 'accuracy', key: hit.key, instance: hit.id, numerator, hit: result, logIndex: this.battle!.log.length, snapshot });
      return result;
    }
    if (name?.kind === 'crit' && !hit.crit) {
      hit.crit = true;
      this.records.push({ kind: 'crit', key: hit.key, instance: hit.id, denominator });
      return hit.script?.crit ?? natural;
    }
    return this.strengthDraw(hit, numerator, denominator, natural);
  }

  private strengthDraw(hit: Instance, numerator: number, denominator: number, natural: boolean): boolean {
    const mix = hit.strength === undefined && !hit.roll ? strengthMix(this.battle!.dex, this.battle!.activeMove!.id) : null;
    if (!mix || numerator !== mix.numerator || denominator !== mix.denominator) return natural;
    const doubled = hit.script?.doubled ?? natural;
    hit.strength = doubled ? mix.factor : 1;
    return doubled;
  }

  override random(from?: number, to?: number): number {
    if (this.delegating) return super.random(from, to);
    const draw: Draw = { call: 'random', from, to };
    const named = this.namer?.name(draw) ?? null;
    if (named?.kind === 'secondary') return this.secondaryRandom(named, draw);
    const name = PairPRNG.ownDie(named);
    const drawn = super.random(from, to);
    const answered = this.quantile(named, draw);
    const natural = typeof answered === 'number' ? answered : drawn;
    if (name?.kind !== 'damage-roll') return natural;
    const hit = this.instance();
    if (!hit) return natural;
    const roll = (hit.roll ? undefined : hit.script?.roll) ?? natural;
    hit.roll = true;
    const battle = this.battle!;
    const crit = !!battle.activeTarget!.getMoveHitData(battle.activeMove!).crit;
    const snapshot: PricedHit = captureHit(battle);
    this.records.push({
      kind: 'roll', key: hit.key, instance: hit.id, roll, crit, logIndex: battle.log.length,
      snapshot: hit.strength === undefined ? snapshot : { ...snapshot, strength: hit.strength },
    });
    return roll;
  }

  private secondaryRandom(name: DieName, draw: Draw): number {
    const drawn = super.random(draw.from, draw.to);
    const answered = this.quantile(name, draw);
    const natural = typeof answered === 'number' ? answered : drawn;
    const hit = name.targetSlot ? this.instance(name.targetSlot) : null;
    if (!hit || !name.effectId) return natural;
    const happens = hit.script?.secondary?.[name.effectId];
    let value = natural;
    if (happens !== undefined && !hit.secondary.has(name.effectId)) {
      const answer = answerDie('secondary', { happens }, draw, this.battle!.gen);
      if (answer && 'value' in answer) value = answer.value;
    }
    hit.secondary.add(name.effectId);
    const chance = draw.chance ?? 1;
    this.records.push({
      kind: 'secondary', key: hit.key, instance: hit.id, effectId: name.effectId, chance, happened: value < Math.round(chance * 1e6) / 1e4,
      logIndex: this.battle!.log.length,
    });
    return value;
  }

  override sample<T>(items: readonly T[]): T {
    const draw: Draw = { call: 'sample', from: items.length, items };
    const name = this.namer?.name(draw) ?? null;
    const natural = this.delegate(() => super.sample(items));
    const answered = this.quantile(name, draw);
    return typeof answered === 'number' ? items[answered] : natural;
  }

  override shuffle<T>(items: T[], start = 0, end = items.length): void {
    this.namer?.name({ call: 'shuffle', from: start, to: end });
    if (isMoveRange(items, start, end)) this.records.push({ kind: 'tie' });
    this.delegate(() => super.shuffle(items, start, end));
  }

  /** One per move object and target slot; a script answers only the first instance of its key. */
  private instance(targetSlot?: string): Instance | null {
    const move = this.battle?.activeMove;
    const pokemon = this.battle?.activePokemon;
    const slot = targetSlot ?? this.battle?.activeTarget?.getSlot();
    if (!move || !pokemon || !slot) return null;
    let byTarget = this.instances.get(move);
    if (!byTarget) {
      byTarget = new Map();
      this.instances.set(move, byTarget);
    }
    let found = byTarget.get(slot);
    if (!found) {
      const key = `${pokemon.getSlot()}:${move.id}>${slot}`;
      const script = this.usedScripts.has(key) ? undefined : this.scripts.get(key);
      if (script) this.usedScripts.add(key);
      found = { id: this.nextInstance++, key, script, accuracy: false, crit: false, roll: false, secondary: new Set() };
      byTarget.set(slot, found);
    }
    return found;
  }

  /** randomChance, sample and shuffle reach random() inside; those calls are not rolls of their own. */
  private delegate<R>(call: () => R): R {
    this.delegating = true;
    try {
      return call();
    } finally {
      this.delegating = false;
    }
  }
}
