import { Dex } from '@pkmn/sim';
import { Dex as DataDex } from '@pkmn/dex';
import { CHAMPIONS_MOD, calcModOf, type CalcGeneration } from './calc-gen.ts';
import { genNumOf, toId } from './ids.ts';

// The one place that reads the simulator's global Dex (Gen 9, no Champions mod); `dex/no-global-dex-read` holds it.

/** The Dex of one generation or mod: the type of `Dex.forGen(gen)`, which the registered Champions Dex shares. */
export type RulesDex = ReturnType<typeof Dex.forGen>;

/** The mod a game plays under: the Champions mod, or none. */
export type RulesMod = typeof CHAMPIONS_MOD | undefined;

/** What decides the Dex of a game: its generation and mod (an inferrer state, a legality context). */
export interface GameRules { gen: number; mod: RulesMod }

const NEWEST_GEN = 9;

/** The Dex a game plays by: the Champions Dex for the Champions mod, else generation `gen` clamped to 1..9. */
export function rulesDex(gen: number, mod?: string): RulesDex {
  if (mod === CHAMPIONS_MOD || gen === 0) {
    const champions = Dex.dexes[CHAMPIONS_MOD] as RulesDex | undefined;
    if (!champions) {
      // The hosts await `loadSimMods` before a Champions game; throwing beats a silent answer from Scarlet/Violet.
      throw new Error('The Pokémon Champions mod is not registered on the simulator: await loadSimMods(format) (eval-engine) or register @pkmn/mods/champions before a Champions game is read');
    }
    return champions;
  }
  return Dex.forGen(Math.min(NEWEST_GEN, Math.max(1, gen)));
}

/** The generation and mod a log names: its `|gen|` line (9 without one) and its `|tier|` line. */
export function logRules(log: string): GameRules {
  const gen = Number(/^\|gen\|(\d+)/m.exec(log)?.[1]) || NEWEST_GEN;
  return { gen, mod: calcModOf(/^\|tier\|(.*)$/m.exec(log)?.[1] ?? '') };
}

/** The generation and mod of a format: an id ('gen9championsou'), a replay or branch format, or a logged tier name. */
export function formatRules(format: string): GameRules {
  return { gen: genNumOf(toId(format)), mod: calcModOf(format) };
}

/** The Dex of the first format in the list that names one ('' reads as Generation 9). */
export const dexOfSources = (...formats: (string | undefined)[]): RulesDex => dexOf(formatRules(formats.find(format => !!format) ?? ''));

/** The Dex of the game these rules name: `rulesDex(rules.gen, rules.mod)`. */
export const dexOf = (rules: GameRules): RulesDex => rulesDex(rules.gen, rules.mod);

/** The Dex of a calculator generation: generation 0 reads the Champions Dex, the others their own. */
export const dexOfCalc = (calc: CalcGeneration): RulesDex => rulesDex(calc.num as number);

/** The data-only Dex @pkmn/data's Generations is built on; simulator handlers make the client miss an item's effect. */
export function dataDex(): typeof DataDex {
  return DataDex;
}

/** The simulator's format registry; the hosts register formats, the Champions formats with the mod. */
export function simFormats(): typeof Dex.formats {
  return Dex.formats;
}

/** The Dex of a format object's own mod, as the simulator's Battle constructor builds the rule table from. */
export function dexOfFormat(format: Parameters<typeof Dex.forFormat>[0]): RulesDex {
  return Dex.forFormat(format);
}

/** The data a mod registers (`Dex.mod`'s second argument). */
export type RulesModData = NonNullable<Parameters<typeof Dex.mod>[1]>;
/** The format list a mod registers (`Dex.formats.extend`'s argument). */
export type RulesModFormats = Parameters<typeof Dex.formats.extend>[0];

// The one place that writes the global Dex; call it once per process (a second registration throws "duplicate ID").
/** Registers the Champions mod (its Dex and its formats) on the simulator. */
export function registerChampionsDex(data: RulesModData, formats: RulesModFormats): void {
  Dex.mod(CHAMPIONS_MOD, data);
  Dex.formats.extend(formats);
}

/** The stat ids in the simulator's order (hp, atk, def, spa, spd, spe): the same in every generation and mod. */
export function statIds(): ReturnType<typeof Dex.stats.ids> {
  return Dex.stats.ids();
}
