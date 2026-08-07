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

  test('item damage recoil reveals the holder (Life Orb)', () => {
    const log = [
      '|player|p2|Bob|',
      '|gen|9',
      '|poke|p2|Iron Valiant|item',
      '|start',
      '|switch|p2a: Izumi|Iron Valiant|100/100',
      '|turn|1',
      '|move|p2a: Izumi|Knock Off|p1a: Relous',
      '|-damage|p2a: Izumi|84/100|[from] item: Life Orb',
      '|turn|2',
    ].join('\n');

    const info = inferOpponentTeam(log, 'p2');
    const valiant = info.pokemon.find(pokemon => pokemon.species === 'Iron Valiant');
    expect(valiant?.item).toEqual(expect.objectContaining({ value: 'Life Orb', source: 'revealed' }));
  });

  test('Rocky Helmet damage reveals the [of] holder, not the damaged attacker', () => {
    const log = [
      '|player|p2|Bob|',
      '|gen|9',
      '|poke|p2|Amoonguss, F|item',
      '|start',
      '|switch|p1a: Kleavor|Kleavor, M|100/100',
      '|switch|p2a: Amoon|Amoonguss, F|100/100',
      '|turn|1',
      '|move|p1a: Kleavor|X-Scissor|p2a: Amoon',
      '|-damage|p2a: Amoon|60/100',
      '|-damage|p1a: Kleavor|84/100|[from] item: Rocky Helmet|[of] p2a: Amoon',
      '|turn|2',
    ].join('\n');

    const amoonguss = inferOpponentTeam(log, 'p2').pokemon.find(pokemon => pokemon.species === 'Amoonguss');
    expect(amoonguss?.item).toEqual(expect.objectContaining({ value: 'Rocky Helmet', source: 'revealed' }));
  });

  test('Rocky Helmet damage without [of] falls back to the attacker\'s move target (video logs)', () => {
    // gpl-pipeline reconstructions drop the [of] attribution — the holder is
    // whoever the damaged Pokémon just hit with a contact move.
    const log = [
      '|player|p1|Alice|',
      '|gen|9',
      '|poke|p1|Uxie, L50|',
      '|poke|p2|Landorus-Therian, L50|',
      '|start',
      '|switch|p1a: Dauni|Uxie, L50|100/100',
      '|switch|p2a: Armstrong|Landorus-Therian, L50|100/100',
      '|turn|1',
      '|move|p2a: Armstrong|U-turn|p1a: Dauni',
      '|-damage|p1a: Dauni|80/100',
      '|-damage|p2a: Armstrong|88/100|[from] item: Rocky Helmet',
      '|turn|2',
    ].join('\n');

    const uxie = inferOpponentTeam(log, 'p1').pokemon.find(pokemon => pokemon.species === 'Uxie');
    expect(uxie?.item).toEqual(expect.objectContaining({ value: 'Rocky Helmet', source: 'revealed' }));

    // The damaged attacker itself must NOT be credited with the helmet.
    const lando = inferOpponentTeam(log, 'p2').pokemon.find(pokemon => pokemon.species === 'Landorus-Therian');
    expect(lando?.item?.value ?? '').not.toBe('Rocky Helmet');
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
