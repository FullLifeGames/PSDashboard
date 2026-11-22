import type { GenerationNum } from '@pkmn/data';
import { RuleTable, TeamValidator, type PokemonSet, type Species } from '@pkmn/sim';
import { CHAMPIONS_MOD, evBudget, generationsFor, rulesDex, simFormats, toId } from '@fulllifegames/replay-core';

/**
 * Legal option pools for dropdowns. Heavy dex/learnset data — this module is
 * only ever loaded via dynamic import() so it stays out of the entry chunk.
 */
// Round 75 (T160): the standard Generations of replay-core (a format-less lookup); Pokémon Champions reads the mod's Dex below.
const gens = generationsFor('');
const movePoolCache = new Map<string, Promise<string[]>>();

export const NATURES: readonly string[] = [
  'Adamant', 'Bashful', 'Bold', 'Brave', 'Calm', 'Careful', 'Docile', 'Gentle', 'Hardy',
  'Hasty', 'Impish', 'Jolly', 'Lax', 'Lonely', 'Mild', 'Modest', 'Naive', 'Naughty',
  'Quiet', 'Quirky', 'Rash', 'Relaxed', 'Sassy', 'Serious', 'Timid',
];

/**
 * Pokémon Champions plays on a simulator mod whose dex the generation
 * wrapper cannot read (it keeps 876 of 1517 species and no Mega Stone, and
 * loses Aegislash), so its pools come from the mod itself.
 */
const isChampions = (format: string | undefined): boolean => !!format && evBudget(format).statPoints;
const championsDex = () => rulesDex(9, CHAMPIONS_MOD);

/** Loads what a format's pools read before the first pool is asked (the Champions mod, nothing else). */
export async function prepareFormat(format: string): Promise<void> {
  if (!isChampions(format)) return;
  const { loadSimMods } = await import('./lazy/branch-engine');
  await loadSimMods(format);
}

/** A listed format of the Champions mod, whose rule table carries the mod's total EV limit for the formats it does not list. */
const CHAMPIONS_REFERENCE_FORMAT = 'gen9championsou';

/**
 * The total EV limit the simulator's team validator enforces in a format
 * (`null`: none, or the format is unknown). The Champions mod lists only some
 * formats; a Champions id it does not list (an earlier regulation, another
 * tier) takes the limit of the mod's reference format, which the rule table
 * sets for the whole mod, and without that format the Stat Points total of
 * replay-core's evBudget.
 */
export function getEvLimit(format: string): number | null {
  const table = (id: string) => {
    const entry = simFormats().get(id);
    return entry.exists ? simFormats().getRuleTable(entry) : null;
  };
  const own = table(format.split('@@@')[0]);
  if (own) return own.evLimit;
  if (!isChampions(format)) return null;
  return table(CHAMPIONS_REFERENCE_FORMAT)?.evLimit ?? evBudget(format).total;
}

const toSimId = (name: string): string => toId(name);

type PoolKind = 'items' | 'moves' | 'abilities';

/**
 * Who reads a pool: the editor's lists or the sets import. They differ only for a format id the simulator does not list (round 88,
 * gate of 08.11.2026): the editor lists the generation's standard pool, the import accepts what the generation's Custom Game plays.
 * Round 89 (#150, ruling 37): the editor's typed names read the import's pool too (`EditorPools.playedMoves`), and a Past species gets
 * its pool from the simulator (`standingSpecies`).
 */
export type PoolUse = 'editor' | 'import';

/**
 * Round 88 (#102): the entries a format's simulator lets exist beyond the generation's standard pool. A listed format
 * answers by its own rule table (an entry exists unless a rule such as `-Nonexistent` removes it: a Custom Game has none, so
 * it plays every Past, Future, Unobtainable, CAP, Legends and LGPE entry; Standard pulls `Obtainable` in and refuses them;
 * National Dex lifts what its rule table names). An id the simulator does not list (a draft league's, and every Scarlet/Violet
 * VGC regulation but 2024 Reg G and 2025 Reg I in @pkmn/sim 0.10.15) adds nothing to the editor's lists, and the import reads it
 * as the Custom Game of its generation (`PoolUse`). The simulator's own TeamValidator decides, in two steps. First its checks on a copy of the rule table that
 * keeps only the existence rules (the bans of single items, moves and abilities and the tier rules are no question of existence:
 * the app lists a banned entry). Then, in a format that refuses existence at all, the validator's own verdict on a one-entry set,
 * because a rule of the format can refine the table (National Dex's `NatDex Mod` lifts `+Past` and still refuses a Past item and
 * the Unobtainable moves of the current generation in its `onValidateSet`). A call without a format keeps the standard pools, and
 * Champions reads its mod (the callers branch before).
 */
const existenceCache = new Map<string, Record<PoolKind, string[]>>();

type Standing = { exists: boolean; isNonstandard?: string | null; name: string };

/** What the validator says of an entry that does not exist in the game (its wording: "does not exist in Gen 9", "not obtainable without hacking", ...). */
const NOT_EXISTING = /does not exist|not obtainable|Smogon CAP|Let's Go|placeholder for/;

/**
 * The simulator format whose rules decide what a battle plays: the format itself when the simulator lists it, else (a draft
 * league's id) the Custom Game of its generation or mod, as the rebuild plays it (`getBranchSimulatorFormat`).
 */
function battleFormat(gen: GenerationNum, format: string): string {
  const own = simFormats().get(format.split('@@@')[0]);
  if (own.exists) return own.id;
  return isChampions(format) ? 'gen9championscustomgame' : `gen${gen}customgame`;
}

/** The simulator format whose existence rules a pool reads (`null`: the standard pool alone). */
function existenceFormat(gen: GenerationNum, format: string | undefined, use: PoolUse): string | null {
  if (!format || isChampions(format)) return null;
  const own = simFormats().get(format.split('@@@')[0]);
  if (own.exists) return own.id;
  return use === 'import' ? battleFormat(gen, format) : null;
}

/** The existence rules of a format's rule table, as a validator that asks nothing else (`tags`: the entries' `isNonstandard` tags). */
function existenceJudge(validator: TeamValidator, tags: Set<string>): { judge: TeamValidator; refusesExistence: boolean } {
  const existenceRules = new RuleTable();
  for (const [rule, source] of validator.ruleTable) {
    const name = /^[+\-*](.+)$/.exec(rule)?.[1];
    if (name === 'nonexistent' || (name?.startsWith('tag:') && tags.has(name.slice(4)))) existenceRules.set(rule, source);
  }
  existenceRules.getTagRules();
  // A format without any existence rule refuses nothing of the sort, and its onValidateSet hooks are not asked.
  const refusesExistence = existenceRules.size > 0 && [...existenceRules.keys()].some(rule => rule.startsWith('-'));
  return { judge: Object.assign(Object.create(validator) as TeamValidator, { ruleTable: existenceRules }), refusesExistence };
}

/** Whether the format itself refuses the entry as non-existent: the validator's own verdict on a one-entry set (National Dex's `onValidateSet`). */
function refusedByFormat(validator: TeamValidator, gen: GenerationNum, entry: Partial<PokemonSet>, name: string): boolean {
  const probe = { name: 'T', species: 'Pikachu', item: '', ability: gen >= 3 ? 'Static' : '', moves: ['Thunderbolt'], evs: {}, ivs: {}, ...entry } as PokemonSet;
  try {
    return !!validator.validateSet(probe, {})?.some(problem => problem.includes(name) && NOT_EXISTING.test(problem));
  } catch {
    return false;
  }
}

function existingBeyondStandard(gen: GenerationNum, format: string | undefined, use: PoolUse): Record<PoolKind, string[]> | null {
  const id = existenceFormat(gen, format, use);
  if (!id) return null;
  const key = `${gen}:${id}`;
  const cached = existenceCache.get(key);
  if (cached) return cached;

  const dex = rulesDex(gen);
  const lists: Record<PoolKind, Standing[]> = { items: [...dex.items.all()], moves: [...dex.moves.all()], abilities: [...dex.abilities.all()] };
  const standing = (thing: Standing) => thing.exists && !!thing.isNonstandard;
  const tags = new Set(Object.values(lists).flat().filter(standing).map(thing => toId(thing.isNonstandard ?? '')));
  const validator = new TeamValidator(id);
  const { judge, refusesExistence } = existenceJudge(validator, tags);
  const set = { name: '' } as PokemonSet;
  const refused = (kind: PoolKind, thing: Standing): boolean =>
    refusesExistence && refusedByFormat(validator, gen, kind === 'items' ? { item: thing.name } : kind === 'moves' ? { moves: [thing.name] } : { ability: thing.name }, thing.name);
  const names = (kind: PoolKind, refusal: (thing: never) => string | null | undefined): string[] =>
    lists[kind].filter(thing => standing(thing) && !refusal(thing as never) && !refused(kind, thing)).map(thing => thing.name);
  const result: Record<PoolKind, string[]> = {
    items: gen < 2 ? [] : names('items', thing => judge.checkItem(set, thing, {})),
    moves: names('moves', thing => judge.checkMove(set, thing, {})),
    abilities: gen < 3 ? [] : names('abilities', thing => judge.checkAbility(set, thing, {})),
  };
  existenceCache.set(key, result);
  return result;
}

const withExisting = (standard: string[], extra: string[] | undefined): string[] =>
  (extra?.length ? [...standard, ...extra] : standard).sort((a, b) => a.localeCompare(b));

/**
 * Round 89 (#150): a species the generation's standard Dex hides (an `isNonstandard` tag: Past, Future, CAP, LGPE, Custom) that
 * the battle's format plays. replay-core's Generations drop such a species, so its standard pool is empty (Dracovish and Zygarde
 * are Past in Generation 9: no Fishious Rend, no Thousand Arrows, no abilities). The battle's own rules answer instead: the
 * simulator's TeamValidator on the format's existence rules (an id it does not list plays as the Custom Game, `battleFormat`),
 * the species' pool from the simulator (`species.getMovePool(id, natDex)`, National Dex when the format plays Past species)
 * and its abilities from the Dex entry of the battle's generation or mod.
 */
type RulesDex = ReturnType<typeof rulesDex>;
interface StandingSpecies { dex: RulesDex; entry: Species; format: string; natDex: boolean }
const speciesJudges = new Map<string, { validator: TeamValidator; judge: TeamValidator; refusesExistence: boolean; gen: GenerationNum }>();
const speciesVerdicts = new Map<string, boolean>();

function playsSpecies(gen: GenerationNum, dex: RulesDex, formatId: string, entry: Species): boolean {
  const key = `${formatId}:${entry.id}`;
  const known = speciesVerdicts.get(key);
  if (known !== undefined) return known;
  let rules = speciesJudges.get(formatId);
  if (!rules) {
    const validator = new TeamValidator(formatId);
    const tags = new Set([...dex.species.all()].filter(species => species.exists && species.isNonstandard).map(species => toId(species.isNonstandard ?? '')));
    rules = { validator, ...existenceJudge(validator, tags), gen };
    speciesJudges.set(formatId, rules);
  }
  const refusal = rules.judge.checkSpecies({ name: '' } as PokemonSet, entry, entry, {});
  const plays = !refusal && !(rules.refusesExistence && refusedByFormat(rules.validator, gen, { species: entry.name }, entry.name));
  speciesVerdicts.set(key, plays);
  return plays;
}

function standingSpecies(gen: GenerationNum, format: string | undefined, species: string): StandingSpecies | null {
  if (!format) return null;
  const dex = isChampions(format) ? championsDex() : rulesDex(gen);
  const entry = dex.species.get(species);
  if (!entry.exists || !entry.isNonstandard) return null;
  const id = battleFormat(gen, format);
  if (!playsSpecies(gen, dex, id, entry)) return null;
  // National Dex: the format plays Past species at all (the simulator's pool reads it from Generation 9 on).
  const past = [...dex.species.all()].find(candidate => candidate.exists && candidate.isNonstandard === 'Past');
  return { dex, entry, format: id, natDex: !!past && playsSpecies(gen, dex, id, past) };
}

/** The simulator's pool of a standing species, sorted; empty when the simulator teaches it nothing. */
function standingMovePool({ dex, entry, natDex }: StandingSpecies): string[] {
  const moves = [...dex.species.getMovePool(entry.id, natDex)].map(id => dex.moves.get(id)).filter(move => move.exists);
  return moves.map(move => move.name).sort((a, b) => a.localeCompare(b));
}

async function getChampionsMovePool(species: string): Promise<string[]> {
  const dex = championsDex();
  const names = new Set<string>();
  const entry = dex.species.get(species);
  // A forme without a learnset of its own learns what its base forme learns.
  for (const id of new Set([entry.id, toSimId(entry.changesFrom ?? entry.baseSpecies)])) {
    for (const [moveId, sources] of Object.entries((await dex.learnsets.get(id)).learnset ?? {})) {
      if (sources.some(code => code.startsWith('9'))) names.add(dex.moves.get(moveId).name);
    }
    if (names.size > 0) break;
  }
  // Unknown species or no Generation 9 learnset (Past in the mod): offer everything rather than block.
  const pool = names.size > 0 ? [...names] : [...dex.moves.all()].filter(move => !move.isNonstandard).map(move => move.name);
  return pool.sort((a, b) => a.localeCompare(b));
}

function clampGen(gen: number): GenerationNum {
  return Math.min(9, Math.max(1, Math.round(gen))) as GenerationNum;
}

function allGenMoves(gen: GenerationNum): string[] {
  return [...gens.get(gen).moves].map(move => move.name).sort((a, b) => a.localeCompare(b));
}

export function getMovePool(species: string, gen: number, format?: string): Promise<string[]> {
  const generation = gens.get(clampGen(gen));
  const champions = isChampions(format);
  const standing = standingSpecies(generation.num, format, species);
  const cacheKey = `${champions ? 'champions' : generation.num}:${species.toLowerCase()}:${standing?.format ?? ''}`;
  const cached = movePoolCache.get(cacheKey);
  if (cached) return cached;
  if (standing) {
    // A species whose pool the simulator leaves empty offers what the battle plays, as an unknown species does.
    const own = standingMovePool(standing);
    const pool = Promise.resolve(own.length > 0 ? own : getEveryMovePool(generation.num, format, 'import'));
    movePoolCache.set(cacheKey, pool);
    return pool;
  }
  if (champions) {
    const pool = getChampionsMovePool(species);
    movePoolCache.set(cacheKey, pool);
    return pool;
  }

  const request = (async () => {
    const names = new Set<string>();
    const genPrefix = String(generation.num);
    const entry = generation.species.get(species);
    // The library walks prevos and the forme a Pokémon changes from (a forme's
    // own learnset holds only its signature moves: Rotom-Wash, Hydro Pump).
    const learnsets = entry ? generation.learnsets.all(entry) : [];
    for await (const learnset of learnsets) {
      for (const [moveId, sources] of Object.entries(learnset.learnset ?? {})) {
        if (!sources.some(code => code.startsWith(genPrefix))) continue;
        const move = generation.moves.get(moveId);
        if (move) names.add(move.name);
      }
    }
    // Unknown species or missing learnset: offer everything rather than block.
    if (names.size === 0) return allGenMoves(generation.num);
    return [...names].sort((a, b) => a.localeCompare(b));
  })();

  movePoolCache.set(cacheKey, request);
  return request;
}

/**
 * Every move of the generation (Champions: of the mod), sorted: what the editor and the import accept next to a species' own
 * pool. A name outside this list is no move of the game.
 */
export function getEveryMovePool(gen: number, format?: string, use: PoolUse = 'editor'): string[] {
  if (isChampions(format)) {
    return [...championsDex().moves.all()].filter(move => !move.isNonstandard).map(move => move.name).sort((a, b) => a.localeCompare(b));
  }
  const generation = clampGen(gen);
  return withExisting(allGenMoves(generation), existingBeyondStandard(generation, format, use)?.moves);
}

/** Every ability of the generation (Champions: of the mod), sorted; empty before Generation 3, which has no abilities. */
export function getEveryAbilityPool(gen: number, format?: string, use: PoolUse = 'editor'): string[] {
  if (isChampions(format)) {
    return [...championsDex().abilities.all()].filter(ability => !ability.isNonstandard).map(ability => ability.name).sort((a, b) => a.localeCompare(b));
  }
  const generation = gens.get(clampGen(gen));
  if (generation.num < 3) return [];
  return withExisting([...generation.abilities].map(ability => ability.name), existingBeyondStandard(generation.num, format, use)?.abilities);
}

export function getItemPool(gen: number, format?: string, use: PoolUse = 'editor'): string[] {
  if (isChampions(format)) {
    return [...championsDex().items.all()].filter(item => !item.isNonstandard).map(item => item.name).sort((a, b) => a.localeCompare(b));
  }
  const generation = gens.get(clampGen(gen));
  if (generation.num < 2) return [];
  return withExisting([...generation.items].map(item => item.name), existingBeyondStandard(generation.num, format, use)?.items);
}

export function getAbilityPool(species: string, gen: number, format?: string): string[] {
  const abilitiesOf = (entry: { abilities: object }) => Object.values(entry.abilities).filter((name): name is string => !!name);
  if (isChampions(format)) {
    const entry = championsDex().species.get(species);
    return entry.exists ? abilitiesOf(entry) : [];
  }
  const generation = gens.get(clampGen(gen));
  if (generation.num < 3) return [];
  const entry = generation.species.get(species) ?? standingSpecies(generation.num, format, species)?.entry;
  return entry ? abilitiesOf(entry) : [];
}

export function getTeraTypePool(gen: number, format?: string): string[] {
  if (isChampions(format)) return [];
  if (clampGen(gen) < 9) return [];
  const names = [...gens.get(9).types]
    .map(type => type.name)
    .filter(name => name !== '???');
  if (!names.includes('Stellar')) names.push('Stellar');
  return names.sort((a, b) => a.localeCompare(b));
}
