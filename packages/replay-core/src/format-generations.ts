import { Generations } from '@pkmn/data';
import { calcModOf } from './calc-gen.ts';
import { dataDex } from './rules-dex.ts';


/** The Dex a Generations is built on (the simulator's modded Dex counts). */
export type LegalDex = ConstructorParameters<typeof Generations>[0];

/** 'logged': every entry the Dex knows (what a log shows); 'legal': what a registered Champions mod allows. */
export type GenerationsScope = 'logged' | 'legal';

const standardGenerations = new Generations(dataDex());

type Known = Parameters<NonNullable<ConstructorParameters<typeof Generations>[1]>>[0];

const known = (row: Known): boolean => !!row.exists && !(row.kind === 'Ability' && row.id === 'noability');

// The modded Dex answers `forGen` with the plain Dex of that generation; the pools need the mod itself.
const pinnedTo = (mod: LegalDex): LegalDex => Object.assign(Object.create(mod as object) as LegalDex, { forGen: () => mod });

// The mod's legality without the tier filter: Meloetta-Pirouette is Illegal in the tier list and legal in the format.
const legalRow = (row: Known): boolean => known(row) && !('isNonstandard' in row && row.isNonstandard);

let loggedChampions: Generations | undefined;
const legalChampions = new WeakMap<object, Generations>();

/** The Generations of `format` (a format id or tier name); 'legal' without `mod` reads as 'logged'. */
export function generationsFor(format: string, scope: GenerationsScope = 'logged', mod?: LegalDex): Generations {
  if (!calcModOf(format)) return standardGenerations;
  if (scope === 'legal' && mod) {
    let legal = legalChampions.get(mod);
    if (!legal) legalChampions.set(mod, legal = new Generations(pinnedTo(mod), legalRow));
    return legal;
  }
  return loggedChampions ??= new Generations(dataDex(), known);
}
