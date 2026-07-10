import { test, expect } from '@playwright/test';
import { inferOpponentTeam } from '../src/lib/opponent-inferrer';
import { enrichPokemonInfo } from '../src/lib/team-info';
import { spriteUrl } from '../src/lib/sprite-url';
import type { RevealedPokemonInfo } from '../src/types';
import type { SmogonUsageStats } from '../src/lib/smogon-stats';

const megaLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gen|9',
  '|tier|[Gen 9] National Dex Draft',
  '|poke|p2|Lopunny, F|item',
  '|poke|p2|Garchomp, M|item',
  '|start',
  '|switch|p2a: Lopunny|Lopunny, F|100/100',
  '|-mega|p2a: Lopunny|Lopunny|Lopunnite',
  '|detailschange|p2a: Lopunny|Lopunny-Mega, F',
  '|turn|1',
  '|switch|p2a: Garchomp|Garchomp, M|100/100',
  '|turn|2',
  '|switch|p2a: Lopunny|Lopunny-Mega, F|100/100',
  '|turn|3',
].join('\n');

const healLog = [
  '|player|p2|Bob|',
  '|gen|9',
  '|poke|p2|Skarmory, M|item',
  '|start',
  '|switch|p2a: Skarmory|Skarmory, M|100/100',
  '|turn|1',
  '|-heal|p2a: Skarmory|88/100|[from] item: Leftovers',
  '|turn|2',
].join('\n');

test.describe('stats panel data quality (WP11)', () => {
  test('mega formes merge into the base species instead of a seventh card (B16)', () => {
    const info = inferOpponentTeam(megaLog, 'p2');
    const speciesList = info.pokemon.map(pokemon => pokemon.species);

    expect(speciesList).toContain('Lopunny');
    expect(speciesList).not.toContain('Lopunny-Mega');
    expect(info.pokemon).toHaveLength(2);
  });

  test('mega evolution reveals the stone as the held item (G19)', () => {
    const info = inferOpponentTeam(megaLog, 'p2');
    const lopunny = info.pokemon.find(pokemon => pokemon.species === 'Lopunny');
    expect(lopunny?.item).toEqual(expect.objectContaining({ value: 'Lopunnite', source: 'revealed' }));
  });

  test('heal-from-item messages reveal the held item (G19)', () => {
    const info = inferOpponentTeam(healLog, 'p2');
    const skarmory = info.pokemon.find(pokemon => pokemon.species === 'Skarmory');
    expect(skarmory?.item).toEqual(expect.objectContaining({ value: 'Leftovers', source: 'revealed' }));
  });

  test('sprite URLs drop base-name hyphens but keep forme hyphens (Ting-Lu)', () => {
    expect(spriteUrl('Ting-Lu')).toBe('https://play.pokemonshowdown.com/sprites/gen5/tinglu.png');
    expect(spriteUrl('Chien-Pao')).toBe('https://play.pokemonshowdown.com/sprites/gen5/chienpao.png');
    expect(spriteUrl('Kommo-o')).toBe('https://play.pokemonshowdown.com/sprites/gen5/kommoo.png');
    expect(spriteUrl('Rotom-Wash')).toBe('https://play.pokemonshowdown.com/sprites/gen5/rotom-wash.png');
    expect(spriteUrl('Ninetales-Alola')).toBe('https://play.pokemonshowdown.com/sprites/gen5/ninetales-alola.png');
    expect(spriteUrl('Greninja-*')).toBe('https://play.pokemonshowdown.com/sprites/gen5/greninja.png');
    expect(spriteUrl('Mr. Mime')).toBe('https://play.pokemonshowdown.com/sprites/gen5/mrmime.png');
  });

  test('guessed typed Hidden Power does not join a revealed generic one (G12)', () => {
    const revealed: RevealedPokemonInfo = {
      species: 'Zapdos',
      moves: [{ name: 'Hidden Power', source: 'revealed' }],
      ability: { value: '', source: 'unknown' },
      item: { value: '', source: 'unknown' },
      teraType: { value: '', source: 'unknown' },
      evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
      level: 100,
      gender: '',
    };
    const usageStats: SmogonUsageStats = {
      format: 'gen3ou',
      month: 'latest',
      source: 'test',
      pokemon: {
        zapdos: {
          species: 'Zapdos',
          rawCount: 100,
          abilities: [],
          items: [],
          moves: [
            { value: 'Hidden Power Grass', probability: 0.6 },
            { value: 'Thunderbolt', probability: 0.9 },
          ],
          spreads: [],
        },
      },
    };

    const enriched = enrichPokemonInfo(revealed, usageStats);
    const hiddenPowerEntries = enriched.moves.filter(move => move.name.toLowerCase().startsWith('hidden power'));
    expect(hiddenPowerEntries).toHaveLength(1);
    expect(hiddenPowerEntries[0].source).toBe('revealed');
    expect(enriched.moves.some(move => move.name === 'Thunderbolt')).toBe(true);
  });
});
