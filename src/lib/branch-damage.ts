import type { BranchMoveOption, BranchSimState, BranchSlotChoice, SimPokemonInfo, DamageResult } from '@fulllifegames/eval-engine';

export interface SpreadTargetDamage {
  label: string;
  result: DamageResult;
}

export interface SideDamage {
  default: DamageResult[][];
  targets: Record<number, Record<string, DamageResult | undefined>>;
  spread: Record<number, Record<number, SpreadTargetDamage[]>>;
}

export const EMPTY_SIDE_DAMAGE: SideDamage = { default: [], targets: {}, spread: {} };

const EMPTY_MOVES: BranchMoveOption[] = [];

type CalcSingleDamageRange = typeof import('./lazy/damage-calc')['calcSingleDamageRange'];
type DamageContext = Parameters<CalcSingleDamageRange>[3];

export interface DamagePreviewInputs {
  p1ActiveSlots: (SimPokemonInfo | null)[];
  p2ActiveSlots: (SimPokemonInfo | null)[];
  p1MovesBySlot: BranchMoveOption[][];
  p2MovesBySlot: BranchMoveOption[][];
  fieldState: BranchSimState['field'] | null;
  gen: number;
  /**
   * The Tera type each slot's armed toggle would take, null when off. The
   * preview reads it as the calc reads a Pokémon after the click: attacking
   * and defending in its Tera type (T20). Mega, Ultra Burst and Z stay out.
   */
  teraBySlot?: { p1: (string | null)[]; p2: (string | null)[] };
  /**
   * Both sides' picks so far (live tip or draft). The preview reads what the
   * defender's partner chose: a Protect there turns the second Dragon Dart
   * back onto the defender (T124).
   */
  choices?: { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };
}

type LivingEnemy = { active: SimPokemonInfo; index: number };
type SlotsBySide = { p1: (SimPokemonInfo | null)[]; p2: (SimPokemonInfo | null)[] };
type ChoicesBySide = NonNullable<DamagePreviewInputs['choices']>;

const NO_CHOICES: ChoicesBySide = { p1: [], p2: [] };

const isLiving = (info: SimPokemonInfo | null | undefined): info is SimPokemonInfo =>
  !!info && !info.fainted && info.hp > 0;

/**
 * Doubles: who else stands next to the defender and the attacker, so the
 * calc lands the move as the simulator does (one target, no spread factor;
 * Dragon Darts split over two foes, unless the partner's pick shields it).
 * The partner is never the attacker.
 */
function fieldFacts(slots: SlotsBySide, choices: ChoicesBySide, attacker: SimPokemonInfo, defenderSide: 'p1' | 'p2', defenderSlot: number) {
  const attackerSide = slots.p1.includes(attacker) ? 'p1' : 'p2';
  const partnerSlot = slots[defenderSide].findIndex((info, slot) => slot !== defenderSlot && info !== attacker && isLiving(info));
  const partnerPick = choices[defenderSide][partnerSlot];
  return {
    defenderPartner: slots[defenderSide][partnerSlot] ?? null,
    ...(partnerPick?.kind === 'move' ? { defenderPartnerMove: partnerPick.moveId } : {}),
    attackerPartnerAlive: slots[attackerSide].some(info => info !== attacker && isLiving(info)),
  };
}

/** Per-move damage of one active slot: targeted entries, the best untargeted range, and spread breakdowns. */
function slotDamage(args: {
  active: SimPokemonInfo;
  moves: BranchMoveOption[];
  enemySide: 'p1' | 'p2';
  enemyActives: LivingEnemy[];
  slots: SlotsBySide;
  choices: ChoicesBySide;
  context: DamageContext;
  calc: CalcSingleDamageRange;
}) {
  const { active, moves, enemySide, enemyActives, slots, choices, context, calc } = args;
  const defaults: DamageResult[] = [];
  const spread: Record<number, SpreadTargetDamage[]> = {};
  const targetEntries: [string, DamageResult][] = [];
  const contextInto = (side: 'p1' | 'p2', slot: number): DamageContext =>
    (context?.gameType === 'Doubles' ? { ...context, ...fieldFacts(slots, choices, active, side, slot) } : context);
  moves.forEach((move, moveIndex) => {
    for (const target of move.targetOptions) {
      const defender = slots[target.side][target.activeSlot];
      if (defender) {
        targetEntries.push([`${move.slot}:${target.targetLoc}`, calc(active, defender, move, contextInto(target.side, target.activeSlot))]);
      }
    }

    if (enemyActives.length === 0) return;
    // Untargeted moves (spread/self/singles): one range per living enemy (G6).
    const perTarget = enemyActives.map(enemy => ({
      label: `${enemySide.toUpperCase()}${String.fromCharCode(65 + enemy.index)}`,
      result: calc(active, enemy.active, move, contextInto(enemySide, enemy.index)),
    }));
    const best = perTarget.reduce((currentBest, candidate) =>
      candidate.result.maxPercent > currentBest.result.maxPercent ? candidate : currentBest,
    perTarget[0]);
    defaults[moveIndex] = best.result;
    if (move.targetOptions.length === 0 && perTarget.length > 1 &&
      perTarget.some(target => target.result.maxPercent > 0)) {
      spread[move.slot] = perTarget;
    }
  });
  return { defaults, spread, targets: Object.fromEntries(targetEntries) };
}

/** The active slots as the calc sees them once the armed Tera toggles take effect. */
function withTera(slots: (SimPokemonInfo | null)[], tera: (string | null)[] | undefined): (SimPokemonInfo | null)[] {
  if (!tera?.some(Boolean)) return slots;
  return slots.map((info, slot) => {
    const teraType = tera[slot];
    return info && teraType ? { ...info, teraType } : info;
  });
}

/** The damage preview for both sides — the pure core of the picker's preview effect. */
export function computePreviewDamage(inputs: DamagePreviewInputs, calc: CalcSingleDamageRange): { p1: SideDamage; p2: SideDamage } {
  const { p1MovesBySlot, p2MovesBySlot, fieldState, gen } = inputs;
  const p1ActiveSlots = withTera(inputs.p1ActiveSlots, inputs.teraBySlot?.p1);
  const p2ActiveSlots = withTera(inputs.p2ActiveSlots, inputs.teraBySlot?.p2);
  const gameType = p1ActiveSlots.length > 1 || p2ActiveSlots.length > 1 ? 'Doubles' as const : 'Singles' as const;
  const contextFor = (attacker: 'p1' | 'p2') => ({
    gameType,
    gen,
    weather: fieldState?.weather,
    terrain: fieldState?.terrain,
    attackerSideConditions: attacker === 'p1' ? fieldState?.p1SideConditions : fieldState?.p2SideConditions,
    defenderSideConditions: attacker === 'p1' ? fieldState?.p2SideConditions : fieldState?.p1SideConditions,
  });
  const slots: SlotsBySide = { p1: p1ActiveSlots, p2: p2ActiveSlots };
  const choices = inputs.choices ?? NO_CHOICES;

  const makeSideDamage = (side: 'p1' | 'p2'): SideDamage => {
    const activeSlots = side === 'p1' ? p1ActiveSlots : p2ActiveSlots;
    const movesBySlot = side === 'p1' ? p1MovesBySlot : p2MovesBySlot;
    const enemySide = side === 'p1' ? 'p2' : 'p1';
    const enemyActives = (side === 'p1' ? p2ActiveSlots : p1ActiveSlots)
      .map((active, index) => ({ active, index }))
      .filter((entry): entry is LivingEnemy => isLiving(entry.active));
    const context = contextFor(side);

    const defaults: DamageResult[][] = [];
    const spread: SideDamage['spread'] = {};
    const targets: SideDamage['targets'] = {};

    activeSlots.forEach((active, activeSlot) => {
      const moves = movesBySlot[activeSlot] ?? EMPTY_MOVES;
      defaults[activeSlot] = [];
      spread[activeSlot] = {};
      targets[activeSlot] = {};
      if (!active || moves.length === 0) return;
      const slot = slotDamage({ active, moves, enemySide, enemyActives, slots, choices, context, calc });
      defaults[activeSlot] = slot.defaults;
      spread[activeSlot] = slot.spread;
      targets[activeSlot] = slot.targets;
    });

    return { default: defaults, targets, spread };
  };

  return { p1: makeSideDamage('p1'), p2: makeSideDamage('p2') };
}
