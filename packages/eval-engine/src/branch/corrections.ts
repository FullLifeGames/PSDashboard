import { type PokemonSnapshot, type TurnSnapshot, sideIndex, toId } from '@fulllifegames/replay-core';
import { protocolChoiceLock, type ChoiceLockContext } from '../choice-lock.ts';
import { CHOICE_ITEMS } from '../sensitivity.ts';
import { restoreSideInvariants } from '../forward-model.ts';
import type { SimBattle, SimPokemon, SimSide } from './types.ts';
import { normalizeBattleOnlyFormeId, retireUnshownBench, sameBodyName, type ProtocolBench } from './team-order.ts';
import { findFirstAvailableSwitchSlot, findPokemonOnSide, findSlotBySpecies } from './protocol-choices.ts';
import { correctFieldFromSnapshot } from './field-correction.ts';
import { applyProtocolHeldItems } from './held-items.ts';
import { playProtocolEntries, playProtocolStarts } from './entry-effects.ts';
import { restoreTeraFromSnapshot } from './tera-restore.ts';
import { bodiesOffTheField, restoreAfterProtocolEntry, restoreExitVolatiles } from './exit-volatiles.ts';
import { endLocksTheGameEnded, settleSleepCounter } from './sleep-counter.ts';
import { hpOfSighting } from './pokemon-info.ts';
import { normalizeLines } from '../line-endings.ts';

function repointActiveSlot(side: SimSide, activeSlot: number, target: SimPokemon): boolean {
  if (side.active[activeSlot] === target) return false;

  const previous = side.active[activeSlot];
  if (previous) previous.isActive = false;

  const duplicateActiveSlot = side.active.findIndex(active => active === target);
  if (duplicateActiveSlot >= 0 && duplicateActiveSlot !== activeSlot && previous) {
    side.active[duplicateActiveSlot] = previous;
    previous.isActive = true;
  }

  // Mirror BattleActions#switchIn's array swap: the sim keeps
  // side.pokemon[i] === side.active[i], and its next real switch swaps via
  // the position fields. Repointing active without reordering side.pokemon
  // makes that swap duplicate one team member and erase another.
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

  // The REAL game brought this Pokémon in fresh; the sim history being
  // corrected may never have switched it out at all — a diverged GPL
  // reconstruction kept Vileplume on the field locked into its tricked
  // scarf's Sludge Bomb, and the stale lock followed it into the corrected
  // position (T38: "Grass Knot not among the options"). Mirror the parts of
  // a real entry that gate move choice.
  delete target.volatiles['choicelock'];
  target.lastMove = null;
  for (const slot of target.moveSlots) slot.disabled = false;
  return true;
}

export function correctActivesFromProtocol(
  battle: SimBattle,
  rawEvents: string[],
  locks?: { context: ChoiceLockContext; turn: number },
  residualAt?: number,
) {
  // The door for lines (round 73, T230 on T206): a block cut from a CRLF log ends its lines in a carriage return; the readers below see LF only.
  const events = normalizeLines(rawEvents);
  const before = battle.sides.map(side => [...side.active]);
  let repointed = false;
  for (const line of events) {
    const match = line.match(/^\|(switch|drag)\|(p[12])([a-d]): ?([^|]*)\|([^,|]+)/);
    if (!match) continue;

    const sideIdx = match[2] === 'p1' ? 0 : 1;
    const activeSlot = match[3].charCodeAt(0) - 'a'.charCodeAt(0);
    const species = match[5].trim();
    const side = battle.sides[sideIdx];
    const target = findPokemonOnSide(side, species);
    if (!target) continue;
    if (repointActiveSlot(side, activeSlot, target)) {
      repointed = true;
      restoreAfterProtocolEntry(battle, target, `${match[2]}${match[3]}: ${match[4]}`, events);
    }
  }
  // A body the repoints put on the field plays its switch-in with the item it
  // held, before the held items take the protocol's state (round 67, T133).
  if (repointed) playProtocolEntries(battle, before, events);
  // A start the block shows and the board lacks (round 73, T212); residualAt: where the block's residual round came.
  const started = playProtocolStarts(battle, events, residualAt);
  // After the repoints, so a lock lands on the body the protocol has active.
  const handedOver = locks ? applyProtocolHeldItems(battle, locks.context, locks.turn) : false;
  // The cached requests were built from the PRE-correction actives — refresh
  // the disable flags and the request view from the corrected board.
  if (repointed || handedOver || started) {
    restoreSideInvariants(battle);
    // Protocol-proven locks go back on BEFORE the request refresh, so the
    // disable pass bakes them into the corrected request (spec ③ 1b).
    if (locks) restampProtocolLocks(battle, locks.context, locks.turn);
    refreshRequestsFromLiveState(battle);
  }
}

/** Spec 1b's stamp: protocol trail + eligibility + set sanity, never sim history. */
function restampProtocolLocks(battle: SimBattle, context: ChoiceLockContext, turn: number) {
  for (const sideId of ['p1', 'p2'] as const) {
    const lock = protocolChoiceLock(context.trails, sideId, turn);
    if (!lock) continue;
    const side = battle.sides[sideIndex(sideId)];
    // Singles only — the trail tracker follows one active per side.
    if (side.active.length !== 1) continue;
    const active = side.active[0];
    if (!active || active.fainted) continue;
    if (toId(active.species.name) !== toId(lock.species) && toId(active.name) !== toId(lock.species)) continue;
    // A handed-over Choice item is in the protocol itself; only a set guess needs the damage vetting.
    if (!lock.handedOver && !context.eligibility[sideId][toId(lock.species)]) continue;
    if (!CHOICE_ITEMS.has(active.item)) continue;
    if (!active.moveSlots.some(slot => slot.id === lock.moveId)) continue;
    if (active.volatiles['choicelock']) continue;
    // Not addVolatile: the condition's onStart reads battle.activeMove (null
    // outside a move). The disable pass only consults effectState.move, so
    // the direct volatile carries everything the sim needs.
    active.volatiles['choicelock'] = { id: 'choicelock', move: lock.moveId } as never;
  }
}

export function forceSwitches(battle: SimBattle, sideIdx: number): boolean[] {
  const requests = battle.sides[sideIdx].activeRequest?.forceSwitch;
  const activeCount = battle.sides[sideIdx].active.length;
  return Array.from({ length: activeCount }, (_, index) => requests?.[index] ?? false);
}

export function hasForceSwitch(battle: SimBattle, sideIdx: number): boolean {
  return forceSwitches(battle, sideIdx).some(Boolean);
}

/**
 * `bench`: what the protocol says about the side (ProtocolBench). With it, a forced slot the log leaves empty after its body
 * fainted takes `pass` once the bench bodies the protocol never shows are out of the game (round 73, T250); without it the
 * slot takes the first living body, as before.
 */
export function buildForcedSwitchChoice(
  battle: SimBattle,
  sideIdx: number,
  forcedSpecies: string[],
  cursor: { current: number },
  bench?: ProtocolBench,
): string | null {
  const needs = forceSwitches(battle, sideIdx);
  if (!needs.some(Boolean)) return null;

  const forced = needs.filter(Boolean).length;
  const answers = Math.min(forced, Math.max(0, forcedSpecies.length - cursor.current));
  const empty = !!bench && answers < forced &&
    retireUnshownBench(battle, sideIdx, bench, answers, needs.flatMap((need, slot) => (need ? [slot] : [])));
  if (battle.ended) return null;
  const choices = needs.map(need => {
    if (!need) return 'pass';
    const species = forcedSpecies[cursor.current++];
    if (species) return `switch ${findSlotBySpecies(battle, sideIdx, species)}`;
    return empty ? 'pass' : `switch ${findFirstAvailableSwitchSlot(battle, sideIdx)}`;
  });

  return choices.join(', ');
}

/**
 * Status residuals read their state from `statusState` (Toxic damage is
 * `stage * maxhp/16`, sleep counts down `time`) — a bare `status` assignment
 * leaves that state empty, so corrected Toxic dealt NaN (= no) damage for the
 * rest of the branch. Mirror Pokemon#setStatus instead, and only when the
 * snapshot disagrees, so a matching reconstruction keeps its own toxic stage
 * and sleep counter. A sleeper takes the count the protocol allows (T187).
 */
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

/** A living benched body's HP: the last sighting, plus Regenerator's switch-out third for a holder. */
function benchHpFromSighting(battlePokemon: SimPokemon, snapshotPokemon: SnapshotPokemon): number {
  const sighting = hpOfSighting(battlePokemon, snapshotPokemon);
  const regenerated = battlePokemon.baseAbility === 'regenerator' ? Math.trunc(battlePokemon.baseMaxhp / 3) : 0;
  return Math.min(battlePokemon.maxhp, Math.max(1, sighting + regenerated));
}

type SnapshotPokemon = TurnSnapshot['p1']['pokemon'][number];

/** The simulator's body for a snapshot entry: by species forme, else by name. */
function simBodyOf(side: SimSide, snapshotPokemon: SnapshotPokemon): SimPokemon | undefined {
  return side.pokemon.find((pokemon: SimPokemon) => !!snapshotPokemon.name && pokemon.name === snapshotPokemon.name) ??
    side.pokemon.find((pokemon: SimPokemon) =>
      toId(pokemon.species?.name || '') === toId(snapshotPokemon.speciesForme) ||
      sameBodyName(pokemon.name, snapshotPokemon.name)
    );
}

/**
 * One body against its snapshot entry. The protocol reports only the
 * actives. A benched body's snapshot HP is its last sighting, taken as it
 * left the field: the bench reads that sighting, plus the third Regenerator
 * restores on the way out (round 40, 573756 Toxapex 70 % → 100 %). The sim's
 * own bench HP is no witness: a body that is hit and leaves within one turn
 * never meets a boundary correction (round 47, 913994 t5: Rillaboom left at
 * 22 % and read 100 %). Status and boosts of the bench stay with the sim (a
 * silent Natural Cure lives only there); only a faint-state disagreement is
 * resolved from the snapshot. A faint written or taken back moves the side's
 * fainted count, as the sim's own faint does (round 67, T133: Supreme
 * Overlord and Last Respects read it; 752324's Kingambit counted no fallen
 * ally after the correction fainted Amoonguss).
 */
function correctBodyFromSnapshot(battlePokemon: SimPokemon, snapshotPokemon: SnapshotPokemon, log: readonly string[]) {
  if (!snapshotPokemon.isActive && battlePokemon.fainted === snapshotPokemon.fainted) {
    if (!snapshotPokemon.fainted) battlePokemon.hp = benchHpFromSighting(battlePokemon, snapshotPokemon);
    return;
  }
  if (battlePokemon.fainted !== snapshotPokemon.fainted) {
    const side = battlePokemon.side;
    side.totalFainted = Math.max(0, side.totalFainted + (snapshotPokemon.fainted ? 1 : -1));
  }
  battlePokemon.hp = Math.max(0, hpOfSighting(battlePokemon, snapshotPokemon));
  battlePokemon.fainted = snapshotPokemon.fainted;
  battlePokemon.faintQueued = snapshotPokemon.fainted;
  if (snapshotPokemon.fainted) battlePokemon.hp = 0;
  if (!snapshotPokemon.fainted && battlePokemon.hp <= 0 && snapshotPokemon.hpPercent > 0) battlePokemon.hp = 1;
  correctStatusFromSnapshot(battlePokemon, snapshotPokemon, log);
  for (const stat of ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'] as const) {
    battlePokemon.boosts[stat] = snapshotPokemon.boosts[stat] ?? 0;
  }
}

function correctHpFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const snapshotSide = sideIndex === 0 ? snapshot.p1 : snapshot.p2;
    const battleSide = battle.sides[sideIndex];

    for (const snapshotPokemon of snapshotSide.pokemon) {
      const battlePokemon = simBodyOf(battleSide, snapshotPokemon);
      if (battlePokemon && snapshotPokemon.maxhp > 0) correctBodyFromSnapshot(battlePokemon, snapshotPokemon, snapshot.log ?? []);
    }
  }
  restoreSideInvariants(battle);
}

/**
 * The protocol-line correction only fires when the real battle logged a
 * switch. When the SIM invents a switch the real game never saw — a guessed
 * spread lets a damage roll faint the active, and a bench mon replaces it —
 * no later block carries a line to undo it: the GPL replay's Uxie stayed
 * benched-dead while the protocol had it casting Future Sight two turns
 * later. The snapshot knows who really stood on the field; put them back.
 */
function correctActivesFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  let moved = false;
  for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
    const snapshotSide = sideIdx === 0 ? snapshot.p1 : snapshot.p2;
    const side = battle.sides[sideIdx];
    const desired = snapshotSide.pokemon.filter(pokemon => pokemon.isActive && !pokemon.fainted);
    if (desired.length === 0) continue;

    const sameMon = (pokemon: SimPokemon | null | undefined, want: PokemonSnapshot) => {
      if (!pokemon) return false;
      const speciesId = normalizeBattleOnlyFormeId(toId(pokemon.species?.name || ''));
      const wantId = normalizeBattleOnlyFormeId(toId(want.speciesForme));
      return speciesId === wantId || sameBodyName(pokemon.name, want.name);
    };

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
  // The request was built from the pre-correction slots (913990 turn 4: Overheat
  // was offered for Chi-Yu only on p2b, where the game had it and the board had not).
  if (moved) {
    restoreSideInvariants(battle);
    refreshRequestsFromLiveState(battle);
  }
}

/**
 * Round 69, T151: a doubles pair stands on the slots the game has it on. The
 * correction above only fills a slot with nobody from the snapshot, so a pair
 * the simulator holds swapped (a revival put one body back on the other's
 * slot) stayed swapped. The snapshot's slot says where each active belongs;
 * a snapshot written before round 69 carries none and moves nothing.
 */
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

/** Two actives trade slots; both stay in play, so unlike a switch-in nothing about either body (its lock, its last move) is reset. */
function swapActiveSlots(side: SimSide, from: number, to: number) {
  const [first, second] = [side.active[from], side.active[to]];
  side.active[from] = second;
  side.active[to] = first;
  // The sim keeps side.pokemon[i] === side.active[i] for the active slots.
  const [firstIndex, secondIndex] = [side.pokemon.indexOf(first), side.pokemon.indexOf(second)];
  side.pokemon[firstIndex] = second;
  side.pokemon[secondIndex] = first;
  first.position = secondIndex;
  second.position = firstIndex;
}

export function correctBattleFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  const offTheField = bodiesOffTheField(battle);
  correctHpFromSnapshot(battle, snapshot);
  endLocksTheGameEnded(battle, snapshot, simBodyOf);
  restoreTeraFromSnapshot(battle, snapshot);
  correctActivesFromSnapshot(battle, snapshot);
  restoreExitVolatiles(battle, snapshot, offTheField, simBodyOf);
  correctFieldFromSnapshot(battle, snapshot);
}

/**
 * After snapshot/active corrections the emitted request can go stale: it still
 * demands a forced switch although no active Pokémon carries a switchFlag
 * anymore (B7 — the gen3 "phantom forced switch" deadlock). The battle itself
 * is consistent, so regenerating the request from the live state repairs it.
 */
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

/**
 * Mirror of Battle#endTurn's move-disable recomputation: reset every active's
 * flags, run the DisableMove events, reapply cantusetwice. The sim ran this
 * BEFORE the correction layers mutated the board, so corrected actives can
 * carry flags in either stale direction — set for a state that no longer
 * holds, or cleared for one that does (a repointed mon beside a standing
 * Imprison would otherwise play through the block).
 */
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

/**
 * Requests are a VIEW of battle state, built by the sim BEFORE the correction
 * layers (active repoints, snapshot HP/status/volatile sync) mutate it. A
 * stale view offers the wrong mon's moves and misses recomputed disable
 * states (Imprison; gen9doublesou-2660802611 turn 2 offered Incineroar's
 * Imprison-disabled Knock Off and turn 4 offered benched Grimmsnarl's
 * screens). Recompute the disable flags, then rebuild the view — both are
 * identities on healthy battles and fixes on corrected ones.
 */
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
