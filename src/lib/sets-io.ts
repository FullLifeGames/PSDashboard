import {
  type OpponentTeamInfo, type PokemonEvs, type RevealedPokemonInfo, itemSetValue, parsePastedTeam, typedHiddenPowerId,
  type PastedSet, applyPastedTeam, countMatchingSpecies, toId,
} from '@fulllifegames/replay-core';
import { EV_STATS, canonicalMove, type EditorPools } from './team-editor';

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

/** What the validator needs of a game: its generation and the editor's legal pools (`null` until they load). */
export interface ImportGame { gen: number; pools: EditorPools | null }

/**
 * The editor's pools for the species of a game, loaded lazily (the move pools read learnsets). The same pools the team editor
 * offers (`useEditorPools` in useTeamDraft.ts), so the import and the editor accept the same values.
 */
export async function loadImportPools(speciesList: string[], gen: number, format: string): Promise<EditorPools> {
  const options = await import('./pokemon-options');
  await options.prepareFormat(format);
  const movesBySpecies: Record<string, string[]> = {};
  const abilitiesBySpecies: Record<string, string[]> = {};
  await Promise.all([...new Set(speciesList)].map(async species => {
    movesBySpecies[species] = await options.getMovePool(species, gen, format);
    abilitiesBySpecies[species] = options.getAbilityPool(species, gen, format);
  }));
  return {
    items: options.getItemPool(gen, format),
    teraTypes: options.getTeraTypePool(gen, format),
    natures: options.NATURES,
    movesBySpecies,
    abilitiesBySpecies,
    evLimit: options.getEvLimit(format),
  };
}

type SideId = 'p1' | 'p2';

/**
 * What an import cannot apply, one message per value (empty: the text is fine). The import is all or nothing: the caller applies
 * nothing while this list is not empty, as the team editor refuses a move outside the species' pool. Only values that differ
 * from what the panel already holds are checked, so the export of the panel itself always imports (a swapped ability, a move
 * copied by Transform, an item of a custom game stay as they are). The pool checks wait until the pools load (`pools: null`),
 * as the editor stays free text until then. `shown` is the view the export reads (the stats panel's solved sets, round 70
 * T205): a value it holds counts as held too (round 77: a guessed Head Smash of Champions VGC 2695803506).
 */
export function validateSetsImport(
  parsed: { p1: PastedSet[]; p2: PastedSet[] },
  current: { p1: OpponentTeamInfo; p2: OpponentTeamInfo },
  game: ImportGame,
  shown?: { p1: OpponentTeamInfo | null; p2: OpponentTeamInfo | null },
): string[] {
  const errors: string[] = [];
  for (const side of ['p1', 'p2'] as SideId[]) {
    const label = side.toUpperCase();
    const info = current[side];
    for (const set of parsed[side]) {
      if (countMatchingSpecies(info, [set]) === 0) errors.push(`${label} ${set.species}: not on ${label}'s team, so its set cannot apply.`);
    }
    if (parsed[side].length === 0) continue;
    const applied = applyPastedTeam(info, parsed[side]).info;
    applied.pokemon.forEach((after, index) => {
      const before = info.pokemon[index];
      if (after === before) return;
      const shownBefore = shown?.[side]?.pokemon.find(pokemon => toId(pokemon.species) === toId(before.species));
      errors.push(...changedValueErrors(`${label} ${after.species}`, shownBefore ? [before, shownBefore] : [before], after, game));
    });
  }
  return errors;
}

const changed = (before: string, after: string) => !!after && toId(before) !== toId(after);
const listed = (pool: readonly string[], value: string) => pool.some(name => toId(name) === toId(value));

type ValueCheck = (who: string, before: RevealedPokemonInfo, after: RevealedPokemonInfo, game: ImportGame & { pools: EditorPools }) => string[];

const moveErrors: ValueCheck = (who, before, after, { pools }) => {
  const held = new Set(before.moves.map(move => toId(move.name)));
  return after.moves
    .filter(move => !held.has(toId(move.name)) && 'illegal' in canonicalMove(pools.movesBySpecies[after.species], move.name))
    .map(move => `${who}: ${move.name} is not in ${after.species}'s legal moves for this generation.`);
};

const abilityErrors: ValueCheck = (who, before, after, { gen, pools }) => {
  const value = after.ability.value;
  if (!changed(before.ability.value, value)) return [];
  if (gen < 3) return [`${who}: generation ${gen} has no abilities, so ${value} cannot apply.`];
  const pool = pools.abilitiesBySpecies[after.species] ?? [];
  return pool.length > 0 && !listed(pool, value) ? [`${who}: ${value} is not an ability of ${after.species}.`] : [];
};

const itemErrors: ValueCheck = (who, before, after, { gen, pools }) => {
  const value = after.item.value;
  if (!changed(itemSetValue(before.item.value), value)) return [];
  if (gen < 2) return [`${who}: generation ${gen} has no held items, so ${value} cannot apply.`];
  return pools.items.length > 0 && !listed(pools.items, value) ? [`${who}: "${value}" is not a known item.`] : [];
};

const natureErrors: ValueCheck = (who, before, after, { pools }) => {
  const value = after.nature?.value ?? '';
  return changed(before.nature?.value ?? '', value) && !listed(pools.natures, value) ? [`${who}: ${value} is not a nature.`] : [];
};

const teraErrors: ValueCheck = (who, before, after, { pools }) => {
  const value = after.teraType.value;
  if (!changed(before.teraType.value, value)) return [];
  if (pools.teraTypes.length === 0) return [`${who}: this game has no Tera types, so ${value} cannot apply.`];
  return listed(pools.teraTypes, value) ? [] : [`${who}: ${value} is not a Tera type.`];
};

/** The value checks of one Pokémon, over the values the import changed against every view the panel holds of it. */
function changedValueErrors(who: string, befores: RevealedPokemonInfo[], after: RevealedPokemonInfo, game: ImportGame): string[] {
  const { pools } = game;
  if (!pools) return [];
  const against = (before: RevealedPokemonInfo) =>
    [moveErrors, abilityErrors, itemErrors, natureErrors, teraErrors].flatMap(check => check(who, before, after, { ...game, pools }));
  return befores.map(against).reduce((kept, next) => kept.filter(message => next.includes(message)));
}
