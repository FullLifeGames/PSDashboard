import type { Battle } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { fallen, otherResults, rollDecides, playTurnWith, type LikeliestDie } from '../../dice/likeliest.ts';
import { createMatchupCache } from '../../eval-function.ts';
import type { ChoiceOption } from '../../forward-model.ts';
import { applyChoice } from '../../forward/switches.ts';
import { battleFaintedFraction, leafValue } from '../../search/leaf.ts';
import { lineDie, slotChoicesOf, withDice } from '../../search/lines.ts';
import type { StaticRuleset } from '../../score/weights.ts';
import type { EvalLine, LineStep } from '../../types.ts';
import type { PinnedTurn } from '../../dice/likeliest.ts';
import { dieKey } from '../../dice/types.ts';

/**
 * Round 89 (#130, step 2): the steps of a luck path and the line the app plays from them. A path is a list of steps (a turn, or the
 * replacement a faint or a pivot asks for), each with the choices of both sides, the battle it started from and the turn it played
 * with its dice (`playTurnWith`). Its exact chance is the product over its dice of the share of each die's results that leave the same
 * bodies standing as the result taken (`chanceOfDie`): the chance the simulator's draw names where the other result changes who falls,
 * one where it does not.
 */
export interface PathStep {
  /** The battle at the step's start (read, never written). */
  start: Battle;
  p1: ChoiceOption;
  p2: ChoiceOption;
  turn: PinnedTurn;
  /** The turns the path has taken once this step is played (a replacement is no turn). */
  turnsDone: number;
}

export const playOf = (p1: ChoiceOption, p2: ChoiceOption) => (battle: Battle): void => {
  applyChoice(battle, 'p1', p1.choice);
  applyChoice(battle, 'p2', p2.choice);
};

/** Whether the battle stands at a request for a replacement (a faint's, a pivot's) rather than at a turn boundary. */
export const awaitsReplacement = (battle: Battle): boolean => battle.sides.slice(0, 2).some(side => side.requestState === 'switch');

export const wonBy = (battle: Battle, side: 'p1' | 'p2'): boolean => battle.ended && battle.winner === battle.sides[sideIndex(side)].name;

/** The dice of a step in the order the turn asked for them (a die no draw reached, a tie, after them). */
export function inDrawOrder(turn: PinnedTurn): LikeliestDie[] {
  const rank = (entry: LikeliestDie): number => { const at = turn.drawOrder.indexOf(dieKey(entry.die.name)); return at < 0 ? turn.drawOrder.length : at; };
  return [...turn.dice].sort((a, b) => rank(a) - rank(b));
}

/**
 * The chance of one die of a step: the share of its results that leave the same bodies standing as the result the path takes. A die
 * whose other results change who falls counts the chance of the result taken (a miss that spares the foe: 0.2); a die whose every
 * result gives the same outcome counts one (a crit on a body one hit point from falling). A damage roll counts the share of rolls in
 * its group (`rollDecides`); a die the draw names no other result for (a sure chance, a draw with no chance) counts one. `count` is
 * told the turns played on copies to decide it.
 */
function chanceOfDie(step: PathStep, dice: readonly LikeliestDie[], at: number, count: (plays: number) => void): number {
  const entry = dice[at];
  const { kind } = entry.die.name;
  const play = playOf(step.p1, step.p2);
  if (kind === 'damage-roll') {
    const decides = rollDecides(step.start, play, dice.map(item => item.die), at);
    count(decides ? 2 + Math.ceil(Math.log2(decides.of)) : 2);
    return decides ? decides.chance : 1;
  }
  const alternatives = otherResults(entry, step.turn.draws.get(dieKey(entry.die.name)));
  if (alternatives.length === 0) return entry.chance ?? 1;
  const taken = fallen(step.turn.battle);
  let share = entry.chance ?? 0.5;
  for (const alternative of alternatives) {
    count(1);
    const trial = playTurnWith(step.start, playOf(step.p1, step.p2), dice.map((item, index) => (index === at ? alternative : item)));
    if (fallen(trial.battle) === taken) share += alternative.chance ?? 0;
  }
  return Math.min(1, share);
}

/** The exact chance of a path (the product over its steps and their dice); `count` is told the turns played to read the rolls and ties. */
export function exactChance(path: readonly PathStep[], count: (plays: number) => void): number {
  let chance = 1;
  for (const step of path) {
    const dice = turnDice(step);
    for (let at = 0; at < dice.length; at++) chance *= chanceOfDie(step, dice, at, count);
  }
  return chance;
}

/** The dice the turn played (the list `rollDecides` and the line index into). */
const turnDice = (step: PathStep): LikeliestDie[] => step.turn.dice;

/** The line of a winning path, as the app plays it: each step's slot choices with its dice on their holders, the way #104's lines carry them. */
export function lineOfPath(side: 'p1' | 'p2', path: readonly PathStep[], ruleset: StaticRuleset): EvalLine | null {
  const steps: LineStep[] = [];
  const unforced = new Set<string>();
  for (const step of path) {
    const s1 = slotChoicesOf(step.start, 'p1', step.p1.choice, step.p1.label);
    const s2 = slotChoicesOf(step.start, 'p2', step.p2.choice, step.p2.label);
    if (!s1 || !s2) return null;
    const play = playOf(step.p1, step.p2);
    const kept = step.turn.dice.filter(entry => entry.chance !== 1);
    const forced = kept.map(entry => entry.die);
    const dice = kept.map((entry, at) => lineDie(step.start, play, forced, entry, at));
    withDice(s1, s2, forced);
    const replacement = awaitsReplacement(step.start) ? (step.p1.choice === 'wait' ? 'p2' : step.p2.choice === 'wait' ? 'p1' : 'both') : undefined;
    steps.push({ p1: { choice: step.p1.choice, label: step.p1.label, slots: s1 }, p2: { choice: step.p2.choice, label: step.p2.label, slots: s2 }, ...(replacement ? { replacement } : {}), dice });
    for (const kind of step.turn.unforced) unforced.add(kind);
    if (step.turn.unnamed > 0) unforced.add('unnamed draw');
  }
  const first = steps[0];
  const own = side === 'p1' ? first.p1 : first.p2;
  const last = path[path.length - 1].turn.battle;
  return {
    side, label: own.label, choice: own.choice, for: [], steps,
    end: (side === 'p1' ? 1 : -1) * leafValue(last, createMatchupCache(ruleset)),
    endFainted: battleFaintedFraction(last), visits: 0,
    ...(unforced.size > 0 ? { unforced: [...unforced] } : {}),
  };
}

