import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { createInferrerState } from '../src/inference/inferrer-state';
import { readLine } from '../src/inference/log-line';
import { dexOf, dexOfCalc, dexOfSources, formatRules, logRules, rulesDex, simFormats, statIds } from '../src/rules-dex';
import { calcGenerationFor } from '../src/calc-gen';
import { replayRules } from '../src/replay-format';

/**
 * Round 75 (T160, decision D1): the one resolver of generation and mod. The global Dex is Generation 9 on Scarlet/Violet; a game
 * reads the Dex of its own generation, and a Pokémon Champions game the registered Champions Dex. This file never registers the
 * mod before the throw test (a spec file runs in its own module registry), so the order is the host's order: load, then read.
 */
describe('rulesDex', () => {
  test('a Champions game without the registered mod throws, never reads Scarlet/Violet', () => {
    expect(() => rulesDex(9, 'champions')).toThrow(/Champions mod is not registered/);
    expect(() => rulesDex(0)).toThrow(/Champions mod is not registered/);
    expect(() => dexOfCalc(calcGenerationFor(9, 'champions'))).toThrow(/Champions mod is not registered/);
    expect(() => dexOfSources('gen9championsou')).toThrow(/Champions mod is not registered/);
  });

  test('every other game reads the Dex of its generation, clamped to the generations the simulator knows', () => {
    for (let gen = 1; gen <= 9; gen++) expect(rulesDex(gen).gen).toBe(gen);
    expect(rulesDex(9)).toBe(Dex);
    expect(rulesDex(0 + 10).gen).toBe(9);
    expect(rulesDex(-1).gen).toBe(1);
    expect(dexOfCalc(calcGenerationFor(6)).gen).toBe(6);
    expect(dexOf({ gen: 4, mod: undefined }).gen).toBe(4);
  });

  test('the generations differ where the games differ: the type chart and the base stats of an older generation', () => {
    // Gen 1 lets Bug hit Poison hard and Ghost do nothing to Psychic; Steel stops resisting Ghost in Gen 6; Clefable's Special Attack rises in Gen 6.
    expect([rulesDex(1), rulesDex(2), rulesDex(9)].map(dex => dex.getEffectiveness('Bug', 'Poison'))).toEqual([1, -1, -1]);
    expect([rulesDex(1), rulesDex(2), rulesDex(9)].map(dex => dex.getEffectiveness('Ghost', 'Psychic'))).toEqual([0, 1, 1]);
    expect([rulesDex(5), rulesDex(6)].map(dex => dex.getEffectiveness('Ghost', 'Steel'))).toEqual([-1, 0]);
    expect([rulesDex(5), rulesDex(6), rulesDex(9)].map(dex => dex.species.get('Clefable').baseStats.spa)).toEqual([85, 95, 95]);
  });

  test('the registered Champions Dex answers for the mod, and for the calculator generation 0', async () => {
    const championsMod = await import('@pkmn/mods/champions');
    Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
    expect(rulesDex(9, 'champions')).toBe(Dex.dexes.champions);
    expect(rulesDex(0)).toBe(Dex.dexes.champions);
    expect(dexOfSources(undefined, 'gen9championsvgc2026regma')).toBe(Dex.dexes.champions);
    expect(dexOfCalc(calcGenerationFor(9, 'champions'))).toBe(Dex.dexes.champions);
    expect(rulesDex(9).moves.get('Snap Trap').type).not.toBe(rulesDex(9, 'champions').moves.get('Snap Trap').type);
  });
});

describe('the rules of a format, a log and an inferrer state', () => {
  test('format ids, tier names and logs name the same generation and mod', () => {
    expect(formatRules('gen9championsou')).toEqual({ gen: 9, mod: 'champions' });
    expect(formatRules('[Gen 9 Champions] OU')).toEqual({ gen: 9, mod: 'champions' });
    expect(formatRules('gen3ou')).toEqual({ gen: 3, mod: undefined });
    expect(formatRules('[Gen 2] OU')).toEqual({ gen: 2, mod: undefined });
    expect(logRules('|gen|9\n|tier|[Gen 9 Champions] VGC 2026 Reg M-B\n')).toEqual({ gen: 9, mod: 'champions' });
    expect(logRules('|gen|4\r\n|tier|[Gen 4] OU\r\n')).toEqual({ gen: 4, mod: undefined });
    expect(logRules('|turn|1')).toEqual({ gen: 9, mod: undefined });
    expect(replayRules({ formatid: 'gen9championsou' })).toEqual({ gen: 9, mod: 'champions' });
    expect(replayRules({ formatid: 'gen6ou' })).toEqual({ gen: 6, mod: undefined });
  });

  test('the inferrer state carries the mod from the tier line, next to its generation', () => {
    const lines = (text: string) => text.split('\n').map(readLine);
    const champions = createInferrerState(lines('|gen|9\n|tier|[Gen 9 Champions] OU'), 'p2');
    expect(champions).toMatchObject({ gen: 9, mod: 'champions' });
    expect(createInferrerState(lines('|gen|7\n|tier|[Gen 7] OU'), 'p2')).toMatchObject({ gen: 7, mod: undefined });
    expect(createInferrerState(lines('|turn|1'), 'p2')).toMatchObject({ gen: 9, mod: undefined });
  });

  test('the format registry and the stat ids come from the resolver too', () => {
    expect(simFormats().get('gen9ou').exists).toBe(true);
    expect(statIds()).toEqual(['hp', 'atk', 'def', 'spa', 'spd', 'spe']);
  });
});
