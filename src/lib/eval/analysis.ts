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
  /** Doubles: the per-slot actions this side actually took. */
  playedSlots?: (PlayedAction | null)[];
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
  /**
   * False when played actions were never parsed (doubles) — score movement
   * and engine lines still apply, but nothing may claim blame or "could not
   * act". Absent means true.
   */
  playedTracking?: boolean;
}

const choiceKeyOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Pure self-boosting moves. The maximin worst case prices a setup turn as
 * "took a hit for nothing" — the boost's payoff lies past the search
 * horizon, so regret against these moves reads systematically high.
 * Curated, not exhaustive: the moves competitive games actually see.
 */
const SETUP_MOVES = new Set([
  'acidarmor', 'agility', 'amnesia', 'autotomize', 'barrier', 'bellydrum',
  'bulkup', 'calmmind', 'clangoroussoul', 'coil', 'cosmicpower', 'cottonguard',
  'curse', 'defendorder', 'dragondance', 'filletaway', 'geomancy', 'growth',
  'honeclaws', 'irondefense', 'nastyplot', 'noretreat', 'quiverdance',
  'rockpolish', 'shellsmash', 'shiftgear', 'stockpile', 'swordsdance',
  'tailglow', 'victorydance', 'workup',
]);

/** The setup move this side actually clicked, if any (display name). */
export function playedSetupMove(side: SideAnalysis): string | null {
  const actions = side.playedSlots?.filter((action): action is PlayedAction => action !== null) ??
    (side.playedRaw ? [side.playedRaw] : []);
  const setup = actions.find(action => action.kind === 'move' && SETUP_MOVES.has(choiceKeyOf(action.name)));
  return setup?.name ?? null;
}

/** "Tera + X" labels contain the slot separator — re-merge after splitting. */
const splitCombinedLabel = (label: string): string[] => {
  const segments = label.split(' + ');
  const parts: string[] = [];
  for (let index = 0; index < segments.length; index++) {
    if ((segments[index] === 'Tera' || segments[index] === 'Mega' || segments[index] === 'Ultra') && index + 1 < segments.length) {
      parts.push(`${segments[index]} + ${segments[index + 1]}`);
      index += 1;
    } else {
      parts.push(segments[index]);
    }
  }
  return parts;
};

function slotMatches(choicePart: string, labelPart: string, action: PlayedAction): boolean {
  if (action.kind === 'switch') return labelPart === `→ ${action.species ?? action.name}`;
  const tokens = choicePart.split(' ');
  if (tokens[0] !== 'move' || tokens[1] !== choiceKeyOf(action.name)) return false;
  // Every gimmick marker must agree — a mega move must match the mega
  // variant, never the base option (VGC 2026 brought Megas back to gen 9).
  if (tokens.includes('terastallize') !== !!action.tera) return false;
  if (tokens.includes('mega') !== !!action.mega) return false;
  if (tokens.includes('ultra') !== !!action.ultra) return false;
  const locToken = tokens.find(token => /^-?\d+$/.test(token));
  // A locless fragment (spread/self move) accepts any protocol target.
  if (locToken !== undefined && action.targetLoc != null && parseInt(locToken, 10) !== action.targetLoc) return false;
  return true;
}

/**
 * Finds the combined (doubles) option matching the side's per-slot actions.
 * Generic over anything with choice + label, so the search restriction can
 * use it on raw options and the analysis on ranked results.
 */
export function findPlayedOption<T extends { choice: string; label: string }>(
  options: T[],
  slots: (PlayedAction | null)[] | undefined,
): T | null {
  const actions = (slots ?? []).filter((action): action is PlayedAction => action !== null);
  if (actions.length === 0) return null;
  return options.find(option => {
    const choiceParts = option.choice.split(',').map(part => part.trim());
    if (choiceParts.length !== actions.length) return false;
    const labelParts = splitCombinedLabel(option.label);
    return choiceParts.every((part, index) => slotMatches(part, labelParts[index] ?? '', actions[index]));
  }) ?? null;
}

/** Side dispatcher: doubles slots when present, singles action otherwise. */
export function matchPlayedSide(
  result: EvalResult,
  side: 'p1' | 'p2',
  played: PlayedTurn | null,
): RankedChoice | null {
  if (!played) return null;
  const slots = side === 'p1' ? played.p1Slots : played.p2Slots;
  if (slots) return findPlayedOption(result.perSide[side], slots);
  return matchPlayedChoice(result, side, played[side]);
}

export function matchPlayedChoice(
  result: EvalResult,
  side: 'p1' | 'p2',
  action: PlayedAction | null,
): RankedChoice | null {
  if (!action) return null;
  const options = result.perSide[side];
  if (action.kind === 'move') {
    const gimmick = action.tera ? ' terastallize' : action.mega ? ' mega' : action.ultra ? ' ultra' : '';
    const choice = `move ${choiceKeyOf(action.name)}${gimmick}`;
    return options.find(option => option.choice === choice) ?? null;
  }
  // Labels carry species names; the nickname is only a fallback for logs
  // where the species could not be parsed.
  return (action.species ? options.find(option => option.label === `→ ${action.species}`) : undefined) ??
    options.find(option => option.label === `→ ${action.name}`) ?? null;
}

export function analyzeTurn(params: {
  turn: number;
  result: EvalResult;
  played: PlayedTurn | null;
  playedOutcome: number | null;
  scoreBefore: number;
  scoreAfter: number | null;
  /** False = played actions unavailable (doubles); blame is off the table. */
  playedTracking?: boolean;
}): TurnAnalysis {
  const playedTracking = params.playedTracking !== false;
  const sideAnalysis = (key: 'p1' | 'p2'): SideAnalysis => {
    const playedRaw = params.played?.[key] ?? null;
    const playedSlots = key === 'p1' ? params.played?.p1Slots : params.played?.p2Slots;
    const played = matchPlayedSide(params.result, key, params.played);
    const best = params.result.perSide[key][0] ?? null;
    const regret = played && best ? Math.max(0, best.worstCase - played.worstCase) : null;
    return { playedRaw, ...(playedSlots ? { playedSlots } : {}), played, best, regret };
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
  if (!playedTracking) {
    // Without played actions only the movement itself can be described.
    attribution = swing !== null && Math.abs(swing) >= CHANCE_THRESHOLD ? 'shift' : 'quiet';
  } else if (p1Bad && p2Bad) attribution = 'both-decision';
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
    playedTracking,
  };
}
