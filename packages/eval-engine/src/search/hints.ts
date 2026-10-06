import type { BoostsTable, Pokemon } from '@pkmn/sim';
import { boostedFraction, pairThreat, singleMoveFraction } from '../eval-function.ts';
import { positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { sideIndex } from '@fulllifegames/replay-core';

/**
 * Static per-option threat hints — the machinery candidate restriction
 * ranks with and the MCTS expansion order reuses (zero sim advances).
 */

export const isCombined = (options: ChoiceOption[]) => options.some(option => option.choice.includes(','));

/** Floor hint for any status move: Protect, redirection, speed control stay rankable. */
const SUPPORT_HINT = 0.25;
/** Fake Out on the turn it works: damage plus one neutralized foe action. */
const FLINCH_BONUS = 0.3;
/** Boost payoff counted for ~2 future attacks. */
const SETUP_HORIZON = 2;
/** Spread moves hit both foes, at the doubles spread penalty. */
const SPREAD_FACTOR = 0.75;

const clampStage = (stage: number) => Math.max(-6, Math.min(6, stage));

/** The board one side's combined-option hints read: the mover's actors, the foes, and their slot order. */
interface HintBoard {
  battle: ReturnType<typeof positionBattle>;
  sideState: ReturnType<typeof positionBattle>['sides'][number];
  foeActives: (Pokemon | null)[];
  foes: Pokemon[];
  actors: Pokemon[];
}

function hintBoard(position: SimPosition, side: 'p1' | 'p2'): HintBoard {
  const battle = positionBattle(position);
  const sideState = battle.sides[sideIndex(side)];
  const foeActives = sideState.foe.active;
  const foes = foeActives.filter((foe): foe is Pokemon => !!foe && !foe.fainted);
  const actors = sideState.active.filter((active): active is Pokemon => !!active && !active.fainted);
  return { battle, sideState, foeActives, foes, actors };
}

type DexMove = ReturnType<HintBoard['battle']['dex']['moves']['get']>;

/** Every stat a stage can sit on. */
const STAGES = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'] as const;

/**
 * The stages a status move gives its user, as the simulator applies them
 * (round 64, T125): `self.boosts` always land on the user, the move's own
 * `boosts` on its targets, and the user is among them only for the target
 * classes 'self' and 'allies' (the simulator's alliesAndSelf). Swagger and
 * Decorate raise the target, Coaching the ally: none of them is the user's
 * setup. test/setup-equity.spec.ts plays every Dex move with stages in the
 * simulator against this reading.
 */
export function ownStages(move: DexMove): Partial<BoostsTable> | null {
  const onUser = move.target === 'self' || move.target === 'allies' ? move.boosts : null;
  const self = move.self?.boosts;
  if (!onUser && !self) return null;
  const stages: Partial<BoostsTable> = {};
  for (const stat of STAGES) {
    const stage = (onUser?.[stat] ?? 0) + (self?.[stat] ?? 0);
    if (stage) stages[stat] = stage;
  }
  return Object.keys(stages).length > 0 ? stages : null;
}

/**
 * Damage-fraction gain a self-boosting move would buy over SETUP_HORIZON
 * turns. Since round 63 (T81) every stage a damage fraction reads counts:
 * Iron Defense buys a Body Press carrier its Defense, Calm Mind buys a
 * Stored Power carrier its power (boostedFraction reads PairThreat.axes).
 * Since round 64 (T125) only the user's own stages count, all seven of them:
 * a stage no move of the carrier reads changes no fraction, and Agility buys
 * Stored Power its power.
 */
function setupEquity(board: HintBoard, attacker: Pokemon, moveId: string): number {
  const { battle, foes } = board;
  const boosts = ownStages(battle.dex.moves.get(moveId));
  if (!boosts) return 0;
  const stages: Partial<BoostsTable> = {};
  for (const stat of STAGES) stages[stat] = clampStage(attacker.boosts[stat] + (boosts[stat] ?? 0));
  let equity = 0;
  for (const foe of foes) {
    const threat = pairThreat(attacker, foe, battle);
    const now = boostedFraction(threat, attacker, foe);
    const then = boostedFraction(threat, attacker, foe, stages);
    equity = Math.max(equity, (then - now) * SETUP_HORIZON);
  }
  return equity;
}

/** A switch part: the candidate's threat differential against the strongest foe. */
function switchHint(board: HintBoard, tokens: string[]): number {
  const { battle, sideState, foes } = board;
  const candidate = sideState.pokemon[parseInt(tokens[1], 10) - 1];
  if (!candidate || foes.length === 0) return 0;
  return Math.max(...foes.map(foe =>
    boostedFraction(pairThreat(candidate, foe, battle), candidate, foe) -
    boostedFraction(pairThreat(foe, candidate, battle), foe, candidate)));
}

/**
 * A Tera option is hinted on the terastallized body (round 63, T81, the hint
 * part of T84): its STAB, Tera Blast and the 60-power floor follow the Tera
 * type. The body is set terastallized for the call and restored, the idiom
 * of speed.ts effectiveSpeed.
 */
function asClicked<T>(attacker: Pokemon, clicked: boolean, ask: () => T): T {
  if (!clicked || attacker.terastallized || !attacker.teraType) return ask();
  attacker.terastallized = attacker.teraType;
  try {
    return ask();
  } finally {
    attacker.terastallized = undefined;
  }
}

/** A move part: support floor or setup equity for status, spread damage, targeted or best-foe damage, the Fake Out bonus. */
function moveHint(board: HintBoard, tokens: string[], partIndex: number): number {
  const attacker = board.actors[partIndex];
  if (!attacker || board.foes.length === 0) return 0;
  return asClicked(attacker, tokens.includes('terastallize'), () => moveHintOf(board, tokens, attacker));
}

function moveHintOf(board: HintBoard, tokens: string[], attacker: Pokemon): number {
  const { battle, foeActives, foes } = board;
  const move = battle.dex.moves.get(tokens[1]);
  if (move.category === 'Status') return Math.max(SUPPORT_HINT, setupEquity(board, attacker, tokens[1]));
  if (move.target === 'allAdjacentFoes' || move.target === 'allAdjacent') {
    return foes.reduce((sum, foe) => sum + singleMoveFraction(attacker, foe, tokens[1], battle), 0) * SPREAD_FACTOR;
  }
  const targetLoc = tokens.length > 2 ? parseInt(tokens[2], 10) : NaN;
  let damage: number;
  if (Number.isFinite(targetLoc) && targetLoc > 0) {
    const foe = foeActives[targetLoc - 1];
    damage = foe && !foe.fainted ? singleMoveFraction(attacker, foe, tokens[1], battle) : 0;
  } else {
    damage = Math.max(...foes.map(foe => singleMoveFraction(attacker, foe, tokens[1], battle)));
  }
  if (move.id === 'fakeout' && attacker.activeMoveActions === 0) damage += FLINCH_BONUS;
  return damage;
}

function partHint(board: HintBoard, part: string, partIndex: number): number {
  const tokens = part.trim().split(' ');
  if (tokens[0] === 'switch') return switchHint(board, tokens);
  if (tokens[0] !== 'move') return 0;
  return moveHint(board, tokens, partIndex);
}

/** Summed per-slot static threat hints for combined doubles options. */
/**
 * The hint of every part a position has priced, per side and slot (round 63,
 * T112). A doubles node ranks some hundred combos built from a few dozen
 * parts and hints its kept combos a second time for the expansion order; each
 * part is now priced once per position (the round-63 count: 9 to 11 % of the
 * parts are distinct). A position's battle never changes once built (a hint
 * that reads a body on other terms restores it: asClicked, effectiveSpeed),
 * so a part's hint is a function of the position, the side, the slot and the
 * part. Singles hint each position and side once and keep their path.
 */
const partHints = new WeakMap<SimPosition, Map<string, number>>();

function partMemo(position: SimPosition): Map<string, number> {
  let memo = partHints.get(position);
  if (!memo) {
    memo = new Map();
    partHints.set(position, memo);
  }
  return memo;
}

export function combinedOptionHints(
  position: SimPosition,
  side: 'p1' | 'p2',
  options: ChoiceOption[],
): number[] {
  const memo = partMemo(position);
  let board: HintBoard | null = null;
  return options.map(option =>
    option.choice.split(',').reduce((sum, part, partIndex) => {
      const key = `${side}:${partIndex}:${part}`;
      let hint = memo.get(key);
      if (hint === undefined) {
        board ??= hintBoard(position, side);
        hint = partHint(board, part, partIndex);
        memo.set(key, hint);
      }
      return sum + hint;
    }, 0));
}

/** Static hints for singles options: damage fraction for moves, threat differential for switches. */
export function singlesOptionHints(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): number[] {
  const battle = positionBattle(position);
  const sideState = battle.sides[sideIndex(side)];
  const opponent = battle.sides[side === 'p1' ? 1 : 0].active[0];
  const active = sideState.active[0];
  const hint = (option: ChoiceOption): number => {
    // The waiting side's sentinel (mid-turn nodes, round 42): nothing to rank.
    if (option.choice === 'wait') return 0;
    if (!opponent || opponent.fainted) return 0;
    if (option.choice.startsWith('move ')) {
      if (!active || active.fainted) return 0;
      return asClicked(active, option.choice.endsWith(' terastallize'),
        () => singleMoveFraction(active, opponent, option.choice.split(' ')[1], battle));
    }
    const slot = parseInt(option.choice.split(' ')[1], 10);
    const candidate = sideState.pokemon[slot - 1];
    if (!candidate) return 0;
    return boostedFraction(pairThreat(candidate, opponent, battle), candidate, opponent) -
      boostedFraction(pairThreat(opponent, candidate, battle), opponent, candidate);
  };
  return options.map(hint);
}

/**
 * Static per-option threat hints — the SAME machinery candidate restriction
 * ranks with, exported so the MCTS expansion order can reuse it (zero sim
 * advances). Combined doubles options sum per-slot hints (support floor,
 * setup equity, spread factor); singles use damage fraction for moves and
 * the threat differential for switches.
 */
export function optionHints(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): number[] {
  if (isCombined(options)) return combinedOptionHints(position, side, options);
  return singlesOptionHints(position, side, options);
}
