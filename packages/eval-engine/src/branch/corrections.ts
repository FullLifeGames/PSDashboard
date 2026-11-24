import { type PokemonSnapshot, type TurnSnapshot, choiceItems, sideIndex, toId } from '@fulllifegames/replay-core';
import { protocolChoiceLock, type ChoiceLockContext } from '../choice-lock.ts';
import { restoreSideInvariants } from '../forward-model.ts';
import type { SimBattle, SimPokemon, SimSide } from './types.ts';
import { sameBodyForme } from './body-forme.ts';
import { retireBenchAfterFaints, sameBodyName, settleFaintFromSnapshot } from './team-order.ts';
import { retireUnshownActives } from './unshown-actives.ts';
import { findPokemonOnSide } from './protocol-choices.ts';
import { buildForcedSwitchChoice } from './forced-choice.ts';
import { correctFieldFromSnapshot } from './field-correction.ts';
import { applyProtocolHeldItems } from './held-items.ts';
import { playProtocolEntries, playProtocolStarts } from './entry-effects.ts';
import { restoreTeraFromSnapshot } from './tera-restore.ts';
import { restorePpFromSnapshot } from './pp-restore.ts';
import { swapActiveSlots } from './active-slots.ts';
import { bodiesOffTheField, restoreAfterProtocolEntry, restoreExitVolatiles } from './exit-volatiles.ts';
import { endLocksTheGameEnded, settleSleepCounter } from './sleep-counter.ts';
import { hpOfSighting } from './pokemon-info.ts';
import { normalizeLines } from '../line-endings.ts';
import { forceSwitches, hasForceSwitch } from './forced-slots.ts';

export { forceSwitches, hasForceSwitch, buildForcedSwitchChoice };

// `returning`: bodies a later entry line puts back; `passed`: bodies this pass took off and has not put back.
interface Passing { returning: ReadonlySet<SimPokemon>; passed: Set<SimPokemon> }

function repointActiveSlot(side: SimSide, activeSlot: number, target: SimPokemon, passing?: Passing): boolean {
  if (side.active[activeSlot] === target) return false;

  const previous = side.active[activeSlot];
  if (previous) previous.isActive = false;

  const duplicateActiveSlot = side.active.findIndex(active => active === target);
  const swapped = duplicateActiveSlot >= 0 && duplicateActiveSlot !== activeSlot && !!previous;
  if (swapped) {
    side.active[duplicateActiveSlot] = previous;
    previous.isActive = true;
  }
  if (previous && !swapped) leaveTheField(previous, passing);

  // BattleActions#switchIn swaps the array: the sim keeps side.pokemon[i] === side.active[i], so repointing
  // active alone would duplicate one team member and erase another.
  const targetIndex = side.pokemon.indexOf(target);
  if (targetIndex >= 0 && targetIndex !== activeSlot) {
    const occupant = side.pokemon[activeSlot];
    side.pokemon[targetIndex] = occupant;
    if (occupant) occupant.position = targetIndex;
    side.pokemon[activeSlot] = target;
  }

  target.isActive = true;
  target.position = activeSlot;
  side.active[activeSlot] = target;

  if (!passing?.passed.delete(target)) enterFresh(target);
  return true;
}

// battle-actions.js ends the old active's volatiles (`clearVolatile()`); a repoint must too, or they come back in.
function leaveTheField(previous: SimPokemon, passing?: Passing) {
  if (passing?.returning.has(previous)) passing.passed.add(previous);
  else previous.clearVolatile();
}

// The sim may never have switched this body out: mirrors the parts of a real entry that gate move choice (stale locks).
function enterFresh(target: SimPokemon) {
  delete target.volatiles['choicelock'];
  target.lastMove = null;
  for (const slot of target.moveSlots) slot.disabled = false;
}

/** Repoints the actives to the block's `|switch|` and `|drag|` entries, restores items, starts, locks, requests. */
export function correctActivesFromProtocol(
  battle: SimBattle,
  rawEvents: string[],
  locks?: { context: ChoiceLockContext; turn: number },
  residualAt?: number,
) {
  // A block cut from a CRLF log ends its lines in a carriage return; the readers below see LF only.
  const events = normalizeLines(rawEvents);
  const before = battle.sides.map(side => [...side.active]);
  let repointed = false;
  const passed = new Set<SimPokemon>();
  const entries = events.flatMap(line => {
    const match = line.match(/^\|(switch|drag)\|(p[12])([a-d]): ?([^|]*)\|([^,|]+)/);
    if (!match) return [];
    const side = battle.sides[match[2] === 'p1' ? 0 : 1];
    const target = findPokemonOnSide(side, match[5].trim());
    return target ? [{ match, side, target }] : [];
  });
  for (const [at, { match, side, target }] of entries.entries()) {
    const activeSlot = match[3].charCodeAt(0) - 'a'.charCodeAt(0);
    const returning = new Set(entries.slice(at + 1).filter(later => later.side === side).map(later => later.target));
    if (repointActiveSlot(side, activeSlot, target, { returning, passed })) {
      repointed = true;
      restoreAfterProtocolEntry(battle, target, `${match[2]}${match[3]}: ${match[4]}`, events);
    }
  }
  if (repointed) playProtocolEntries(battle, before, events);
  const started = playProtocolStarts(battle, events, residualAt);
  // After the repoints, so a lock lands on the body the protocol has active.
  const handedOver = locks ? applyProtocolHeldItems(battle, locks.context, locks.turn, events) : false;
  if (repointed || handedOver || started) {
    restoreSideInvariants(battle);
    // Protocol-proven locks go back on before the refresh, so the disable pass bakes them into the corrected request.
    if (locks) restampProtocolLocks(battle, locks.context, locks.turn);
    refreshRequestsFromLiveState(battle);
  }
}

// Locks come from the protocol trail, the eligibility and set sanity, never from sim history.
function restampProtocolLocks(battle: SimBattle, context: ChoiceLockContext, turn: number) {
  for (const sideId of ['p1', 'p2'] as const) {
    const lock = protocolChoiceLock(context.trails, sideId, turn, battle.dex);
    if (!lock) continue;
    const side = battle.sides[sideIndex(sideId)];
    // Singles only: the trail tracker follows one active per side.
    if (side.active.length !== 1) continue;
    const active = side.active[0];
    if (!active || active.fainted) continue;
    if (toId(active.species.name) !== toId(lock.species) && toId(active.name) !== toId(lock.species)) continue;
    if (!lock.handedOver && !context.eligibility[sideId][toId(lock.species)]) continue;
    if (!choiceItems(battle.dex).has(active.item)) continue;
    if (!active.moveSlots.some(slot => slot.id === lock.moveId)) continue;
    if (active.volatiles['choicelock']) continue;
    // Not addVolatile: the condition's onStart reads battle.activeMove (null outside a move); the disable pass
    // only consults effectState.move.
    active.volatiles['choicelock'] = { id: 'choicelock', move: lock.moveId } as never;
  }
}

// Residuals read `statusState` (Toxic: `stage * maxhp/16`; sleep counts down `time`): a bare `status` leaves it empty.
// Mirrors Pokemon#setStatus, only when the snapshot disagrees (a match keeps its toxic stage and sleep counter).
function correctStatusFromSnapshot(battlePokemon: SimPokemon, snapshotPokemon: SnapshotPokemon, log: readonly string[]) {
  const status = (snapshotPokemon.status || '') as SimPokemon['status'];
  const turns = status === 'slp' ? snapshotPokemon.sleepTurns : undefined;
  const rested = turns !== undefined && log.some(line => line.startsWith(`|-status|`) && line.includes(`: ${snapshotPokemon.name}|slp|[from] move: Rest`));
  if (battlePokemon.status === status) {
    if (turns !== undefined) settleSleepCounter(battlePokemon, turns, rested, false);
    return;
  }

  battlePokemon.status = status;
  const statusState = battlePokemon.statusState as {
    id: string;
    target?: unknown;
    stage?: number;
    time?: number;
    startTime?: number;
  };
  statusState.id = status;
  statusState.target = battlePokemon;
  delete statusState.stage;
  delete statusState.time;
  delete statusState.startTime;
  if (status === 'tox') statusState.stage = 0;
  if (status === 'slp') {
    // The average, until the protocol's cant lines say more.
    statusState.startTime = 3;
    statusState.time = 3;
    if (turns !== undefined) settleSleepCounter(battlePokemon, turns, rested, true);
  }
}

// A living benched body's HP: the last sighting, plus Regenerator's switch-out third for a holder.
function benchHpFromSighting(battlePokemon: SimPokemon, snapshotPokemon: SnapshotPokemon): number {
  const sighting = hpOfSighting(battlePokemon, snapshotPokemon);
  const regenerated = battlePokemon.baseAbility === 'regenerator' ? Math.trunc(battlePokemon.baseMaxhp / 3) : 0;
  return Math.min(battlePokemon.maxhp, Math.max(1, sighting + regenerated));
}

type SnapshotPokemon = TurnSnapshot['p1']['pokemon'][number];

function simBodyOf(side: SimSide, snapshotPokemon: SnapshotPokemon): SimPokemon | undefined {
  return side.pokemon.find((pokemon: SimPokemon) => !!snapshotPokemon.name && pokemon.name === snapshotPokemon.name) ??
    side.pokemon.find((pokemon: SimPokemon) =>
      toId(pokemon.species?.name || '') === toId(snapshotPokemon.speciesForme) ||
      sameBodyName(pokemon.name, snapshotPokemon.name)
    );
}

// Bench status and boosts stay with the sim (a silent Natural Cure); a faint change moves the side's fainted count.
function correctBodyFromSnapshot(battlePokemon: SimPokemon, snapshotPokemon: SnapshotPokemon, log: readonly string[]): boolean {
  if (!snapshotPokemon.isActive && battlePokemon.fainted === snapshotPokemon.fainted) {
    if (!snapshotPokemon.fainted) battlePokemon.hp = benchHpFromSighting(battlePokemon, snapshotPokemon);
    return false;
  }
  const leavesTheField = snapshotPokemon.fainted && !battlePokemon.fainted && battlePokemon.side.active.includes(battlePokemon);
  settleFaintFromSnapshot(battlePokemon, snapshotPokemon);
  if (!snapshotPokemon.fainted && battlePokemon.hp <= 0 && snapshotPokemon.hpPercent > 0) battlePokemon.hp = 1;
  correctStatusFromSnapshot(battlePokemon, snapshotPokemon, log);
  for (const stat of ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'] as const) {
    battlePokemon.boosts[stat] = snapshotPokemon.boosts[stat] ?? 0;
  }
  return leavesTheField;
}

function correctHpFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot): Set<SimPokemon> {
  const tookOut = new Set<SimPokemon>();
  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const snapshotSide = sideIndex === 0 ? snapshot.p1 : snapshot.p2;
    const battleSide = battle.sides[sideIndex];

    for (const snapshotPokemon of snapshotSide.pokemon) {
      const battlePokemon = simBodyOf(battleSide, snapshotPokemon);
      if (battlePokemon && snapshotPokemon.maxhp > 0) {
        battlePokemon.timesAttacked = snapshotPokemon.timesAttacked ?? 0;
        if (correctBodyFromSnapshot(battlePokemon, snapshotPokemon, snapshot.log ?? [])) tookOut.add(battlePokemon);
      }
    }
  }
  restoreSideInvariants(battle);
  return tookOut;
}

/** Whether the field body is the snapshot's entry: the same species by the Dex (another forme counts) or name. */
export function sameMon(pokemon: SimPokemon | null | undefined, want: PokemonSnapshot): boolean {
  if (!pokemon) return false;
  return sameBodyForme(pokemon.battle.dex, pokemon.species?.name, want.speciesForme) || sameBodyName(pokemon.name, want.name);
}

// The protocol-line correction fires only when the real battle logged a switch; a switch the sim invents has no line.
function correctActivesFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  let moved = false;
  for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
    const snapshotSide = sideIdx === 0 ? snapshot.p1 : snapshot.p2;
    const side = battle.sides[sideIdx];
    const desired = snapshotSide.pokemon.filter(pokemon => pokemon.isActive && !pokemon.fainted);
    if (desired.length === 0) continue;

    const missing = desired.filter(want => !side.active.some(active => sameMon(active, want)));
    for (const want of missing) {
      const slot = side.active.findIndex(active =>
        !active || active.fainted || !desired.some(entry => sameMon(active, entry)));
      if (slot < 0) break;
      const target = findPokemonOnSide(side, want.speciesForme)
        ?? (want.name ? findPokemonOnSide(side, want.name) : null);
      if (!target || target.fainted) continue;
      repointActiveSlot(side, slot, target);
    }
    if (placeOnSlots(side, desired, sameMon)) moved = true;
  }
  if (moved) {
    restoreSideInvariants(battle);
    refreshRequestsFromLiveState(battle);
  }
}

function placeOnSlots(
  side: SimSide,
  desired: PokemonSnapshot[],
  sameMon: (pokemon: SimPokemon | null | undefined, want: PokemonSnapshot) => boolean,
): boolean {
  if (side.active.length < 2) return false;
  let moved = false;
  for (const want of desired) {
    if (want.slot === undefined || want.slot >= side.active.length) continue;
    const candidates = side.active.filter(active => sameMon(active, want));
    // Two bodies of one species cannot be told apart by name.
    if (candidates.length !== 1 || side.active[want.slot] === candidates[0]) continue;
    swapActiveSlots(side, side.active.indexOf(candidates[0]), want.slot);
    moved = true;
  }
  return moved;
}

/** Corrects the battle to the turn snapshot: HP, status, boosts, actives, faints, volatiles, field, Tera and PP. */
export function correctBattleFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  const offTheField = bodiesOffTheField(battle);
  const tookOut = correctHpFromSnapshot(battle, snapshot);
  endLocksTheGameEnded(battle, snapshot, simBodyOf);
  restoreTeraFromSnapshot(battle, snapshot);
  correctActivesFromSnapshot(battle, snapshot);
  const strangers = retireUnshownActives(battle, snapshot);
  retireBenchAfterFaints(battle, snapshot, new Set([...tookOut, ...strangers]));
  if (strangers.size > 0) {
    restoreSideInvariants(battle);
    refreshRequestsFromLiveState(battle);
  }
  restoreExitVolatiles(battle, snapshot, offTheField, simBodyOf);
  correctFieldFromSnapshot(battle, snapshot);
  if (restorePpFromSnapshot(battle, snapshot, simBodyOf) && strangers.size === 0) refreshRequestsFromLiveState(battle);
}

/** Whether the request demands a forced switch although no active carries a switchFlag (gen 3 phantom deadlock). */
export function hasStaleForcedSwitchRequest(battle: SimBattle): boolean {
  if (battle.ended) return false;
  return battle.sides.some(side =>
    side.activeRequest?.forceSwitch?.some((forced, index) => forced && !side.active[index]?.switchFlag)
  );
}

export function repairStaleForcedSwitchRequest(battle: SimBattle) {
  if (!hasStaleForcedSwitchRequest(battle)) return;
  try {
    battle.makeRequest('move');
  } catch {
    // Leave the wedged state to validateBranchRuntime to report.
  }
}

// Mirrors Battle#endTurn's move-disable pass (reset flags, run DisableMove events, reapply cantusetwice).
function runDisablePass(battle: SimBattle) {
  for (const side of battle.sides) {
    for (const pokemon of side.active) {
      if (!pokemon || pokemon.fainted) continue;
      pokemon.maybeDisabled = false;
      pokemon.maybeLocked = false;
      for (const moveSlot of pokemon.moveSlots) {
        moveSlot.disabled = false;
        moveSlot.disabledSource = '';
      }
      battle.runEvent('DisableMove', pokemon);
      for (const moveSlot of pokemon.moveSlots) {
        const activeMove = battle.dex.getActiveMove(moveSlot.id);
        battle.singleEvent('DisableMove', activeMove, null, pokemon);
        if (activeMove.flags['cantusetwice'] && pokemon.lastMove?.id === moveSlot.id) {
          pokemon.disableMove(pokemon.lastMove.id);
        }
      }
    }
  }
}

export function refreshRequestsFromLiveState(battle: SimBattle) {
  if (battle.ended) return;
  if (hasStaleForcedSwitchRequest(battle)) {
    repairStaleForcedSwitchRequest(battle);
    return;
  }
  if (battle.requestState !== 'move' && battle.requestState !== 'switch') return;
  try {
    if (battle.requestState === 'move') runDisablePass(battle);
    battle.makeRequest();
  } catch {
    // Leave the wedged state to validateBranchRuntime to report.
  }
}
