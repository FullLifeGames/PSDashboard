import { toID } from '@pkmn/sim';
import { applied, otherwise, parts, slotOfIdent, type Witness } from './report-lines.ts';
import type { ReportInput } from './report.ts';
import type { DieReport } from './types.ts';

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
  if (type === 'move') return !line.includes('|[from]');
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
