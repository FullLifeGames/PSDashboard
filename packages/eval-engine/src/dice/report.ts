import { toID, type Battle } from '@pkmn/sim';
import type { DieNote } from './prng.ts';
import type { DieName, DieReport, ForcedDie } from './types.ts';
import type { MoveSight } from './watch.ts';
import { about, applied, otherwise, parts, shows, slotOfIdent, type Witness } from './report-lines.ts';
import { moveNoDraw, moveWitness } from './report-moves.ts';
import { pickNoDraw, pickReport } from './report-picks.ts';
import { endNoDraw, procReport, SPAN_KINDS } from './report-procs.ts';
import { moveFirstReport, orderNoDraw, startRollReport, statusNoDraw, statusReport, tieReport } from './report-turn.ts';


export interface ReportInput {
  die: ForcedDie;
  note: DieNote | undefined;
  battle: Battle;
  /** `battle.log.length` before the real turn. */
  start: number;
  saw?: ReadonlyMap<string, MoveSight>;
  /** The start-of-turn roll of Gens 2 and 3, written on the battle: no draw of the turn belongs to it. */
  startRoll?: boolean;
}

// A move another move calls (`[from]`) belongs to the action.
function startsAction(line: string): boolean {
  const type = line.split('|')[1];
  if (line === '|') return true;
  if (type === 'move') return !line.includes('|[from]');
  return type === 'cant' || type === 'switch' || type === 'drag' || type === 'upkeep' || type === 'turn' || type === 'win' || type === 'tie';
}

function windowOf(log: readonly string[], from: number): string[] {
  const lines: string[] = [];
  for (let index = from; index < log.length; index++) {
    if (startsAction(log[index])) break;
    lines.push(log[index]);
  }
  return lines;
}

const MARKERS = new Set(['-miss', '-crit', '-supereffective', '-resisted', '-hitcount', '-immune', '-fail', '-notarget', '-block', '-anim', '-prepare', '-singleturn', '-hint', '-nothing', 'move']);

function isEffect(line: string): boolean {
  const type = parts(line)[1];
  if (type === '-activate') return line.includes('[damage]');
  return type.startsWith('-') && !MARKERS.has(type);
}

function missFor(line: string, targetSlot: string | undefined): boolean {
  const fields = parts(line);
  if (fields[1] !== '-miss') return false;
  return fields[3] === undefined || targetSlot === undefined || slotOfIdent(fields[3]) === targetSlot;
}

function isBlocker(line: string, targetSlot: string | undefined): boolean {
  const type = parts(line)[1];
  if (type === '-miss') return missFor(line, targetSlot);
  if (type === '-immune' || type === '-block') return about(line, targetSlot);
  if (type === '-fail' || type === '-notarget') return true;
  return type === '-activate' && !line.includes('[damage]') && about(line, targetSlot);
}

const QUIET = new Set(['debug', '-nothing', '']);


function noDraw(input: ReportInput): DieReport {
  const early = orderNoDraw(input) ?? pickNoDraw(input);
  if (early) return early;
  if (input.die.name.kind === 'end-of-turn') return endNoDraw(input);
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

// For a later hit's die only a line before the first hit's effect on the target blocks; `hitNoDraw` reads the count.
function firstBlocker(action: readonly string[], name: DieName): string | undefined {
  const later = name.kind === 'accuracy' && name.hit !== undefined;
  const effect = later ? action.findIndex(line => about(line, name.targetSlot) && isEffect(line)) : -1;
  return (effect < 0 ? action : action.slice(0, effect)).find(line => isBlocker(line, name.targetSlot));
}

function noDrawInAction(input: ReportInput, move: ReturnType<Battle['dex']['moves']['get']>, action: string[]): DieReport {
  const { die } = input;
  const { targetSlot, kind } = die.name;
  const blocker = firstBlocker(action, input.die.name);
  if (blocker) return { die, took: 'no-draw', reason: `${move.name} drew no ${kind}: ${shows(blocker)}` };
  if (move.flags.futuremove) return { die, took: 'no-draw', reason: `${move.name} lands two turns later: its draws fall in the end-of-turn residual` };
  const happened = action.some(line => (about(line, targetSlot) && isEffect(line)) || parts(line)[1] === '-activate');
  if (kind === 'accuracy' && die.name.hit !== undefined && happened) return hitNoDraw(input, move.name, action);
  // A die the simulator never drew is `no-draw` for both answers; `no-chance` is a draw that ran and cannot give it.
  if (kind === 'accuracy' && happened) return { die, took: 'no-draw', reason: `${move.name} hit without an accuracy draw: it cannot miss here` };
  if (kind === 'crit' && move.willCrit && action.some(line => about(line, targetSlot) && isEffect(line))) {
    return { die, took: 'no-draw', reason: `${move.name} always crits: the simulator draws no crit` };
  }
  const extra = moveNoDraw(input, move.name, action);
  if (extra) return extra;
  if (action.every(line => QUIET.has(parts(line)[1]))) return { die, took: 'no-draw', reason: `${move.name} did nothing this turn: no line follows it` };
  return { die, took: 'no-draw', reason: `the simulator drew no ${kind} for ${move.name} this turn` };
}

// A target that fainted in the chain gets `|-hitcount|p2: Name|3` with its side: the slot's side reads as the target.
function hitCountIn(action: readonly string[], targetSlot: string | undefined): number | undefined {
  const line = action.find(entry => parts(entry)[1] === '-hitcount' && (about(entry, targetSlot) || slotOfIdent(parts(entry)[2]) === targetSlot?.slice(0, 2)));
  return line === undefined ? undefined : Number(parts(line)[3]);
}

function hitNoDraw(input: ReportInput, move: string, action: readonly string[]): DieReport {
  const { die } = input;
  const count = hitCountIn(action, die.name.targetSlot);
  const hit = die.name.hit!;
  if (count !== undefined && count < hit) {
    return { die, took: 'no-draw', reason: `${move} ended after ${count} hit${count === 1 ? '' : 's'}, so hit ${hit} was never rolled`, landed: count };
  }
  return { die, took: 'no-draw', reason: `${move} rolls no accuracy for hit ${hit} here: one roll covers every hit` };
}

function hitReport(w: Witness, happens: boolean): DieReport {
  const hit = w.die.name.hit!;
  const count = hitCountIn(w.action, w.targetSlot);
  if (happens) {
    if (count !== undefined && count >= hit) return applied(w);
    return { ...otherwise(w, 'blocked', `${w.name} stopped after ${count ?? 0} hit${count === 1 ? '' : 's'} although the die gave hit ${hit}`), landed: count ?? 0 };
  }
  if (count === hit - 1) return applied(w);
  return otherwise(w, 'no-chance', `${w.name} landed hit ${hit} although the die gave a miss (the protocol counts ${count ?? 'no'} hits)`);
}

function accuracyReport(w: Witness, happens: boolean): DieReport {
  if (w.die.name.hit !== undefined) return hitReport(w, happens);
  const missed = w.action.some(line => missFor(line, w.targetSlot));
  if (!happens) return missed ? applied(w) : otherwise(w, 'no-chance', `${w.name} hit although the die gave a miss`);
  if (missed) return otherwise(w, 'blocked', `${w.name} missed although the die gave a hit`);
  // A line after the hit's first effect is no block: an ability or item answering the damage writes `-activate` there.
  const effect = w.action.findIndex(line => about(line, w.targetSlot) && isEffect(line));
  const blocker = w.action.slice(0, effect < 0 ? undefined : effect).find(line => isBlocker(line, w.targetSlot));
  if (blocker) return otherwise(w, 'blocked', `${w.name} hit and did nothing: ${shows(blocker)}`);
  if (!w.target.some(isEffect)) return otherwise(w, 'blocked', `${w.name} hit and left no effect line for ${w.targetSlot ?? 'the target'}`);
  return applied(w);
}

function critReport(w: Witness, happens: boolean): DieReport {
  const crit = w.target.some(line => parts(line)[1] === '-crit');
  if (crit === happens) return applied(w);
  // The Gen 2 draw compares a number to a threshold it does not show: 0 and 255 are no way to a crit or to none.
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
  if (input.startRoll) return startRollReport(die, battle.log, input.start);
  if (!note) return noDraw(input);
  const seen = { ...(note.chance === undefined ? {} : { chance: note.chance }), ...(note.logIndex === undefined ? {} : { logIndex: note.logIndex }) };
  if (note.unfit) return { die, took: 'no-chance', ...seen, reason: 'the answer does not fit this die: no such step or result' };
  if (note.noChance) {
    const percent = note.chance === undefined ? '' : ` (chance ${Math.round(note.chance * 10000) / 100} percent)`;
    return { die, took: 'no-chance', ...seen, reason: `the draw has no way to give this answer${percent}` };
  }
  const { targetSlot, moveId } = die.name;
  const action = windowOf(battle.log, note.logIndex ?? battle.log.length);
  // A proc or an end-of-turn die owns the lines up to the next draw of any die: two holders' lines share one action.
  if (SPAN_KINDS.has(die.name.kind) && note.until !== undefined) action.length = Math.min(action.length, note.until - (note.logIndex ?? 0));
  const witness: Witness = {
    die, seen, note, action, targetSlot, target: action.filter(line => about(line, targetSlot)), name: battle.dex.moves.get(moveId).name || moveId,
  };
  return witnessOf(witness, battle, input.start);
}

function witnessOf(witness: Witness, battle: Battle, start: number): DieReport {
  const { kind } = witness.die.name;
  const { result } = witness.die;
  if (kind === 'accuracy' && 'happens' in result) return accuracyReport(witness, result.happens);
  if (kind === 'crit' && 'happens' in result) return critReport(witness, result.happens);
  if (kind === 'damage-roll') return rollReport(witness);
  if (kind === 'status-check' && 'happens' in result) return statusReport(witness, result.happens, battle.log);
  if (kind === 'speed-tie') return tieReport(witness, battle.log, start);
  if (kind === 'random-target' || kind === 'drag') return pickReport(witness, battle);
  if (kind === 'move-first' && 'happens' in result) return moveFirstReport(witness, result.happens, battle.log);
  if (SPAN_KINDS.has(kind)) return procReport(witness, battle);
  return moveWitness(witness, battle) ?? applied(witness);
}
