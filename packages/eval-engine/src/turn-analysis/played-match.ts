import type { EvalResult, RankedChoice } from '../types.ts';
import type { PlayedAction, PlayedBounds, PlayedTurn, SlotBound } from '../played.ts';
import type { SideAnalysis } from './types.ts';
import { dexOf, toId, type GameRules, type RulesDex } from '@fulllifegames/replay-core';
import { setupMoves } from '../dex-facts/setup.ts';

/** Pure self-boosting moves (dex-facts/setup.ts), held to the simulator by test/setup-moves-oracle.spec.ts. */
export const setupMovesOf = (dex: RulesDex): ReadonlySet<string> => setupMoves(dex);

export function setupMoveClicked(side: Pick<SideAnalysis, 'playedSlots' | 'playedRaw'>, dex: RulesDex): string | null {
  const actions = side.playedSlots?.filter((action): action is PlayedAction => action !== null) ??
    (side.playedRaw ? [side.playedRaw] : []);
  const setup = actions.find(action => action.kind === 'move' && setupMovesOf(dex).has(toId(action.name)));
  return setup?.name ?? null;
}

/** The setup move this side actually clicked, if any (display name), as the record carries it. */
export const playedSetupMove = (side: Pick<SideAnalysis, 'setupMove'>): string | null => side.setupMove ?? null;

/** "Tera + X" labels contain the slot separator, so they are re-merged after splitting. */
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
  // A pivot pair ("move uturn > switch 4") must bring in the Pokémon chosen; target unknown: any pair of the move.
  if (action.pivotTarget && choicePart.includes(' > ') &&
    labelPart.split(' → ').pop() !== action.pivotTarget) {
    return false;
  }
  const tokens = choicePart.split(' ');
  if (tokens[0] !== 'move' || tokens[1] !== toId(action.name)) return false;
  // Every gimmick marker must agree: a mega move matches the mega variant, never the base option.
  if (tokens.includes('terastallize') !== !!action.tera) return false;
  if (tokens.includes('mega') !== !!action.mega) return false;
  if (tokens.includes('ultra') !== !!action.ultra) return false;
  const locToken = tokens.find(token => /^-?\d+$/.test(token));
  // A locless fragment (spread/self move) accepts any protocol target.
  if (locToken !== undefined && action.targetLoc != null && parseInt(locToken, 10) !== action.targetLoc) return false;
  return true;
}

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

function ruledOut(choicePart: string, bound: SlotBound): boolean {
  const tokens = choicePart.split(' ');
  return tokens[0] === 'switch' ? bound.switchOut : tokens[0] === 'move' && bound.moves.includes(tokens[1] ?? '');
}

// A bound that leaves no option is no proof (the log and the queue disagree): the options stay.
function withinBounds(options: RankedChoice[], slots: (PlayedAction | null)[], bounds: (SlotBound | null)[] | undefined): RankedChoice[] {
  if (!bounds) return options;
  const kept = options.filter(option => {
    const parts = option.choice.split(',').map(part => part.trim());
    return slots.every((action, index) => {
      const bound = bounds[index];
      return action !== null || !bound || !ruledOut(parts[index] ?? '', bound);
    });
  });
  return kept.length > 0 ? kept : options;
}

/** Doubles matcher: the exact combo when every slot was observed, else the charitable pick (regret a lower bound). */
export function matchPlayedSlots(
  options: RankedChoice[],
  slots: (PlayedAction | null)[] | undefined,
  bounds?: (SlotBound | null)[],
): { played: RankedChoice | null; partial: boolean } {
  const exact = findPlayedOption(options, slots);
  if (exact) return { played: exact, partial: false };
  const consistent = findConsistentOptions(options, slots);
  if (consistent.length === 0 || !slots?.some(action => action === null)) {
    return { played: null, partial: false };
  }
  const played = withinBounds(consistent, slots, bounds).reduce((a, b) => (b.ev > a.ev ? b : a));
  return { played, partial: true };
}

const GIMMICK_NAMES: Record<string, string> = {
  mega: 'Mega Evolution',
  terastallize: 'Terastallization',
  ultra: 'Ultra Burst',
};

const moveDisplayName = (labelPart: string): string =>
  labelPart.replace(/^(Tera|Mega|Ultra) \+ /, '').split('→')[0];

const partPhrase = (labelPart: string): string =>
  labelPart.startsWith('→ ') ? `switching to ${labelPart.slice(2)}` : labelPart;

/** The condensed "why" between played and recommended choice: the single structural difference, else null. */
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
    if (playedParts.length === 1) return null;
    diffs.push(`${partPhrase(bestLabels[index] ?? best.label)} instead of ${partPhrase(playedLabels[index] ?? played.label)}`);
  }
  return diffs.length === 1 ? diffs[0] : null;
}

/** The ranked option a side's played action matches: doubles slots when present, the singles action otherwise. */
export function matchPlayedSide(
  result: EvalResult,
  side: 'p1' | 'p2',
  played: PlayedTurn | null,
  bounds?: PlayedBounds,
): RankedChoice | null {
  if (!played) return null;
  const slots = side === 'p1' ? played.p1Slots : played.p2Slots;
  if (slots) return matchPlayedSlots(result.perSide[side], slots, bounds?.[side]).played;
  return matchPlayedChoice(result, side, played[side]);
}

/** The choice a side CLICKED (the opponent's column in a hindsight read); a hidden doubles slot gives no click. */
export function matchClickedColumn(
  result: EvalResult,
  side: 'p1' | 'p2',
  played: PlayedTurn | null | undefined,
): RankedChoice | null {
  if (!played) return null;
  const slots = side === 'p1' ? played.p1Slots : played.p2Slots;
  if (slots) return findPlayedOption(result.perSide[side], slots);
  return matchPlayedChoice(result, side, played[side]);
}

/** The stay-in phantom: the ranked move that stands for a side KO'd before it acted, or null. */
export function phantomStayIn(
  result: EvalResult,
  side: 'p1' | 'p2',
  played: PlayedTurn | null | undefined,
  rules: GameRules | undefined,
  bound?: SlotBound | null,
): RankedChoice | null {
  // A KO before acting proves a MOVE was chosen: the best-ranked priority-0 move stands in (a priority move preempts).
  // Cant-family preventions get no phantom; an order bound (`ruledOutMoves`, action-bound.ts) replaces Dex priority.
  if (!played || played[side] !== null || !rules) return null;
  const dex = dexOf(rules);
  if (played.p1Slots || played.p2Slots) return null;
  if (played.prevented?.[side] !== 'faint') return null;
  const moves = result.perSide[side].filter(candidate => candidate.choice.startsWith('move '));
  const idOf = (candidate: RankedChoice): string => candidate.choice.split(' ')[1] ?? '';
  const open = bound ? moves.filter(candidate => !bound.moves.includes(idOf(candidate))) : [];
  const option = open[0] ?? moves.find(candidate => (dex.moves.get(idOf(candidate)).priority ?? 0) === 0);
  return option ? { ...option, label: 'stayed in (KO’d before acting)' } : null;
}

export function matchPlayedChoice(
  result: EvalResult,
  side: 'p1' | 'p2',
  action: PlayedAction | null,
): RankedChoice | null {
  if (!action) return null;
  const options = result.perSide[side];
  // The matrix lists a pivot ONLY as pairs ("move uturn > switch 2"): an exact-choice lookup would miss it.
  if (action.kind === 'move') return findPlayedOption(options, [action]);
  // Labels carry species names; the nickname is only a fallback for logs where the species could not be parsed.
  return (action.species ? options.find(option => option.label === `→ ${action.species}`) : undefined) ??
    options.find(option => option.label === `→ ${action.name}`) ?? null;
}
