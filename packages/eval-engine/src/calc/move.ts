import { Move as CalcMove } from '@smogon/calc';
import { Dex, toID } from '@pkmn/sim';
import { CHAMPIONS_MOD, simGenNum, type CalcGeneration } from '@fulllifegames/replay-core';
import { simDexOf, type CalcBody } from './body.ts';

export { protectBlocks } from './protect.ts';

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
 * them: the calc's own Champions generation (0) agrees with the mod on every
 * legal damaging move but Pound, which it lacks, so a move the calc lacks or
 * reads at another power, type or category goes in as an override, read from
 * the mod's own Dex (round 68, T186; calc-champions-moves.spec.ts checks every
 * Champions move).
 */

type CalcGen = CalcGeneration;
type CalcMoveOptions = NonNullable<ConstructorParameters<typeof CalcMove>[2]>;
type PowerCallback = (this: unknown, pokemon: unknown, target: unknown, move: unknown) => unknown;

const CALC_LACKS_POWER = new Set(['lastrespects']);

/** The power the move's own callback gives on the attacker's facts, or null to leave the calc its own. */
function powerAtUse(gen: CalcGen, name: string, attacker: CalcBody): number | null {
  const move = simDexOf(gen).moves.get(name);
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
  return { name: `Hidden Power ${attacker.hpType}`, basePower: simGenNum(gen) < 6 && attacker.hpPower ? attacker.hpPower : null };
}

/**
 * What the body's mod gives a move where the calc's data differs or has none (round 68, T186, decision 2): the calc's own
 * Champions generation (0) lists the mod's moves except for Pound, which it lacks, so a move whose power, type or
 * category differs, or which the calc has no data for, goes in with the values of the mod's Dex (loaded with its battle),
 * and the whole row (flags, target) when the calc has none. Negative priority stays out: the calc reads priority only as
 * "greater than zero", which has no damage effect.
 */
function modOverrides(gen: CalcGen, name: string, attacker: CalcBody, calc: CalcMove): CalcMoveOptions['overrides'] | null {
  const move = attacker.mod === CHAMPIONS_MOD ? Dex.dexes[CHAMPIONS_MOD]?.moves.get(name) : undefined;
  if (!move?.exists) return null;
  if (!gen.moves.get(toID(move.name) as never)) {
    return { basePower: move.basePower, type: move.type as never, category: move.category, flags: { ...move.flags } as never, target: move.target as never };
  }
  const power = move.category !== 'Status' && !move.basePowerCallback && move.basePower !== calc.bp ? { basePower: move.basePower } : {};
  const type = move.type !== calc.type ? { type: move.type as never } : {};
  const category = move.category !== calc.category ? { category: move.category } : {};
  return Object.keys(power).length + Object.keys(type).length + Object.keys(category).length > 0 ? { ...power, ...type, ...category } : null;
}

export function calcMove(gen: CalcGen, name: string, attacker: CalcBody, options: CalcMoveOptions = {}): CalcMove {
  const typed = typedHiddenPower(gen, name, attacker);
  const basePower = typed.basePower ?? powerAtUse(gen, name, attacker);
  const move = new CalcMove(gen, typed.name, basePower === null ? options : { ...options, overrides: { ...options.overrides, basePower } });
  const changed = basePower === null ? modOverrides(gen, typed.name, attacker, move) : null;
  return changed ? new CalcMove(gen, typed.name, { ...options, overrides: { ...options.overrides, ...changed } }) : move;
}
