import { toID, type Battle } from '@pkmn/sim';
import { applied, otherwise, parts, shows, slotOfIdent, type Witness } from './report-lines.ts';
import type { ReportInput } from './report.ts';
import type { DieReport } from './types.ts';

/**
 * Round 89 (#137): the witnesses of the two dice that sample a body. A `random-target` die is the foe a move was aimed at when the
 * click named none: the draw runs before the move is in flight, so the witness is the `|move|` line the draw is followed by, which
 * names the target. A `drag` die is the body that came in: the `|drag|` line of the slot dragged out names it.
 */

/** The first line from `from` on of the given kind for the slot that `matches`. */
function lineFrom(log: readonly string[], from: number, type: string, slot: string, matches: (fields: string[]) => boolean): string | undefined {
  return log.slice(from).find(line => {
    const fields = parts(line);
    return fields[1] === type && slotOfIdent(fields[2]) === slot && matches(fields);
  });
}

const nameOf = (ident: string | undefined): string => (ident ?? '').split(':').slice(1).join(':').trim();

/** The die was drawn: the line that follows shows the body the answer names, or says what happened instead. */
export function pickReport(w: Witness, battle: Battle): DieReport {
  const { name, result } = w.die;
  const log = battle.log;
  const from = w.seen.logIndex ?? log.length;
  const option = 'option' in result ? result.option : undefined;
  if (name.kind === 'drag') {
    const line = lineFrom(log, from, 'drag', name.slot, () => true);
    if (line === undefined) return otherwise(w, 'blocked', `no body came into ${name.slot}: the protocol shows no drag line after the draw`);
    return nameOf(parts(line)[2]) === option ? applied(w) : otherwise(w, 'blocked', `${shows(line)}, not ${option}`);
  }
  const line = lineFrom(log, from, 'move', name.slot, fields => toID(fields[3]) === name.moveId);
  if (line === undefined) return otherwise(w, 'blocked', `${w.name} did not run after the draw`);
  const aimed = slotOfIdent(parts(line)[4]);
  if (aimed === option) return applied(w);
  return otherwise(w, 'blocked', aimed ? `${shows(line)}, not ${option}` : `the move line names no target (${shows(line)})`);
}

/** The die was never drawn: the click named a target (or the one foe of singles stands), or the body never moved or never dragged. */
export function pickNoDraw(input: ReportInput): DieReport | null {
  const { die, battle, start } = input;
  const { kind, slot, moveId } = die.name;
  if (kind !== 'random-target' && kind !== 'drag') return null;
  const turn = battle.log.slice(start);
  if (kind === 'drag') return { die, took: 'no-draw', reason: `the simulator dragged no body out of ${slot} this turn` };
  const name = battle.dex.moves.get(moveId).name || moveId;
  const line = lineFrom(turn, 0, 'move', slot, fields => toID(fields[3]) === moveId);
  if (line === undefined) return { die, took: 'no-draw', reason: `${slot} did not use ${name} this turn` };
  return { die, took: 'no-draw', reason: `${name} kept the target of its click: the simulator drew no random target (${shows(line)})` };
}
