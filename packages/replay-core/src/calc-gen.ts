import { Generations } from '@smogon/calc';
import { isChampionsFormat } from './champions-format.ts';

/** The one place that decides which @smogon/calc generation prices a battle; the only caller of `Generations.get(`. */

/** A @smogon/calc generation; its `num` is not the simulator's generation (`simGenNum` maps it). */
export type CalcGeneration = ReturnType<typeof Generations.get>;
type CalcGenerationNum = Parameters<typeof Generations.get>[0];

/** The Champions mod's id, as the simulator's `Dex.currentMod` names it. */
export const CHAMPIONS_MOD = 'champions';

const CLASSIC_GEN = 9;
let championsGen: CalcGeneration | undefined;

function championsCalcGeneration(): CalcGeneration {
  championsGen ??= Generations.get(0 as CalcGenerationNum);
  return championsGen;
}

/** The calculator generation of a battle of game generation `gen` under `mod`; `gen` 0 names the Champions one. */
export function calcGenerationFor(gen: number, mod?: string): CalcGeneration {
  if (mod === CHAMPIONS_MOD || gen === 0) return championsCalcGeneration();
  return Generations.get(Math.min(9, Math.max(1, gen)) as CalcGenerationNum);
}

/** The mod of a format id or tier name ('champions' for the Pokémon Champions formats). */
export function calcModOf(formatid: string): typeof CHAMPIONS_MOD | undefined {
  return isChampionsFormat(formatid) ? CHAMPIONS_MOD : undefined;
}

/** The simulator's generation behind a calculator generation: the Champions generation 0 plays on Gen 9's rules. */
export function simGenNum(gen: CalcGeneration): number {
  return (gen.num as number) === 0 ? CLASSIC_GEN : gen.num;
}
