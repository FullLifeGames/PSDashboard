import type { EvalResult, RankedChoice } from './types';
import type { PlayedAction, PlayedTurn } from './played';

/**
 * Turns a sweep's cached per-turn data into a chess-style turn explanation:
 * what was played vs what the engine preferred (regret per side), and how
 * the score swing splits into a decision part and a chance part. Pure — no
 * @pkmn/sim imports, main-bundle safe.
 */

/** Regret (best − played, own perspective) that marks a decision problem. */
export const REGRET_THRESHOLD = 0.15;
/** Residual swing (actual − expected outcome) that marks a chance swing. */
export const CHANCE_THRESHOLD = 0.2;

export type TurnAttribution =
  | 'p1-decision' | 'p2-decision' | 'both-decision'
  | 'chance'
  /** A meaningful swing with no single culprit: decision and chance parts each stay under their thresholds. */
  | 'shift'
  | 'quiet' | 'unclear';

export interface SideAnalysis {
  playedRaw: PlayedAction | null;
  /** The played action matched into the engine's ranked list. */
  played: RankedChoice | null;
  best: RankedChoice | null;
  /** best.worstCase − played.worstCase (own perspective), floored at 0. */
  regret: number | null;
}

export interface TurnAnalysis {
  turn: number;
  scoreBefore: number;
  scoreAfter: number | null;
  swing: number | null;
  /** Engine expectation of the actually played pair (p1 perspective). */
  playedOutcome: number | null;
  /** playedOutcome − scoreBefore: the predictable consequence of the choices. */
  decisionDelta: number | null;
  /** scoreAfter − playedOutcome: rolls, crits, and model error. */
  chanceDelta: number | null;
  attribution: TurnAttribution;
  p1: SideAnalysis;
  p2: SideAnalysis;
}

const choiceKeyOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export function matchPlayedChoice(
  result: EvalResult,
  side: 'p1' | 'p2',
  action: PlayedAction | null,
): RankedChoice | null {
  if (!action) return null;
  const options = result.perSide[side];
  if (action.kind === 'move') {
    const choice = `move ${choiceKeyOf(action.name)}${action.tera ? ' terastallize' : ''}`;
    return options.find(option => option.choice === choice) ?? null;
  }
  return options.find(option => option.label === `→ ${action.name}`) ??
    (action.species ? options.find(option => option.label === `→ ${action.species}`) ?? null : null);
}

export function analyzeTurn(params: {
  turn: number;
  result: EvalResult;
  played: PlayedTurn | null;
  playedOutcome: number | null;
  scoreBefore: number;
  scoreAfter: number | null;
}): TurnAnalysis {
  const sideAnalysis = (key: 'p1' | 'p2'): SideAnalysis => {
    const playedRaw = params.played?.[key] ?? null;
    const played = matchPlayedChoice(params.result, key, playedRaw);
    const best = params.result.perSide[key][0] ?? null;
    const regret = played && best ? Math.max(0, best.worstCase - played.worstCase) : null;
    return { playedRaw, played, best, regret };
  };

  const p1 = sideAnalysis('p1');
  const p2 = sideAnalysis('p2');
  const swing = params.scoreAfter !== null ? params.scoreAfter - params.scoreBefore : null;
  const decisionDelta = params.playedOutcome !== null ? params.playedOutcome - params.scoreBefore : null;
  const chanceDelta = params.playedOutcome !== null && params.scoreAfter !== null
    ? params.scoreAfter - params.playedOutcome
    : null;

  const p1Bad = (p1.regret ?? 0) >= REGRET_THRESHOLD;
  const p2Bad = (p2.regret ?? 0) >= REGRET_THRESHOLD;
  let attribution: TurnAttribution;
  if (p1Bad && p2Bad) attribution = 'both-decision';
  else if (p1Bad) attribution = 'p1-decision';
  else if (p2Bad) attribution = 'p2-decision';
  else if (chanceDelta !== null && Math.abs(chanceDelta) >= CHANCE_THRESHOLD) attribution = 'chance';
  else if (swing !== null && Math.abs(swing) >= CHANCE_THRESHOLD) {
    // The score clearly moved but nothing crossed a blame threshold: either
    // a side's choice never surfaced (unclear), or pressure and rolls just
    // added up (shift) — never "quiet".
    attribution = p1.played === null || p2.played === null ? 'unclear' : 'shift';
  } else attribution = 'quiet';

  return {
    turn: params.turn,
    scoreBefore: params.scoreBefore,
    scoreAfter: params.scoreAfter,
    swing,
    playedOutcome: params.playedOutcome,
    decisionDelta,
    chanceDelta,
    attribution,
    p1,
    p2,
  };
}
