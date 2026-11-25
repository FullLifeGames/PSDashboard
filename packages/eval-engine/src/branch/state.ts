import { Battle, BattleStreams, Teams } from '@pkmn/sim';
import type { ID, PokemonSet } from '@pkmn/sim';
import type { BranchSlotChoice } from '../branch-choices.ts';
import { serializeBattleStable } from '../forward-model.ts';
import { cloneBattle } from '../forward/sim-fast/clone.ts';
import type {
  BranchChoices, BranchMoveOption, BranchSimState, BranchSlotModifiers, BranchSwitchOption, BranchTargetOption,
  SimBattle, SimPokemon, SimSide,
} from './types.ts';
import { slotLetter, trimTeamsToBring } from './team-order.ts';
import { formatRules, toId } from '@fulllifegames/replay-core';
import { targetTypeForMove } from './protocol-choices.ts';
import { isLockedEntry } from '../forward/request-moves.ts';
import { forceSwitches } from './corrections.ts';
import { extractPokemonInfo, makePokemonInfo, shownPercent } from './pokemon-info.ts';


/** The type a move lands with, as the simulator reads it on the active body; the catalog type when it refuses. */
// Order of battle-actions.js useMoveInner. Debug lines are off: a custom-game format's debug mode would log them.
export function typeAtUse(battle: SimBattle, active: SimPokemon, id: string): string {
  const log = battle as unknown as { debugMode: boolean };
  const debug = log.debugMode;
  log.debugMode = false;
  try {
    const move = battle.dex.getActiveMove(id);
    const target = active.foes()[0] ?? null;
    battle.singleEvent('ModifyType', move, null, active, target, move, move);
    battle.runEvent('ModifyType', active, target, move, move);
    return move.type;
  } catch {
    return battle.dex.moves.get(id).type || '';
  } finally {
    log.debugMode = debug;
  }
}

/** The type each retyping move lands with after the Tera click, via `typeAtUse` on a copy that terastallized. */
export function typesUnderTera(
  battle: SimBattle, active: SimPokemon, moveIds: readonly string[] = active.moveSlots.map(move => move.id || move.move),
): Map<string, string> {
  const labels = new Map<string, string>();
  if (!active.canTerastallize) return labels;
  const ids = moveIds.filter(id => !!battle.dex.moves.get(id).onModifyType);
  if (!ids.length) return labels;
  try {
    const copy = cloneBattle(battle) as SimBattle;
    (copy as unknown as { debugMode: boolean }).debugMode = false;
    const twin = copy.sides[active.side.n].active[active.position];
    copy.actions.terastallize(twin);
    if (!twin.terastallized) return labels;
    for (const id of ids) labels.set(id, typeAtUse(copy, twin, id));
  } catch {
    labels.clear();
  }
  return labels;
}

// getMoves flags a move disabled for every reason the Dex gives, so the picker keeps no list; a slot's own flag stays.
function makeMoves(
  active: SimPokemon | null | undefined,
  activeSlot: number,
  forceSwitch: boolean,
  battle: SimBattle,
): BranchMoveOption[] {
  if (!active || active.fainted || forceSwitch) return [];
  const underTera = typesUnderTera(battle, active);
  const requestMoves = active.getMoveRequestData().moves;
  const ownIds = new Set(active.moveSlots.map(move => move.id || toId(move.move)));
  const known = (id: string) => battle.dex.moves.get(id).exists;
  const entries = [
    ...active.moveSlots.map(move => ({ name: move.move, id: move.id || toId(move.move), pp: move.pp, maxpp: move.maxpp, slotDisabled: !!move.disabled, dex: true })),
    ...requestMoves
      .filter(move => !ownIds.has(move.id) && (known(move.id) || isLockedEntry(move)))
      .map(move => ({
        name: known(move.id) ? battle.dex.moves.get(move.id).name : move.move, id: move.id,
        pp: move.pp ?? 0, maxpp: move.maxpp ?? 0, slotDisabled: false, dex: known(move.id),
      })),
  ];
  return entries.map((move, index): BranchMoveOption => {
    const targetType = move.dex ? targetTypeForMove(battle.dex, active, move.id) : '';
    const targetOptions = buildTargetOptions(battle, active, targetType);
    const type = move.dex ? typeAtUse(battle, active, move.id) : '';
    const typeUnderTera = underTera.get(move.id);
    const requested = requestMoves.find(entry => entry.id === move.id);
    return {
      name: move.name,
      activeSlot,
      slot: index + 1,
      pp: move.pp,
      maxpp: move.maxpp,
      // A request that lists other moves only (Struggle, a locked turn) leaves this one out: it cannot be clicked.
      disabled: move.slotDisabled || (requested ? !!requested.disabled : requestMoves.length > 0),
      type,
      ...(typeUnderTera && typeUnderTera !== type ? { typeUnderTera } : {}),
      targetType,
      requiresTarget: targetOptions.length > 0,
      targetOptions,
    };
  });
}

function buildTargetOptions(
  battle: SimBattle,
  active: SimPokemon,
  targetType: string,
): BranchTargetOption[] {
  if (active.side.active.length < 2 || !battle.actions.targetTypeChoices(targetType)) return [];
  const targetLocs = Array.from({ length: battle.activePerHalf }, (_, index) => index + 1)
    .flatMap(loc => [loc, -loc]);

  return targetLocs
    .filter(targetLoc => battle.validTargetLoc(targetLoc, active, targetType))
    .map(targetLoc => {
      const target = active.getAtLoc(targetLoc);
      if (!target || target.fainted) return null;
      const targetSide = target.side.id as 'p1' | 'p2';
      return {
        label: `${targetSide.toUpperCase()}${slotLetter(target.position).toUpperCase()}`,
        targetLoc,
        side: targetSide,
        activeSlot: target.position,
        name: target.name,
        species: target.species.name,
        hpPercent: shownPercent(target),
      };
    })
    .filter((target): target is BranchTargetOption => !!target);
}

const EMPTY_SLOT_MODIFIERS: BranchSlotModifiers = {
  teraType: null,
  canMegaEvo: false,
  canUltraBurst: false,
  zMoves: [],
};

function makeSlotModifiers(battle: SimBattle, active: SimPokemon | null | undefined): BranchSlotModifiers {
  if (!active || active.fainted) return EMPTY_SLOT_MODIFIERS;

  // Once-per-battle availability lives on the Pokémon (a spent gimmick is nulled); Z availability is a dynamic check.
  const teraType = active.canTerastallize || null;
  const canMegaEvo = !!active.canMegaEvo;
  const canUltraBurst = !!active.canUltraBurst;
  let zMoves: (string | null)[];
  try {
    zMoves = (battle.actions.canZMove(active) ?? []).map(option => option?.move ?? null);
  } catch {
    zMoves = [];
  }

  return { teraType, canMegaEvo, canUltraBurst, zMoves };
}

// A held body (`trapped` in a move request) cannot switch out (side.js chooseSwitch): the chips carry the flag.
function makeSwitches(side: SimSide, activeSlot: number, forced: boolean): BranchSwitchOption[] {
  const activeNames = new Set(side.active.filter(Boolean).map(active => active.name));
  const held = side.active[activeSlot];
  if (!forced && (!held || held.fainted)) return [];
  const trapped = !forced && !!held.trapped;
  return side.pokemon
    .map((pokemon, index): BranchSwitchOption => {
      const percent = shownPercent(pokemon);
      return {
        name: pokemon.name,
        species: pokemon.species.name,
        activeSlot,
        slot: index + 1,
        hp: `${percent}%`,
        hpPercent: percent,
        fainted: pokemon.fainted,
        ...(trapped ? { trapped } : {}),
      };
    })
    .filter(pokemon => !pokemon.fainted && !activeNames.has(pokemon.name));
}

function normalizeChoices(
  choices: (BranchSlotChoice | null)[] | undefined,
  legacyChoice: BranchSlotChoice | null | undefined,
  activeCount: number,
): (BranchSlotChoice | null)[] {
  const normalized = Array.from({ length: Math.max(activeCount, 1) }, (_, index) => choices?.[index] ?? null);
  if (!choices && legacyChoice) normalized[0] = legacyChoice;
  return normalized;
}

function emptyState(log: string[], choices: BranchChoices): BranchSimState {
  const p1Choices = normalizeChoices(choices.p1Choices, choices.p1Choice, 1);
  const p2Choices = normalizeChoices(choices.p2Choices, choices.p2Choice, 1);

  return {
    p1Moves: [],
    p1MovesBySlot: [],
    p1Switches: [],
    p1SwitchesBySlot: [],
    p2Moves: [],
    p2MovesBySlot: [],
    p2Switches: [],
    p2SwitchesBySlot: [],
    p1Pokemon: [],
    p2Pokemon: [],
    p1Active: null,
    p1ActiveSlots: [],
    p2Active: null,
    p2ActiveSlots: [],
    p1ModifiersBySlot: [],
    p2ModifiersBySlot: [],
    field: { weather: '', terrain: '', p1SideConditions: [], p2SideConditions: [] },
    log,
    ended: false,
    winner: null,
    waitingForChoice: false,
    turnNumber: 0,
    p1ForceSwitch: false,
    p1ForceSwitches: [],
    p2ForceSwitch: false,
    p2ForceSwitches: [],
    p1Choice: p1Choices[0] ?? null,
    p1Choices,
    p2Choice: p2Choices[0] ?? null,
    p2Choices,
  };
}

/** The picker state of a runtime's battle: moves, switches, field, force-switch flags and the pending choices. */
export function createBranchState(
  battleStream: BattleStreams.BattleStream | null,
  log: string[],
  choices: BranchChoices,
): BranchSimState {
  return createBranchStateFromBattle(battleStream?.battle, log, choices);
}

function sideSlots(battle: SimBattle, sideIndex: 0 | 1) {
  const side = battle.sides[sideIndex];
  const forced = forceSwitches(battle, sideIndex);
  return {
    forced,
    activeSlots: side.active.map((active, index) => active ? makePokemonInfo(active, true, index) : null),
    movesBySlot: side.active.map((active, index) => makeMoves(active, index, forced[index] ?? false, battle)),
    // After the moves: a locked move marks its body trapped in the request data (pokemon.js getMoveRequestData).
    switchesBySlot: side.active.map((_, index) => makeSwitches(side, index, forced[index] ?? false)),
    modifiersBySlot: side.active.map(active => makeSlotModifiers(battle, active)),
  };
}

function fieldState(battle: SimBattle): BranchSimState['field'] {
  return {
    weather: battle.field.weather || '',
    terrain: battle.field.terrain || '',
    p1SideConditions: Object.keys(battle.sides[0].sideConditions),
    p2SideConditions: Object.keys(battle.sides[1].sideConditions),
  };
}

/** The picker state from a bare Battle, for stored positions deserialized without a stream. */
export function createBranchStateFromBattle(
  battle: SimBattle | null | undefined,
  log: string[],
  choices: BranchChoices,
): BranchSimState {
  const effectiveLog = log.length > 0 ? log : (battle?.log ?? []);
  if (!battle) return emptyState([...effectiveLog], choices);

  const p1 = sideSlots(battle, 0);
  const p2 = sideSlots(battle, 1);
  const p1Choices = normalizeChoices(choices.p1Choices, choices.p1Choice, p1.activeSlots.length);
  const p2Choices = normalizeChoices(choices.p2Choices, choices.p2Choice, p2.activeSlots.length);

  return {
    p1Moves: p1.movesBySlot[0] ?? [],
    p1MovesBySlot: p1.movesBySlot,
    p1Switches: p1.switchesBySlot[0] ?? [],
    p1SwitchesBySlot: p1.switchesBySlot,
    p2Moves: p2.movesBySlot[0] ?? [],
    p2MovesBySlot: p2.movesBySlot,
    p2Switches: p2.switchesBySlot[0] ?? [],
    p2SwitchesBySlot: p2.switchesBySlot,
    p1Pokemon: extractPokemonInfo(battle.sides[0]),
    p2Pokemon: extractPokemonInfo(battle.sides[1]),
    p1Active: p1.activeSlots[0] ?? null,
    p1ActiveSlots: p1.activeSlots,
    p2Active: p2.activeSlots[0] ?? null,
    p2ActiveSlots: p2.activeSlots,
    p1ModifiersBySlot: p1.modifiersBySlot,
    p2ModifiersBySlot: p2.modifiersBySlot,
    field: fieldState(battle),
    log: [...effectiveLog],
    ended: battle.ended,
    winner: battle.winner || null,
    waitingForChoice: !battle.ended && !!battle.requestState,
    turnNumber: battle.turn,
    p1ForceSwitch: p1.forced.some(Boolean),
    p1ForceSwitches: p1.forced,
    p2ForceSwitch: p2.forced.some(Boolean),
    p2ForceSwitches: p2.forced,
    p1Choice: p1Choices[0] ?? null,
    p1Choices,
    p2Choice: p2Choices[0] ?? null,
    p2Choices,
  };
}

/** The state AFTER an executed entry in the engine's stable serialization; null on failure (needs a rebuild). */
export function captureSerializedPosition(battle: SimBattle | null | undefined): string | null {
  if (!battle) return null;
  try {
    return serializeBattleStable(battle);
  } catch {
    return null;
  }
}

/** The turn-0 position at team preview (null without one), on a fixed seed so every caller serializes the same one. */
export function serializePreviewPosition(
  format: string,
  p1Team: PokemonSet[],
  p2Team: PokemonSet[],
  bringOnly?: { p1: string[]; p2: string[]; guessed?: { p1: number; p2: number } } | null,
): string | null {
  try {
    const trimmed = trimTeamsToBring(p1Team, p2Team, bringOnly, formatRules(format));
    const battle = new Battle({
      // The raw format string, never toID: toID mangles clause suffixes ("@@@Sleep Clause Mod") into an unknown format
      // WITHOUT team preview (every draft replay lost its turn 0).
      formatid: format as ID,
      seed: '1,2,3,4',
      p1: { name: 'p1', team: Teams.pack(trimmed.p1) },
      p2: { name: 'p2', team: Teams.pack(trimmed.p2) },
    });
    if (battle.sides[0]?.requestState !== 'teampreview') return null;
    return serializeBattleStable(battle);
  } catch {
    return null;
  }
}
