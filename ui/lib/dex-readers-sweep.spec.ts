import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Dex, type PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay, parseReplayLog, type TurnSnapshot } from '@fulllifegames/replay-core';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { pickerStateFromSnapshot } from '../../src/lib/picker-state';
import { spriteUrl } from '../../src/lib/sprite-url';
import { getAbilityPool, getItemPool } from '../../src/lib/pokemon-options';

/**
 * Round 75 (T160, decision D1), the sweep of the app's half: the pickers, the sprite names and the option pools read the Dex of
 * the replay's generation and mod, entry by entry. The picker used the Scarlet/Violet Dex for a Champions game (Snap Trap and
 * Growth differ in the mod) and the newest Dex for an older one. The changed entries are found by comparing the mod's Dex with
 * Scarlet/Violet, not by our code; the older generations are compared with each generation's own Dex.
 * Singles and doubles use one reader here (the picker takes a side's bodies; the format name carries the game type), so each
 * reader runs on a singles format and a doubles format of Champions and of Scarlet/Violet.
 */
await loadSimMods('gen9championsou');

const replay = JSON.parse(readFileSync(join('packages', 'eval-engine', 'test', 'fixtures', 'champions', 'gen9championsou-2693832490.json'), 'utf-8')) as { log: string };
const mod = Dex.dexes.champions;
const standard = Dex.forGen(9);
const FORMATS = {
  'Champions singles': 'gen9championsou', 'Champions doubles': 'gen9championsvgc2026regmbbo3',
  'Scarlet/Violet singles': 'gen9ou', 'Scarlet/Violet doubles': 'gen9doublesou',
} as const;
const championsOf = (format: string) => /champions/.test(format);

const snapshot = parseReplayLog(replay.log).find(entry => entry.turn === 3)!;
const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);

/** The picker's first body of side one with `species` and the moves, read in the format at the generation. */
function bodyIn(format: string, gen: number, species: string, moves: string[]) {
  const mon = { ...snapshot.p1.pokemon.find(candidate => !candidate.fainted)!, speciesForme: species, name: species, maxhp: 100, hp: 100, hpPercent: 100, isActive: true, moves };
  const set = { ...p1Team[0], species, name: species, moves } as PokemonSet;
  const lone = { ...snapshot, p1: { ...snapshot.p1, pokemon: [mon] }, p2: { ...snapshot.p2, pokemon: snapshot.p2.pokemon.slice(0, 1) } } as TurnSnapshot;
  return pickerStateFromSnapshot(lone, [set], p2Team, gen, null, { format }).p1Pokemon[0];
}

const typeChanged = mod.moves.all().filter(move => move.exists && !move.isNonstandard && standard.moves.get(move.id).exists && move.type !== standard.moves.get(move.id).type);
const speciesChanged = mod.species.all().filter(entry => entry.exists && !entry.isNonstandard && standard.species.get(entry.id).exists
  && entry.types.join() !== standard.species.get(entry.id).types.join());

describe.each(Object.entries(FORMATS))('%s: the picker reads the game\'s Dex', (_name, format) => {
  const dex = championsOf(format) ? mod : standard;

  test('every move the mod gives another type shows the type of the game', () => {
    expect(typeChanged.map(move => move.id)).toEqual(expect.arrayContaining(['growth', 'snaptrap']));
    const names = typeChanged.map(move => move.name);
    const info = bodyIn(format, 9, 'Garchomp', names);
    expect(info.moves.map(move => [move.name, move.type])).toEqual(typeChanged.map(move => [move.name, dex.moves.get(move.id).type]));
  });

  test('every species the mod gives other types shows the types of the game', () => {
    const wrong = speciesChanged.filter(entry => bodyIn(format, 9, entry.name, ['Tackle']).types.join() !== dex.species.get(entry.id).types.join()).map(entry => entry.id);
    expect(wrong).toEqual([]);
  });
});

describe('older generations: the picker reads the generation\'s own types', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('Gen %i: Clefable and Magnemite have the types of the generation', gen => {
    for (const species of ['Clefable', 'Magnemite', 'Gengar']) {
      expect(bodyIn('gen9ou', gen, species, ['Tackle']).types, species).toEqual([...Dex.forGen(gen).species.get(species).types]);
    }
  });

  test('the types differ between Generation 5 and 6 for Clefable (Fairy), which the sweep needs to see', () => {
    expect(bodyIn('gen9ou', 5, 'Clefable', ['Tackle']).types).not.toEqual(bodyIn('gen9ou', 6, 'Clefable', ['Tackle']).types);
  });
});

describe('the sprite name and the option pools read the game\'s Dex', () => {
  test('a Champions-only forme and a base forme name their sprite files from the replay\'s Dex', () => {
    const rules = { gen: 9, mod: 'champions' as const };
    const forms = mod.species.all().filter(entry => entry.exists && !entry.isNonstandard && entry.forme);
    expect(forms.length).toBeGreaterThan(10);
    const wrong = forms.filter(entry => !spriteUrl(entry.name, rules).endsWith(`/${entry.baseSpecies.toLowerCase().replace(/[^a-z0-9]/g, '')}-${entry.forme.toLowerCase().replace(/[^a-z0-9]/g, '')}.png`)).map(entry => entry.name);
    expect(wrong).toEqual([]);
    expect(spriteUrl('Greninja-*', { gen: 9, mod: undefined })).toMatch(/greninja\.png$/);
  });

  test('the Champions pools are the mod\'s, the Generation 9 pools the standard Generations\'', () => {
    expect(getItemPool(9, 'gen9championsou')).toEqual([...mod.items.all()].filter(item => !item.isNonstandard).map(item => item.name).sort((a, b) => a.localeCompare(b)));
    const species = mod.species.get('Garchomp');
    expect(getAbilityPool('Garchomp', 9, 'gen9championsou')).toEqual(Object.values(species.abilities).filter(Boolean));
    expect(getAbilityPool('Garchomp', 9, 'gen9ou').length).toBeGreaterThan(0);
  });
});
