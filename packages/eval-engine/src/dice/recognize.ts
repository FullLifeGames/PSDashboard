import { type DieName, type Draw } from './types.ts';
import type { BattleWatch } from './watch.ts';

/**
 * Round 82 (forced dice), decision D3: which draw is which die. `recognize` maps one draw of the simulator's PRNG to the name
 * of a die, or to null for a draw this module leaves to the stream. Two rules, in this order (docs/adr/0002):
 *
 * 1. The hook rule. The simulator runs a hook right before some draws: `Accuracy` before the accuracy chance, `ModifyCritRatio`
 *    before the crit (Gen 2 on). The watch arms the hook; the draw that follows is that die.
 * 2. The script rule, for draws no hook announces. The damage roll is the draw inside `battle.randomizer` (Gens 3 and up) or a
 *    `random(217, 256)` inside `getDamage` (Gens 1 and 2); the Gen 1 crit is the chance inside `getDamage`.
 *
 * The numbers of both rules live in this one table (hook probe, lanes/A/p1-hooks.md, exceptions 1 to 3); the sweeps hold it to
 * the simulator for every generation and the Champions mod.
 */

/** How a generation writes the damage roll and where its raw value sits relative to the damage. */
interface RollShape {
  /** The script call the draw sits in. */
  scope: 'randomizer' | 'getDamage';
  from: number;
  to?: number;
  /** The number of damage rolls, lowest damage first. */
  steps: number;
  /** The raw value of the step (0 is the lowest damage). */
  raw(step: number): number;
}

interface GenShape {
  /** The crit has a `ModifyCritRatio` hook before it. */
  critHook: boolean;
  /** `chance` (`randomChance(n, d)`) or `random` (`random(256) < n`). */
  critCall: 'chance' | 'random';
  roll: RollShape;
}

/** Gens 3 and up: `random(16)` inside the randomizer, a lower value hurts more (`tr(baseDamage * (100 - random(16)) / 100)`). */
const ROLL_SIXTEEN: RollShape = { scope: 'randomizer', from: 16, steps: 16, raw: step => 15 - step };
/** Gens 1 and 2: `damage *= random(217, 256)`, 39 values, a higher value hurts more. */
const ROLL_RANGE: RollShape = { scope: 'getDamage', from: 217, to: 256, steps: 39, raw: step => 217 + step };

export function genShape(gen: number): GenShape {
  if (gen === 1) return { critHook: false, critCall: 'chance', roll: ROLL_RANGE };
  if (gen === 2) return { critHook: true, critCall: 'random', roll: ROLL_RANGE };
  return { critHook: true, critCall: 'chance', roll: ROLL_SIXTEEN };
}

/** Whether the draw has the shape of the generation's damage roll (the caller checks the script call). */
const isRollCall = (draw: Draw, shape: RollShape): boolean =>
  draw.call === 'random' && draw.from === shape.from && draw.to === shape.to;

/** The crit: the draw after `ModifyCritRatio` (Gen 2 on; Gen 2 compares `random(256)`), or the chance inside Gen 1's `getDamage`. */
function isCritDraw(draw: Draw, shape: GenShape, watch: BattleWatch): boolean {
  if (!shape.critHook) return watch.scope() === 'getDamage' && draw.call === 'chance';
  if (watch.armed?.kind !== 'crit' || draw.call !== shape.critCall) return false;
  return draw.call === 'chance' || (draw.from === 256 && draw.to === undefined);
}

/**
 * The name of the die this draw is, read at the moment of the draw from the watch and the battle's state.
 * `gen` is the battle's generation (Champions plays as Gen 9).
 */
export function recognize(draw: Draw, watch: BattleWatch, gen: number): DieName | null {
  const { battle, armed } = watch;
  const move = battle.activeMove;
  const user = battle.activePokemon;
  if (!move || !user) return null;
  const shape = genShape(gen);
  const base = { slot: user.getSlot(), moveId: move.id };
  const target = (): { targetSlot?: string; effectId?: string } => inCondition(battle, base.slot, battle.activeTarget?.getSlot());

  if (watch.scope() === shape.roll.scope && isRollCall(draw, shape.roll)) return { ...base, ...target(), kind: 'damage-roll' };
  if (isCritDraw(draw, shape, watch)) return { ...base, ...target(), kind: 'crit' };
  if (draw.call === 'chance' && armed?.kind === 'accuracy') return { ...base, targetSlot: armed.targetSlot, kind: 'accuracy' };
  return null;
}

/**
 * A draw inside a condition's `BeforeMove` handler (the confusion self-hit rolls its own damage) belongs to the condition,
 * not to the move in flight: the condition names it, and the body it hurts is the user.
 */
function inCondition(battle: BattleWatch['battle'], slot: string, targetSlot: string | undefined): { targetSlot?: string; effectId?: string } {
  const event = (battle.event as { id?: string } | undefined)?.id;
  const effect = battle.effect as { id?: string; effectType?: string } | undefined;
  if (event === 'BeforeMove' && effect?.id && (effect.effectType === 'Condition' || effect.effectType === 'Status')) {
    return { targetSlot: slot, effectId: effect.id };
  }
  return targetSlot === undefined ? {} : { targetSlot };
}
