import { Move as CalcMove, type Generations } from '@smogon/calc';
import { Dex, toID } from '@pkmn/sim';
import type { CalcBody } from './body.ts';

/**
 * Round 67: the move as the calc must read it for this attacker, the other
 * half of the engine's one builder (calc/body.ts), used by ko-odds.ts,
 * damage-calc.ts and pair/kill-table.ts. The slot "Hidden Power" goes as the
 * type the simulator gives the attacker (hpType), and before gen 6 at the
 * power it gives (hpPower), where the calc reads the bare name as a Normal
 * move of power 60, 0 before gen 6 (T83). A move whose power rule calc 0.11
 * lacks gets the power its own basePowerCallback in the Dex returns on the
 * attacker's facts: Last Respects by the side's fallen (T76;
 * test/calc-sim-inputs.spec.ts holds that the calc prices it at its listed
 * power whatever alliesFainted says, so the set empties once it learns it).
 * A body of a Champions battle uses its moves as the Champions mod defines
 * them: calc 0.11 prices them at Gen 9 values, so a power or type the mod
 * changes goes in as an override, read from the mod's own Dex (round 67
 * merge, decision 30; calc-champions.spec.ts checks every Champions move).
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

/** The slot "Hidden Power" with the attacker's type, and its power before gen 6; any other move as named. */
function typedHiddenPower(gen: CalcGen, name: string, attacker: CalcBody): { name: string; basePower: number | null } {
  if (toID(name) !== 'hiddenpower' || !attacker.hpType) return { name, basePower: null };
  return { name: `Hidden Power ${attacker.hpType}`, basePower: gen.num < 6 && attacker.hpPower ? attacker.hpPower : null };
}

/** The power and type a body's mod gives the move where the calc reads another, from the mod's Dex (loaded with its battle). */
function modOverrides(name: string, attacker: CalcBody, calc: CalcMove): CalcMoveOptions['overrides'] | null {
  const dex = attacker.mod === 'champions' ? Dex.dexes[attacker.mod] : undefined;
  const move = dex?.moves.get(name);
  if (!move?.exists) return null;
  const power = move.category !== 'Status' && !move.basePowerCallback && move.basePower !== calc.bp ? { basePower: move.basePower } : {};
  const type = move.type !== calc.type ? { type: move.type as never } : {};
  return Object.keys(power).length + Object.keys(type).length > 0 ? { ...power, ...type } : null;
}

export function calcMove(gen: CalcGen, name: string, attacker: CalcBody, options: CalcMoveOptions = {}): CalcMove {
  const typed = typedHiddenPower(gen, name, attacker);
  const basePower = typed.basePower ?? powerAtUse(gen, name, attacker);
  const move = new CalcMove(gen, typed.name, basePower === null ? options : { ...options, overrides: { ...options.overrides, basePower } });
  const changed = basePower === null ? modOverrides(typed.name, attacker, move) : null;
  return changed ? new CalcMove(gen, typed.name, { ...options, overrides: { ...options.overrides, ...changed } }) : move;
}
