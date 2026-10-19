import { hasHandler, idsOf, type FactsDex } from './facts.ts';

type DexMove = ReturnType<FactsDex['moves']['get']>;

/** The moves of the Dex that exist and are no Max or Z move (those set their effects through their own fields). */
const plainMoves = (dex: FactsDex): DexMove[] => dex.moves.all().filter(move => move.exists && !move.isMax && !move.isZ);

const scanChoice = (dex: FactsDex) => dex.items.all().filter(item => item.exists && item.isChoice).map(item => item.id);

const scanHazards = (dex: FactsDex) => plainMoves(dex)
  .filter(move => move.target === 'foeSide' && !!move.sideCondition && hasHandler(dex.conditions.get(move.sideCondition), ['onSwitchIn', 'onEntryHazard']))
  .map(move => move.sideCondition!);

const scanTerrains = (dex: FactsDex) => plainMoves(dex).filter(move => !!move.terrain).map(move => move.terrain!);

const scanUmbrella = (dex: FactsDex) => Object.keys(dex.data.Conditions)
  .map(id => dex.conditions.get(id))
  .filter(condition => condition.effectType === 'Weather' && hasHandler(condition, ['onWeatherModifyDamage']))
  .map(condition => condition.id);

const scanCalling = (dex: FactsDex) => plainMoves(dex).filter(move => !!move.callsMove).map(move => move.id);

/** The items that lock their holder into one move (`isChoice`: Choice Band, Specs and Scarf). */
export const choiceItems = (dex: FactsDex): ReadonlySet<string> => idsOf(dex, 'choiceItems', scanChoice);

/**
 * The side conditions of the entry hazards: a foe-side move sets a side condition that acts on a switch-in (`onSwitchIn`,
 * or `onEntryHazard` for the ones the simulator runs through the hazard hook). Layers and caps stay with the readers.
 */
export const hazardConditions = (dex: FactsDex): ReadonlySet<string> => idsOf(dex, 'hazardConditions', scanHazards);

/** The terrain conditions: the terrain a move sets. */
export const terrainConditions = (dex: FactsDex): ReadonlySet<string> => idsOf(dex, 'terrainConditions', scanTerrains);

/** The weathers the Utility Umbrella takes away: the weather conditions that change the damage of a type. */
export const umbrellaWeathers = (dex: FactsDex): ReadonlySet<string> => idsOf(dex, 'umbrellaWeathers', scanUmbrella);

/**
 * The moves that call another move (`callsMove`: Metronome, Sleep Talk, Assist, Copycat, Mirror Move, Me First, Nature Power). The move
 * that runs is chosen elsewhere in the turn, so a one-turn model cannot price them. Read it over a Dex that carries the Past moves
 * (`Dex` itself holds all seven; Generation 9 marks Assist, Mirror Move, Me First and Nature Power Past, which stay real moves).
 */
export const callingMoves = (dex: FactsDex): ReadonlySet<string> => idsOf(dex, 'callingMoves', scanCalling);
