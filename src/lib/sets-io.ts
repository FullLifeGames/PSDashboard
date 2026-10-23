import {
  type OpponentTeamInfo, type PokemonEvs, type RevealedPokemonInfo, itemSetValue, parsePastedTeam, typedHiddenPowerId,
  type PastedSet,
} from '@fulllifegames/replay-core';
import { EV_STATS } from './team-editor';

/**
 * Text import/export for both players' sets (perfect-information analysis).
 * Plain Showdown export blocks under `=== p1: … ===` / `=== p2: … ===`
 * headers — every block pastes cleanly into Showdown and the whole document
 * round-trips through parseSetsImport. Dependency-free like team-paste.
 */

const ALL_31_IVS: PokemonEvs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

function statLine(prefix: 'EVs' | 'IVs', values: PokemonEvs, defaultValue: number): string | null {
  const parts = EV_STATS
    .filter(stat => values[stat.id] !== defaultValue)
    .map(stat => `${values[stat.id]} ${stat.label}`);
  return parts.length > 0 ? `${prefix}: ${parts.join(' / ')}` : null;
}

function knownValue(field: { value: string } | undefined): string {
  const value = field?.value?.trim() ?? '';
  // "(has item)"-style placeholders are knowledge about knowledge, not sets.
  return value && !value.startsWith('(') ? value : '';
}

/** `Species (M) @ Item` — the export block's first line. */
function headerLine(pokemon: RevealedPokemonInfo): string {
  const gender = pokemon.gender === 'M' || pokemon.gender === 'F' ? ` (${pokemon.gender})` : '';
  const item = itemSetValue(pokemon.item?.value ?? '');
  return `${pokemon.species}${gender}${item ? ` @ ${item}` : ''}`;
}

/** EVs, Nature, IVs — in Showdown's export order, only the known ones. */
function spreadLines(pokemon: RevealedPokemonInfo): string[] {
  const lines: string[] = [];
  if (pokemon.evs && pokemon.evs.source !== 'unknown') {
    const evLine = statLine('EVs', pokemon.evs.value, 0);
    if (evLine) lines.push(evLine);
  }
  const nature = knownValue(pokemon.nature);
  if (nature) lines.push(`${nature} Nature`);
  const known = pokemon.ivs && pokemon.ivs.source !== 'unknown' ? pokemon.ivs.value : null;
  const ivLine = known ? statLine('IVs', known, 31) : null;
  if (ivLine) lines.push(ivLine);
  // Round 76 (T234): the import (the library's) gives a set with a typed Hidden Power that type's own IVs unless the text lists
  // IVs, and the build plays the IVs it has (31 when nothing says otherwise): all 31 stay explicit then.
  else if (typedHiddenPowerId(pokemon.moves.map(move => move.name))) lines.push(statLine('IVs', ALL_31_IVS, 0)!);
  return lines;
}

function exportSet(pokemon: RevealedPokemonInfo): string {
  const lines = [headerLine(pokemon)];

  const ability = knownValue(pokemon.ability);
  if (ability) lines.push(`Ability: ${ability}`);
  if (pokemon.level && pokemon.level !== 100) lines.push(`Level: ${pokemon.level}`);
  const teraType = knownValue(pokemon.teraType);
  if (teraType) lines.push(`Tera Type: ${teraType}`);
  lines.push(...spreadLines(pokemon));
  for (const move of pokemon.moves) lines.push(`- ${move.name}`);

  return lines.join('\n');
}

function exportSide(header: string, info: OpponentTeamInfo | null): string {
  const sets = (info?.pokemon ?? []).map(exportSet).join('\n\n');
  return `${header}\n\n${sets}`.trimEnd();
}

/**
 * Both teams as plain Showdown export blocks under `=== p1: … ===` headers. Every known value is written, and
 * `applyPastedTeam` reads every written value back as the user's own input, ahead of the solver. The caller passes the
 * infos the stats panel shows (round 70, T205): their spreads are the solved ones, so an import pins what the build
 * already plays; the enriched infos hold the guesses and would bring a refuted guess back.
 */
export function buildSetsExport(params: {
  p1Name: string;
  p2Name: string;
  p1Info: OpponentTeamInfo | null;
  p2Info: OpponentTeamInfo | null;
}): string {
  return [
    exportSide(`=== p1: ${params.p1Name} ===`, params.p1Info),
    '',
    exportSide(`=== p2: ${params.p2Name} ===`, params.p2Info),
    '',
  ].join('\n');
}

const SIDE_HEADER = /^===\s*(p[12])\b[^=]*===\s*$/;

/** Splits on `=== p1/p2 ===` headers; each side parses as a normal paste. */
export function parseSetsImport(text: string): { p1: PastedSet[]; p2: PastedSet[] } {
  const result: { p1: PastedSet[]; p2: PastedSet[] } = { p1: [], p2: [] };
  let side: 'p1' | 'p2' | null = null;
  let buffer: string[] = [];
  let sawHeader = false;

  const flush = () => {
    if (side && buffer.length > 0) result[side].push(...parsePastedTeam(buffer.join('\n')));
    buffer = [];
  };

  for (const line of text.replace(/\r/g, '').split('\n')) {
    const header = line.match(SIDE_HEADER);
    if (header) {
      flush();
      side = header[1] as 'p1' | 'p2';
      sawHeader = true;
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (!sawHeader) {
    throw new Error(
      'No side headers found. Start each side with "=== p1: Name ===" or "=== p2: Name ===" so the sets can be assigned to the right player.',
    );
  }
  return result;
}
