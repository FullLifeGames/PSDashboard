import { Generations } from '@pkmn/data';
import { calcModOf } from './calc-gen.ts';
import { dataDex } from './rules-dex.ts';

/**
 * Round 69 (T188, decision 33): the one place that knows which Generations a format's client battle is built on.
 * The default Generations hides everything the Dex marks non-standard, and a Champions log names species the mod calls
 * non-standard (Absol-Mega-Z is `Past` in the mod and `Future` in the base Dex), so the client threw "reading 'abilities'"
 * or "'types'" at the move line of a Pressure carrier that targeted one (275 lines in the round-67 capture) and the line
 * was skipped. A log is the truth of what happened: its species exist whatever their legality. Two scopes:
 *  - 'logged' (the default, what the protocol parser and the inference walk read): a Champions format knows every species,
 *    item, move and ability the Dex knows, with the base Dex's data (types, abilities, priority and category of every
 *    Champions species equal the mod's; checked by format-generations.spec.ts against the mod itself).
 *  - 'legal' (the team editor's pools): exactly what a registered Champions mod allows, from the mod's own Dex.
 * Every other format keeps the one shared standard Generations, so nothing outside Champions moves.
 */

/** The Dex a Generations is built on (the simulator's modded Dex counts). */
export type LegalDex = ConstructorParameters<typeof Generations>[0];

export type GenerationsScope = 'logged' | 'legal';

/** The standard Generations: what the Dex lists as played in a generation. */
const standardGenerations = new Generations(dataDex());

type Known = Parameters<NonNullable<ConstructorParameters<typeof Generations>[1]>>[0];

/** A row the Dex has, legal or not (the 'logged' scope); the Dex marks the "no ability" row as no row. */
const known = (row: Known): boolean => !!row.exists && !(row.kind === 'Ability' && row.id === 'noability');

/** The simulator's modded Dex answers `forGen` with the plain Dex of that generation; the pools need the mod itself. */
const pinnedTo = (mod: LegalDex): LegalDex => Object.assign(Object.create(mod as object) as LegalDex, { forGen: () => mod });

/** A row the mod allows: the mod's own legality, without the default's tier filter (the mod's Meloetta-Pirouette is Illegal in the tier list and legal in the format). */
const legalRow = (row: Known): boolean => known(row) && !('isNonstandard' in row && row.isNonstandard);

let loggedChampions: Generations | undefined;
const legalChampions = new WeakMap<object, Generations>();

/**
 * The Generations of `format`, a format id ('gen9championsou') or the tier name a log prints ('[Gen 9 Champions] OU').
 * `mod` is the registered Champions Dex (`Dex.dexes.champions`); the 'legal' scope without it reads as 'logged'.
 */
export function generationsFor(format: string, scope: GenerationsScope = 'logged', mod?: LegalDex): Generations {
  if (!calcModOf(format)) return standardGenerations;
  if (scope === 'legal' && mod) {
    let legal = legalChampions.get(mod);
    if (!legal) legalChampions.set(mod, legal = new Generations(pinnedTo(mod), legalRow));
    return legal;
  }
  return loggedChampions ??= new Generations(dataDex(), known);
}
