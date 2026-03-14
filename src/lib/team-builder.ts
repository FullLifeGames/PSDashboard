import type { PokemonSet } from '@pkmn/sim';
import { Teams } from '@pkmn/sim';
import { inferOpponentTeam } from './opponent-inferrer';
import { getCommonSet, fillDefaultMoves, getDefaultItem } from './common-sets';
import type { RevealedPokemonInfo } from '../types';

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Build PokemonSet arrays for both sides from a replay's protocol log.
 * p1 is augmented with the user's pasted team (full moveset, EVs, nature).
 * p2 is augmented with common competitive sets.
 */
export function buildTeamsFromReplay(
  log: string,
  userTeamText?: string,
): { p1Team: PokemonSet[]; p2Team: PokemonSet[] } {
  const p1Info = inferOpponentTeam(log, 'p1');
  const p2Info = inferOpponentTeam(log, 'p2');

  let userTeam: PokemonSet[] | null = null;
  if (userTeamText?.trim()) {
    const imported = Teams.import(userTeamText);
    if (imported && imported.length > 0) {
      userTeam = imported;
    }
  }

  const p1Team = p1Info.pokemon.map(p => buildSet(p, userTeam));
  const p2Team = p2Info.pokemon.map(p => buildSet(p, null));

  return { p1Team, p2Team };
}

function buildSet(info: RevealedPokemonInfo, userTeam: PokemonSet[] | null): PokemonSet {
  // Try to find a matching entry in the user's pasted team
  const userMatch = userTeam?.find(u => {
    const uId = toId(u.species);
    const infoId = toId(info.species);
    return uId === infoId ||
      toId(u.name || '') === infoId ||
      uId === toId(info.species.split('-')[0]) ||
      infoId === toId(u.species.split('-')[0]);
  });

  if (userMatch) {
    // Merge: keep user's full data, overlay replay-observed info
    const moves = mergeMoveLists(info.moves, userMatch.moves);
    return {
      ...userMatch,
      moves: moves.length > 0 ? moves : userMatch.moves,
      ability: info.ability || userMatch.ability,
      item: cleanItem(info.item, userMatch.item),
      level: info.level || userMatch.level || 100,
      gender: (info.gender || userMatch.gender || '') as '' | 'M' | 'F',
    };
  }

  // No user match — use common sets to fill gaps
  const common = getCommonSet(info.species);
  const moves = fillDefaultMoves(info.species, info.moves);

  return {
    name: info.species,
    species: info.species,
    item: cleanItem(info.item, common?.item || ''),
    ability: info.ability || common?.ability || '',
    moves: moves.length > 0 ? moves : ['Tackle'],
    nature: (common?.nature || 'Hardy') as any,
    evs: common?.evs || { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: info.level || 100,
    gender: (info.gender || '') as '' | 'M' | 'F',
  };
}

function cleanItem(replayItem: string, fallback: string): string {
  if (!replayItem) return fallback;
  if (replayItem === '(has item)' || replayItem.startsWith('(')) return fallback;
  if (replayItem.includes('(consumed)')) return replayItem.replace(/\s*\(consumed\)/, '').trim();
  return replayItem;
}

function mergeMoveLists(observed: string[], full: string[]): string[] {
  const result = [...full];
  for (const move of observed) {
    if (!result.some(m => toId(m) === toId(move))) {
      if (result.length < 4) {
        result.push(move);
      }
    }
  }
  return result.slice(0, 4);
}
