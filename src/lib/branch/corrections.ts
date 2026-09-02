import { Dex } from '@pkmn/sim';
import type { PokemonSnapshot, TurnSnapshot } from '../../types';
import { protocolChoiceLock, type ChoiceLockContext } from '../choice-lock';
import { CHOICE_ITEMS } from '../eval/sensitivity';
import { restoreSideInvariants } from '../eval/forward-model';
import type { SimBattle, SimPokemon, SimSide } from './types';
import { normalizeBattleOnlyFormeId } from './team-order';
import { findFirstAvailableSwitchSlot, findPokemonOnSide, findSlotBySpecies } from './protocol-choices';
import { sideIndex, toId } from '../ids';

export function repointActiveSlot(side: SimSide, activeSlot: number, target: SimPokemon): boolean {
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
  events: string[],
  locks?: { context: ChoiceLockContext; turn: number },
) {
  let repointed = false;
  for (const line of events) {
    const match = line.match(/^\|(switch|drag)\|(p[12])([a-d]):[^|]*\|([^,|]+)/);
    if (!match) continue;

    const sideIdx = match[2] === 'p1' ? 0 : 1;
    const activeSlot = match[3].charCodeAt(0) - 'a'.charCodeAt(0);
    const species = match[4].trim();
    const side = battle.sides[sideIdx];
    const target = findPokemonOnSide(side, species);
    if (!target) continue;
    if (repointActiveSlot(side, activeSlot, target)) repointed = true;
  }
  // The cached requests were built from the PRE-correction actives — refresh
  // the disable flags and the request view from the corrected board.
  if (repointed) {
    restoreSideInvariants(battle);
    // Protocol-proven locks go back on BEFORE the request refresh, so the
    // disable pass bakes them into the corrected request (spec ③ 1b).
    if (locks) restampProtocolLocks(battle, locks.context, locks.turn);
    refreshRequestsFromLiveState(battle);
  }
}

/** Spec 1b's stamp: protocol trail + eligibility + set sanity, never sim history. */
export function restampProtocolLocks(battle: SimBattle, context: ChoiceLockContext, turn: number) {
  for (const sideId of ['p1', 'p2'] as const) {
    const lock = protocolChoiceLock(context.trails, sideId, turn);
    if (!lock) continue;
    const side = battle.sides[sideIndex(sideId)];
    // Singles only — the trail tracker follows one active per side.
    if (side.active.length !== 1) continue;
    const active = side.active[0];
    if (!active || active.fainted) continue;
    if (toId(active.species.name) !== toId(lock.species) && toId(active.name) !== toId(lock.species)) continue;
    if (!context.eligibility[sideId][toId(lock.species)]) continue;
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

export function buildForcedSwitchChoice(
  battle: SimBattle,
  sideIdx: number,
  forcedSpecies: string[],
  cursor: { current: number },
): string | null {
  const needs = forceSwitches(battle, sideIdx);
  if (!needs.some(Boolean)) return null;

  const choices = needs.map(need => {
    if (!need) return 'pass';
    const species = forcedSpecies[cursor.current++];
    if (species) return `switch ${findSlotBySpecies(battle, sideIdx, species)}`;
    return `switch ${findFirstAvailableSwitchSlot(battle, sideIdx)}`;
  });

  return choices.join(', ');
}

/**
 * Status residuals read their state from `statusState` (Toxic damage is
 * `stage * maxhp/16`, sleep counts down `time`) — a bare `status` assignment
 * leaves that state empty, so corrected Toxic dealt NaN (= no) damage for the
 * rest of the branch. Mirror Pokemon#setStatus instead, and only when the
 * snapshot disagrees, so a matching reconstruction keeps its own toxic stage
 * and sleep counter.
 */
export function correctStatusFromSnapshot(battlePokemon: SimPokemon, snapshotStatus: string) {
  const status = snapshotStatus as SimPokemon['status'];
  if (battlePokemon.status === status) return;

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
    // The snapshot does not carry remaining sleep turns — use the average.
    statusState.startTime = 3;
    statusState.time = 3;
  }
}

export function correctHpFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const snapshotSide = sideIndex === 0 ? snapshot.p1 : snapshot.p2;
    const battleSide = battle.sides[sideIndex];

    for (const snapshotPokemon of snapshotSide.pokemon) {
      const battlePokemon = battleSide.pokemon.find((pokemon: SimPokemon) =>
        toId(pokemon.species?.name || '') === toId(snapshotPokemon.speciesForme) ||
        toId(pokemon.name || '') === toId(snapshotPokemon.name)
      );

      if (battlePokemon && snapshotPokemon.maxhp > 0) {
        const ratio = snapshotPokemon.hpPercent / 100;
        battlePokemon.hp = Math.max(0, Math.round(ratio * battlePokemon.maxhp));
        battlePokemon.fainted = snapshotPokemon.fainted;
        battlePokemon.faintQueued = snapshotPokemon.fainted;
        if (snapshotPokemon.fainted) battlePokemon.hp = 0;
        if (!snapshotPokemon.fainted && battlePokemon.hp <= 0 && snapshotPokemon.hpPercent > 0) {
          battlePokemon.hp = 1;
        }
        correctStatusFromSnapshot(battlePokemon, snapshotPokemon.status || '');
        for (const stat of ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'] as const) {
          battlePokemon.boosts[stat] = snapshotPokemon.boosts[stat] ?? 0;
        }
      }
    }
  }
  restoreSideInvariants(battle);
}

function snapshotConditionDuration(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const maybeDuration = value as { minDuration?: unknown; maxDuration?: unknown; duration?: unknown };
  for (const duration of [maybeDuration.duration, maybeDuration.minDuration, maybeDuration.maxDuration]) {
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) return duration;
  }
  return undefined;
}

function syncEffectTableFromSnapshot(
  table: Record<string, { id?: string; duration?: number; effectOrder?: number }>,
  snapshotTable: Record<string, unknown>,
) {
  const desiredIds = new Set(Object.keys(snapshotTable).map(key => toId(key)));
  for (const key of Object.keys(table)) {
    if (!desiredIds.has(toId(key))) delete table[key];
  }

  for (const [key, value] of Object.entries(snapshotTable)) {
    const id = toId(key);
    const duration = snapshotConditionDuration(value);
    table[id] = {
      ...(table[id] ?? {}),
      id,
      effectOrder: table[id]?.effectOrder ?? 0,
      ...(duration ? { duration } : {}),
    };
  }
}

function terrainIdFromSnapshot(terrain: string): string {
  if (!terrain) return '';
  const terrainCondition = Dex.conditions.get(`${terrain} Terrain`);
  return terrainCondition.exists ? terrainCondition.id : toId(terrain);
}

/**
 * @pkmn/client snapshots report weather by display name (its WEATHERS map:
 * "Sand", "Sun", …) — the sim only knows condition ids. Writing an untranslated
 * name into the sim silently disables every weather residual (the gen 3
 * Sandstorm-does-no-damage report).
 */
const CLIENT_WEATHER_IDS: Record<string, string> = {
  sand: 'sandstorm',
  sun: 'sunnyday',
  rain: 'raindance',
  hail: 'hail',
  snow: 'snowscape',
  harshsunshine: 'desolateland',
  heavyrain: 'primordialsea',
  strongwinds: 'deltastream',
};

function weatherIdFromSnapshot(weather: string): string {
  if (!weather) return '';
  const mapped = CLIENT_WEATHER_IDS[toId(weather)];
  if (mapped) return mapped;
  const weatherCondition = Dex.conditions.get(weather);
  return weatherCondition.exists ? weatherCondition.id : toId(weather);
}

export function correctFieldFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  battle.turn = snapshot.turn;
  const weather = weatherIdFromSnapshot(snapshot.field.weather);
  if ((battle.field.weather as string) !== weather) {
    // Only touch weather the sim disagrees about — matching weather keeps its
    // reconstructed weatherState (source, remaining duration) untouched.
    battle.field.weather = weather as SimBattle['field']['weather'];
    battle.field.weatherState.id = weather as typeof battle.field.weatherState.id;
    delete battle.field.weatherState.duration;
  }
  battle.field.terrain = terrainIdFromSnapshot(snapshot.field.terrain) as SimBattle['field']['terrain'];
  syncEffectTableFromSnapshot(
    battle.field.pseudoWeather as Record<string, { id?: string; duration?: number; effectOrder?: number }>,
    snapshot.field.pseudoWeather,
  );
  syncEffectTableFromSnapshot(
    battle.sides[0].sideConditions as Record<string, { id?: string; duration?: number; effectOrder?: number }>,
    snapshot.p1.sideConditions,
  );
  syncEffectTableFromSnapshot(
    battle.sides[1].sideConditions as Record<string, { id?: string; duration?: number; effectOrder?: number }>,
    snapshot.p2.sideConditions,
  );
}

/**
 * The protocol-line correction only fires when the real battle logged a
 * switch. When the SIM invents a switch the real game never saw — a guessed
 * spread lets a damage roll faint the active, and a bench mon replaces it —
 * no later block carries a line to undo it: the GPL replay's Uxie stayed
 * benched-dead while the protocol had it casting Future Sight two turns
 * later. The snapshot knows who really stood on the field; put them back.
 */
export function correctActivesFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
    const snapshotSide = sideIdx === 0 ? snapshot.p1 : snapshot.p2;
    const side = battle.sides[sideIdx];
    const desired = snapshotSide.pokemon.filter(pokemon => pokemon.isActive && !pokemon.fainted);
    if (desired.length === 0) continue;

    const sameMon = (pokemon: SimPokemon | null | undefined, want: PokemonSnapshot) => {
      if (!pokemon) return false;
      const speciesId = normalizeBattleOnlyFormeId(toId(pokemon.species?.name || ''));
      const wantId = normalizeBattleOnlyFormeId(toId(want.speciesForme));
      return speciesId === wantId || toId(pokemon.name || '') === toId(want.name);
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
  }
}

export function correctBattleFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  correctHpFromSnapshot(battle, snapshot);
  correctActivesFromSnapshot(battle, snapshot);
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
export function runDisablePass(battle: SimBattle) {
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
