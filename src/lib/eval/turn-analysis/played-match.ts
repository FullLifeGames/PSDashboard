// Data-only Dex (move priorities for the stay-in phantom) — this module is
// in the app's MAIN bundle; @pkmn/sim must never be imported here.
import { Dex } from '@pkmn/dex';
import type { EvalResult, RankedChoice } from '../types';
import type { PlayedAction, PlayedTurn } from '../played';
import type { SideAnalysis } from './types';

/**
 * Matching the protocol's played actions into the engine's ranked lists:
 * singles by choice id, doubles per slot (charitable when a slot stayed
 * hidden), the stay-in phantom for sides KO'd before acting, and the
 * condensed "why" between a played and a recommended choice.
 */

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
