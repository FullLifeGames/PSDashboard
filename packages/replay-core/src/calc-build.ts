import { Pokemon as CalcPokemon } from '@smogon/calc';
import { calcGenerationFor, type CalcGeneration } from './calc-gen.ts';
import { rulesDex } from './rules-dex.ts';
import { toId } from './ids.ts';

/**
 * Round 68 (T186, decision 3 with D8): the one place that builds a calculator Pokémon from a species name, for the
 * engine (calc/body.ts), the spread solver (spreads/fit.ts), the item judge (team/item-damage.ts) and the app's picker.
 * The calculator's Champions generation 0 lists 359 species and lacks 35 the mod allows (Aegislash, the Vivillon
 * patterns, the Alcremie flavors, Minior-Meteor, the Ogerpon Tera formes, ...), and it lists no Pound: a name it
 * lacks used to throw (a skipped observation, a Speed of 0, a picker without numbers). Here such a species goes to the
 * calculator as the form it lists with equal values, else as overrides read from the Dex; a move it lacks is told apart
 * by `calcKnowsMove`, because the calculator builds it as a 0-damage Status move that would read as a miss.
 */

/** What the builder reads of a Dex: the species rows. The engine hands the simulator's (the Champions mod's where it is loaded). */
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

export type CalcPokemonOptions = NonNullable<ConstructorParameters<typeof CalcPokemon>[2]>;

/** The calculator generation's own number, the key of a memo (the simulator's generation is `simGenNum`). */
const calcGenId = (calc: CalcGeneration): number => calc.num;

/** The Dex a generation's species come from when the caller names none: the game generation's own (round 75, T160: the Champions generation reads the registered Champions Dex). */
function defaultDex(calc: CalcGeneration): SpeciesDex {
  return rulesDex(calc.num as number) as unknown as SpeciesDex;
}

/** One answer per generation, dex and name. */
const speciesMemo = new Map<string, string>();

/**
 * The species as the calc knows it (round 67, T72). The calc refuses a name it does not list (Gastrodon-East, the
 * simulator's "Aegislash" for the Shield forme, color forms), so such a species goes to it as the form it lists with the
 * same base species in the Dex and the same base stats and types: the base species' own name first, then the calc's
 * order. Without such a form the name stays (`speciesOverrides` then builds it from the Dex).
 */
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

/**
 * The species as overrides, read from the Dex: a species the calculator's generation does not list and no equal-valued form
 * stands in for (Meloetta-Pirouette, Minior-Meteor, the Ogerpon Tera formes, Terapagos-Terastal in Champions' generation 0)
 * goes to the calc as the data the Dex holds, on its own name; the calc builds the stats, types and weight from it.
 * Undefined when the calc lists the name or the Dex does not know it either (the calc refuses as before).
 */
export function speciesOverrides(gen: CalcGeneration, name: string, dex?: SpeciesDex): CalcPokemonOptions['overrides'] | undefined {
  if (gen.species.get(toId(name) as never)) return undefined;
  const species = (dex ?? defaultDex(gen)).species.get(name);
  if (!species.exists) return undefined;
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

/**
 * A calculator Pokémon of any species the Dex knows, whatever the generation lists (the one builder of the four paths).
 * `dex` names the species data (default: the game generation's own Dex); the caller's own overrides win over the species'.
 */
export function buildCalcPokemon(gen: CalcGeneration, species: string, options: CalcPokemonOptions = {}, dex?: SpeciesDex): CalcPokemon {
  const known = calcSpecies(calcGenId(gen), species, dex);
  const overrides = speciesOverrides(gen, known, dex);
  return new CalcPokemon(gen, known, overrides ? { ...options, overrides: { ...overrides, ...options.overrides } } : options);
}

/** The species' base stats as the calculator will build them (a listed form's, else the Dex's through the overrides); undefined for a species neither knows. */
export function calcBaseStats(gen: CalcGeneration, species: string, dex?: SpeciesDex): SpeciesRow['baseStats'] | undefined {
  const known = calcSpecies(calcGenId(gen), species, dex);
  return gen.species.get(toId(known) as never)?.baseStats ?? speciesOverrides(gen, known, dex)?.baseStats;
}

/**
 * Whether the calculator's generation lists the move. A move it lacks (Pound in Champions' generation 0) builds as a
 * typeless 0-damage Status move, so a reader that judges the roll (the spread solver, the item judge) must treat the
 * move as unreadable: no judgment, no miss.
 */
export function calcKnowsMove(gen: CalcGeneration, name: string): boolean {
  return !!gen.moves.get(toId(name) as never);
}
