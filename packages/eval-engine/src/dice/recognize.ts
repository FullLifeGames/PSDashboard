import type { Battle } from '@pkmn/sim';
import type { DieName, Draw, SecondaryEntry } from './types.ts';
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
 * Round 82, step A3a: the same two rules name the secondary effect (the entries `ModifySecondaries` returned in Gens 3 and up,
 * the script's own chance in tryMoveHit in Gens 1 and 2), the self effect (`random(100)` in `selfDrops`), the hit count (a
 * `sample` or `random` with no event in flight inside the hit loop), and the draws inside a handler that name their event:
 * `StallMove` is a stalling move that succeeds again, `BasePower` a chance that changes a move's power.
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

/** The script call the hit count's draw sits in: Gens 1 to 3 draw it in `tryMoveHit`, Gen 4 on in the hit loop. */
const hitCountScope = (gen: number): string => (gen <= 3 ? 'tryMoveHit' : 'hitStepMoveHitLoop');

/**
 * Whether a numerator is the one Gens 1 and 2 draw for a secondary entry (`chance(n, 256)` in `tryMoveHit`). An entry with no
 * chance draws nothing. Gen 1 rounds the percent up to 256ths and, for one kind of entry, takes one off (the script's own
 * comment says which); the draw shows which of the two it was. Gen 2 scales to 255.
 */
function legacyDraws(gen: number, entry: SecondaryEntry, numerator: number | undefined): boolean {
  if (entry.chance === undefined) return false;
  if (gen === 1) {
    const rounded = Math.ceil(entry.chance * 256 / 100);
    return numerator === rounded || numerator === rounded - 1;
  }
  return numerator === Math.floor(entry.chance * 255 / 100);
}

/** The id of a secondary entry as a die names it: the status, the condition, the boosted stats, or its self effect. */
export function secondaryEffectId(entry: SecondaryEntry): string {
  if (entry.status) return entry.status;
  if (entry.volatileStatus) return entry.volatileStatus;
  if (entry.boosts) return `boosts:${Object.keys(entry.boosts).join('+')}`;
  if (entry.self?.boosts) return `self:${Object.keys(entry.self.boosts).join('+')}`;
  if (entry.self?.volatileStatus) return `self:${entry.self.volatileStatus}`;
  return 'effect';
}

/** The chance of an entry (or of a move's self effect) as a number from 0 to 1; no chance is a sure effect. */
const chanceOfEntry = (chance: number | undefined): number => (chance === undefined ? 1 : Math.min(1, chance / 100));

const HANDLERS = new Set(['Condition', 'Status', 'Item', 'Ability']);
/** A draw inside a condition's, an item's or an ability's handler belongs to it, not to the script that called it. */
const inHandler = (battle: Battle): boolean => HANDLERS.has((battle.effect as { effectType?: string } | undefined)?.effectType ?? '');

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
  return recognizeMoveDraw(draw, watch, gen, base);
}

type Base = { slot: string; moveId: string };
type ActiveMoveLike = { secondaries?: SecondaryEntry[]; self?: { chance?: number } };
const isPercent = (draw: Draw): boolean => draw.call === 'random' && draw.from === 100 && draw.to === undefined;

/** Gens 3 and up: one `random(100)` per entry `ModifySecondaries` returned, in order. */
function hookedSecondary(draw: Draw, watch: BattleWatch, base: Base): DieName | null {
  const queue = watch.secondaries;
  const entry = queue?.entries[queue.next];
  if (!queue || !entry || !isPercent(draw)) return null;
  queue.next++;
  draw.chance = chanceOfEntry(entry.chance);
  // behind a Substitute the simulator hands the hook no target (a null): the body the move is aimed at stands in for it
  return { ...base, targetSlot: queue.targetSlot ?? watch.battle.activeTarget?.getSlot(), kind: 'secondary', effectId: secondaryEffectId(entry) };
}

/** Gens 1 and 2: the script's own `chance(n, 256)` after the hit, one per entry that has a chance, in order. */
function scriptedSecondary(draw: Draw, watch: BattleWatch, gen: number, base: Base): DieName | null {
  const { battle } = watch;
  if (draw.call !== 'chance' || draw.from !== 256 || watch.armed || inHandler(battle)) return null;
  const move = battle.activeMove as unknown as ActiveMoveLike;
  const entry = move.secondaries?.find(candidate => !watch.taken.has(candidate) && legacyDraws(gen, candidate, draw.numerator));
  if (!entry) return null;
  watch.taken.add(entry);
  return { ...base, targetSlot: battle.activeTarget?.getSlot(), kind: 'secondary', effectId: secondaryEffectId(entry) };
}

/** The secondary effect, by the rule of the generation. */
function secondaryDie(draw: Draw, watch: BattleWatch, gen: number, base: Base): DieName | null {
  const scope = watch.scope();
  if (gen >= 3) return scope === 'secondaries' ? hookedSecondary(draw, watch, base) : null;
  return scope === 'tryMoveHit' ? scriptedSecondary(draw, watch, gen, base) : null;
}

/** A chance a handler draws under its own event: a stalling move that succeeds again, a chance that changes a move's power. */
function handlerDie(draw: Draw, battle: Battle, base: Base): DieName | null {
  const event = (battle.event as { id?: string } | undefined)?.id;
  const effectId = (battle.effect as { id?: string } | undefined)?.id;
  if (draw.call !== 'chance') return null;
  if (event === 'StallMove') return { ...base, kind: 'stalling', effectId };
  if (event === 'BasePower') return { ...base, kind: 'power', effectId };
  return null;
}

/** The dice of a move that are not accuracy, crit or roll (A3a): secondaries, self effects, hit counts, stalling, power. */
function recognizeMoveDraw(draw: Draw, watch: BattleWatch, gen: number, base: Base): DieName | null {
  const { battle, armed } = watch;
  const scope = watch.scope();
  const quiet = !armed && !(battle.event as { id?: string } | undefined)?.id;
  const secondary = secondaryDie(draw, watch, gen, base);
  if (secondary) return secondary;
  if (isPercent(draw) && quiet && (scope === 'selfDrops' || (gen === 2 && scope === 'tryMoveHit'))) {
    draw.chance = chanceOfEntry((battle.activeMove as unknown as ActiveMoveLike).self?.chance);
    return { ...base, kind: 'self-effect' };
  }
  if (scope === hitCountScope(gen) && (draw.call === 'sample' || draw.call === 'random') && quiet) return { ...base, kind: 'hit-count' };
  return handlerDie(draw, battle, base);
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
