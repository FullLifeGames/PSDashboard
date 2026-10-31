import { toID, type Battle } from '@pkmn/sim';
import type { DieNote } from './prng.ts';
import type { DieReport, ForcedDie } from './types.ts';
import type { MoveSight } from './watch.ts';
import { about, applied, otherwise, parts, shows, slotOfIdent, type Witness } from './report-lines.ts';
import { moveNoDraw, moveWitness } from './report-moves.ts';
import { statusNoDraw, statusReport } from './report-turn.ts';

/**
 * Round 82 (forced dice), decision D9: what became of a forced die. The real turn's PRNG notes whether the simulator drew the
 * die and whether the draw could give the answer; this module reads the protocol's own lines after the draw and says
 * `applied` (the protocol shows the answer), `no-draw` (the simulator never drew it, for both answers: a move that hits
 * without an accuracy draw, a move that always crits), `no-chance` (a draw ran and has no way to give the answer) or `blocked` (the draw ran and the answer was given, but the effect did not land). The reason is the
 * protocol line that shows why, or a short sentence.
 *
 * The witness per kind (the user's answer against the lines of the action, from the log index of the first draw to the next
 * action):
 * - accuracy: yes needs no `|-miss|` for the target and an effect line for it, no needs the `|-miss|`.
 * - crit: yes needs the `|-crit|` line, no needs none. The Gen 2 crit compares a number to a threshold the draw does not
 *   show, so the module answers 0 or 255 and the protocol decides.
 * - damage roll: the draw ran, so a damage line for the target (or the Substitute's `[damage]` activation) has to follow.
 * - secondary: the effect line of the entry (a `|-status|`, a `|cant|` flinch, a `|-start|`, a `|-boost|` or `|-unboost|`) after
 *   the draw, for the target (for the user when the entry is a self effect).
 * - self effect: a `|-boost|` or `|-unboost|` of the move's own stats on the user.
 * - hit count: the `|-hitcount|` line equals the count; a count no draw gives is `no-chance` (the learner found none).
 * - stalling: no `|-fail|` for the user in the action means it succeeded.
 * - power: the handler's own `|-activate|` line for its move means the stronger draw.
 * - status check: a yes shows as a line that names the condition after the draw; a no has no line of its own (report-turn.ts).
 */

export interface ReportInput {
  die: ForcedDie;
  /** What the real turn's PRNG saw of the die; undefined when the simulator never drew it. */
  note: DieNote | undefined;
  battle: Battle;
  /** `battle.log.length` before the real turn. */
  start: number;
  /** What the watch saw of the moves of the turn (the reasons of a die that was never drawn). */
  saw?: ReadonlyMap<string, MoveSight>;
}

/** Lines that open a new action: the next body's move, a switch, the end of the turn. A move another move calls (`[from]`) belongs to the action. */
function startsAction(line: string): boolean {
  const type = line.split('|')[1];
  if (line === '|') return true;
  if (type === 'move') return !line.includes('|[from]');
  return type === 'cant' || type === 'switch' || type === 'drag' || type === 'upkeep' || type === 'turn' || type === 'win' || type === 'tie';
}

/** The lines of the action that holds the draw at log index `from`. */
function windowOf(log: readonly string[], from: number): string[] {
  const lines: string[] = [];
  for (let index = from; index < log.length; index++) {
    if (startsAction(log[index])) break;
    lines.push(log[index]);
  }
  return lines;
}

/** Lines that say what a hit was like, not that it did something. */
const MARKERS = new Set(['-miss', '-crit', '-supereffective', '-resisted', '-hitcount', '-immune', '-fail', '-notarget', '-block', '-anim', '-prepare', '-singleturn', '-hint', '-nothing', 'move']);

/** A line about the target that shows the hit did something: damage, a status, a boost, a start, the Substitute taking the hit. */
function isEffect(line: string): boolean {
  const type = parts(line)[1];
  if (type === '-activate') return line.includes('[damage]');
  return type.startsWith('-') && !MARKERS.has(type);
}

/** The `|-miss|` line for the target: Gens 3 and up name user and target, Gens 1 and 2 only the user. */
function missFor(line: string, targetSlot: string | undefined): boolean {
  const fields = parts(line);
  if (fields[1] !== '-miss') return false;
  return fields[3] === undefined || targetSlot === undefined || slotOfIdent(fields[3]) === targetSlot;
}

/** A line that stops a move: an immunity, a failure, no target, a block, a miss, a Protect-like activation (an `-activate` that is no `[damage]`). */
function isBlocker(line: string, targetSlot: string | undefined): boolean {
  const type = parts(line)[1];
  if (type === '-miss') return missFor(line, targetSlot);
  if (type === '-immune' || type === '-block') return about(line, targetSlot);
  if (type === '-fail' || type === '-notarget') return true;
  return type === '-activate' && !line.includes('[damage]') && about(line, targetSlot);
}

/** Lines a move that did nothing leaves behind. */
const QUIET = new Set(['debug', '-nothing', '']);


/** Why the simulator never drew the die, read from the protocol of the turn. */
function noDraw(input: ReportInput): DieReport {
  const { die, battle, start } = input;
  const { moveId, slot } = die.name;
  const move = battle.dex.moves.get(moveId);
  const turn = battle.log.slice(start);
  const moveLine = turn.findIndex(line => {
    const fields = parts(line);
    return fields[1] === 'move' && slotOfIdent(fields[2]) === slot && toID(fields[3]) === moveId;
  });
  if (moveLine < 0) {
    const cant = turn.find(line => parts(line)[1] === 'cant' && slotOfIdent(parts(line)[2]) === slot);
    return { die, took: 'no-draw', reason: `${slot} did not use ${move.name} this turn${cant ? ` (${shows(cant)})` : ''}` };
  }
  const next = turn[moveLine + 1];
  if (next !== undefined && parts(next)[1] === 'cant' && slotOfIdent(parts(next)[2]) === slot) {
    return { die, took: 'no-draw', reason: `${move.name} did not run: ${shows(next)}` };
  }
  return statusNoDraw(input, move.name, turn) ?? noDrawInAction(input, move, windowOf(turn, moveLine + 1));
}

/** The move ran and a hit followed: why the simulator drew no die for it, read from the lines of the action. */
function noDrawInAction(input: ReportInput, move: ReturnType<Battle['dex']['moves']['get']>, action: string[]): DieReport {
  const { die } = input;
  const { targetSlot, kind } = die.name;
  const blocker = action.find(line => isBlocker(line, targetSlot));
  if (blocker) return { die, took: 'no-draw', reason: `${move.name} drew no ${kind}: ${shows(blocker)}` };
  // A future move draws in the end-of-turn residual two turns later, when no move is in flight.
  if (move.flags.futuremove) return { die, took: 'no-draw', reason: `${move.name} lands two turns later: its draws fall in the end-of-turn residual` };
  const happened = action.some(line => (about(line, targetSlot) && isEffect(line)) || parts(line)[1] === '-activate');
  // A die the simulator never drew is `no-draw` for both answers; `no-chance` stays for a draw that ran and cannot give the answer.
  if (kind === 'accuracy' && happened) return { die, took: 'no-draw', reason: `${move.name} hit without an accuracy draw: it cannot miss here` };
  if (kind === 'crit' && move.willCrit && action.some(line => about(line, targetSlot) && isEffect(line))) {
    return { die, took: 'no-draw', reason: `${move.name} always crits: the simulator draws no crit` };
  }
  const extra = moveNoDraw(input, move.name, action);
  if (extra) return extra;
  if (action.every(line => QUIET.has(parts(line)[1]))) return { die, took: 'no-draw', reason: `${move.name} did nothing this turn: no line follows it` };
  return { die, took: 'no-draw', reason: `the simulator drew no ${kind} for ${move.name} this turn` };
}

function accuracyReport(w: Witness, happens: boolean): DieReport {
  const missed = w.action.some(line => missFor(line, w.targetSlot));
  if (!happens) return missed ? applied(w) : otherwise(w, 'no-chance', `${w.name} hit although the die gave a miss`);
  if (missed) return otherwise(w, 'blocked', `${w.name} missed although the die gave a hit`);
  const blocker = w.action.find(line => isBlocker(line, w.targetSlot));
  if (blocker) return otherwise(w, 'blocked', `${w.name} hit and did nothing: ${shows(blocker)}`);
  if (!w.target.some(isEffect)) return otherwise(w, 'blocked', `${w.name} hit and left no effect line for ${w.targetSlot ?? 'the target'}`);
  return applied(w);
}

function critReport(w: Witness, happens: boolean): DieReport {
  const crit = w.target.some(line => parts(line)[1] === '-crit');
  if (crit === happens) return applied(w);
  // The Gen 2 draw compares a number to a threshold it does not show: 0 and 255 are not a way to a crit or to none.
  if (w.note.chance === undefined) return otherwise(w, 'no-chance', `${w.name}'s crit threshold lets ${happens ? 'no crit' : 'every number'} through`);
  return happens
    ? otherwise(w, 'blocked', 'the crit drew but no crit line followed: a rule of the target or the move stopped it')
    : otherwise(w, 'no-chance', 'the crit showed although the die gave none');
}

function rollReport(w: Witness): DieReport {
  const damaged = w.target.some(line => parts(line)[1] === '-damage' || (parts(line)[1] === '-activate' && line.includes('[damage]')));
  return damaged ? applied(w) : otherwise(w, 'blocked', `the roll drew but no damage line followed for ${w.targetSlot ?? 'the target'}`);
}

export function reportOf(input: ReportInput): DieReport {
  const { die, note, battle } = input;
  if (!note) return noDraw(input);
  const seen = { ...(note.chance === undefined ? {} : { chance: note.chance }), ...(note.logIndex === undefined ? {} : { logIndex: note.logIndex }) };
  if (note.unfit) return { die, took: 'no-chance', ...seen, reason: 'the answer does not fit this die: no such step or result' };
  if (note.noChance) {
    const percent = note.chance === undefined ? '' : ` (chance ${Math.round(note.chance * 10000) / 100} percent)`;
    return { die, took: 'no-chance', ...seen, reason: `the draw has no way to give this answer${percent}` };
  }
  const { targetSlot, moveId } = die.name;
  const action = windowOf(battle.log, note.logIndex ?? battle.log.length);
  const witness: Witness = {
    die, seen, note, action, targetSlot, target: action.filter(line => about(line, targetSlot)), name: battle.dex.moves.get(moveId).name || moveId,
  };
  return witnessOf(witness, battle);
}

/** The witness of the die's kind. */
function witnessOf(witness: Witness, battle: Battle): DieReport {
  const { kind } = witness.die.name;
  const { result } = witness.die;
  if (kind === 'accuracy' && 'happens' in result) return accuracyReport(witness, result.happens);
  if (kind === 'crit' && 'happens' in result) return critReport(witness, result.happens);
  if (kind === 'damage-roll') return rollReport(witness);
  if (kind === 'status-check' && 'happens' in result) return statusReport(witness, result.happens, battle.log);
  return moveWitness(witness, battle) ?? applied(witness);
}
