import type { Battle } from '@pkmn/sim';
import { evalChoiceToSlotChoices, requiredChoicesForActiveSlots, type BranchSlotChoice } from '../branch-choices.ts';
import { createBranchStateFromBattle } from '../branch/state.ts';
import type { SimBattle } from '../branch/types.ts';
import { chipShown, playLikeliestTurn, rollDecides } from '../dice/likeliest.ts';
import type { LikeliestDie } from '../dice/likeliest.ts';
import type { ForcedDie } from '../dice/types.ts';
import { createMatchupCache, type MatchupCache } from '../eval-function.ts';
import { createRootPosition, positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { forkBattle, toPosition } from '../forward/position.ts';
import { applyChoice } from '../forward/switches.ts';
import { perfCount } from '../perf-trace.ts';
import { copyOf } from '../sim-ask/copy.ts';
import type { StaticRuleset } from '../score/weights.ts';
import type { EvalLine, LineDie, LineRequest, LinesInput, LineStep, TreeLineStep } from '../types.ts';
import { battleFaintedFraction, leafValue } from './leaf.ts';
import { searchOptions } from './options.ts';

/**
 * Round 89 (#104): the lines job. A tree's line names both sides' choices by label; this replay plays it on the root, one step at a
 * time, with every die at its likeliest result (dice/likeliest.ts), and writes what the branch layer needs to play it as a variation:
 * each step's slot choices with the dice on the bodies that hold them. Each step is resolved by label against the options the replay's
 * own position offers (the trees run on the canonical bench order, their choice strings below the root do not translate), so a line
 * stops before a step that is no longer legal after the likeliest dice (`cut`): the tree's world had a miss where the line hits.
 *
 * Singles and doubles share this path. The replay reads the simulator on copies and never writes the root.
 */

/** The seed of a replay's battle: every die the line names is forced, so nothing reads it (the sweep plays two seeds and compares the logs). */
const REPLAY_SEED = '1,2,3,4';

/** One side's slot choices for the engine's choice string, aligned with the slots the simulator asks. */
export function slotChoicesOf(battle: Battle, side: 'p1' | 'p2', choice: string, label: string): (BranchSlotChoice | null)[] | null {
  const state = createBranchStateFromBattle(battle as unknown as SimBattle, [], {});
  const actives = side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots;
  if (choice === 'wait') return actives.map(() => null);
  const forced = side === 'p1' ? state.p1ForceSwitches : state.p2ForceSwitches;
  const mask = requiredChoicesForActiveSlots(actives.map(active => (active ? { fainted: active.fainted, commanding: active.commanding } : null)), forced);
  return evalChoiceToSlotChoices(
    choice, side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot, side === 'p1' ? state.p1SwitchesBySlot : state.p2SwitchesBySlot, label, mask,
  );
}

/** The dice put on the slot choice of the body that holds them (a pair's die on its first slot); a die whose holder has no choice goes on the first choice of its side, else of the other. */
export function withDice(p1: (BranchSlotChoice | null)[], p2: (BranchSlotChoice | null)[], dice: readonly ForcedDie[]): void {
  for (const die of dice) {
    const own = die.name.slot[1] === '1' ? p1 : p2;
    const lists = [own, own === p1 ? p2 : p1];
    const index = die.name.slot[2] === 'b' ? 1 : 0;
    const place = own[index] ? { list: own, at: index } : lists.map(list => ({ list, at: list.findIndex(choice => choice !== null) })).find(found => found.at >= 0);
    const held = place?.list[place.at];
    if (place && held) place.list[place.at] = { ...held, dice: [...(held.dice ?? []), die] };
  }
}

interface Replay { steps: LineStep[]; unforced: Set<string>; cut?: string; battle: Battle; turns: number }

const labelOf = (line: TreeLineStep, side: 'p1' | 'p2'): string => (side === 'p1' ? line.p1 : line.p2);

/** The two sides' options for one wanted step, resolved by label, and the slot choices that go with them; null with the reason when the step cannot be played. */
interface Resolved { o1: ChoiceOption; o2: ChoiceOption; s1: (BranchSlotChoice | null)[]; s2: (BranchSlotChoice | null)[] }

function resolveStep(root: SimPosition, battle: Battle, index: number, wanted: TreeLineStep, input: LinesInput): Resolved | string {
  const position = index === 0 ? root : toPosition(copyOf(battle));
  const options = (side: 'p1' | 'p2') => searchOptions(position, side, {
    tera: input.tera ?? true, keep: index === 0 ? input.keepPlayed?.[side === 'p1' ? 'p1Slots' : 'p2Slots'] : undefined, sleepClause: input.sleepClause,
  }).find(option => option.label === labelOf(wanted, side));
  const o1 = options('p1');
  const o2 = options('p2');
  if (!o1 || !o2) return `step ${index + 1}: ${!o1 ? `p1 ${wanted.p1}` : `p2 ${wanted.p2}`} is not legal after the likeliest dice`;
  const s1 = slotChoicesOf(battle, 'p1', o1.choice, o1.label);
  const s2 = slotChoicesOf(battle, 'p2', o2.choice, o2.label);
  return s1 && s2 ? { o1, o2, s1, s2 } : `step ${index + 1}: the choices do not map onto the slots`;
}

function replayDonor(root: SimPosition, donor: readonly TreeLineStep[], input: LinesInput): Replay {
  let battle = forkBattle(root, REPLAY_SEED);
  const out: Replay = { steps: [], unforced: new Set(), battle, turns: 0 };
  for (const [index, wanted] of donor.entries()) {
    if (battle.ended) break;
    const resolved = resolveStep(root, battle, index, wanted, input);
    if (typeof resolved === 'string') {
      out.cut = resolved;
      break;
    }
    const { o1, o2, s1, s2 } = resolved;
    const replacement = battle.requestState === 'switch' ? (o1.choice === 'wait' ? 'p2' : o2.choice === 'wait' ? 'p1' : 'both') : undefined;
    const play = (b: Battle): void => {
      perfCount('lines-sim-turns');
      applyChoice(b, 'p1', o1.choice);
      applyChoice(b, 'p2', o2.choice);
    };
    let turn;
    try {
      turn = playLikeliestTurn(battle, play);
    } catch (error) {
      out.cut = `step ${index + 1}: ${String((error as Error)?.message ?? error).slice(0, 120)}`;
      break;
    }
    // a die that is sure (a 100 percent accuracy) cannot go the other way: the click need not force it
    const kept = turn.dice.filter(entry => entry.chance !== 1);
    const forced = kept.map(entry => entry.die);
    const dice = kept.map((entry, at) => lineDie(battle, play, forced, entry, at));
    withDice(s1, s2, forced);
    out.steps.push({
      p1: { choice: o1.choice, label: o1.label, slots: s1 },
      p2: { choice: o2.choice, label: o2.label, slots: s2 },
      ...(replacement ? { replacement } : {}),
      dice,
    });
    for (const kind of turn.unforced) out.unforced.add(kind);
    if (turn.unnamed > 0) out.unforced.add('unnamed draw');
    out.turns += 1;
    battle = turn.battle;
  }
  out.battle = battle;
  return out;
}

/** One die as the line shows it: its chance, whether it earns a chip, and, for a roll, whether the roll decides a knock-out. */
export function lineDie(battle: Battle, play: (b: Battle) => void, forced: readonly ForcedDie[], entry: LikeliestDie, at: number): LineDie {
  const decides = entry.die.name.kind === 'damage-roll' ? rollDecides(battle, play, forced, at) : null;
  const chance = decides ? decides.chance : entry.chance;
  return {
    die: entry.die,
    ...(chance === undefined ? {} : { chance }),
    shown: chipShown(entry.die, chance, decides !== null),
    ...(decides ? { ko: { rolls: decides.rolls, of: decides.of } } : {}),
  };
}

/** Who the position after the last step asks to send a body in (a pivot's switch, a faint's): the tree made no choice for it. */
function awaitsOf(battle: Battle): 'p1' | 'p2' | 'both' | undefined {
  if (battle.ended) return undefined;
  const asked = battle.sides.map(side => side.requestState === 'switch');
  return asked[0] && asked[1] ? 'both' : asked[0] ? 'p1' : asked[1] ? 'p2' : undefined;
}

function lineOf(request: LineRequest, replay: Replay, perspective: 1 | -1, matchupCache: MatchupCache): EvalLine {
  const first = replay.steps[0];
  const own = request.side === 'p1' ? first.p1 : first.p2;
  const awaits = awaitsOf(replay.battle);
  return {
    side: request.side,
    label: request.label,
    choice: own.choice,
    for: request.for,
    steps: replay.steps,
    end: perspective * leafValue(replay.battle, matchupCache),
    endFainted: battleFaintedFraction(replay.battle),
    visits: request.visits,
    ...(replay.cut ? { cut: replay.cut } : {}),
    ...(awaits ? { awaits } : {}),
    ...(replay.unforced.size > 0 ? { unforced: [...replay.unforced] } : {}),
  };
}

/**
 * The lines of a search: for each request the first donor whose replay keeps every step of its tree's line, else the replay that kept
 * the most (the earlier donor on a tie). A request no donor can start is left out. The root battle is read and never written.
 */
export function playLines(serializedBattle: string, ruleset: StaticRuleset, input: LinesInput): EvalLine[] {
  const root = createRootPosition(serializedBattle, ruleset);
  if (positionBattle(root).ended) return [];
  const matchupCache = createMatchupCache(ruleset);
  const lines: EvalLine[] = [];
  for (const request of input.requests) {
    let best: Replay | null = null;
    for (const donor of request.donors) {
      const replay = replayDonor(root, donor, input);
      perfCount('lines-turns', replay.turns);
      if (replay.steps.length === 0) continue;
      if (!best || replay.steps.length > best.steps.length) best = replay;
      if (!replay.cut) break;
    }
    if (best) lines.push(lineOf(request, best, request.side === 'p1' ? 1 : -1, matchupCache));
  }
  return lines;
}
