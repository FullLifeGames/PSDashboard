import { toID } from '@pkmn/sim';
import { rollsAtTurnStart } from './recognize.ts';
import { applied, otherwise, parts, slotOfIdent, type Witness } from './report-lines.ts';
import type { ReportInput } from './report.ts';
import type { DieReport, ForcedDie } from './types.ts';

/**
 * Round 82 (forced dice), step A3b: the witnesses of the dice that belong to the body's turn and not to its move: the status
 * checks of the attacker (full paralysis, the thaw, the infatuation, the confusion check) and, in the same file after them, the
 * order of the turn. Each reads the protocol after the draw and says `applied` or `blocked`, and the reasons of a die that was
 * never drawn.
 */

/** The line names the condition in one of its arguments after the body (`|cant|p1a: X|par`, `|-activate|p1a: X|move: Attract`). */
function mentions(line: string, id: string): boolean {
  return parts(line).slice(3).some(field => toID(field) === id || toID(field.replace(/^(move|item|ability): /, '')) === id);
}

/** Lines that start the next action, the end of the turn, or a switch: a status check's own lines come before them. */
function opensNext(line: string): boolean {
  const type = parts(line)[1];
  if (type === 'move') return startsMove(line);
  return type === 'switch' || type === 'drag' || type === 'upkeep' || type === 'turn' || type === 'win' || type === 'tie' || line === '|';
}

/**
 * The lines a status check writes after its draw: the `|cant|` of a stop comes first, then the next body's move opens the next
 * action. A check that lets the body go is followed by the body's own `|move|`, so its window is empty.
 */
function statusWindow(log: readonly string[], from: number): string[] {
  const lines: string[] = [];
  for (let index = from; index < log.length && !opensNext(log[index]); index++) lines.push(log[index]);
  return lines;
}

/**
 * Status check: "happens" is what the body does. Yes: the check lets it go on, its own `|move|` line follows the draw (a thaw
 * shows its `|-curestatus|` first). No: the check stops it (a `|cant|`, or the confusion self-hit), so no `|move|` of its own
 * follows. The condition's own handler decides which way the draw goes (status-probe.ts); this witness reads what came of it.
 */
export function statusReport(w: Witness, happens: boolean, log: readonly string[]): DieReport {
  const { slot } = w.die.name;
  const from = w.seen.logIndex ?? log.length;
  const next = log[from + statusWindow(log, from).length];
  const moved = next !== undefined && parts(next)[1] === 'move' && slotOfIdent(parts(next)[2]) === slot;
  if (moved === happens) return applied(w);
  return happens
    ? otherwise(w, 'blocked', `the check let ${slot} go on but its move did not follow: ${next ?? 'the log ends'}`)
    : otherwise(w, 'blocked', `the check stopped ${slot} but its move followed`);
}

/** Why a status check was never drawn, read from the turn's lines: a move that thaws its user draws no thaw; else the body had no such check. */
export function statusNoDraw(input: ReportInput, moveName: string, turn: readonly string[]): DieReport | null {
  const { die } = input;
  const { slot, effectId = '' } = die.name;
  if (die.name.kind !== 'status-check') return null;
  const cured = turn.find(line => parts(line)[1] === '-curestatus' && slotOfIdent(parts(line)[2]) === slot && mentions(line, effectId));
  if (cured) return { die, took: 'no-draw', reason: `${moveName} thaws its user without a draw: the protocol shows "${cured}"` };
  return { die, took: 'no-draw', reason: `${slot} had no ${effectId} check to draw this turn` };
}

/**
 * A `|move|` line that starts a body's action: no other move called it, or an item let the holder go first (Gen 4 writes the Quick
 * Claw holder's move with `[from] item:`).
 */
const startsMove = (line: string): boolean => !line.includes('|[from]') || line.includes('|[from] item:');

/** The slots of the bodies that acted in the lines, in the order of their first action (a `|move|` that starts an action, or a `|cant|`). */
export function actionOrder(lines: readonly string[]): string[] {
  const order: string[] = [];
  for (const line of lines) {
    const fields = parts(line);
    const acts = (fields[1] === 'move' && startsMove(line)) || fields[1] === 'cant';
    const slot = acts ? slotOfIdent(fields[2]) : undefined;
    if (slot !== undefined && !order.includes(slot)) order.push(slot);
  }
  return order;
}

/**
 * Speed tie: the die names a pair of bodies and says which of them goes first. The order of their first actions in the turn's
 * lines shows it. A body that never acted leaves no order to read: that is blocked, with the body named.
 */
export function tieReport(w: Witness, log: readonly string[], start: number): DieReport {
  const { slot, targetSlot } = w.die.name;
  const first = 'first' in w.die.result ? w.die.result.first : undefined;
  const order = actionOrder(log.slice(start));
  const [a, b] = [order.indexOf(slot), order.indexOf(targetSlot ?? '')];
  const idle = a < 0 ? slot : b < 0 ? targetSlot : undefined;
  if (idle !== undefined) return otherwise(w, 'blocked', `${idle} did not act this turn, so the order of the two cannot show`);
  const went = a < b ? slot : targetSlot;
  return went === first ? applied(w) : otherwise(w, 'blocked', `${first} was forced first but ${went} acted first`);
}

/** Why a die of the turn's order was never drawn. Null for the kinds that belong to a move. */
export function orderNoDraw(input: ReportInput): DieReport | null {
  const { die } = input;
  const { slot, targetSlot, kind } = die.name;
  if (kind === 'speed-tie') return { die, took: 'no-draw', reason: `${slot} and ${targetSlot} did not tie in speed and priority this turn` };
  if (kind === 'move-first' && rollsAtTurnStart(input.battle.gen)) {
    return { die, took: 'no-draw', reason: `${slot} holds nothing that reads the roll of the start of the turn` };
  }
  if (kind === 'move-first') {
    const acted = actionOrder(input.battle.log.slice(input.start)).includes(slot);
    const why = acted ? 'its move is in a priority bracket that draws none' : 'it did not act';
    return { die, took: 'no-draw', reason: `the simulator drew no ${die.name.effectId ?? 'first-mover'} die for ${slot} this turn: ${why}` };
  }
  return null;
}

/**
 * The die that lets a holder act first (Gen 4 on): a yes shows as the item's or the ability's own `|-activate|` line after the
 * draw, a no shows none.
 */
export function moveFirstReport(w: Witness, happens: boolean, log: readonly string[]): DieReport {
  const id = w.die.name.effectId ?? '';
  const window = statusWindow(log, w.seen.logIndex ?? log.length);
  const activated = window.some(line => parts(line)[1] === '-activate' && mentions(line, id));
  if (activated === happens) return applied(w);
  return happens
    ? otherwise(w, 'blocked', `the draw said yes but no activation line of ${id} followed for ${w.die.name.slot}`)
    : otherwise(w, 'blocked', `${id} activated for ${w.die.name.slot} although the die said no`);
}

/**
 * The start-of-turn roll of Gens 2 and 3 is written on the battle, so no draw of the turn carries it. A yes shows as the
 * holder acting before every other body that acted; a holder in a lower priority bracket, or one that did not act, is blocked.
 * A no needs no witness: the roll was written false.
 */
export function startRollReport(die: ForcedDie, log: readonly string[], start: number): DieReport {
  const happens = 'happens' in die.result && die.result.happens;
  if (!happens) return { die, took: 'applied' };
  const order = actionOrder(log.slice(start));
  if (order[0] === die.name.slot) return { die, took: 'applied' };
  const where = order.indexOf(die.name.slot);
  return {
    die, took: 'blocked',
    reason: where < 0
      ? `${die.name.slot} did not act this turn`
      : `${die.name.slot} acted after ${order.slice(0, where).join(' and ')} although the roll gave it the first move`,
  };
}
