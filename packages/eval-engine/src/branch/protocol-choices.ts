import { Dex } from '@pkmn/sim';
import type { PokemonIdent, SimBattle, SimPokemon, SimSide, TurnBlock } from './types.ts';
import { formatTargetLoc, normalizeBattleOnlyFormeId, slotLetter } from './team-order.ts';
import { sideIndex, toId } from '@fulllifegames/replay-core';

export function parseTurnBlocks(log: string): { preGame: string[]; turns: TurnBlock[] } {
  const lines = log.split('\n');
  const preGame: string[] = [];
  const turns: TurnBlock[] = [];
  let current: TurnBlock | null = null;
  let inPostUpkeep = false;

  for (const line of lines) {
    if (line.startsWith('|turn|')) {
      if (current) turns.push(current);
      current = { turn: parseInt(line.split('|')[2], 10), preUpkeep: [], postUpkeep: [] };
      inPostUpkeep = false;
    } else if (!current) {
      preGame.push(line);
    } else if (line.startsWith('|upkeep')) {
      inPostUpkeep = true;
    } else if (inPostUpkeep) {
      current.postUpkeep.push(line);
    } else {
      current.preUpkeep.push(line);
    }
  }
  if (current) turns.push(current);

  return { preGame, turns };
}

export function extractLeads(log: string): { p1Leads: PokemonIdent[]; p2Leads: PokemonIdent[] } {
  const p1Leads: PokemonIdent[] = [];
  const p2Leads: PokemonIdent[] = [];

  for (const line of log.split('\n')) {
    if (line.startsWith('|turn|')) break;

    const match = line.match(/^\|switch\|(p[12])[a-d]:\s*([^|]*)\|([^,|]+)/);
    if (!match) continue;

    const side = match[1];
    const name = match[2].trim();
    const species = match[3].trim();
    const target = side === 'p1' ? p1Leads : p2Leads;
    if (!target.some(existing => toId(existing.name) === toId(name) && toId(existing.species) === toId(species))) {
      target.push({ name, species });
    }
  }

  return { p1Leads, p2Leads };
}

export function findSlotBySpecies(battle: SimBattle, sideIdx: number, species: string): number {
  const side = battle.sides[sideIdx];
  const speciesId = toId(species);
  const normalizedSpeciesId = normalizeBattleOnlyFormeId(speciesId);

  for (let i = 0; i < side.pokemon.length; i++) {
    const pokemon = side.pokemon[i];
    if (pokemon.isActive || pokemon.fainted) continue;
    const speciesName = toId(pokemon.species?.name || '');
    const displayName = toId(pokemon.name || '');
    if (
      speciesName === speciesId ||
      speciesName === normalizedSpeciesId ||
      displayName === speciesId ||
      displayName === normalizedSpeciesId ||
      speciesName.startsWith(speciesId) ||
      speciesId.startsWith(speciesName) ||
      speciesName.startsWith(normalizedSpeciesId) ||
      normalizedSpeciesId.startsWith(speciesName)
    ) {
      return i + 1;
    }
  }

  return findFirstAvailableSwitchSlot(battle, sideIdx);
}

export function findFirstAvailableSwitchSlot(battle: SimBattle, sideIdx: number): number {
  const side = battle.sides[sideIdx];
  for (let i = 0; i < side.pokemon.length; i++) {
    if (!side.pokemon[i].isActive && !side.pokemon[i].fainted) return i + 1;
  }
  return 2;
}

export function findPokemonOnSide(side: SimSide, species: string): SimPokemon | null {
  const speciesId = toId(species);
  const normalizedSpeciesId = normalizeBattleOnlyFormeId(speciesId);
  return side.pokemon.find(pokemon =>
    toId(pokemon.species?.name || '') === speciesId ||
    toId(pokemon.species?.name || '') === normalizedSpeciesId ||
    toId(pokemon.name || '') === speciesId ||
    toId(pokemon.name || '') === normalizedSpeciesId
  ) ?? null;
}

function protocolTargetLoc(
  battle: SimBattle,
  sourceSide: 'p1' | 'p2',
  sourceActiveSlot: number,
  targetIdent: string | undefined,
): number {
  const match = targetIdent?.match(/^(p[12])([a-d]):/);
  if (!match) return 0;

  const sourceSideIdx = sideIndex(sourceSide);
  const targetSideIdx = match[1] === 'p1' ? 0 : 1;
  const targetActiveSlot = match[2].charCodeAt(0) - 'a'.charCodeAt(0);
  const source = battle.sides[sourceSideIdx].active[sourceActiveSlot];
  const target = battle.sides[targetSideIdx].active[targetActiveSlot];

  if (source && target) return source.getLocOf(target);
  return targetSideIdx === sourceSideIdx ? -(targetActiveSlot + 1) : targetActiveSlot + 1;
}

export function targetTypeForMove(active: SimPokemon | null | undefined, moveName: string): string {
  if (!active) return Dex.moves.get(moveName).target || '';
  const moveId = toId(moveName);
  const request = active.getMoveRequestData();
  return request.moves.find(move => move.id === moveId)?.target || Dex.moves.get(moveName).target || '';
}

function shouldAppendTargetLoc(
  battle: SimBattle,
  active: SimPokemon | null | undefined,
  moveName: string,
  targetLoc: number,
): boolean {
  if (!active || !targetLoc || active.side.active.length < 2) return false;
  const targetType = targetTypeForMove(active, moveName);
  return battle.actions.targetTypeChoices(targetType) && battle.validTargetLoc(targetLoc, active, targetType);
}

export function targetLocSuffixForChoice(
  battle: SimBattle,
  active: SimPokemon | null | undefined,
  moveName: string,
  protocolTargetLoc: number,
): string {
  if (shouldAppendTargetLoc(battle, active, moveName, protocolTargetLoc)) {
    return ` ${formatTargetLoc(protocolTargetLoc)}`;
  }

  if (!active || active.side.active.length < 2) return '';
  const targetType = targetTypeForMove(active, moveName);
  if (!battle.actions.targetTypeChoices(targetType)) return '';

  const fallbackTargetLoc = firstLegalTargetLoc(battle, active, targetType);
  return fallbackTargetLoc ? ` ${formatTargetLoc(fallbackTargetLoc)}` : '';
}

function firstLegalTargetLoc(battle: SimBattle, active: SimPokemon, targetType: string): number | null {
  if (active.side.active.length < 2 || !battle.actions.targetTypeChoices(targetType)) return null;
  for (let loc = 1; loc <= battle.activePerHalf; loc++) {
    for (const targetLoc of [loc, -loc]) {
      if (battle.validTargetLoc(targetLoc, active, targetType)) return targetLoc;
    }
  }
  return null;
}

function defaultMoveChoice(battle: SimBattle, active: SimPokemon | null | undefined): string {
  if (!active || active.fainted) return 'pass';
  const firstMove = active.moveSlots[0];
  if (!firstMove) return 'pass';
  const targetType = targetTypeForMove(active, firstMove.id || firstMove.move);
  const targetLoc = firstLegalTargetLoc(battle, active, targetType);
  return `move 1${targetLoc ? ` ${formatTargetLoc(targetLoc)}` : ''}`;
}

function moveChoiceForActive(active: SimPokemon | null | undefined, moveName: string): string {
  if (!active) return `move ${toId(moveName)}`;
  const moveId = toId(moveName);
  const requestMoves = active.getMoveRequestData().moves;
  const requestMoveIndex = requestMoves.findIndex(move =>
    move.id === moveId || toId(move.move) === moveId
  );
  if (requestMoveIndex >= 0) return `move ${requestMoveIndex + 1}`;

  const moveIndex = active.moveSlots.findIndex(move =>
    toId(move.id || move.move) === moveId || toId(move.move) === moveId
  );
  return `move ${moveIndex >= 0 ? moveIndex + 1 : moveId}`;
}

/**
 * Replays the protocol's gimmick markers (Tera / Mega / Ultra Burst) as
 * choice modifiers. Without them the reconstructed sim never transforms —
 * every later position then carries an unspent gimmick on an untransformed
 * Pokémon, and the eval recommends a Mega that already happened. Gated on
 * the sim actually offering the gimmick so an unknown item can never
 * produce a rejected choice.
 */
function gimmickSuffixForSlot(events: string[], ident: string, active: SimPokemon | null | undefined): string {
  if (!active) return '';
  for (const line of events) {
    if (line.startsWith(`|-terastallize|${ident}`) && active.canTerastallize) return ' terastallize';
    if (line.startsWith(`|-mega|${ident}`) && active.canMegaEvo) return ' mega';
    if (line.startsWith(`|-burst|${ident}`) && active.canUltraBurst) return ' ultra';
  }
  return '';
}

function getChoiceForSlot(
  events: string[],
  side: 'p1' | 'p2',
  activeSlot: number,
  battle: SimBattle,
): string {
  const sideIdx = sideIndex(side);
  const ident = `${side}${slotLetter(activeSlot)}:`;

  for (const line of events) {
    if (line.startsWith(`|switch|${ident}`) && !line.includes('[from]')) {
      const species = line.split('|')[3].split(',')[0].trim();
      return `switch ${findSlotBySpecies(battle, sideIdx, species)}`;
    }

    if (line.startsWith(`|move|${ident}`)) {
      const moveName = line.split('|')[3];
      const active = battle.sides[sideIdx].active[activeSlot];
      const targetLoc = protocolTargetLoc(battle, side, activeSlot, line.split('|')[4]);
      const suffix = targetLocSuffixForChoice(
        battle,
        active,
        moveName,
        targetLoc,
      );
      return `${moveChoiceForActive(active, moveName)}${suffix}${gimmickSuffixForSlot(events, ident, active)}`;
    }

    // A |cant| that names a move is the choice the player committed before it
    // was blocked (same-turn Taunt, Imprison, flinch). Falling through to
    // `move 1` instead played Uxie's U-turn on a taunted Stealth Rock turn and
    // pulled the pivot switch a turn early — the first domino of a replay-wide
    // desync. A reason-only |cant| (slp, par) keeps scanning: a Sleep Talk
    // turn carries both that line and the |move| line the scan should find.
    if (line.startsWith(`|cant|${ident}`)) {
      const moveName = line.split('|')[4]?.trim();
      if (moveName) {
        const active = battle.sides[sideIdx].active[activeSlot];
        const suffix = targetLocSuffixForChoice(battle, active, moveName, 0);
        return `${moveChoiceForActive(active, moveName)}${suffix}${gimmickSuffixForSlot(events, ident, active)}`;
      }
    }
  }

  const active = battle.sides[sideIdx].active[activeSlot];
  return defaultMoveChoice(battle, active);
}

export function getMainChoice(events: string[], side: 'p1' | 'p2', battle: SimBattle): string {
  const sideIdx = sideIndex(side);
  const actives = battle.sides[sideIdx].active;
  const choices = actives.map((_, activeSlot) => getChoiceForSlot(events, side, activeSlot, battle));
  return choices.length > 0 ? choices.join(', ') : 'move 1';
}

export function collectForcedSwitchSpecies(
  preUpkeep: string[],
  postUpkeep: string[],
  side: 'p1' | 'p2',
): string[] {
  const species: string[] = [];
  const matcher = new RegExp(`^\\|switch\\|${side}[a-d]:`);

  for (const line of preUpkeep) {
    if (matcher.test(line) && line.includes('[from]')) {
      species.push(line.split('|')[3].split(',')[0].trim());
    }
  }

  for (const line of postUpkeep) {
    if (matcher.test(line)) {
      species.push(line.split('|')[3].split(',')[0].trim());
    }
  }

  return species;
}
