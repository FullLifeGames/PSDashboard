import { test, expect, describe } from 'vitest';
import { INFERRED_SPREAD_DETAIL } from '@fulllifegames/replay-core';
import { spriteUrl } from '../src/lib/sprite-url';
import { sourceLabel } from '../src/lib/provenance-labels';

// The two display helpers the stats panel reads: sprite addresses and the
// provenance badge text. Moved out of stats-panel-quality when that spec
// became a replay-core package test (A.3, round 39).

describe('stats panel display helpers', () => {
  test('sprite URLs drop base-name hyphens but keep forme hyphens (Ting-Lu)', () => {
    expect(spriteUrl('Ting-Lu')).toBe('https://play.pokemonshowdown.com/sprites/gen5/tinglu.png');
    expect(spriteUrl('Chien-Pao')).toBe('https://play.pokemonshowdown.com/sprites/gen5/chienpao.png');
    expect(spriteUrl('Kommo-o')).toBe('https://play.pokemonshowdown.com/sprites/gen5/kommoo.png');
    expect(spriteUrl('Rotom-Wash')).toBe('https://play.pokemonshowdown.com/sprites/gen5/rotom-wash.png');
    expect(spriteUrl('Ninetales-Alola')).toBe('https://play.pokemonshowdown.com/sprites/gen5/ninetales-alola.png');
    expect(spriteUrl('Greninja-*')).toBe('https://play.pokemonshowdown.com/sprites/gen5/greninja.png');
    expect(spriteUrl('Mr. Mime')).toBe('https://play.pokemonshowdown.com/sprites/gen5/mrmime.png');
  });
});

describe('provenance labels', () => {
  test('a damage-fitted spread reads fitted, a usage guess reads guessed with its share', () => {
    expect(sourceLabel('guessed', undefined, INFERRED_SPREAD_DETAIL)).toBe('fitted');
    expect(sourceLabel('guessed', 0.318)).toBe('guessed 31.8%');
    expect(sourceLabel('guessed')).toBe('guessed');
    expect(sourceLabel('revealed', undefined, INFERRED_SPREAD_DETAIL)).toBe('revealed');
  });
});
