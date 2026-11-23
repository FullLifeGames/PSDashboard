import { Generations } from '@pkmn/data';
import { calcModOf } from './calc-gen.ts';
import { dataDex } from './rules-dex.ts';

/** The one place that knows which Generations a format's client battle is built on: the default hides what the Dex marks non-standard, and a Champions log names such species (Absol-Mega-Z is `Past` in the mod and `Future` in the base Dex), so the client would throw on their lines. */

/** The Dex a Generations is built on (the simulator's modded Dex counts). */
export type LegalDex = ConstructorParameters<typeof Generations>[0];

/** 'logged': every species, item, move and ability the Dex knows, whatever its legality (what the log shows); 'legal': exactly what a registered Champions mod allows (the team editor's pools). */
export type GenerationsScope = 'logged' | 'legal';

/** The standard Generations: what the Dex lists as played in a generation. */
const standardGenerations = new Generations(dataDex());

type Known = Parameters<NonNullable<ConstructorParameters<typeof Generations>[1]>>[0];

/** A row the Dex has, legal or not; the Dex marks the "no ability" row as no row. */
const known = (row: Known): boolean => !!row.exists && !(row.kind === 'Ability' && row.id === 'noability');

/** The simulator's modded Dex answers `forGen` with the plain Dex of that generation; the pools need the mod itself. */
const pinnedTo = (mod: LegalDex): LegalDex => Object.assign(Object.create(mod as object) as LegalDex, { forGen: () => mod });

/** A row the mod allows: the mod's own legality, without the default's tier filter (the mod's Meloetta-Pirouette is Illegal in the tier list and legal in the format). */
const legalRow = (row: Known): boolean => known(row) && !('isNonstandard' in row && row.isNonstandard);

let loggedChampions: Generations | undefined;
const legalChampions = new WeakMap<object, Generations>();

/** The Generations of `format` (a format id or the tier name a log prints); the 'legal' scope without `mod`, the registered Champions Dex, reads as 'logged'. */
export function generationsFor(format: string, scope: GenerationsScope = 'logged', mod?: LegalDex): Generations {
  if (!calcModOf(format)) return standardGenerations;
  if (scope === 'legal' && mod) {
    let legal = legalChampions.get(mod);
    if (!legal) legalChampions.set(mod, legal = new Generations(pinnedTo(mod), legalRow));
    return legal;
  }
  return loggedChampions ??= new Generations(dataDex(), known);
}
