import { Pokemon as CalcPokemon } from '@smogon/calc';
import { calcGenerationFor, type CalcGeneration } from './calc-gen.ts';
import { rulesDex } from './rules-dex.ts';
import { toId } from './ids.ts';


/** The species rows the builder reads of a Dex, the Champions mod's where it is loaded. */
export interface SpeciesDex {
  currentMod?: string;
  species: { get(name: string): SpeciesRow };
}

interface SpeciesRow {
  exists: boolean;
  name: string;
  baseSpecies: string;
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  types: readonly string[];
  weightkg: number;
  nfe?: boolean;
  gender?: string;
  abilities: { 0: string };
}

/** The options of the @smogon/calc Pokemon constructor. */
export type CalcPokemonOptions = NonNullable<ConstructorParameters<typeof CalcPokemon>[2]>;

const calcGenId = (calc: CalcGeneration): number => calc.num;

function defaultDex(calc: CalcGeneration): SpeciesDex {
  return rulesDex(calc.num as number) as unknown as SpeciesDex;
}

const speciesMemo = new Map<string, string>();

/** The name the calculator lists for a species: an equal-valued form of the same base species when it lacks it. */
export function calcSpecies(gen: number, name: string, dex?: SpeciesDex): string {
  const calc = calcGenerationFor(gen);
  const source = dex ?? defaultDex(calc);
  const key = `${gen}|${source.currentMod ?? ''}|${name}`;
  let known = speciesMemo.get(key);
  if (known === undefined) {
    known = knownForm(calc, name, source);
    speciesMemo.set(key, known);
  }
  return known;
}

// The calculator's Champions generation 0 lacks 35 species the mod allows (Aegislash, Vivillon, Alcremie, Tera forms).
function knownForm(calc: CalcGeneration, name: string, dex: SpeciesDex): string {
  if (calc.species.get(toId(name) as never)) return name;
  const species = dex.species.get(name);
  if (!species.exists) return name;
  const stats = Object.values(species.baseStats).join('/');
  const types = species.types.join('/');
  const forms = [...calc.species].filter(form => dex.species.get(form.name).baseSpecies === species.baseSpecies &&
    Object.values(form.baseStats).join('/') === stats && form.types.join('/') === types);
  return (forms.find(form => form.name === species.baseSpecies) ?? forms[0])?.name ?? name;
}

const overridesMemo = new Map<string, CalcPokemonOptions['overrides'] | null>();

/** The overrides that make the calculator build a species it lacks or lists with other values; undefined when none. */
export function speciesOverrides(gen: CalcGeneration, name: string, dex?: SpeciesDex): CalcPokemonOptions['overrides'] | undefined {
  const source = dex ?? defaultDex(gen);
  const key = `${calcGenId(gen)}|${source.currentMod ?? ''}|${name}`;
  let overrides = overridesMemo.get(key);
  if (overrides === undefined) {
    overrides = dexOverrides(gen, name, source) ?? null;
    overridesMemo.set(key, overrides);
  }
  return overrides ?? undefined;
}

function dexOverrides(gen: CalcGeneration, name: string, dex: SpeciesDex): CalcPokemonOptions['overrides'] | undefined {
  const species = dex.species.get(name);
  if (!species.exists) return undefined;
  const listed = gen.species.get(toId(name) as never);
  // The Dex wins where the calculator lists other base stats or types (Obliteryx: Special Defense 78 vs 90).
  if (listed) {
    const stats = Object.keys(species.baseStats) as (keyof SpeciesRow['baseStats'])[];
    const same = stats.every(stat => listed.baseStats[stat] === species.baseStats[stat]) && listed.types.join('/') === species.types.join('/');
    return same ? undefined : { types: species.types as never, baseStats: species.baseStats };
  }
  return {
    name: species.name as never,
    types: species.types as never,
    baseStats: species.baseStats,
    weightkg: species.weightkg,
    ...(species.nfe ? { nfe: true } : {}),
    ...(species.gender ? { gender: species.gender as never } : {}),
    abilities: { 0: species.abilities[0] } as never,
  };
}

/** A calculator Pokémon of any species the Dex knows; the caller's overrides win over the species'. */
export function buildCalcPokemon(gen: CalcGeneration, species: string, options: CalcPokemonOptions = {}, dex?: SpeciesDex): CalcPokemon {
  const known = calcSpecies(calcGenId(gen), species, dex);
  const overrides = speciesOverrides(gen, known, dex);
  return new CalcPokemon(gen, known, overrides ? { ...options, overrides: { ...overrides, ...options.overrides } } : options);
}

/** The species' base stats as the calculator builds them; undefined for a species neither knows. */
export function calcBaseStats(gen: CalcGeneration, species: string, dex?: SpeciesDex): SpeciesRow['baseStats'] | undefined {
  const known = calcSpecies(calcGenId(gen), species, dex);
  return speciesOverrides(gen, known, dex)?.baseStats ?? gen.species.get(toId(known) as never)?.baseStats;
}

/** Whether the calculator lists the move; an unlisted one (Pound in Champions) builds as a 0-damage Status move. */
export function calcKnowsMove(gen: CalcGeneration, name: string): boolean {
  return !!gen.moves.get(toId(name) as never);
}
