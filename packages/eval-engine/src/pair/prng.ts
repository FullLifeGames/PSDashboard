import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed } from '@pkmn/sim';
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
 */

export interface PairScript {
  hit?: boolean;
  crit?: boolean;
  /** random(16): 0 is the top roll (100 %), 15 the bottom one (85 %). */
  roll?: number;
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
  snapshot: HitSnapshot;
}

export type PairRecord = AccuracyRecord | CritRecord | RollRecord | { kind: 'tie' };

/** getDamage's crit denominators over the gens (1: a sure crit still rolls). */
const CRIT_DENOMINATORS = new Set([24, 16, 8, 4, 3, 2, 1]);

interface Instance { id: number; key: string; script: PairScript | undefined; accuracy: boolean; crit: boolean; roll: boolean }
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
  }

  override randomChance(numerator: number, denominator: number): boolean {
    const natural = this.delegate(() => super.randomChance(numerator, denominator));
    const hit = this.instance();
    if (!hit) return natural;
    if (denominator === 100 && !hit.accuracy) {
      hit.accuracy = true;
      const result = hit.script?.hit ?? natural;
      const snapshot = numerator < 100 ? captureHit(this.battle!) : null;
      this.records.push({ kind: 'accuracy', key: hit.key, instance: hit.id, numerator, hit: result, logIndex: this.battle!.log.length, snapshot });
      return result;
    }
    if (numerator === 1 && CRIT_DENOMINATORS.has(denominator) && !hit.crit && this.inDamage()) {
      hit.crit = true;
      this.records.push({ kind: 'crit', key: hit.key, instance: hit.id, denominator });
      return hit.script?.crit ?? natural;
    }
    return natural;
  }

  override random(from?: number, to?: number): number {
    if (this.delegating || from !== 16 || to !== undefined) return super.random(from, to);
    const natural = super.random(16);
    const hit = this.instance();
    if (!hit) return natural;
    const roll = (hit.roll ? undefined : hit.script?.roll) ?? natural;
    hit.roll = true;
    const battle = this.battle!;
    const crit = !!battle.activeTarget!.getMoveHitData(battle.activeMove!).crit;
    this.records.push({ kind: 'roll', key: hit.key, instance: hit.id, roll, crit, logIndex: battle.log.length, snapshot: captureHit(battle) });
    return roll;
  }

  override sample<T>(items: readonly T[]): T {
    return this.delegate(() => super.sample(items));
  }

  override shuffle<T>(items: T[], start = 0, end = items.length): void {
    if (isMoveRange(items, start, end)) this.records.push({ kind: 'tie' });
    this.delegate(() => super.shuffle(items, start, end));
  }

  /** The instance the sim rolls for: one per move object and target slot; a script answers only the first instance of its key. */
  private instance(): Instance | null {
    const move = this.battle?.activeMove;
    const pokemon = this.battle?.activePokemon;
    const target = this.battle?.activeTarget;
    if (!move || !pokemon || !target) return null;
    let byTarget = this.instances.get(move);
    if (!byTarget) {
      byTarget = new Map();
      this.instances.set(move, byTarget);
    }
    const slot = target.getSlot();
    let found = byTarget.get(slot);
    if (!found) {
      const key = `${pokemon.getSlot()}:${move.id}>${slot}`;
      const script = this.usedScripts.has(key) ? undefined : this.scripts.get(key);
      if (script) this.usedScripts.add(key);
      found = { id: this.nextInstance++, key, script, accuracy: false, crit: false, roll: false };
      byTarget.set(slot, found);
    }
    return found;
  }

  /** getDamage makes the target's hit data right before it rolls the crit; BeforeMove's status checks come earlier. */
  private inDamage(): boolean {
    const move = this.battle?.activeMove as { moveHitData?: Record<string, unknown> } | null | undefined;
    const slot = this.battle?.activeTarget?.getSlot();
    return !!slot && !!move?.moveHitData?.[slot];
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
