import { toID, type Battle } from '@pkmn/sim';
import { applied, otherwise, parts, slotOfIdent, type Witness } from './report-lines.ts';
import type { ReportInput } from './report.ts';
import type { DieReport } from './types.ts';

/**
 * Round 82 (forced dice), step A3a: the witnesses of the dice of a move that are not accuracy, crit or roll (the secondary,
 * the self effect, the hit count, a stalling move, a chance of power) and the reasons of a secondary that was never drawn.
 * Each reads the protocol after the draw and says `applied`, `blocked` or `no-chance` as `report.ts` does for the first three.
 */

/** Names the ability or the item in a body's Dex entry that carries the handler `handler`, or null. */
function holderOf(battle: Battle, slot: string | undefined, handler: string): string | null {
  const body = slot ? battle.sides[slot[1] === '1' ? 0 : 1]?.active[slot[2] === 'a' ? 0 : 1] : undefined;
  if (!body) return null;
  for (const entry of [battle.dex.abilities.get(body.ability), battle.dex.items.get(body.item)]) {
    if (typeof (entry as unknown as Record<string, unknown>)[handler] === 'function') return entry.name;
  }
  return null;
}

/** The reason a secondary die was never drawn when the hit connected: a hook or the user's ability removed the entries. */
function secondaryRemoved(input: ReportInput, moveName: string): string | null {
  const { die, battle, saw } = input;
  const sight = saw?.get(die.name.moveId);
  if (!sight) return null;
  const { targetSlot, slot } = die.name;
  if (targetSlot && sight.removedFor.includes(targetSlot)) {
    const by = holderOf(battle, targetSlot, 'onModifySecondaries');
    return `${by ?? 'a rule of the target'} removed the secondary effects of ${moveName} for ${targetSlot}`;
  }
  if (sight.stripped && sight.secondaries === 0) {
    const body = battle.sides[slot[1] === '1' ? 0 : 1]?.active[slot[2] === 'a' ? 0 : 1];
    return `${body ? battle.dex.abilities.get(body.ability).name : 'an ability of the user'} removed the secondary effects of ${moveName} before it hit`;
  }
  return null;
}

/** The lines after the draw, to the end of the turn: a flinch shows when its target tries to move, later than the action. */
const restOf = (battle: Battle, from: number): string[] => battle.log.slice(from);

/** Whether the protocol after the draw shows the effect of a secondary entry named by `effectId` (status, flinch, condition, boosts). */
function effectLandedLines(w: Witness, rest: string[], battle: Battle): boolean {
  const effectId = w.die.name.effectId ?? 'effect';
  const target = w.targetSlot;
  const user = w.die.name.slot;
  const rows = rest.map(parts);
  const boosted = (slot: string | undefined, stats: string[]): boolean =>
    rows.some(row => (row[1] === '-boost' || row[1] === '-unboost') && slotOfIdent(row[2]) === slot && stats.includes(row[3]));
  if (effectId.startsWith('boosts:')) return boosted(target, effectId.slice(7).split('+'));
  if (effectId.startsWith('self:')) {
    const what = effectId.slice(5);
    const condition = battle.dex.conditions.get(what);
    if (condition.exists && what.split('+').length === 1 && !'atk def spa spd spe accuracy evasion'.split(' ').includes(what)) {
      return rows.some(row => row[1] === '-start' && slotOfIdent(row[2]) === user);
    }
    return boosted(user, what.split('+'));
  }
  if (effectId === 'flinch') return rows.some(row => row[1] === 'cant' && slotOfIdent(row[2]) === target && row[3] === 'flinch');
  if (effectId === 'effect') return rows.some(row => (row[1] === '-status' || row[1] === '-start') && slotOfIdent(row[2]) === target);
  const condition = battle.dex.conditions.get(effectId);
  if (condition.effectType === 'Status') return rows.some(row => row[1] === '-status' && slotOfIdent(row[2]) === target && row[3] === effectId);
  return rows.some(row => row[1] === '-start' && slotOfIdent(row[2]) === target);
}

function secondaryReport(w: Witness, happens: boolean, battle: Battle): DieReport {
  const shown = effectLandedLines(w, restOf(battle, w.note.logIndex ?? battle.log.length), battle);
  if (shown === happens) return applied(w);
  if (happens) return otherwise(w, 'blocked', `the entry drew a hit but no ${w.die.name.effectId} line followed: the target's rules or state stopped it`);
  return otherwise(w, 'no-chance', `the effect showed although the die gave none`);
}

function selfEffectReport(w: Witness, happens: boolean, battle: Battle): DieReport {
  const stats = Object.keys((battle.dex.moves.get(w.die.name.moveId) as unknown as { self?: { boosts?: object } }).self?.boosts ?? {});
  const shown = restOf(battle, w.note.logIndex ?? battle.log.length).map(parts)
    .some(row => (row[1] === '-boost' || row[1] === '-unboost') && slotOfIdent(row[2]) === w.die.name.slot && stats.includes(row[3]));
  if (shown === happens) return applied(w);
  return happens ? otherwise(w, 'blocked', 'the self effect drew but no boost line followed') : otherwise(w, 'no-chance', 'the self effect showed although the die gave none');
}

function hitCountReport(w: Witness, hits: number, battle: Battle): DieReport {
  const count = restOf(battle, w.note.logIndex ?? battle.log.length).map(parts).find(row => row[1] === '-hitcount');
  const got = count ? Number(count[3]) : 0;
  if (got === hits) return applied(w);
  return otherwise(w, 'blocked', `${w.name} hit ${got} times, not ${hits}: the turn ended the hits early or the count cannot be reached`);
}

function stallingReport(w: Witness, happens: boolean): DieReport {
  const failed = w.action.some(line => parts(line)[1] === '-fail' && slotOfIdent(parts(line)[2]) === w.die.name.slot);
  if (failed !== happens) return applied(w);
  return happens ? otherwise(w, 'blocked', `${w.name} failed although the die gave success`) : otherwise(w, 'no-chance', `${w.name} succeeded although the die gave a failure`);
}

function powerReport(w: Witness, happens: boolean): DieReport {
  const effectId = w.die.name.effectId;
  const stronger = w.action.some(line => parts(line)[1] === '-activate' && toID((parts(line)[3] ?? '').split(':').pop()) === effectId);
  if (stronger === happens) return applied(w);
  return happens ? otherwise(w, 'blocked', `${w.name} drew the stronger power but its handler left no line`) : otherwise(w, 'no-chance', `${w.name} used its stronger power although the die gave none`);
}

/** Why a die of these kinds was never drawn, beyond the reasons every kind shares; null when none of them applies. */
export function moveNoDraw(input: ReportInput, moveName: string, action: string[]): DieReport | null {
  const { die } = input;
  if (die.name.kind === 'secondary') {
    const removed = secondaryRemoved(input, moveName);
    return removed ? { die, took: 'no-draw', reason: removed } : null;
  }
  if (die.name.kind === 'hit-count') {
    const count = action.find(line => parts(line)[1] === '-hitcount');
    return count ? { die, took: 'no-draw', reason: `${moveName} has a fixed hit count (${parts(count)[3]}): the simulator drew none` } : null;
  }
  if (die.name.kind === 'stalling') {
    return { die, took: 'no-draw', reason: `no stall draw: ${moveName} succeeds without one when it is not used twice in a row` };
  }
  return null;
}

/** The witness of a die of these kinds against the protocol, or null for a kind `report.ts` reads itself. */
export function moveWitness(w: Witness, battle: Battle): DieReport | null {
  const { kind } = w.die.name;
  const { result } = w.die;
  if (kind === 'secondary' && 'happens' in result) return secondaryReport(w, result.happens, battle);
  if (kind === 'self-effect' && 'happens' in result) return selfEffectReport(w, result.happens, battle);
  if (kind === 'hit-count' && 'hits' in result) return hitCountReport(w, result.hits, battle);
  if (kind === 'stalling' && 'happens' in result) return stallingReport(w, result.happens);
  if (kind === 'power' && 'happens' in result) return powerReport(w, result.happens);
  return null;
}
