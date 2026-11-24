import { Move as CalcMove } from '@smogon/calc';
import { toID } from '@pkmn/sim';
import { CHAMPIONS_MOD, dexOfCalc, historyPower, simGenNum, type CalcGeneration } from '@fulllifegames/replay-core';
import type { CalcBody } from './body.ts';

export { protectBlocks } from './protect.ts';


type CalcGen = CalcGeneration;
type CalcMoveOptions = NonNullable<ConstructorParameters<typeof CalcMove>[2]>;

// calc 0.12 prices Last Respects at its listed power whatever alliesFainted says, and counts no Rage Fist hits.
function powerAtUse(gen: CalcGen, name: string, attacker: CalcBody): number | null {
  const dex = dexOfCalc(gen);
  return historyPower(dex, dex.moves.get(name).id, { fainted: attacker.totalFainted ?? 0, timesAttacked: attacker.timesAttacked ?? 0 });
}

// The calc reads the bare name as a Normal move of power 60 (0 before gen 6).
function typedHiddenPower(gen: CalcGen, name: string, attacker: CalcBody): { name: string; basePower: number | null } {
  if (toID(name) !== 'hiddenpower' || !attacker.hpType) return { name, basePower: null };
  return { name: `Hidden Power ${attacker.hpType}`, basePower: simGenNum(gen) < 6 && attacker.hpPower ? attacker.hpPower : null };
}

// A damaging move the simulator plays typeless (Struggle in Gens 2 to 4) goes to the calc typeless too:
// calc 0.12 lets it take Normal items.
function typelessOverride(gen: CalcGen, name: string): { type: never } | null {
  const move = dexOfCalc(gen).moves.get(name);
  return move.exists && move.type === '???' && move.category !== 'Status' ? { type: '???' as never } : null;
}

// The caller's overrides win; the calc reads priority only as "greater than zero", so a negative one stays out.
function modOverrides(gen: CalcGen, name: string, attacker: CalcBody, calc: CalcMove): CalcMoveOptions['overrides'] | null {
  const move = attacker.mod === CHAMPIONS_MOD ? dexOfCalc(gen).moves.get(name) : undefined;
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
  const own = { ...(basePower === null ? {} : { basePower }), ...typelessOverride(gen, typed.name) };
  const move = new CalcMove(gen, typed.name, Object.keys(own).length === 0 ? options : { ...options, overrides: { ...options.overrides, ...own } });
  const changed = basePower === null ? modOverrides(gen, typed.name, attacker, move) : null;
  return changed ? new CalcMove(gen, typed.name, { ...options, overrides: { ...changed, ...options.overrides, ...own } }) : move;
}
