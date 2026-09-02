import { Battle, BattleStreams, Dex, Teams } from '@pkmn/sim';
import type { ID, PokemonSet } from '@pkmn/sim';
import type { BranchSlotChoice } from '../branch-choices';
import { serializeBattleStable } from '../forward-model';
import type {
  BranchChoices, BranchMoveOption, BranchSimState, BranchSlotModifiers, BranchSwitchOption, BranchTargetOption,
  SimBattle, SimPokemon, SimSide,
} from './types';
import { slotLetter, trimTeamToBring } from './team-order';
import { targetTypeForMove } from './protocol-choices';
import { forceSwitches } from './corrections';
import { extractPokemonInfo, makePokemonInfo } from './pokemon-info';


function makeMoves(
  active: SimPokemon | null | undefined,
  activeSlot: number,
  forceSwitch: boolean,
  battle: SimBattle,
): BranchMoveOption[] {
  if (!active || active.fainted || forceSwitch) return [];
  return active.moveSlots.map((move, index): BranchMoveOption => {
    const moveData = Dex.moves.get(move.id || move.move);
    const targetType = targetTypeForMove(active, move.id || move.move);
    const targetOptions = buildTargetOptions(battle, active, targetType);
    return {
      name: move.move,
      activeSlot,
      slot: index + 1,
      pp: move.pp,
      maxpp: move.maxpp,
      disabled: !!move.disabled,
      type: moveData?.type || '',
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
        hpPercent: target.maxhp > 0 ? Math.round(target.hp / target.maxhp * 100) : 0,
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

  // The sim maintains once-per-battle availability on the Pokémon itself
  // (consumed gimmicks are nulled there); Z availability is a dynamic check.
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

function makeSwitches(side: SimSide, activeSlot: number): BranchSwitchOption[] {
  const activeNames = new Set(side.active.filter(Boolean).map(active => active.name));
  return side.pokemon
    .map((pokemon, index): BranchSwitchOption => ({
      name: pokemon.name,
      species: pokemon.species.name,
      activeSlot,
      slot: index + 1,
      hp: `${pokemon.maxhp > 0 ? Math.round(pokemon.hp / pokemon.maxhp * 100) : 0}%`,
      hpPercent: pokemon.maxhp > 0 ? Math.round(pokemon.hp / pokemon.maxhp * 100) : 0,
      fainted: pokemon.fainted,
    }))
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

export function createBranchState(
  battleStream: BattleStreams.BattleStream | null,
  log: string[],
  choices: BranchChoices,
): BranchSimState {
  return createBranchStateFromBattle(battleStream?.battle, log, choices);
}

/** One side's per-slot views: active infos, move lists, switch lists. */
function sideSlots(battle: SimBattle, sideIndex: 0 | 1) {
  const side = battle.sides[sideIndex];
  const forced = forceSwitches(battle, sideIndex);
  return {
    forced,
    activeSlots: side.active.map((active, index) => active ? makePokemonInfo(active, true, index) : null),
    movesBySlot: side.active.map((active, index) => makeMoves(active, index, forced[index] ?? false, battle)),
    switchesBySlot: side.active.map((_, index) => makeSwitches(side, index)),
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

/** Same picker state, but from a bare Battle — used for stored positions
 *  (deserialized without a stream) by the unified timeline's pickers. */
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

/**
 * Position record for the unified timeline: the state AFTER an executed
 * entry, in the eval engine's stable serialization. Failure degrades to
 * null — the entry stays navigable via the sim log, it just cannot be
 * evaluated or picked from without a rebuild.
 */
export function captureSerializedPosition(battle: SimBattle | null | undefined): string | null {
  if (!battle) return null;
  try {
    return serializeBattleStable(battle);
  } catch {
    return null;
  }
}

/**
 * The turn-0 position: a fresh battle sitting at team preview, before either
 * side has ordered its team — the lead decision the eval engine can search.
 * Null for formats without team preview (older gens). Deterministic seed so
 * every caller serializes the identical position.
 */
export function serializePreviewPosition(
  format: string,
  p1Team: PokemonSet[],
  p2Team: PokemonSet[],
  /** Bring-limited replays: the preview holds only the brought species, so
   *  the lead enumeration prices real pairs instead of a phantom pool.
   *  Callers pass both sides or nothing; an unmatchable list keeps its
   *  side whole (same trim as the branch reconstruction). */
  bringOnly?: { p1: string[]; p2: string[] } | null,
): string | null {
  try {
    const battle = new Battle({
      // The raw format string, never toID: clause suffixes ride along as
      // "@@@Sleep Clause Mod", and toID mangles them into an unknown format
      // WITHOUT team preview — every draft replay lost its turn 0 that way.
      formatid: format as ID,
      seed: '1,2,3,4',
      p1: { name: 'p1', team: Teams.pack(trimTeamToBring(p1Team, bringOnly?.p1)) },
      p2: { name: 'p2', team: Teams.pack(trimTeamToBring(p2Team, bringOnly?.p2)) },
    });
    if (battle.sides[0]?.requestState !== 'teampreview') return null;
    return serializeBattleStable(battle);
  } catch {
    return null;
  }
}
