import type { Pokemon } from '@pkmn/sim';
import { boostedFraction, pairThreat, singleMoveFraction } from '../eval-function';
import { positionBattle, type ChoiceOption, type SimPosition } from '../forward-model';

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
  const sideState = battle.sides[side === 'p1' ? 0 : 1];
  const foeActives = sideState.foe.active;
  const foes = foeActives.filter((foe): foe is Pokemon => !!foe && !foe.fainted);
  const actors = sideState.active.filter((active): active is Pokemon => !!active && !active.fainted);
  return { battle, sideState, foeActives, foes, actors };
}

/** Damage-fraction gain a self-boosting move would buy over SETUP_HORIZON turns. */
function setupEquity(board: HintBoard, attacker: Pokemon, moveId: string): number {
  const { battle, foes } = board;
  const move = battle.dex.moves.get(moveId);
  const boosts = (move.boosts || move.self?.boosts || undefined) as { atk?: number; spa?: number } | undefined;
  if (!boosts || (!boosts.atk && !boosts.spa)) return 0;
  let equity = 0;
  for (const foe of foes) {
    const threat = pairThreat(attacker, foe, battle);
    const now = boostedFraction(threat, attacker, foe);
    const then = boostedFraction(threat, attacker, foe, {
      atk: clampStage(attacker.boosts.atk + (boosts.atk ?? 0)),
      spa: clampStage(attacker.boosts.spa + (boosts.spa ?? 0)),
    });
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

/** A move part: support floor or setup equity for status, spread damage, targeted or best-foe damage, the Fake Out bonus. */
function moveHint(board: HintBoard, tokens: string[], partIndex: number): number {
  const { battle, foeActives, foes, actors } = board;
  const attacker = actors[partIndex];
  if (!attacker || foes.length === 0) return 0;
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
export function combinedOptionHints(
  position: SimPosition,
  side: 'p1' | 'p2',
  options: ChoiceOption[],
): number[] {
  const board = hintBoard(position, side);
  return options.map(option =>
    option.choice.split(',').reduce((sum, part, partIndex) => sum + partHint(board, part, partIndex), 0));
}

/** Static hints for singles options: damage fraction for moves, threat differential for switches. */
export function singlesOptionHints(position: SimPosition, side: 'p1' | 'p2', options: ChoiceOption[]): number[] {
  const battle = positionBattle(position);
  const sideState = battle.sides[side === 'p1' ? 0 : 1];
  const opponent = battle.sides[side === 'p1' ? 1 : 0].active[0];
  const active = sideState.active[0];
  const hint = (option: ChoiceOption): number => {
    if (!opponent || opponent.fainted) return 0;
    if (option.choice.startsWith('move ')) {
      if (!active || active.fainted) return 0;
      return singleMoveFraction(active, opponent, option.choice.split(' ')[1], battle);
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
