import type { BranchMoveOption, BranchSimState, SimPokemonInfo, DamageResult } from '@fulllifegames/eval-engine';

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
}

type LivingEnemy = { active: SimPokemonInfo; index: number };

/** Per-move damage of one active slot: targeted entries, the best untargeted range, and spread breakdowns. */
function slotDamage(args: {
  active: SimPokemonInfo;
  moves: BranchMoveOption[];
  enemySide: 'p1' | 'p2';
  enemyActives: LivingEnemy[];
  targetBySideSlot: { p1: Map<string, SimPokemonInfo | null>; p2: Map<string, SimPokemonInfo | null> };
  context: DamageContext;
  calc: CalcSingleDamageRange;
}) {
  const { active, moves, enemySide, enemyActives, targetBySideSlot, context, calc } = args;
  const defaults: DamageResult[] = [];
  const spread: Record<number, SpreadTargetDamage[]> = {};
  const targetEntries: [string, DamageResult][] = [];
  moves.forEach((move, moveIndex) => {
    for (const target of move.targetOptions) {
      const defender = targetBySideSlot[target.side].get(`${target.side}:${target.activeSlot}`);
      if (defender) {
        targetEntries.push([`${move.slot}:${target.targetLoc}`, calc(active, defender, move, context)]);
      }
    }

    if (enemyActives.length === 0) return;
    // Untargeted moves (spread/self/singles): one range per living enemy (G6).
    const perTarget = enemyActives.map(enemy => ({
      label: `${enemySide.toUpperCase()}${String.fromCharCode(65 + enemy.index)}`,
      result: calc(active, enemy.active, move, context),
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

/** The damage preview for both sides — the pure core of the picker's preview effect. */
export function computePreviewDamage(inputs: DamagePreviewInputs, calc: CalcSingleDamageRange): { p1: SideDamage; p2: SideDamage } {
  const { p1ActiveSlots, p2ActiveSlots, p1MovesBySlot, p2MovesBySlot, fieldState, gen } = inputs;
  const gameType = p1ActiveSlots.length > 1 || p2ActiveSlots.length > 1 ? 'Doubles' as const : 'Singles' as const;
  const contextFor = (attacker: 'p1' | 'p2') => ({
    gameType,
    gen,
    weather: fieldState?.weather,
    terrain: fieldState?.terrain,
    attackerSideConditions: attacker === 'p1' ? fieldState?.p1SideConditions : fieldState?.p2SideConditions,
    defenderSideConditions: attacker === 'p1' ? fieldState?.p2SideConditions : fieldState?.p1SideConditions,
  });
  const targetBySideSlot = {
    p1: new Map(p1ActiveSlots.map((active, index) => [`p1:${index}`, active])),
    p2: new Map(p2ActiveSlots.map((active, index) => [`p2:${index}`, active])),
  };

  const makeSideDamage = (side: 'p1' | 'p2'): SideDamage => {
    const activeSlots = side === 'p1' ? p1ActiveSlots : p2ActiveSlots;
    const movesBySlot = side === 'p1' ? p1MovesBySlot : p2MovesBySlot;
    const enemySide = side === 'p1' ? 'p2' : 'p1';
    const enemyActives = (side === 'p1' ? p2ActiveSlots : p1ActiveSlots)
      .map((active, index) => ({ active, index }))
      .filter((entry): entry is LivingEnemy =>
        !!entry.active && !entry.active.fainted && entry.active.hp > 0);
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
      const slot = slotDamage({ active, moves, enemySide, enemyActives, targetBySideSlot, context, calc });
      defaults[activeSlot] = slot.defaults;
      spread[activeSlot] = slot.spread;
      targets[activeSlot] = slot.targets;
    });

    return { default: defaults, targets, spread };
  };

  return { p1: makeSideDamage('p1'), p2: makeSideDamage('p2') };
}
