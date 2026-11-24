import {
  type OpponentTeamInfo, type PokemonEvs, type RevealedPokemonInfo, itemSetValue, parsePastedTeam, typedHiddenPowerId,
  type PastedSet, applyPastedTeam, countMatchingSpecies, toId,
} from '@fulllifegames/replay-core';
import { EV_STATS, canonicalMove, type EditorPools } from './team-editor';


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

function headerLine(pokemon: RevealedPokemonInfo): string {
  const gender = pokemon.gender === 'M' || pokemon.gender === 'F' ? ` (${pokemon.gender})` : '';
  const item = itemSetValue(pokemon.item?.value ?? '');
  return `${pokemon.species}${gender}${item ? ` @ ${item}` : ''}`;
}

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
  // The library's import gives a typed Hidden Power that type's own IVs unless the text lists IVs: 31s stay explicit.
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

/** The caller passes the infos the stats panel shows (solved spreads), so an import pins what the build plays. */
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

export interface ImportGame { gen: number; pools: EditorPools | null }

// The team editor's pools; a format id the simulator does not list takes the generation's Custom Game pool (`PoolUse`).
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
    items: options.getItemPool(gen, format, 'import'),
    teraTypes: options.getTeraTypePool(gen, format),
    natures: options.NATURES,
    movesBySpecies,
    abilitiesBySpecies,
    allMoves: options.getEveryMovePool(gen, format, 'import'),
    allAbilities: options.getEveryAbilityPool(gen, format, 'import'),
    evLimit: options.getEvLimit(format),
  };
}

type SideId = 'p1' | 'p2';

// The import is all or nothing. Only values that differ from the panel's are checked, so its own export always imports;
// `shown` is the view the export reads (a value it holds counts as held); `pools: null` skips the pool checks.
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
    .filter(move => !held.has(toId(move.name)) && 'unknown' in canonicalMove(pools.movesBySpecies[after.species], move.name, pools.allMoves))
    .map(move => `${who}: "${move.name}" is not a known move.`);
};

const abilityErrors: ValueCheck = (who, before, after, { gen, pools }) => {
  const value = after.ability.value;
  if (!changed(before.ability.value, value)) return [];
  if (gen < 3) return [`${who}: generation ${gen} has no abilities, so ${value} cannot apply.`];
  return pools.allAbilities.length > 0 && !listed(pools.allAbilities, value) ? [`${who}: "${value}" is not a known ability.`] : [];
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

function changedValueErrors(who: string, befores: RevealedPokemonInfo[], after: RevealedPokemonInfo, game: ImportGame): string[] {
  const { pools } = game;
  if (!pools) return [];
  const against = (before: RevealedPokemonInfo) =>
    [moveErrors, abilityErrors, itemErrors, natureErrors, teraErrors].flatMap(check => check(who, before, after, { ...game, pools }));
  return befores.map(against).reduce((kept, next) => kept.filter(message => next.includes(message)));
}
