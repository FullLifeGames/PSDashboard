import { Move as CalcMove, type Generations } from '@smogon/calc';
import { Dex } from '@pkmn/sim';
import type { CalcBody } from './body.ts';

/**
 * Round 67: the move as the calc must read it for this attacker, the other
 * half of the engine's one builder (calc/body.ts), used by ko-odds.ts,
 * damage-calc.ts and pair/kill-table.ts. A move whose power rule calc 0.11
 * lacks gets the power its own basePowerCallback in the Dex returns on the
 * attacker's facts: Last Respects by the side's fallen (T76;
 * test/calc-sim-inputs.spec.ts holds that the calc prices it at its listed
 * power whatever alliesFainted says, so the set empties once it learns it).
 */

type CalcGen = ReturnType<typeof Generations.get>;
type CalcMoveOptions = NonNullable<ConstructorParameters<typeof CalcMove>[2]>;
type PowerCallback = (this: unknown, pokemon: unknown, target: unknown, move: unknown) => unknown;

const CALC_LACKS_POWER = new Set(['lastrespects']);

/** The power the move's own callback gives on the attacker's facts, or null to leave the calc its own. */
function powerAtUse(gen: CalcGen, name: string, attacker: CalcBody): number | null {
  const move = Dex.forGen(gen.num).moves.get(name);
  if (!CALC_LACKS_POWER.has(move.id) || typeof move.basePowerCallback !== 'function') return null;
  try {
    const power = (move.basePowerCallback as unknown as PowerCallback).call(undefined, { side: { totalFainted: attacker.totalFainted ?? 0 } }, null, move);
    return typeof power === 'number' ? power : null;
  } catch {
    return null;
  }
}

export function calcMove(gen: CalcGen, name: string, attacker: CalcBody, options: CalcMoveOptions = {}): CalcMove {
  const basePower = powerAtUse(gen, name, attacker);
  return new CalcMove(gen, name, basePower === null ? options : { ...options, overrides: { ...options.overrides, basePower } });
}
