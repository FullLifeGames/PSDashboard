import { describe, expect, test } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Dex, toID } from '@pkmn/sim';
import { Move } from '@smogon/calc';
import { calcGenerationFor } from '@fulllifegames/replay-core';
import { calcMove } from '../src/calc/move';
import type { CalcBody } from '../src/calc/body';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 68 (T186, decision 2): the Champions mod stays the truth for moves. Checker: every damaging move the mod
 * allows (isNonstandard null), read through the engine's calcMove for a body of the Champions mod, has the mod's base
 * power (a power callback excepted: the engine asks the callback), type, category, hit count and the contact, punch,
 * bite, sound and slicing flags. Negative priority is left out on purpose: the calculator reads priority only as
 * "greater than zero", so it has no damage effect. A move's data does not depend on the game type, so one run covers
 * singles and doubles (the roll oracle in champions-roll-oracle.spec.ts prices a spread move in doubles).
 * The moves the engine's override layer touches in legal Champions play (the calculator's own data differs from the
 * mod, or has none) go to steps/champions-override-moves.json so the ledger can name them without a list in the test.
 */
await loadSimMods('gen9championsou');

const FLAGS = ['contact', 'punch', 'bite', 'sound', 'slicing'] as const;
const attacker = { mod: 'champions' } as CalcBody;
const gen = calcGenerationFor(9, 'champions');
const legalDamaging = () => Dex.dexes.champions.moves.all()
  .filter(move => move.exists && !move.isNonstandard && move.category !== 'Status' && move.id !== 'struggle');

/** The move as the calculator builds it from its own data alone, or null when it has none or refuses it. */
function plain(name: string): Move | null {
  try {
    return gen.moves.get(toID(name) as never) ? new Move(gen, name) : null;
  } catch {
    return null;
  }
}

describe('every damaging move of the Champions mod reads the mod\'s data through calcMove (decision 2)', () => {
  test('power, type, category, hits and flags equal the mod\'s', () => {
    const wrong: string[] = [];
    for (const move of legalDamaging()) {
      const calc = calcMove(gen, move.name, attacker);
      if (calc.type !== move.type) wrong.push(`${move.name} type ${calc.type} vs ${move.type}`);
      if (calc.category !== move.category) wrong.push(`${move.name} category ${calc.category} vs ${move.category}`);
      if (!move.basePowerCallback && calc.bp !== move.basePower) wrong.push(`${move.name} power ${calc.bp} vs ${move.basePower}`);
      const hits = Array.isArray(move.multihit) ? [move.multihit[0], move.multihit[1]] : [move.multihit ?? 1, move.multihit ?? 1];
      if (calc.hits < hits[0] || calc.hits > hits[1]) wrong.push(`${move.name} hits ${calc.hits} vs ${hits.join('-')}`);
      const flags = calc.flags as Record<string, unknown> | undefined;
      for (const flag of FLAGS) if (!!flags?.[flag] !== !!move.flags[flag]) wrong.push(`${move.name} flag ${flag} ${!!flags?.[flag]} vs ${!!move.flags[flag]}`);
    }
    expect(wrong).toEqual([]);
  });

  test('Pound, which the calculator\'s Champions list lacks, prices at the mod\'s power', () => {
    const pound = Dex.dexes.champions.moves.get('pound');
    expect(pound.isNonstandard, 'Pound is legal in the mod').toBeFalsy();
    const calc = calcMove(gen, 'Pound', attacker);
    expect([calc.bp, calc.type, calc.category]).toEqual([pound.basePower, pound.type, pound.category]);
  });

  test('the moves the override layer touches are recorded', () => {
    const touched = legalDamaging().filter(move => {
      const raw = plain(move.name);
      const calc = calcMove(gen, move.name, attacker);
      return !raw || raw.bp !== calc.bp || raw.type !== calc.type || raw.category !== calc.category;
    }).map(move => move.name).sort();
    const folder = fileURLToPath(new URL('../../../docs/perf/probes/2026-10-12-r68/steps/', import.meta.url));
    if (existsSync(folder)) writeFileSync(`${folder}champions-override-moves.json`, JSON.stringify({ calcGenerationNum: gen.num, count: touched.length, moves: touched }, null, 1));
    // With the calculator's own Champions generation the mod and the calculator agree on every move but Pound.
    if ((gen.num as number) === 0) expect(touched).toEqual(['Pound']);
  });
});
