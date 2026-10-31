import type { Battle } from '@pkmn/sim';
import type { DieName, Draw, SecondaryEntry } from './types.ts';
import type { AllyList, BattleWatch } from './watch.ts';

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
 * Round 82, step A3b: a chance a condition draws in its `BeforeMove` handler is a status check of the body about to move
 * (full paralysis, the thaw, the infatuation, the confusion check); the chance of an item's or an ability's `FractionalPriority`
 * handler (Gen 4: the item's `BeforeTurn`) is a die that lets its holder act first. The second kind runs when the queue is
 * built, with no move in flight: the holder is the event's target. Gens 2 and 3 draw that die once at the start of the turn,
 * outside any action, and read it from `battle.quickClawRoll`: no draw of the turn is named for it (`rollsAtTurnStart`).
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
export const chanceOfEntry = (chance: number | undefined): number => (chance === undefined ? 1 : Math.min(1, chance / 100));

const HANDLERS = new Set(['Condition', 'Status', 'Item', 'Ability']);
/** A draw inside a condition's, an item's or an ability's handler belongs to it, not to the script that called it. */
const inHandler = (battle: Battle): boolean => HANDLERS.has((battle.effect as { effectType?: string } | undefined)?.effectType ?? '');

/** Gens 2 and 3 draw the die that lets a holder act first at the start of every turn and keep it in `battle.quickClawRoll`. */
export const rollsAtTurnStart = (gen: number): boolean => gen === 2 || gen === 3;

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
  const first = firstMoverDie(draw, battle) ?? endOfTurnDie(draw, watch);
  if (first) return first;
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

/**
 * A chance a handler draws under its own event: a stalling move that succeeds again, a chance that changes a move's power, and
 * the status check of a condition on the body about to move (`BeforeMove`).
 */
function handlerDie(draw: Draw, battle: Battle, base: Base): DieName | null {
  const event = (battle.event as { id?: string } | undefined)?.id;
  const effect = battle.effect as { id?: string; effectType?: string } | undefined;
  if (draw.call !== 'chance') return null;
  if (event === 'StallMove') return { ...base, kind: 'stalling', effectId: effect?.id };
  if (event === 'BasePower') return { ...base, kind: 'power', effectId: effect?.id };
  if (event === 'BeforeMove' && effect?.id && (effect.effectType === 'Condition' || effect.effectType === 'Status')) {
    return { ...base, kind: 'status-check', effectId: effect.id };
  }
  return null;
}

/**
 * Round 82, step A4: a proc of the move's hit. An ability's handler draws a chance (a contact ability, Cursed Body, Poison Touch,
 * Toxic Chain) or a number from 0 to 99 (Effect Spore) when its holder was hit or hit; an item's handler draws a chance under
 * `Damage` (the Focus Band). The die names the user of the move, the body that was hit (the event's target) and the holder's
 * ability or item. The Gens 3 and 4 Effect Spore then picks its status with a `sample` under the same event: that pick is its own
 * die, told apart by `:option`.
 */
function procDie(draw: Draw, battle: Battle, base: Base): DieName | null {
  const event = battle.event as { id?: string; target?: { getSlot?: () => string } } | undefined;
  const effect = battle.effect as { id?: string; effectType?: string } | undefined;
  const targetSlot = event?.target?.getSlot?.();
  if (!effect?.id || !targetSlot) return null;
  const named = { ...base, targetSlot };
  if (effect.effectType === 'Ability') return abilityProc(draw, event?.id, effect.id, named);
  return effect.effectType === 'Item' && draw.call === 'chance' && event?.id === 'Damage' ? { ...named, kind: 'item-proc', effectId: effect.id } : null;
}

function abilityProc(draw: Draw, event: string | undefined, id: string, named: Base & { targetSlot: string }): DieName | null {
  if (draw.call === 'sample') return event === 'DamagingHit' ? { ...named, kind: 'ability-proc', effectId: `${id}:option` } : null;
  return draw.call === 'chance' || isPercent(draw) ? { ...named, kind: 'ability-proc', effectId: id } : null;
}

/**
 * The count is drawn for a move with a `multihit` before the first hit starts (`move.hit` is still 0), with no handler in
 * flight; a duration or a pick is no count.
 */
function hitCountDraw(draw: Draw, battle: Battle, scope: string | null, gen: number, quiet: boolean): boolean {
  const counted = battle.activeMove as unknown as { hit?: number; multihit?: unknown };
  return scope === hitCountScope(gen) && (draw.call === 'sample' || draw.call === 'random') && quiet && !counted.hit && !!counted.multihit;
}

/** The dice of a move that are not accuracy, crit or roll (A3a): secondaries, self effects, hit counts, stalling, power. */
function recognizeMoveDraw(draw: Draw, watch: BattleWatch, gen: number, base: Base): DieName | null {
  const { battle } = watch;
  const scope = watch.scope();
  // no handler in flight; a hook left armed without a draw (Gen 2 skips the accuracy draw of a sure move) does not matter here
  const quiet = !(battle.event as { id?: string } | undefined)?.id;
  const secondary = secondaryDie(draw, watch, gen, base);
  if (secondary) return secondary;
  if (isPercent(draw) && quiet && (scope === 'selfDrops' || (gen === 2 && scope === 'tryMoveHit'))) {
    draw.chance = chanceOfEntry((battle.activeMove as unknown as ActiveMoveLike).self?.chance);
    return { ...base, kind: 'self-effect' };
  }
  if (hitCountDraw(draw, battle, scope, gen, quiet)) return { ...base, kind: 'hit-count' };
  return handlerDie(draw, battle, base) ?? procDie(draw, battle, base);
}

/** Events whose handler lets its holder act first: Gen 4 draws in the item's `BeforeTurn`, Gens 5 on in `FractionalPriority`. */
const FIRST_MOVER_EVENTS = new Set(['FractionalPriority', 'BeforeTurn']);

/**
 * The die that lets the holder of an item or an ability act first in its priority bracket. The handler runs while the queue is
 * built (or before the turn's first action), so no move is in flight and the holder is the event's target.
 */
function firstMoverDie(draw: Draw, battle: Battle): DieName | null {
  const event = battle.event as { id?: string; target?: { getSlot?: () => string } } | undefined;
  const effect = battle.effect as { id?: string; effectType?: string } | undefined;
  if (draw.call !== 'chance' || !event?.id || !FIRST_MOVER_EVENTS.has(event.id) || !effect?.id) return null;
  if (effect.effectType !== 'Item' && effect.effectType !== 'Ability') return null;
  const slot = event.target?.getSlot?.();
  return slot === undefined ? null : { slot, moveId: '', kind: 'move-first', effectId: effect.id };
}

/**
 * Round 82, step A4: a chance a handler draws under `Residual`, the end of the turn (Shed Skin, Harvest, Healer, the Gen 2 thaw).
 * No move is in flight; the holder is the event's target. A handler that asked for the holder's allies (Healer) draws once for
 * each ally that has a status, and the die names that ally: the watch gives the allies in order.
 */
function endOfTurnDie(draw: Draw, watch: BattleWatch): DieName | null {
  const { battle } = watch;
  const event = battle.event as { id?: string; target?: { getSlot?: () => string } } | undefined;
  const effect = battle.effect as { id?: string; effectType?: string } | undefined;
  const slot = event?.target?.getSlot?.();
  if (draw.call !== 'chance' || event?.id !== 'Residual' || !effect?.id || !slot) return null;
  if (!RESIDUAL_EFFECTS.has(effect.effectType ?? '')) return null;
  const name: DieName = { slot, moveId: '', kind: 'end-of-turn', effectId: effect.id };
  const ally = nextAlly(watch.allies, event.target, effect.id);
  return ally ? { ...name, targetSlot: ally.getSlot() } : name;
}

/** The next ally with a status that a handler looping over its holder's allies is drawing for. */
function nextAlly(allies: AllyList | null, holder: unknown, effectId: string): { getSlot(): string } | undefined {
  if (!allies || allies.holder !== holder || allies.effectId !== effectId) return undefined;
  allies.pending ??= allies.allies.filter(ally => ally.status);
  return allies.pending[allies.used++];
}

/** The kinds of effect that hold a Residual handler of a body. */
const RESIDUAL_EFFECTS = new Set(['Ability', 'Item', 'Condition', 'Status']);

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
