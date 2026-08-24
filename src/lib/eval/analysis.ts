// Data-only Dex (move priorities for the stay-in phantom) — this module is
// in the app's MAIN bundle; @pkmn/sim must never be imported here.
import { Dex } from '@pkmn/dex';
import type { EvalMatrix, EvalResult, KoOddsInfo, RankedChoice, ReadRecommendation } from './types';
import { nullMoveReason } from './null-moves';
import { detectStreakOdds, type StreakHistoryEntry, type StreakOdds } from './streaks';
import { TIE_EPSILON } from './rank';
import type { PlayedAction, PlayedTurn, SackInfo } from './played';

/**
 * Turns a sweep's cached per-turn data into a chess-style turn explanation:
 * what was played vs what the engine preferred (regret per side), and how
 * the score swing splits into a decision part and a chance part. Pure — no
 * @pkmn/sim imports, main-bundle safe.
 */

/**
 * Chess-style verdict bands on the EV-regret, in WP-UNITS (0.1 = 5% win
 * probability): 5% / 10% / 20% win-prob loss. Half of Lichess's 10/20/30
 * bands — deliberately: the score-space thresholds flagged ~3–5% losses as
 * mistakes (the T22/T26/T29 over-flagging), while full Lichess bands would
 * barely flag anything at this engine's confidence levels.
 */
export type VerdictTier = 'inaccuracy' | 'mistake' | 'blunder';
export const TIER_THRESHOLDS: Record<VerdictTier, number> = {
  inaccuracy: 0.1,
  mistake: 0.2,
  blunder: 0.4,
};
/**
 * Lichess-style leniency: once the game is this decided (own perspective;
 * 0.7 wp-units = 85% win probability), verdicts soften one tier — piling
 * blame onto a lost position teaches nothing, and a winning position
 * forgives small imprecision. KEPT after the wp-unit conversion: sigmoid
 * compression already shrinks decided-position regrets, but garbage-time
 * turns still produce band-crossing regrets when the leaf spread is wide.
 */
export const DECIDED_SCORE = 0.7;

/**
 * Own-perspective score at or above which a HEALTHY-body feed can read as a
 * deliberate simplification sack (both before and after the sack). Anchored
 * to the calibration buckets: |score| 0.4–0.7 wins for the favored side 77%
 * of the time — "decisively ahead", where surplus material buys certainty.
 */
export const HEALTHY_SACK_FLOOR = 0.4;

/** Regret (best − played, own perspective) that marks a decision problem. */
export const REGRET_THRESHOLD = TIER_THRESHOLDS.mistake;
/**
 * Residual swing (actual − expected outcome) that marks a chance swing.
 * Derived from the tier bands (re-derived with them for wp-units): the roll
 * "mattered" when it moved the game a mistake-sized amount.
 */
export const CHANCE_THRESHOLD = TIER_THRESHOLDS.mistake;

export type TurnAttribution =
  | 'p1-decision' | 'p2-decision' | 'both-decision'
  /** A flagged risk whose read won real value — graded as a good play, not a mistake. */
  | 'p1-read' | 'p2-read' | 'both-read'
  | 'chance'
  /** A meaningful swing with no single culprit: decision and chance parts each stay under their thresholds. */
  | 'shift'
  | 'quiet' | 'unclear';

/**
 * A risk pays off when the actual pair's expected value beats the safe
 * line's GUARANTEE by at least this much (own perspective). Comparing
 * against the floor is deliberate: the guarantee is exactly what the safe
 * player locks in — beating it is what the read earned. Derived from the
 * tier bands (wp-units): an inaccuracy-sized edge is a real edge.
 */
export const RISK_PAYOFF_MARGIN = TIER_THRESHOLDS.inaccuracy;

/**
 * Measurement-noise tolerance UNDER the payoff margin for the paid-off
 * credit only: static-eval repricing legitimately moves guarantees at the
 * third decimal, and a knife-edge credit must not flip with it (648453
 * t20: a pinned paid-off read at 0.1006 fell to 0.0972 when stranded
 * pricing moved the safe floor by 0.0033). Same epsilon scale as the
 * rank-tie and feed-certainty gates. The feed payoff gate and the
 * clearly-failed exit stay strict — this widens praise, never excuses.
 */
export const RISK_PAYOFF_EPSILON = 0.02;

/**
 * How many FUTURE turns a read gets to cash in: setup and positional plays
 * bank their payoff over the following expected outcomes, not one turn. The
 * chain uses depth-matched expectations only — rolls stay in the luck ledger.
 */
export const PAYOFF_WINDOW = 3;

/**
 * A stay-and-die feed's certainty gate: the played line's ev may exceed its
 * floor by at most this much to count as "the player accepted the known
 * worst case" (573756 t68: floor = ev exactly). Same epsilon scale as the
 * rank-tie threshold.
 */
export const FEED_CERTAINTY_EPSILON = 0.02;

/**
 * Both sides must have at least this many VIABLE options (within an
 * inaccuracy of best) before a culprit-free swing reads as a genuinely open
 * turn instead of a drift (562428 t10: the expert counted four-plus live
 * options per side and called the turn a read, not a shift).
 */
export const BREADTH_MIN_OPTIONS = 4;

/**
 * A recommendation conflicts with the engine's own play when the side's
 * equilibrium mix puts at least this much weight on a DIFFERENT choice than
 * the argmax-EV pick — the "better was X" line then owes the reader the
 * condition under which X actually is the pick (653785 t19).
 */
export const CONDITIONAL_MIX_MIN = 0.5;

/**
 * An equilibrium mix this concentrated on one SWITCH reads as "effectively
 * forced" — the forced-sac situations whose expectation the narrative names
 * in prose instead of leaving the percentage in matrix header badges.
 */
export const FORCED_MIX_THRESHOLD = 0.85;

/**
 * One re-evaluation of the flagged side's turn under an ALTERNATIVE item on
 * an opposing mon whose item is only a usage guess. EVs are own-perspective
 * pair values, same space as RankedChoice.ev.
 */
export interface SensitivityProbe {
  species: string;
  item: string;
  playedEv: number;
  bestEv: number;
}

/** Per-side probes for one turn — the shape sweeps cache and analyzeTurn consumes. */
export interface TurnSensitivity {
  p1?: SensitivityProbe[];
  p2?: SensitivityProbe[];
}

export interface SideAnalysis {
  playedRaw: PlayedAction | null;
  /**
   * The protocol's reason a chosen action never surfaced ('slp', 'flinch',
   * 'move: Taunt', 'faint', …) — the side DID pick something.
   */
  prevented?: string;
  /** The side was KO'd before it ever acted — `played` is a charitable
   * outcome-equivalent stand-in ("stayed in") for the hidden move choice,
   * gradable against the engine's best; risk framing stays off. */
  neverActed?: boolean;
  /** Doubles: the per-slot actions this side actually took. */
  playedSlots?: (PlayedAction | null)[];
  /** The played action matched into the engine's ranked list. */
  played: RankedChoice | null;
  /** The top choice by equilibrium EV — the grading reference. */
  best: RankedChoice | null;
  /** The max-floor choice — "the engine's safe line", the safety reference. */
  safe: RankedChoice | null;
  /** best.ev − played.ev (own perspective), floored at 0. */
  regret: number | null;
  /**
   * The regret's floor priced in a punishing reply the opponent did NOT
   * click — a prediction play whose read came true, not a punished misplay.
   */
  riskUnpunished?: boolean;
  /** Own-perspective value of the actual pair over the safe line's floor. */
  riskPayoff?: number;
  /** Turns AFTER this one until the payoff peaked (absent = immediate). */
  riskPayoffTurn?: number;
  /**
   * The read won at least RISK_PAYOFF_MARGIN over the safe guarantee. Also
   * set on UNTIERED turns when the play was a genuine gamble (deviated from
   * the engine's pick, gave up a mistake-sized floor) that landed.
   */
  riskPaidOff?: boolean;
  /**
   * The flagged risk MATCHES the opponent model's best response — phrased
   * as "a read against the opponent's tendencies" (grading unchanged).
   */
  riskWasRead?: boolean;
  /**
   * A slot's choice was never observed (flinch/sleep — the protocol shows
   * `|cant|`): `played` is the BEST combo consistent with the visible slots,
   * so the regret is a charitable lower bound, never blame for hidden picks.
   */
  playedPartial?: boolean;
  /** A depth+1 verification pass cleared the shallow misplay flag. */
  verifiedAtDepth?: boolean;
  /** Verdict band for the regret, after leniency (absent = clean play). */
  tier?: VerdictTier;
  /**
   * The flagged turn fed a body deliberately — a nearly-dead Pokémon
   * (≤ SACK_HP_THRESHOLD at turn start, unconditional) or a HEALTHY one
   * while the engine's scores stayed ≥ HEALTHY_SACK_FLOOR on both sides of
   * the sack (simplification). Graded as a sack: tier demoted one band —
   * cleared entirely for a stayed feed whose windowed payoff repaid the
   * full regret plus the margin (`verified`) — never labeled a risk.
   */
  sacrifice?: SackInfo;
  /**
   * How many options the engine ranked for this side — 1 marks a forced
   * turn (or the waiting sentinel), which accuracy grading must exclude.
   */
  choiceCount?: number;
  /**
   * The verdict HINGES on a guessed item: under some usage-plausible
   * alternative set the regret lands in a softer band. The tier above is
   * already softened to the most charitable probed band (acquit-only —
   * probes never add blame).
   */
  sensitivity?: { species: string; alternatives: { item: string; tier: VerdictTier | 'none' }[] };
  /**
   * How many ranked options sit within an inaccuracy of best — the side's
   * real decision breadth. Both sides clearing BREADTH_MIN_OPTIONS turns a
   * culprit-free shift into an "open turn" in the narrative.
   */
  viableCount?: number;
  /**
   * The engine's own equilibrium leans a DIFFERENT choice than the argmax-EV
   * recommendation (weight ≥ CONDITIONAL_MIX_MIN): the narrative renders the
   * recommendation conditionally. bestWhen/mixWhen name the opponent replies
   * against which each choice earns its keep (largest own-perspective value
   * difference in the solved matrix); null when no reply favors that side of
   * the split. Only computed on tiered turns — where a recommendation renders.
   */
  conditional?: { mixLabel: string; mixWeight: number; bestWhen: string | null; mixWhen: string | null };
  /**
   * The recommended best is MECHANICALLY NULL against the opposing active
   * (Will-O-Wisp into a Fire-type). `alternative` is a co-optimal option
   * within the rank-tie epsilon that is not itself null — the narrative
   * displays it in place of the null pick (grading untouched); with no such
   * option the narrative keeps the true best and names the caveat.
   */
  bestNull?: { reason: string; alternative: { label: string; ev: number; koOdds?: KoOddsInfo } | null };
  /**
   * The side's equilibrium mix all but commits to one SWITCH
   * (≥ FORCED_MIX_THRESHOLD with more than one option) — a forced-sac /
   * forced-pivot expectation the narrative names in prose.
   */
  forcedMix?: { label: string; weight: number };
  /**
   * Multi-turn expectation cumulation (round 6): a milestone streak of
   * secondary fishing or crit accumulation ending on this turn. Render-time
   * narrative only — grading never sees it.
   */
  streakOdds?: StreakOdds;
}

/** Deep re-search of the played and best pairs (p1-perspective outcomes). */
export interface VerifiedOutcomes {
  playedDeep: number;
  bestDeep: number;
}
export interface TurnVerification {
  p1?: VerifiedOutcomes;
  p2?: VerifiedOutcomes;
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
export const splitCombinedLabel = (label: string): string[] => {
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
  // A pivot pair ("move uturn > switch 4") must bring in the Pokémon the
  // player actually chose; with the target unknown (old parses) any pair of
  // the move matches and ranking order picks the charitable one.
  if (action.pivotTarget && choicePart.includes(' > ') &&
    labelPart.split(' → ').pop() !== action.pivotTarget) {
    return false;
  }
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

/**
 * Combos consistent with the OBSERVED slots — hidden (null) slots match
 * anything. Empty when no slot was observed at all: with nothing visible
 * there is nothing to grade.
 */
export function findConsistentOptions<T extends { choice: string; label: string }>(
  options: T[],
  slots: (PlayedAction | null)[] | undefined,
): T[] {
  if (!slots || slots.every(action => action === null)) return [];
  return options.filter(option => {
    const choiceParts = option.choice.split(',').map(part => part.trim());
    if (choiceParts.length !== slots.length) return false;
    const labelParts = splitCombinedLabel(option.label);
    return slots.every((action, index) =>
      action === null || slotMatches(choiceParts[index], labelParts[index] ?? '', action));
  });
}

/**
 * Doubles matcher: the exact combo when every slot was observed, otherwise
 * the CHARITABLE pick among consistent combos — the hidden slot is assumed
 * to have chosen whatever grades best, so regret becomes a lower bound.
 */
export function matchPlayedSlots(
  options: RankedChoice[],
  slots: (PlayedAction | null)[] | undefined,
): { played: RankedChoice | null; partial: boolean } {
  const exact = findPlayedOption(options, slots);
  if (exact) return { played: exact, partial: false };
  const consistent = findConsistentOptions(options, slots);
  if (consistent.length === 0 || !slots?.some(action => action === null)) {
    return { played: null, partial: false };
  }
  // Charitable pick by the grading reference: equilibrium EV.
  const played = consistent.reduce((a, b) => (b.ev > a.ev ? b : a));
  return { played, partial: true };
}

const GIMMICK_NAMES: Record<string, string> = {
  mega: 'Mega Evolution',
  terastallize: 'Terastallization',
  ultra: 'Ultra Burst',
};

/** "Mega + Close Combat→Politoed" → "Close Combat" (the display move name). */
const moveDisplayName = (labelPart: string): string =>
  labelPart.replace(/^(Tera|Mega|Ultra) \+ /, '').split('→')[0];

/** "→ Amoonguss" reads as prose in a sentence context. */
const partPhrase = (labelPart: string): string =>
  labelPart.startsWith('→ ') ? `switching to ${labelPart.slice(2)}` : labelPart;

/**
 * The condensed "why" between the played and the recommended choice: names
 * the single structural difference when there is exactly one — a skipped
 * gimmick, a move's target, or one slot of a doubles pair. Null when the
 * choices differ wholesale (the full labels already tell that story).
 */
export function diffChoices(played: RankedChoice, best: RankedChoice): string | null {
  const playedParts = played.choice.split(',').map(part => part.trim().split(' '));
  const bestParts = best.choice.split(',').map(part => part.trim().split(' '));
  if (playedParts.length !== bestParts.length) return null;
  const playedLabels = splitCombinedLabel(played.label);
  const bestLabels = splitCombinedLabel(best.label);
  const stripGimmicks = (tokens: string[]) => tokens.filter(token => !(token in GIMMICK_NAMES));
  const stripLocs = (tokens: string[]) => tokens.filter(token => !/^-?\d+$/.test(token));

  const diffs: string[] = [];
  for (let index = 0; index < playedParts.length; index++) {
    const from = playedParts[index];
    const to = bestParts[index];
    if (from.join(' ') === to.join(' ')) continue;
    if (stripGimmicks(from).join(' ') === stripGimmicks(to).join(' ')) {
      const changed = [...from, ...to].find(token =>
        token in GIMMICK_NAMES && from.includes(token) !== to.includes(token));
      diffs.push(`only the ${changed ? GIMMICK_NAMES[changed] : 'gimmick'}`);
      continue;
    }
    if (from[0] === 'move' && to[0] === 'move' && from[1] === to[1] &&
      stripLocs(from).join(' ') === stripLocs(to).join(' ')) {
      diffs.push(`only the target of ${moveDisplayName(bestLabels[index] ?? best.label)}`);
      continue;
    }
    // A whole-action difference only condenses when it is one slot of a
    // multi-slot pair — for a single action the full labels say it all.
    if (playedParts.length === 1) return null;
    diffs.push(`${partPhrase(bestLabels[index] ?? best.label)} instead of ${partPhrase(playedLabels[index] ?? played.label)}`);
  }
  return diffs.length === 1 ? diffs[0] : null;
}

/** Side dispatcher: doubles slots when present, singles action otherwise. */
export function matchPlayedSide(
  result: EvalResult,
  side: 'p1' | 'p2',
  played: PlayedTurn | null,
): RankedChoice | null {
  if (!played) return null;
  const slots = side === 'p1' ? played.p1Slots : played.p2Slots;
  if (slots) return matchPlayedSlots(result.perSide[side], slots).played;
  return matchPlayedChoice(result, side, played[side]);
}

/**
 * Stand-in for a side KO'd before it ever acted (`prevented: 'faint'` with
 * no action line): the KO-before-acting logic proves the side chose a MOVE
 * (a chosen switch would have resolved before the attack), and every
 * priority-0 move is outcome-equivalent — none of them executed. The
 * best-ranked priority-0 move represents the stay-in most charitably; a
 * priority choice cannot represent it (it would have preempted the KO).
 * Null when the marker is absent, the parse is doubles-shaped, or only
 * priority moves exist. Cant-family preventions (sleep, flinch, full
 * paralysis) get NO phantom — their hidden choice may have mattered.
 */
export function phantomStayIn(
  result: EvalResult,
  side: 'p1' | 'p2',
  played: PlayedTurn | null | undefined,
): RankedChoice | null {
  if (!played || played[side] !== null) return null;
  if (played.p1Slots || played.p2Slots) return null;
  if (played.prevented?.[side] !== 'faint') return null;
  const option = result.perSide[side].find(candidate => {
    if (!candidate.choice.startsWith('move ')) return false;
    const id = candidate.choice.split(' ')[1] ?? '';
    return (Dex.moves.get(id).priority ?? 0) === 0;
  });
  return option ? { ...option, label: 'stayed in (KO’d before acting)' } : null;
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
  /**
   * Expected pair values of the FOLLOWING turns (p1 perspective) — lets a
   * read's payoff cash in over PAYOFF_WINDOW turns of expected play.
   */
  futureOutcomes?: (number | null)[];
  /**
   * Deep re-search of flagged turns (chess.com's sacrifice-verification
   * pattern): when the depth+1 pair values say the played line holds up,
   * the misplay verdict is cleared. Confirming passes change nothing.
   */
  verified?: TurnVerification | null;
  scoreBefore: number;
  scoreAfter: number | null;
  /** False = played actions unavailable (doubles); blame is off the table. */
  playedTracking?: boolean;
  /** Per-side low-HP sacrifices detected in the turn's protocol (played.ts). */
  sacks?: { p1?: SackInfo; p2?: SackInfo };
  /** Per-side opponent-model best responses (opponent-model.ts computeRead). */
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null };
  /**
   * Per-side item-sensitivity probes for flagged turns (useEvaluation).
   * Acquit-only: a probe can soften the side's verdict, never harshen it.
   */
  sensitivity?: TurnSensitivity | null;
  /**
   * Active species at turn start (singles: exactly one per side, else null)
   * plus the replay generation — the null-move guard's board context.
   * Absent/null species keep the guard off (fail closed).
   */
  actives?: { p1: string | null; p2: string | null; gen: number } | null;
  /**
   * Per-side played-move history for the whole game (index t−1 = turn t,
   * the current turn included) — the streak detector's input. Render-time
   * only, fail closed when absent.
   */
  playedHistory?: { p1: (StreakHistoryEntry | null)[]; p2: (StreakHistoryEntry | null)[] } | null;
}): TurnAnalysis {
  const playedTracking = params.playedTracking !== false;
  const sideAnalysis = (key: 'p1' | 'p2'): SideAnalysis => {
    const playedRaw = params.played?.[key] ?? null;
    const playedSlots = key === 'p1' ? params.played?.p1Slots : params.played?.p2Slots;
    let played: RankedChoice | null = null;
    let playedPartial = false;
    let neverActed = false;
    if (playedSlots) {
      const match = matchPlayedSlots(params.result.perSide[key], playedSlots);
      played = match.played;
      playedPartial = match.partial;
    } else if (params.played) {
      played = matchPlayedChoice(params.result, key, playedRaw);
      if (!played) {
        const phantom = phantomStayIn(params.result, key, params.played);
        if (phantom) {
          played = phantom;
          neverActed = true;
        }
      }
    }
    const options = params.result.perSide[key];
    const best = options[0] ?? null;
    const safe = options.length > 0
      ? options.reduce((a, b) => (b.worstCase > a.worstCase ? b : a))
      : null;
    let regret = played && best ? Math.max(0, best.ev - played.ev) : null;
    // Verification can only ACQUIT: a deep pass that confirms the gap keeps
    // the shallow equilibrium regret (the deep pair values are an
    // exploitative lens, not a fairer grade when they agree).
    let verifiedAtDepth = false;
    const verifiedSide = params.verified?.[key];
    if (verifiedSide && regret !== null && regret >= REGRET_THRESHOLD) {
      const sign = key === 'p1' ? 1 : -1;
      const deepRegret = Math.max(0, sign * (verifiedSide.bestDeep - verifiedSide.playedDeep));
      if (deepRegret < REGRET_THRESHOLD) {
        regret = deepRegret;
        verifiedAtDepth = true;
      }
    }
    const demoteTier = (current: VerdictTier | undefined): VerdictTier | undefined =>
      current === 'blunder' ? 'mistake' : current === 'mistake' ? 'inaccuracy' : undefined;
    const tierOf = (regretValue: number): VerdictTier | undefined =>
      regretValue >= TIER_THRESHOLDS.blunder ? 'blunder'
        : regretValue >= TIER_THRESHOLDS.mistake ? 'mistake'
          : regretValue >= TIER_THRESHOLDS.inaccuracy ? 'inaccuracy' : undefined;
    let tier: VerdictTier | undefined;
    if (regret !== null) {
      tier = tierOf(regret);
      const own = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
      if (tier && Math.abs(own) >= DECIDED_SCORE) tier = demoteTier(tier);
    }
    // A sack of a nearly-dead body is a deliberate low-cost play: demote one
    // band (same shape as the decided-position leniency) and mark it so the
    // risk machinery and the report treat it neutrally. BOUNDED: a
    // blunder-sized regret is a throw whatever the body was worth — the
    // sack leniency never forgives the blunder band.
    // A HEALTHY feed (switched in and fainted, above the low-HP threshold)
    // is only a simplification sack while the engine's own scores call the
    // game decisively won for the sacker BEFORE and AFTER — trading surplus
    // material for certainty (GPL T35 Salazzle). Expectation-based, not
    // results-based: both gates read engine scores. No after-score = no
    // excuse (fails closed on game ends and gap turns).
    const sack = params.sacks?.[key];
    const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
    const ownAfter = params.scoreAfter === null ? null : (key === 'p1' ? params.scoreAfter : -params.scoreAfter);
    // Shape gates: low-HP applies unconditionally; healthy only while
    // decisively ahead on both sides of the sack; a stayed feed only when
    // the outcome was priced certain (ev ≈ floor — the player accepted the
    // known worst case) AND the windowed payoff over the safe guarantee
    // clears the read margin (573756 t68). Expectation-based, fails closed.
    let sackApplies = false;
    let feedPayoff: number | null = null;
    if (sack) {
      if (sack.stayed) {
        const certain = played !== null &&
          played.ev - played.worstCase <= FEED_CERTAINTY_EPSILON;
        if (certain && safe && params.playedOutcome !== null) {
          const chain = [params.playedOutcome, ...(params.futureOutcomes ?? [])]
            .slice(0, PAYOFF_WINDOW + 1);
          let payoff: number | null = null;
          for (const outcome of chain) {
            if (outcome === null || outcome === undefined) continue;
            const own = key === 'p1' ? outcome : -outcome;
            const value = own - safe.worstCase;
            if (payoff === null || value > payoff) payoff = value;
          }
          sackApplies = payoff !== null && payoff >= RISK_PAYOFF_MARGIN;
          if (sackApplies) feedPayoff = payoff;
        }
      } else if (sack.healthy) {
        sackApplies = ownBefore >= HEALTHY_SACK_FLOOR &&
          ownAfter !== null && ownAfter >= HEALTHY_SACK_FLOOR;
      } else {
        sackApplies = true;
      }
    }
    const sacrificed = !!(tier && sackApplies && (regret ?? 0) < TIER_THRESHOLDS.blunder);
    // A stayed feed VERIFIES when its windowed payoff repaid the FULL regret
    // with the read margin on top. Under the certainty gate, payoff − regret
    // ≈ windowed peak − best.ev, so this bar says the line reached what the
    // engine's best promised — the win-condition payoff is real, and no
    // verdict band sticks (573756 t68: payoff 0.4415 ≥ regret 0.2661 + 0.1).
    // The blunder bound above still applies: a blunder-sized feed is never
    // excused, verified or not.
    const feedVerified = sacrificed && feedPayoff !== null && regret !== null &&
      feedPayoff >= regret + RISK_PAYOFF_MARGIN;
    if (sacrificed) tier = feedVerified ? undefined : demoteTier(tier);
    // Item-sensitivity: if the verdict changes band under a usage-plausible
    // alternative item for an opposing mon whose item is only a guess, the
    // verdict HINGES on hidden information — soften to the most charitable
    // probed band (acquit-only) and record the hinge.
    let sensitivity: SideAnalysis['sensitivity'];
    const probes = params.sensitivity?.[key];
    if (tier && probes && probes.length > 0) {
      const rank: Record<VerdictTier | 'none', number> = { none: 0, inaccuracy: 1, mistake: 2, blunder: 3 };
      const probed = probes.map(probe => ({
        probe,
        tier: tierOf(Math.max(0, probe.bestEv - probe.playedEv)) ?? 'none' as const,
      }));
      const charitable = probed.reduce((a, b) => (rank[b.tier] < rank[a.tier] ? b : a));
      if (rank[charitable.tier] < rank[tier]) {
        sensitivity = {
          species: charitable.probe.species,
          alternatives: probed
            .filter(entry => entry.probe.species === charitable.probe.species)
            .map(entry => ({ item: entry.probe.item, tier: entry.tier })),
        };
        tier = charitable.tier === 'none' ? undefined : charitable.tier;
      }
    }
    // ---- Narrative signals (round 5 ⑥): computed here where the full
    // result is in scope, rendered in summary.ts/report.ts. All of them
    // fail closed on missing data and never touch the grading above. ----
    const viableCount = best === null ? undefined :
      options.filter(option => best.ev - option.ev <= TIER_THRESHOLDS.inaccuracy).length;

    const matrix = params.result.matrix;
    const sideChoices = key === 'p1' ? matrix?.p1Choices : matrix?.p2Choices;
    const sideLabels = key === 'p1' ? matrix?.p1Labels : matrix?.p2Labels;
    const oppLabels = key === 'p1' ? matrix?.p2Labels : matrix?.p1Labels;
    const mix = key === 'p1' ? matrix?.mixes.p1 : matrix?.mixes.p2;
    // Own-perspective matrix value of (own index i, opponent index j).
    const ownValue = (grid: EvalMatrix, i: number, j: number): number =>
      key === 'p1' ? grid.values[i][j] : -grid.values[j][i];
    const mixTop = mix && mix.length > 0
      ? mix.reduce((top, weight, index) => (weight > mix[top] ? index : top), 0)
      : -1;

    let conditional: SideAnalysis['conditional'];
    if (tier && matrix && sideChoices && sideLabels && oppLabels && mix && best && mixTop >= 0) {
      const bestIndex = sideChoices.indexOf(best.choice);
      if (bestIndex >= 0 && mixTop !== bestIndex && mix[mixTop] >= CONDITIONAL_MIX_MIN) {
        let bestWhen: string | null = null;
        let mixWhen: string | null = null;
        let bestDiff = 0;
        let mixDiff = 0;
        for (let j = 0; j < oppLabels.length; j++) {
          const diff = ownValue(matrix, bestIndex, j) - ownValue(matrix, mixTop, j);
          if (diff > bestDiff) { bestDiff = diff; bestWhen = oppLabels[j]; }
          if (diff < mixDiff) { mixDiff = diff; mixWhen = oppLabels[j]; }
        }
        conditional = { mixLabel: sideLabels[mixTop], mixWeight: mix[mixTop], bestWhen, mixWhen };
      }
    }

    let forcedMix: SideAnalysis['forcedMix'];
    if (matrix && sideChoices && sideLabels && mix && options.length > 1 && mixTop >= 0 &&
      mix[mixTop] >= FORCED_MIX_THRESHOLD && sideChoices[mixTop]?.startsWith('switch')) {
      forcedMix = { label: sideLabels[mixTop], weight: mix[mixTop] };
    }

    let bestNull: SideAnalysis['bestNull'];
    const actives = params.actives;
    const defenderSpecies = actives ? (key === 'p1' ? actives.p2 : actives.p1) : null;
    if (best && actives && defenderSpecies) {
      const attackerSpecies = key === 'p1' ? actives.p1 : actives.p2;
      const nullFor = (choice: string) => nullMoveReason({
        choice, gen: actives.gen, attackerSpecies, defenderSpecies,
      });
      const reason = nullFor(best.choice);
      if (reason) {
        // The swap stays within the established rank-tie scale: a co-optimal
        // option is a fair display substitute, never a regrade.
        const alternative = options.find(option => option !== best &&
          best.ev - option.ev <= TIE_EPSILON && nullFor(option.choice) === null) ?? null;
        bestNull = {
          reason,
          alternative: alternative
            ? { label: alternative.label, ev: alternative.ev, ...(alternative.koOdds ? { koOdds: alternative.koOdds } : {}) }
            : null,
        };
      }
    }

    // Round 6 ②: multi-turn cumulation — a streak ending THIS turn, read
    // from the render-time history (index t−1 = turn t, current included).
    let streakOdds: SideAnalysis['streakOdds'];
    if (params.playedHistory && actives) {
      streakOdds = detectStreakOdds(actives.gen, params.playedHistory[key].slice(0, params.turn)) ?? undefined;
    }

    return {
      playedRaw,
      ...(params.played?.prevented?.[key] ? { prevented: params.played.prevented[key] } : {}),
      ...(playedSlots ? { playedSlots } : {}),
      ...(neverActed ? { neverActed } : {}),
      played,
      best,
      safe,
      regret,
      choiceCount: options.length,
      ...(playedPartial ? { playedPartial } : {}),
      ...(verifiedAtDepth ? { verifiedAtDepth } : {}),
      ...(tier ? { tier } : {}),
      ...(sacrificed && sack ? { sacrifice: feedVerified ? { ...sack, verified: true } : sack } : {}),
      ...(sensitivity ? { sensitivity } : {}),
      ...(viableCount !== undefined ? { viableCount } : {}),
      ...(conditional ? { conditional } : {}),
      ...(bestNull ? { bestNull } : {}),
      ...(forcedMix ? { forcedMix } : {}),
      ...(streakOdds ? { streakOdds } : {}),
    };
  };

  const p1 = sideAnalysis('p1');
  const p2 = sideAnalysis('p2');
  // A flagged risk whose punishing reply was never clicked reads differently
  // from a punished misplay. Where the pair's expected value is known, the
  // payoff over the safe guarantee grades the read: clearly ahead = a good
  // play, clearly behind = a plain misplay even unpunished, between = risk.
  // UNTIERED turns enter too, but only as genuine gambles — the play deviated
  // from the engine's pick AND gave up a mistake-sized floor vs the safe line
  // (draft T50: a co-optimal switch whose floor priced in Earth Power). They
  // can only EARN the paid-off credit; with no verdict to soften, the risk
  // labels stay off. Two honesty bounds (GPL T35): no praise from an
  // already-lost position (garbage time makes every move a "gamble" outcome
  // noise can credit), and the credit grades on the IMMEDIATE outcome only —
  // the payoff window softens flagged risks; here it would attribute the
  // opponent's follow-up choices and the rolls to the gamble.
  const markRisk = (key: 'p1' | 'p2', side: SideAnalysis, opponent: SideAnalysis) => {
    // A phantom stay-in has no real floor to price a read against.
    if (side.sacrifice || side.neverActed) return;
    const tiered = side.tier === 'mistake' || side.tier === 'blunder';
    const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
    const gamble = !tiered && side.played !== null && side.best !== null && side.safe !== null
      && side.played.choice !== side.best.choice
      && side.played.choice !== side.safe.choice
      && side.safe.worstCase - side.played.worstCase >= TIER_THRESHOLDS.mistake
      && ownBefore > -DECIDED_SCORE
      && params.playedOutcome !== null;
    if (!tiered && !gamble) return;
    if (!side.played?.punishedBy || !opponent.played) return;
    if (opponent.played.label === side.played.punishedBy) return;
    if (params.playedOutcome !== null && side.safe) {
      // The payoff is the BEST expected outcome within the window vs the safe
      // guarantee — a setup turn's value arrives on the turns after it.
      const chain = tiered
        ? [params.playedOutcome, ...(params.futureOutcomes ?? [])].slice(0, PAYOFF_WINDOW + 1)
        : [params.playedOutcome];
      let payoff: number | null = null;
      let payoffTurn = 0;
      chain.forEach((outcome, index) => {
        if (outcome === null || outcome === undefined) return;
        const own = key === 'p1' ? outcome : -outcome;
        const value = own - side.safe!.worstCase;
        if (payoff === null || value > payoff) {
          payoff = value;
          payoffTurn = index;
        }
      });
      if (payoff !== null) {
        side.riskPayoff = payoff;
        if (payoffTurn > 0) side.riskPayoffTurn = payoffTurn;
        if (payoff <= -RISK_PAYOFF_MARGIN) return;
        if (payoff >= RISK_PAYOFF_MARGIN - RISK_PAYOFF_EPSILON) side.riskPaidOff = true;
      }
    }
    // Gambles stop here: paid-off credit or nothing.
    if (!tiered) return;
    side.riskUnpunished = true;
    // The opponent model agrees: this "risk" was the exploitative best
    // response to how the opponent actually plays — phrase it as a read.
    const read = params.reads?.[key];
    // The machine id is authoritative; the label match only serves cached
    // reads written before choice ids existed.
    if (read && side.played && (read.choice.choiceId !== undefined
      ? read.choice.choiceId === side.played.choice
      : read.choice.label === side.played.label)) {
      side.riskWasRead = true;
    }
  };
  markRisk('p1', p1, p2);
  markRisk('p2', p2, p1);
  const swing = params.scoreAfter !== null ? params.scoreAfter - params.scoreBefore : null;
  const decisionDelta = params.playedOutcome !== null ? params.playedOutcome - params.scoreBefore : null;
  const chanceDelta = params.playedOutcome !== null && params.scoreAfter !== null
    ? params.scoreAfter - params.playedOutcome
    : null;

  // A paid-off read does not count as a decision problem; neither does an
  // inaccuracy or a leniency-softened verdict.
  const badTier = (side: SideAnalysis) => side.tier === 'mistake' || side.tier === 'blunder';
  const p1Bad = badTier(p1) && !p1.riskPaidOff;
  const p2Bad = badTier(p2) && !p2.riskPaidOff;
  let attribution: TurnAttribution;
  if (!playedTracking) {
    // Without played actions only the movement itself can be described.
    attribution = swing !== null && Math.abs(swing) >= CHANCE_THRESHOLD ? 'shift' : 'quiet';
  } else if (p1Bad && p2Bad) attribution = 'both-decision';
  else if (p1Bad) attribution = 'p1-decision';
  else if (p2Bad) attribution = 'p2-decision';
  else if (p1.riskPaidOff && p2.riskPaidOff) attribution = 'both-read';
  else if (p1.riskPaidOff) attribution = 'p1-read';
  else if (p2.riskPaidOff) attribution = 'p2-read';
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
