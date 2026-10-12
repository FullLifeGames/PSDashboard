import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { Dex as BaseDex } from '@pkmn/dex';
import * as championsMod from '@pkmn/mods/champions';
import { generationsFor } from '../src/format-generations';

/**
 * Round 69 (T188, decision 33): the Generations a format's client battle is built on. A Champions battle's log names
 * species the mod calls non-standard (Absol-Mega-Z is `Past` in the mod and `Future` in the base Dex), so the parser reads
 * the 'logged' scope (every species the Dex knows, with the base Dex's data) and the team editor's pools read the 'legal'
 * scope (exactly what the registered mod allows). Every other format keeps the one shared standard Generations.
 * The checker is the mod: Dex.mod('champions', @pkmn/mods/champions), as the engine registers it.
 */
Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
const mod = Dex.dexes.champions;
const FORMATS = { singles: 'gen9championsou', doubles: 'gen9championsvgc2026regmbbo3', logTier: '[Gen 9 Champions] OU' } as const;

describe('formats outside Champions keep the standard Generations', () => {
  test('one shared object for every other format and both scopes, whatever the mod argument', () => {
    const standard = generationsFor('gen9ou');
    for (const format of ['gen9doublesou', 'gen9vgc2026regi', 'gen8ou', '[Gen 9] OU', '']) expect(generationsFor(format), format).toBe(standard);
    expect(generationsFor('gen9ou', 'legal', mod as never)).toBe(standard);
    expect(standard.get(9).species.get('Absol-Mega-Z')).toBeUndefined();
  });
});

describe('the logged scope of a Champions format', () => {
  for (const [kind, format] of Object.entries(FORMATS)) {
    test(`${kind} (${format}): every species the mod lists, legal or not, reads with the mod's types and abilities`, () => {
      const gen = generationsFor(format).get(9);
      const wrong: string[] = [];
      for (const species of mod.species.all()) {
        const read = gen.species.get(species.name);
        if (!read) { wrong.push(`${species.name}: missing`); continue; }
        if (!species.isNonstandard && (read.types.join() !== species.types.join() || JSON.stringify(read.abilities) !== JSON.stringify(species.abilities))) wrong.push(species.name);
      }
      expect(wrong).toEqual([]);
    });
  }

  test('Absol-Mega-Z, which the mod flags non-standard and a Champions log names, is a species of it', () => {
    expect(mod.species.get('Absol-Mega-Z').isNonstandard).toBeTruthy();
    expect(generationsFor(FORMATS.singles).get(9).species.get('Absol-Mega-Z')?.name).toBe('Absol-Mega-Z');
    expect(BaseDex.species.get('Absol-Mega-Z').exists).toBe(true);
  });

  test('items, moves and abilities of the mod resolve too, and one object serves the format id and the tier name', () => {
    const gen = generationsFor(FORMATS.singles).get(9);
    expect(mod.items.all().filter(item => !gen.items.get(item.name)).map(item => item.name)).toEqual([]);
    expect(mod.moves.all().filter(move => !gen.moves.get(move.name)).map(move => move.name)).toEqual([]);
    expect(mod.abilities.all().filter(ability => ability.id !== 'noability' && !gen.abilities.get(ability.name)).map(ability => ability.name)).toEqual([]);
    expect(generationsFor(FORMATS.logTier)).toBe(generationsFor(FORMATS.singles));
    expect(generationsFor(FORMATS.doubles)).toBe(generationsFor(FORMATS.singles));
  });
});

describe('the legal scope of a Champions format with the registered mod', () => {
  test('reads a row exactly when the mod allows it: species, items, moves and abilities', () => {
    const gen = generationsFor(FORMATS.singles, 'legal', mod as never).get(9);
    const wrong: string[] = [];
    const check = (kind: string, rows: { name: string; id: string; isNonstandard?: unknown }[], read: (name: string) => unknown) => {
      for (const row of rows) {
        if (row.id === 'noability') continue;
        if (!!read(row.name) !== !row.isNonstandard) wrong.push(`${kind} ${row.name}`);
      }
    };
    check('species', mod.species.all(), name => gen.species.get(name));
    check('item', mod.items.all(), name => gen.items.get(name));
    check('move', mod.moves.all(), name => gen.moves.get(name));
    check('ability', mod.abilities.all(), name => gen.abilities.get(name));
    expect(wrong).toEqual([]);
    expect(gen.species.get('Absol-Mega-Z')).toBeUndefined();
    expect(gen.species.get('Meloetta-Pirouette')).toBeDefined();
  });

  test('is memoized per mod, apart from the logged scope, and falls back to the logged scope without a mod', () => {
    expect(generationsFor(FORMATS.singles, 'legal', mod as never)).toBe(generationsFor(FORMATS.doubles, 'legal', mod as never));
    expect(generationsFor(FORMATS.singles, 'legal', mod as never)).not.toBe(generationsFor(FORMATS.singles));
    expect(generationsFor(FORMATS.singles, 'legal')).toBe(generationsFor(FORMATS.singles));
  });
});
