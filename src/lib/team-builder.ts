import type { PokemonSet } from '@pkmn/sim';
import { Dex, Teams } from '@pkmn/sim';
import { inferOpponentTeam } from './opponent-inferrer';
import { getSpeciesUsageSet, type SmogonUsageStats, type UsageProbability } from './smogon-stats';
import { getSpeciesSetAssumption, type SetAssumption, type SmogonSetAssumptions } from './smogon-sets';
import { itemSetValue } from './team-info';
import type { KnowledgeSource, OpponentTeamInfo, PokemonEvs, RevealedPokemonInfo } from '../types';

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Build PokemonSet arrays for both sides from a replay's protocol log.
 * Pasted teams take precedence for the user's side; otherwise hidden data can
 * be filled from Smogon usage probabilities when those stats are available.
 */
export function buildTeamsFromReplay(
  log: string,
  options?: {
    userTeamText?: string;
    p1Info?: OpponentTeamInfo | null;
    p2Info?: OpponentTeamInfo | null;
    usageStats?: SmogonUsageStats | null;
    setAssumptions?: SmogonSetAssumptions | null;
  },
): { p1Team: PokemonSet[]; p2Team: PokemonSet[] } {
  const p1Info = options?.p1Info || inferOpponentTeam(log, 'p1');
  const p2Info = options?.p2Info || inferOpponentTeam(log, 'p2');
  const embeddedTeams = extractEmbeddedShowteamExports(log);

  let userTeam: PokemonSet[] | null = null;
  if (options?.userTeamText?.trim()) {
    const imported = Teams.import(options.userTeamText);
    if (imported && imported.length > 0) {
      userTeam = imported;
    }
  }

  const p1KnownTeam = userTeam || embeddedTeams.p1 || null;
  const p2KnownTeam = embeddedTeams.p2 || null;
  const p1Team = p1Info.pokemon.map(pokemon => buildSet(pokemon, p1KnownTeam, options?.usageStats, options?.setAssumptions));
  const p2Team = p2Info.pokemon.map(pokemon => buildSet(pokemon, p2KnownTeam, options?.usageStats, options?.setAssumptions));

  return { p1Team, p2Team };
}

function buildSet(
  info: RevealedPokemonInfo,
  userTeam: PokemonSet[] | null,
  usageStats?: SmogonUsageStats | null,
  setAssumptions?: SmogonSetAssumptions | null,
): PokemonSet {
  const editedEvs = info.evs?.source === 'manual' || info.evs?.source === 'revealed'
    ? sanitizeEvs(info.evs.value)
    : null;
  const editedNature = (info.nature?.source === 'manual' || info.nature?.source === 'revealed') && info.nature.value
    ? (info.nature.value as PokemonSet['nature'])
    : null;
  const editedIvs = info.ivs?.source === 'manual' || info.ivs?.source === 'revealed'
    ? info.ivs.value
    : null;
  // Only knowledge that outranks a team sheet: seen in game or user-edited.
  // Enriched infos carry usage GUESSES in value — a 58% Leftovers guess must
  // never beat a sheet's Choice Scarf.
  const known = (field: { value: string; source: KnowledgeSource }) =>
    field.source === 'revealed' || field.source === 'manual' ? field.value : '';
  const userMatch = userTeam?.find(candidate => {
    const candidateId = toId(candidate.species);
    const infoId = toId(info.species);
    return candidateId === infoId ||
      toId(candidate.name || '') === infoId ||
      candidateId === toId(info.species.split('-')[0]) ||
      infoId === toId(candidate.species.split('-')[0]);
  });

  const usageSet = getSpeciesUsageSet(usageStats, info.species);
  const smogonSet = getSpeciesSetAssumption(setAssumptions, info.species);

  if (userMatch) {
    // A full team sheet normally defines the moveset — but a manual edit
    // (team editor, sets import, hypothetical move) must beat the sheet, or
    // "load Draco Meteor on Kyurem" silently vanishes on sheet replays.
    const hasManualMoves = info.moves.some(move => move.source === 'manual');
    const infoMoveNames = info.moves.map(move => move.name);
    const moves = hasManualMoves
      ? mergeMoveLists(userMatch.moves, infoMoveNames)
      : mergeMoveLists(infoMoveNames, userMatch.moves);
    // Open Team Sheets omit EVs/nature — fall back to usage spreads instead of
    // simulating an all-zero spread (B3/B6).
    const fallbackSpread = usageSet?.spread || smogonSet?.spread || null;
    const matchEvs = hasNonZeroEvs(userMatch.evs) ? userMatch.evs : fallbackSpread?.evs || userMatch.evs;
    return {
      ...userMatch,
      moves: moves.length > 0 ? moves : userMatch.moves,
      ability: known(info.ability) || userMatch.ability,
      item: cleanItem(known(info.item), userMatch.item),
      teraType: known(info.teraType) || userMatch.teraType,
      nature: (editedNature || userMatch.nature || fallbackSpread?.nature || 'Hardy') as PokemonSet['nature'],
      evs: editedEvs || matchEvs,
      ivs: editedIvs || userMatch.ivs,
      level: info.level || userMatch.level || 100,
      gender: (info.gender || userMatch.gender || '') as '' | 'M' | 'F',
    };
  }
  const usageMoves = mergeUsageMoves(info.moves.map(move => move.name), usageSet?.moves ?? []);
  const moves = mergeSetMoves(usageMoves, smogonSet?.moves ?? []);
  const spread = usageSet?.spread;
  const setSpread = smogonSet?.spread;

  return {
    name: info.species,
    species: info.species,
    item: cleanItem(info.item.value, usageSet?.item?.value || smogonSet?.item?.value || ''),
    ability: info.ability.value || usageSet?.ability?.value || smogonSet?.ability?.value || defaultAbility(info.species),
    moves: moves.length > 0 ? moves : ['Tackle'],
    nature: (editedNature || spread?.nature || setSpread?.nature || 'Hardy') as PokemonSet['nature'],
    evs: editedEvs || spread?.evs || setSpread?.evs || { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: editedIvs || { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: info.level || 100,
    gender: (info.gender || '') as '' | 'M' | 'F',
    teraType: info.teraType.value || undefined,
  };
}

function hasNonZeroEvs(evs: PokemonSet['evs'] | undefined): boolean {
  return !!evs && Object.values(evs).some(value => (value ?? 0) > 0);
}

function sanitizeEv(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(252, Math.max(0, Math.round(value ?? 0)));
}

function sanitizeEvs(evs: PokemonEvs): PokemonEvs {
  return {
    hp: sanitizeEv(evs.hp),
    atk: sanitizeEv(evs.atk),
    def: sanitizeEv(evs.def),
    spa: sanitizeEv(evs.spa),
    spd: sanitizeEv(evs.spd),
    spe: sanitizeEv(evs.spe),
  };
}

function cleanItem(replayItem: string, fallback: string): string {
  return itemSetValue(replayItem) || fallback;
}

/**
 * A packed set with an empty ability gives the sim Pokémon NO ability at all
 * (custom games skip team validation) — the GPL reconstruction's Uxie died to
 * an Earthquake it should have been immune to. Slot 0 is Showdown's own
 * teambuilder default when nothing better is known.
 */
function defaultAbility(species: string): string {
  return Dex.species.get(species).abilities?.[0] || '';
}

/** `primary` defines the set; `fill` only tops it up to four moves. */
function mergeMoveLists(fill: string[], primary: string[]): string[] {
  const result = [...primary];
  for (const move of fill) {
    if (!result.some(existing => toId(existing) === toId(move))) {
      if (result.length < 4) {
        result.push(move);
      }
    }
  }
  return result.slice(0, 4);
}

function mergeUsageMoves(observed: string[], usageMoves: UsageProbability[]): string[] {
  const result = [...observed];
  for (const move of usageMoves) {
    if (result.length >= 4) break;
    if (!result.some(existing => toId(existing) === toId(move.value))) {
      result.push(move.value);
    }
  }
  return result.slice(0, 4);
}

function mergeSetMoves(observed: string[], setMoves: SetAssumption[]): string[] {
  const result = [...observed];
  for (const move of setMoves) {
    if (result.length >= 4) break;
    if (!result.some(existing => toId(existing) === toId(move.value))) {
      result.push(move.value);
    }
  }
  return result.slice(0, 4);
}

/** Public: the open-team-sheet sets both players posted, if any. */
export function extractTeamSheets(log: string): { p1: PokemonSet[] | null; p2: PokemonSet[] | null } {
  return extractEmbeddedShowteamExports(log);
}

function extractEmbeddedShowteamExports(log: string): { p1: PokemonSet[] | null; p2: PokemonSet[] | null } {
  const playerByName = new Map<string, 'p1' | 'p2'>();
  const fromShowteam: { p1: PokemonSet[] | null; p2: PokemonSet[] | null } = { p1: null, p2: null };
  const fromChat: { p1: PokemonSet[] | null; p2: PokemonSet[] | null } = { p1: null, p2: null };
  const unassigned: PokemonSet[][] = [];

  for (const rawLine of log.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const playerMatch = line.match(/^\|player\|(p[12])\|([^|]+)/);
    if (playerMatch) {
      playerByName.set(toId(playerMatch[2]), playerMatch[1] as 'p1' | 'p2');
      continue;
    }

    // Open Team Sheets: |showteam|p1|<packed team, pipes included> (B3)
    const showteamMatch = line.match(/^\|showteam\|(p[12])\|([\s\S]+)$/);
    if (showteamMatch) {
      const side = showteamMatch[1] as 'p1' | 'p2';
      if (!fromShowteam[side]) {
        const unpacked = Teams.unpack(showteamMatch[2]);
        if (unpacked && unpacked.length > 0) fromShowteam[side] = unpacked;
      }
      continue;
    }

    const chatMatch = line.match(/^\|c\|([^|]+)\|\/raw\s+([\s\S]+)$/);
    if (!chatMatch || !chatMatch[2].includes('<summary>View team</summary>')) continue;

    const imported = Teams.import(showteamHtmlToText(chatMatch[2]));
    if (!imported || imported.length === 0) continue;

    const side = playerByName.get(toId(chatMatch[1]));
    if (side) {
      fromChat[side] = imported;
    } else {
      unassigned.push(imported);
    }
  }

  if (!fromChat.p1 && unassigned[0]) fromChat.p1 = unassigned[0];
  if (!fromChat.p2 && unassigned[1]) fromChat.p2 = unassigned[1];
  return {
    p1: fromShowteam.p1 || fromChat.p1,
    p2: fromShowteam.p2 || fromChat.p2,
  };
}

function showteamHtmlToText(html: string): string {
  const match = html.match(/<summary>View team<\/summary>([\s\S]*?)<\/details>/i);
  const teamHtml = match?.[1] ?? html;
  return decodeHtmlEntities(teamHtml)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => String.fromCharCode(parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCharCode(parseInt(value, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
