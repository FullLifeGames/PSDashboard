import type { OpponentTeamInfo, PokemonEvs } from '../types';
import { EMPTY_EVS, itemSetValue, manualEvs, manualField, manualMove } from './team-info';
import { toId } from './ids';

/**
 * Lightweight Showdown-export parser for pasted teams (G15). Deliberately
 * dependency-free: @pkmn/sim stays out of the main bundle — the sim gets the
 * raw paste separately when a branch starts.
 */
export interface PastedSet {
  species: string;
  nickname?: string;
  item?: string;
  ability?: string;
  teraType?: string;
  evs?: PokemonEvs;
  nature?: string;
  ivs?: PokemonEvs;
  level?: number;
  moves: string[];
}

const STAT_KEYS: Record<string, keyof PokemonEvs> = {
  hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe',
};

function parseEvLine(line: string): PokemonEvs | undefined {
  const evs: PokemonEvs = { ...EMPTY_EVS };
  let any = false;
  for (const part of line.replace(/^EVs:/i, '').split('/')) {
    const match = part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
    if (!match) continue;
    const key = STAT_KEYS[match[2].toLowerCase()];
    if (!key) continue;
    evs[key] = Math.min(252, Math.max(0, parseInt(match[1], 10)));
    any = true;
  }
  return any ? evs : undefined;
}

function parseIvLine(line: string): PokemonEvs | undefined {
  const ivs: PokemonEvs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  let any = false;
  for (const part of line.replace(/^IVs:/i, '').split('/')) {
    const match = part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
    if (!match) continue;
    const key = STAT_KEYS[match[2].toLowerCase()];
    if (!key) continue;
    ivs[key] = Math.min(31, Math.max(0, parseInt(match[1], 10)));
    any = true;
  }
  return any ? ivs : undefined;
}

function parseHeader(header: string): { species: string; nickname?: string; item?: string } | null {
  const [nameSide, itemSide] = header.split('@').map(part => part.trim());
  if (!nameSide) return null;

  let working = nameSide.replace(/\s*\((M|F)\)\s*$/i, '').trim();
  let nickname: string | undefined;
  const nickMatch = working.match(/^(.*)\(([^()]+)\)\s*$/);
  if (nickMatch) {
    nickname = nickMatch[1].trim() || undefined;
    working = nickMatch[2].trim();
  }
  if (!working) return null;

  return { species: working, nickname, item: itemSide ? itemSetValue(itemSide) || undefined : undefined };
}

export function parsePastedTeam(teamText: string): PastedSet[] {
  const sets: PastedSet[] = [];
  const blocks = teamText.replace(/\r/g, '').split(/\n\s*\n+/);

  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const moves = lines
      .filter(line => line.startsWith('- '))
      .map(line => line.slice(2).trim())
      .filter(Boolean);
    // A recognizable set needs a header plus at least one move line — this is
    // what rejects garbage like "asdf asdf" (G15).
    if (moves.length === 0) continue;

    const header = parseHeader(lines[0]);
    if (!header) continue;

    const abilityLine = lines.find(line => /^Ability:/i.test(line));
    const teraLine = lines.find(line => /^Tera Type:/i.test(line));
    const evLine = lines.find(line => /^EVs:/i.test(line));
    const natureLine = lines.find(line => /^[A-Za-z]+\s+Nature$/i.test(line));
    const ivLine = lines.find(line => /^IVs:/i.test(line));
    const levelLine = lines.find(line => /^Level:\s*\d+$/i.test(line));

    sets.push({
      ...header,
      ability: abilityLine?.replace(/^Ability:/i, '').trim() || undefined,
      teraType: teraLine?.replace(/^Tera Type:/i, '').trim() || undefined,
      evs: evLine ? parseEvLine(evLine) : undefined,
      nature: natureLine?.replace(/\s+Nature$/i, '').trim() || undefined,
      ivs: ivLine ? parseIvLine(ivLine) : undefined,
      level: levelLine ? parseInt(levelLine.replace(/^Level:/i, '').trim(), 10) : undefined,
      moves: moves.slice(0, 4),
    });
  }

  return sets;
}

/**
 * Overlays a pasted team onto the revealed/guessed team info so the stats
 * panel shows the paste as green "manual" knowledge (G15).
 */
export function applyPastedTeam(
  info: OpponentTeamInfo,
  sets: PastedSet[],
): { info: OpponentTeamInfo; matched: number } {
  const byId = new Map<string, PastedSet>();
  for (const set of sets) {
    byId.set(toId(set.species), set);
    byId.set(toId(set.species.split('-')[0]), set);
  }

  let matched = 0;
  const pokemon = info.pokemon.map(entry => {
    const set = byId.get(toId(entry.species)) ?? byId.get(toId(entry.species.split('-')[0]));
    if (!set) return entry;
    matched += 1;
    return {
      ...entry,
      moves: set.moves.map(manualMove),
      ability: set.ability ? manualField(set.ability) : entry.ability,
      item: set.item ? manualField(set.item) : entry.item,
      teraType: set.teraType ? manualField(set.teraType) : entry.teraType,
      evs: set.evs ? manualEvs(set.evs) : entry.evs,
      nature: set.nature ? manualField(set.nature) : entry.nature,
      ivs: set.ivs ? manualEvs(set.ivs) : entry.ivs,
      level: set.level ?? entry.level,
    };
  });

  return { info: { pokemon }, matched };
}

export function countMatchingSpecies(info: OpponentTeamInfo | null, sets: PastedSet[]): number {
  if (!info) return 0;
  const teamIds = new Set(info.pokemon.flatMap(entry => [toId(entry.species), toId(entry.species.split('-')[0])]));
  return sets.filter(set => teamIds.has(toId(set.species)) || teamIds.has(toId(set.species.split('-')[0]))).length;
}
