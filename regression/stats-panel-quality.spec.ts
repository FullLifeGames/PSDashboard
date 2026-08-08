import { test, expect } from '@playwright/test';
import { inferOpponentTeam } from '../src/lib/opponent-inferrer';
import { applyInferredSpreads, enrichPokemonInfo, guessedEvs, INFERRED_SPREAD_DETAIL, manualEvs, unknownField } from '../src/lib/team-info';
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

  test('hazard and status damage rule out Magic Guard', () => {
    const log = [
      '|player|p2|Bob|', '|gen|9', '|poke|p2|Clefable, F|',
      '|start', '|switch|p2a: Clef|Clefable, F|100/100', '|turn|1',
      '|-damage|p2a: Clef|88/100|[from] Stealth Rock',
      '|turn|2',
    ].join('\n');
    const clef = inferOpponentTeam(log, 'p2').pokemon.find(p => p.species === 'Clefable');
    expect(clef?.ruledOut?.abilities).toContain('magicguard');
  });

  test('Stealth Rock damage on switch-in rules out Heavy-Duty Boots', () => {
    const log = [
      '|player|p2|Bob|', '|gen|9', '|poke|p2|Corviknight, M|',
      '|start', '|switch|p2a: Corv|Corviknight, M|100/100', '|turn|1',
      '|switch|p2a: Corv|Corviknight, M|88/100',
      '|-damage|p2a: Corv|76/100|[from] Stealth Rock',
      '|turn|2',
    ].join('\n');
    const corv = inferOpponentTeam(log, 'p2').pokemon.find(p => p.species === 'Corviknight');
    expect(corv?.ruledOut?.items).toContain('heavydutyboots');
  });

  test('taking a Ground move rules out Levitate', () => {
    const log = [
      '|player|p2|Bob|', '|gen|9', '|poke|p2|Rotom-Heat|',
      '|start', '|switch|p1a: Chomp|Garchomp, M|100/100',
      '|switch|p2a: Toaster|Rotom-Heat|100/100', '|turn|1',
      '|move|p1a: Chomp|Earthquake|p2a: Toaster',
      '|-damage|p2a: Toaster|40/100',
      '|turn|2',
    ].join('\n');
    const rotom = inferOpponentTeam(log, 'p2').pokemon.find(p => p.species === 'Rotom-Heat');
    expect(rotom?.ruledOut?.abilities).toContain('levitate');
  });

  test('an immune Ground move plus later unattributed damage does NOT rule out Levitate', () => {
    // The stale-attribution bug class: |-immune| ends the action, so the
    // confusion self-hit next turn must not be read as landed Earthquake.
    const log = [
      '|player|p2|Bob|', '|gen|9', '|poke|p2|Bronzong|',
      '|start', '|switch|p1a: Chomp|Garchomp, M|100/100',
      '|switch|p2a: Bell|Bronzong|100/100', '|turn|1',
      '|move|p1a: Chomp|Earthquake|p2a: Bell',
      '|-immune|p2a: Bell',
      '|turn|2',
      '|-activate|p2a: Bell|confusion',
      '|-damage|p2a: Bell|90/100',
      '|turn|3',
    ].join('\n');
    const zong = inferOpponentTeam(log, 'p2').pokemon.find(p => p.species === 'Bronzong');
    expect(zong?.ruledOut?.abilities ?? []).not.toContain('levitate');
  });

  test('Ground damage from a Mold Breaker species or under Gravity does NOT rule out Levitate', () => {
    // Excadrill can be Mold Breaker: its landed Earthquake proves nothing.
    const moldBreaker = [
      '|player|p2|Bob|', '|gen|9', '|poke|p2|Bronzong|',
      '|start', '|switch|p1a: Drill|Excadrill, M|100/100',
      '|switch|p2a: Bell|Bronzong|100/100', '|turn|1',
      '|move|p1a: Drill|Earthquake|p2a: Bell',
      '|-damage|p2a: Bell|60/100',
      '|turn|2',
    ].join('\n');
    const zong = inferOpponentTeam(moldBreaker, 'p2').pokemon.find(p => p.species === 'Bronzong');
    expect(zong?.ruledOut?.abilities ?? []).not.toContain('levitate');

    // Gravity grounds everyone; a landed Ground move proves nothing.
    const gravity = [
      '|player|p2|Bob|', '|gen|9', '|poke|p2|Rotom-Heat|',
      '|start', '|switch|p1a: Chomp|Garchomp, M|100/100',
      '|switch|p2a: Toaster|Rotom-Heat|100/100', '|turn|1',
      '|-fieldstart|move: Gravity',
      '|move|p1a: Chomp|Earthquake|p2a: Toaster',
      '|-damage|p2a: Toaster|40/100',
      '|turn|2',
    ].join('\n');
    const rotom = inferOpponentTeam(gravity, 'p2').pokemon.find(p => p.species === 'Rotom-Heat');
    expect(rotom?.ruledOut?.abilities ?? []).not.toContain('levitate');
  });

  test('a Ground move that ignores immunity (Thousand Arrows) does NOT rule out Levitate', () => {
    const log = [
      '|player|p2|Bob|', '|gen|9', '|poke|p2|Rotom-Heat|',
      '|start', '|switch|p1a: Zyg|Zygarde|100/100',
      '|switch|p2a: Toaster|Rotom-Heat|100/100', '|turn|1',
      '|move|p1a: Zyg|Thousand Arrows|p2a: Toaster',
      '|-damage|p2a: Toaster|60/100',
      '|turn|2',
    ].join('\n');
    const rotom = inferOpponentTeam(log, 'p2').pokemon.find(p => p.species === 'Rotom-Heat');
    expect(rotom?.ruledOut?.abilities ?? []).not.toContain('levitate');
  });

  test('inferred spreads surface in the display info with their provenance', () => {
    const info = {
      pokemon: [{
        species: 'Uxie',
        moves: [],
        ability: unknownField(), item: unknownField(), teraType: unknownField(),
        evs: guessedEvs({ hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 }),
        level: 50, gender: '',
      }, {
        species: 'Clefable',
        moves: [],
        ability: unknownField(), item: unknownField(), teraType: unknownField(),
        evs: manualEvs({ hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }),
        level: 50, gender: '',
      }],
    };
    const inferred = new Map([
      ['p1:uxie', { evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 }, nature: 'Timid' }],
      ['p1:clefable', { evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 'Hardy' }],
    ]);
    const overlaid = applyInferredSpreads(info, 'p1', inferred);
    const uxie = overlaid.pokemon[0];
    expect(uxie.evs.value.hp).toBe(252);
    expect(uxie.evs.sourceDetail).toBe(INFERRED_SPREAD_DETAIL);
    expect(uxie.nature?.value).toBe('Timid');
    // Manual EVs are never overridden by inference.
    const clef = overlaid.pokemon[1];
    expect(clef.evs.value.hp).toBe(252);
    expect(clef.evs.sourceDetail).toBeUndefined();
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

  test('ruled-out abilities filter usage guesses down to the next candidate', () => {
    const revealed: RevealedPokemonInfo = {
      species: 'Clefable',
      moves: [],
      ability: { value: '', source: 'unknown' },
      item: { value: '', source: 'unknown' },
      teraType: { value: '', source: 'unknown' },
      evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
      level: 100,
      gender: 'F',
      ruledOut: { abilities: ['magicguard'], items: [] },
    };
    const usageStats: SmogonUsageStats = {
      format: 'gen9ou',
      month: 'latest',
      source: 'test',
      pokemon: {
        clefable: {
          species: 'Clefable',
          rawCount: 100,
          abilities: [
            { value: 'Magic Guard', probability: 0.9 },
            { value: 'Unaware', probability: 0.1 },
          ],
          items: [],
          moves: [],
          spreads: [],
        },
      },
    };

    const enriched = enrichPokemonInfo(revealed, usageStats);
    expect(enriched.ability.value).toBe('Unaware');
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
