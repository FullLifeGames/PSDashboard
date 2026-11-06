import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
import { strengthMix } from '../calc/fickle.ts';
import { DrawNamer } from '../dice/namer.ts';
import { answerDie } from '../dice/answer.ts';
import type { DieName, Draw } from '../dice/types.ts';
import type { PricedHit } from './kill-table.ts';
import { captureHit, type HitSnapshot } from './snapshot.ts';

/**
 * Round 56: the doubles pair plan's dice. A recording PRNG writes down, per
 * hit instance (one move object and one target), the accuracy roll with the
 * threshold the sim used, the crit roll with its denominator, and the damage
 * roll with the crit flag and a snapshot of both bodies — hitStepAccuracy and
 * getSpreadDamage set battle.activeTarget per target, so a spread move is
 * one instance per target. A speed tie among move actions is written down
 * too. Scripts answer one instance's rolls on demand, keyed
 * `${attackerSlot}:${moveId}>${targetSlot}`; an answered roll still draws
 * its number, so everything before it replays exactly as without the
 * script. Without scripts the draws are the plain PRNG's, number for number.
 * The singles solver keeps ScriptedPRNG; nothing here reaches it.
 *
 * Round 69 (T154): a move that doubles its strength on a chance (Fickle Beam's
 * randomChance(3, 10) in the BasePower event, read from the Dex handler by
 * calc/fickle.ts) draws that chance before the damage roll; the draw is kept
 * on the hit's instance and the roll's snapshot carries the factor it drew, so
 * the table at the roll is the table of the strength the log shows. A script
 * answers it with `doubled`.
 *
 * Round 86 (T299): the recorder no longer tells a draw by its numbers. A `DrawNamer`
 * (dice/namer.ts, the module's naming by the simulator's hook, docs/adr/0002) names
 * each call, and only the move's own accuracy, crit and damage roll are booked: an
 * attacker's status check (the confusion check has an accuracy shape, the others a
 * crit shape) and the confusion self-hit's random(16) leave no record. The draws
 * stay the plain PRNG's number for number, as before.
 *
 * Round 86 (T305): a secondary die (an entry of the move's `secondaries`, one `random(100)` per entry the target's rules leave)
 * is booked per hit instance with its effect id, its chance and the result it had. A script answers it by effect id
 * (`secondary`); as with the other rolls the natural value is drawn first, so the stream stays where it would have been.
 */

export interface PairScript {
  hit?: boolean;
  crit?: boolean;
  /** random(16): 0 is the top roll (100 %), 15 the bottom one (85 %). */
  roll?: number;
  /** The strength draw of a move that doubles on a chance (Fickle Beam): true is the stronger strength. */
  doubled?: boolean;
  /** The secondary dice by effect id (`secondaryEffectId`): true lets the entry happen, false stops it; an id left out keeps the natural draw. */
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

/** Every item of the range is a move action with an acting Pokémon: speedSort shuffling a tie in the queue. */
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
  private readonly instances = new WeakMap<object, Map<string, Instance>>();
  private nextInstance = 0;
  private delegating = false;

  constructor(seed: PRNGSeed, scripts: PairScripts = new Map()) {
    super(seed);
    this.scripts = scripts;
  }

  attach(battle: Battle): void {
    this.battle = battle;
    this.namer?.release();
    this.namer = new DrawNamer(battle);
  }

  /** Puts the battle back as the simulator made it; `drawPair` calls this when the turn is over. */
  release(): void {
    this.namer?.release();
    this.namer = null;
  }

  /** The die of a draw the move in flight rolls: its own accuracy, crit or damage roll, not a condition's draw. */
  private static ownDie(name: DieName | null): DieName | null {
    return name && name.effectId === undefined ? name : null;
  }

  override randomChance(numerator: number, denominator: number): boolean {
    const name = PairPRNG.ownDie(this.namer?.name({ call: 'chance', from: denominator, numerator }) ?? null);
    const natural = this.delegate(() => super.randomChance(numerator, denominator));
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

  /** The chance a move that doubles on one draws before its damage roll (Fickle Beam): kept on the instance, answered by the script's `doubled`. */
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
    if (name?.kind !== 'damage-roll') return super.random(from, to);
    const natural = super.random(from, to);
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

  /** The entry's `random(100)`: the natural value is drawn, the script (once per effect of the instance) may replace it, the record keeps the result. */
  private secondaryRandom(name: DieName, draw: Draw): number {
    const natural = super.random(draw.from, draw.to);
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
    this.namer?.name({ call: 'sample', from: items.length, items });
    return this.delegate(() => super.sample(items));
  }

  override shuffle<T>(items: T[], start = 0, end = items.length): void {
    this.namer?.name({ call: 'shuffle', from: start, to: end });
    if (isMoveRange(items, start, end)) this.records.push({ kind: 'tie' });
    this.delegate(() => super.shuffle(items, start, end));
  }

  /** The instance the sim rolls for: one per move object and target slot; a script answers only the first instance of its key. */
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
