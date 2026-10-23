import { Dex } from '@pkmn/sim';
import { Dex as DataDex } from '@pkmn/dex';
import { CHAMPIONS_MOD, calcModOf, type CalcGeneration } from './calc-gen.ts';
import { genNumOf, toId } from './ids.ts';

/**
 * Round 75 (T160, decision D1): the one place that reads the simulator's global Dex. The global Dex is Generation 9 on
 * Scarlet/Violet: it knows neither the type chart of Gen 1 to 5, a species' older base stats and abilities (Clefable's Special
 * Attack is 95 from Gen 7 and 85 before), a move's older power, nor the Pokémon Champions mod (159 moves, 7 abilities, White Herb
 * and three conditions differ). Every read of a rule asks `rulesDex(gen, mod)`, or a battle's own `battle.dex`; the lint rule
 * dex/no-global-dex-read (eslint.dex.mjs) fails any other read of the global Dex in this package's src.
 */

/** The Dex of one generation or mod: the type of `Dex.forGen(gen)`, which the registered Champions Dex shares. */
export type RulesDex = ReturnType<typeof Dex.forGen>;

/** The mod a game plays under: the Champions mod, or none. */
export type RulesMod = typeof CHAMPIONS_MOD | undefined;

/** What decides the Dex of a game: its generation and mod (an inferrer state, a legality context). */
export interface GameRules { gen: number; mod: RulesMod }

const NEWEST_GEN = 9;

/**
 * The Dex a game plays by: the registered Champions Dex for the Champions mod (and the calculator's generation 0), else the
 * Dex of generation `gen` (clamped to 1..9, the generations the simulator knows). The Champions mod loads on demand
 * (eval-engine's loadSimMods, the hosts await it before they read a Champions game): a Champions game without it throws,
 * because Scarlet/Violet would answer silently and wrongly.
 */
export function rulesDex(gen: number, mod?: string): RulesDex {
  if (mod === CHAMPIONS_MOD || gen === 0) {
    const champions = Dex.dexes[CHAMPIONS_MOD] as RulesDex | undefined;
    if (!champions) {
      throw new Error('The Pokémon Champions mod is not registered on the simulator: await loadSimMods(format) (eval-engine) or register @pkmn/mods/champions before a Champions game is read');
    }
    return champions;
  }
  return Dex.forGen(Math.min(NEWEST_GEN, Math.max(1, gen)));
}

/** The generation and mod a log names: its `|gen|` line (9 without one) and its `|tier|` line, as the inferrer state reads them. */
export function logRules(log: string): GameRules {
  const gen = Number(/^\|gen\|(\d+)/m.exec(log)?.[1]) || NEWEST_GEN;
  return { gen, mod: calcModOf(/^\|tier\|(.*)$/m.exec(log)?.[1] ?? '') };
}

/** The generation and mod of a format: an id ('gen9championsou'), a replay or branch format, or the tier name a log prints. */
export function formatRules(format: string): GameRules {
  return { gen: genNumOf(toId(format)), mod: calcModOf(format) };
}

/** The Dex of the first format of the list that names one ('' reads as Generation 9, the format-less default): the sources a set was published or a usage count was made for. */
export const dexOfSources = (...formats: (string | undefined)[]): RulesDex => dexOf(formatRules(formats.find(format => !!format) ?? ''));

/** The Dex of the game these rules name: `rulesDex(rules.gen, rules.mod)`. */
export const dexOf = (rules: GameRules): RulesDex => rulesDex(rules.gen, rules.mod);

/** The Dex of a calculator generation: the Champions generation 0 reads the Champions Dex, the others their own generation. */
export const dexOfCalc = (calc: CalcGeneration): RulesDex => rulesDex(calc.num as number);

/**
 * The data-only Dex that @pkmn/data's Generations, and so @pkmn/client's Battle, is built on. The client reads an item or an
 * ability by the shape of the data package (the simulator's Dex adds the handlers, and the client then misses an item's own
 * effect: Toxic Orb's holder stayed unknown), so the client's Generations take this one. It holds the base data of every
 * generation; the Champions mod enters `generationsFor` as its own Dex ('legal' scope), never through here.
 */
export function dataDex(): typeof DataDex {
  return DataDex;
}

/** The simulator's format registry (ids, names, rule tables). Formats are registered by the hosts, the Champions formats with the mod. */
export function simFormats(): typeof Dex.formats {
  return Dex.formats;
}

/** The stat ids in the simulator's order (hp, atk, def, spa, spd, spe): the same in every generation and mod. */
export function statIds(): ReturnType<typeof Dex.stats.ids> {
  return Dex.stats.ids();
}
