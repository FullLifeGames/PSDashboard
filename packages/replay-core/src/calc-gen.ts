import { Generations } from '@smogon/calc';

/**
 * Round 68 (T186, decision 1): the one place that decides which @smogon/calc
 * generation prices a battle, and the one file that calls `Generations.get(`.
 * A battle of the Champions mod is the calculator's own generation 0 (since
 * 0.12); every other battle is its game generation, clamped to 1..9. The
 * calculator's generation number is no longer the simulator's: a reader that
 * wants the simulator's generation (a Dex, a rule that depends on the
 * generation) asks `simGenNum`, never `gen.num`.
 */

export type CalcGeneration = ReturnType<typeof Generations.get>;
type CalcGenerationNum = Parameters<typeof Generations.get>[0];

/** The Champions mod's id, as the simulator's `Dex.currentMod` names it. */
export const CHAMPIONS_MOD = 'champions';

const CLASSIC_GEN = 9;
let championsGen: CalcGeneration | undefined;

/** The calculator's generation for the Champions mod: its own generation 0 (0.12 and later, which the peer ranges require). */
function championsCalcGeneration(): CalcGeneration {
  championsGen ??= Generations.get(0 as CalcGenerationNum);
  return championsGen;
}

/**
 * The calculator generation of a battle of game generation `gen` under `mod` (the simulator's Dex.currentMod).
 * `gen` 0 names the Champions generation itself, as the engine's memo keys do.
 */
export function calcGenerationFor(gen: number, mod?: string): CalcGeneration {
  if (mod === CHAMPIONS_MOD || gen === 0) return championsCalcGeneration();
  return Generations.get(Math.min(9, Math.max(1, gen)) as CalcGenerationNum);
}

/** The mod of a format id, for a host that knows a format and not a battle ('champions' for the Pokémon Champions formats). */
export function calcModOf(formatid: string): typeof CHAMPIONS_MOD | undefined {
  return /champions/.test(formatid) ? CHAMPIONS_MOD : undefined;
}

/** The simulator's generation behind a calculator generation: the Champions generation 0 plays on Gen 9's rules. */
export function simGenNum(gen: CalcGeneration): number {
  // The calculator's types list 1..9 until 0.12 adds the Champions generation.
  return (gen.num as number) === 0 ? CLASSIC_GEN : gen.num;
}
