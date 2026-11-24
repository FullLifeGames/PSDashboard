import type { Battle } from '@pkmn/sim';
import type { DieName, Draw, SecondaryEntry } from './types.ts';
import type { AllyList, BattleWatch } from './watch.ts';

/** Maps one draw of the simulator's PRNG to the name of a die, or null for a draw left to the stream (ADR 0002). */

interface RollShape {
  scope: 'randomizer' | 'getDamage';
  from: number;
  to?: number;
  steps: number;
  /** The raw value of a step; step 0 is the lowest damage. */
  raw(step: number): number;
}

interface GenShape {
  critHook: boolean;
  critCall: 'chance' | 'random';
  roll: RollShape;
}

// Gens 3 and up: `random(16)` in the randomizer; a lower value hurts more.
const ROLL_SIXTEEN: RollShape = { scope: 'randomizer', from: 16, steps: 16, raw: step => 15 - step };
// Gens 1 and 2: `damage *= random(217, 256)`; a higher value hurts more.
const ROLL_RANGE: RollShape = { scope: 'getDamage', from: 217, to: 256, steps: 39, raw: step => 217 + step };

const hitCountScope = (gen: number): string => (gen <= 3 ? 'tryMoveHit' : 'hitStepMoveHitLoop');

// `chance(n, 256)` in tryMoveHit: Gen 1 rounds percent up to 256ths (one kind takes one off); Gen 2 scales to 255.
function legacyDraws(gen: number, entry: SecondaryEntry, numerator: number | undefined): boolean {
  if (entry.chance === undefined) return false;
  if (gen === 1) {
    const rounded = Math.ceil(entry.chance * 256 / 100);
    return numerator === rounded || numerator === rounded - 1;
  }
  return numerator === Math.floor(entry.chance * 255 / 100);
}

export function secondaryEffectId(entry: SecondaryEntry): string {
  if (entry.status) return entry.status;
  if (entry.volatileStatus) return entry.volatileStatus;
  if (entry.boosts) return `boosts:${Object.keys(entry.boosts).join('+')}`;
  if (entry.self?.boosts) return `self:${Object.keys(entry.self.boosts).join('+')}`;
  if (entry.self?.volatileStatus) return `self:${entry.self.volatileStatus}`;
  return 'effect';
}

export const chanceOfEntry = (chance: number | undefined): number => (chance === undefined ? 1 : Math.min(1, chance / 100));

const HANDLERS = new Set(['Condition', 'Status', 'Item', 'Ability']);
const inHandler = (battle: Battle): boolean => HANDLERS.has((battle.effect as { effectType?: string } | undefined)?.effectType ?? '');

export const rollsAtTurnStart = (gen: number): boolean => gen === 2 || gen === 3;

// test/dice-recognize.spec.ts holds these numbers to the simulator in every generation and the Champions mod.
export function genShape(gen: number): GenShape {
  if (gen === 1) return { critHook: false, critCall: 'chance', roll: ROLL_RANGE };
  if (gen === 2) return { critHook: true, critCall: 'random', roll: ROLL_RANGE };
  return { critHook: true, critCall: 'chance', roll: ROLL_SIXTEEN };
}

const isRollCall = (draw: Draw, shape: RollShape): boolean =>
  draw.call === 'random' && draw.from === shape.from && draw.to === shape.to;

// Gen 2 on: the draw after `ModifyCritRatio` (Gen 2 compares `random(256)`); Gen 1: the chance inside `getDamage`.
function isCritDraw(draw: Draw, shape: GenShape, watch: BattleWatch): boolean {
  if (!shape.critHook) return watch.scope() === 'getDamage' && draw.call === 'chance';
  if (watch.armed?.kind !== 'crit' || draw.call !== shape.critCall) return false;
  return draw.call === 'chance' || (draw.from === 256 && draw.to === undefined);
}

/** The die this draw is, read at the moment of the draw; `gen` is the battle's (Champions plays as Gen 9). */
export function recognize(draw: Draw, watch: BattleWatch, gen: number): DieName | null {
  const { battle, armed } = watch;
  const first = pickedDie(draw, watch) ?? firstMoverDie(draw, battle) ?? endOfTurnDie(draw, watch);
  if (first) return first;
  const move = battle.activeMove;
  const user = battle.activePokemon;
  if (!move || !user) return null;
  const shape = genShape(gen);
  const base = { slot: user.getSlot(), moveId: move.id };
  const target = (): { targetSlot?: string; effectId?: string } => inCondition(battle, base.slot, battle.activeTarget?.getSlot());

  if (watch.scope() === shape.roll.scope && isRollCall(draw, shape.roll)) return { ...base, ...target(), kind: 'damage-roll' };
  if (isCritDraw(draw, shape, watch)) return { ...base, ...target(), kind: 'crit' };
  if (draw.call === 'chance' && armed?.kind === 'accuracy') return { ...base, targetSlot: armed.targetSlot, kind: 'accuracy', ...hitOf(move) };
  return recognizeMoveDraw(draw, watch, gen, base);
}

// `multiaccuracy` rolls each hit's accuracy at `move.hit` N (the first hit's, before the loop, at 0).
// Skill Link and Loaded Dice clear the flag, so their draws name no hit.
function hitOf(move: { multiaccuracy?: boolean; hit?: number }): { hit?: number } {
  return move.multiaccuracy && typeof move.hit === 'number' && move.hit >= 2 ? { hit: move.hit } : {};
}

type Base = { slot: string; moveId: string };
type ActiveMoveLike = { secondaries?: SecondaryEntry[]; self?: { chance?: number } };
const isPercent = (draw: Draw): boolean => draw.call === 'random' && draw.from === 100 && draw.to === undefined;

// Gens 3 and up: one `random(100)` per entry `ModifySecondaries` returned, in order.
function hookedSecondary(draw: Draw, watch: BattleWatch, base: Base): DieName | null {
  const queue = watch.secondaries;
  const entry = queue?.entries[queue.next];
  if (!queue || !entry || !isPercent(draw)) return null;
  queue.next++;
  draw.chance = chanceOfEntry(entry.chance);
  // Behind a Substitute the simulator hands the hook no target: the body the move is aimed at stands in.
  return { ...base, targetSlot: queue.targetSlot ?? watch.battle.activeTarget?.getSlot(), kind: 'secondary', effectId: secondaryEffectId(entry) };
}

// Gens 1 and 2: the script's own `chance(n, 256)` after the hit, one per entry that has a chance, in order.
function scriptedSecondary(draw: Draw, watch: BattleWatch, gen: number, base: Base): DieName | null {
  const { battle } = watch;
  if (draw.call !== 'chance' || draw.from !== 256 || watch.armed || inHandler(battle)) return null;
  const move = battle.activeMove as unknown as ActiveMoveLike;
  const entry = move.secondaries?.find(candidate => !watch.taken.has(candidate) && legacyDraws(gen, candidate, draw.numerator));
  if (!entry) return null;
  watch.taken.add(entry);
  return { ...base, targetSlot: battle.activeTarget?.getSlot(), kind: 'secondary', effectId: secondaryEffectId(entry) };
}

function secondaryDie(draw: Draw, watch: BattleWatch, gen: number, base: Base): DieName | null {
  const scope = watch.scope();
  if (gen >= 3) return scope === 'secondaries' ? hookedSecondary(draw, watch, base) : null;
  return scope === 'tryMoveHit' ? scriptedSecondary(draw, watch, gen, base) : null;
}

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

// Gens 3 and 4 Effect Spore then picks its status with a `sample` under the same event: that pick is the `:option` die.
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

// The count is drawn before the first hit starts (`move.hit` is still 0), with no handler in flight.
function hitCountDraw(draw: Draw, battle: Battle, scope: string | null, gen: number, quiet: boolean): boolean {
  const counted = battle.activeMove as unknown as { hit?: number; multihit?: unknown };
  return scope === hitCountScope(gen) && (draw.call === 'sample' || draw.call === 'random') && quiet && !counted.hit && !!counted.multihit;
}

function recognizeMoveDraw(draw: Draw, watch: BattleWatch, gen: number, base: Base): DieName | null {
  const { battle } = watch;
  const scope = watch.scope();
  // A hook left armed without a draw (Gen 2 skips the accuracy draw of a sure move) does not matter here.
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

// `getRandomTarget` runs before the move is in flight, so the watch hands over the user and the move it got.
// A draw inside a handler that a drag's switch-in or a redirect runs is not this call's own: only the innermost counts.
function pickedDie(draw: Draw, watch: BattleWatch): DieName | null {
  if (draw.call !== 'sample') return null;
  const scope = watch.scope();
  if (scope === 'getRandomTarget' && watch.aim) return { slot: watch.aim.slot, moveId: watch.aim.moveId, kind: 'random-target' };
  if (scope === 'getRandomSwitchable' && watch.dragged) return { slot: watch.dragged.slot, moveId: '', kind: 'drag' };
  return null;
}

// Gen 4 draws in the item's `BeforeTurn`, Gens 5 on in `FractionalPriority`.
const FIRST_MOVER_EVENTS = new Set(['FractionalPriority', 'BeforeTurn']);

function firstMoverDie(draw: Draw, battle: Battle): DieName | null {
  const event = battle.event as { id?: string; target?: { getSlot?: () => string } } | undefined;
  const effect = battle.effect as { id?: string; effectType?: string } | undefined;
  if (draw.call !== 'chance' || !event?.id || !FIRST_MOVER_EVENTS.has(event.id) || !effect?.id) return null;
  if (effect.effectType !== 'Item' && effect.effectType !== 'Ability') return null;
  const slot = event.target?.getSlot?.();
  return slot === undefined ? null : { slot, moveId: '', kind: 'move-first', effectId: effect.id };
}

// Healer draws once for each ally that has a status; the die names that ally, in the watch's order.
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

function nextAlly(allies: AllyList | null, holder: unknown, effectId: string): { getSlot(): string } | undefined {
  if (!allies || allies.holder !== holder || allies.effectId !== effectId) return undefined;
  allies.pending ??= allies.allies.filter(ally => ally.status);
  return allies.pending[allies.used++];
}

const RESIDUAL_EFFECTS = new Set(['Ability', 'Item', 'Condition', 'Status']);

// A draw in a condition's `BeforeMove` handler (the confusion self-hit's roll) is the condition's, not the move's.
function inCondition(battle: BattleWatch['battle'], slot: string, targetSlot: string | undefined): { targetSlot?: string; effectId?: string } {
  const event = (battle.event as { id?: string } | undefined)?.id;
  const effect = battle.effect as { id?: string; effectType?: string } | undefined;
  if (event === 'BeforeMove' && effect?.id && (effect.effectType === 'Condition' || effect.effectType === 'Status')) {
    return { targetSlot: slot, effectId: effect.id };
  }
  return targetSlot === undefined ? {} : { targetSlot };
}
