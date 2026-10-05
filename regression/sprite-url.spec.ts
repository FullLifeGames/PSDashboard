import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { spriteUrl } from '../src/lib/sprite-url';

const file = (species: string) => spriteUrl(species).replace('https://play.pokemonshowdown.com/sprites/gen5/', '');

describe('sprite file names', () => {
  test('a hyphen inside the forme goes, as Showdown names the file (T96 point 2)', () => {
    expect(file('Urshifu-Rapid-Strike')).toBe('urshifu-rapidstrike.png');
    expect(file('Alcremie-Ruby-Swirl')).toBe('alcremie-rubyswirl.png');
  });

  test('hyphens of the base name go, the forme hyphen stays', () => {
    expect(file('Ting-Lu')).toBe('tinglu.png');
    expect(file('Kommo-o-Totem')).toBe('kommoo-totem.png');
    expect(file('Nidoran-F')).toBe('nidoranf.png');
    expect(file('Mr. Mime-Galar')).toBe('mrmime-galar.png');
    expect(file('Rotom-Wash')).toBe('rotom-wash.png');
    expect(file('Gastrodon-East')).toBe('gastrodon-east.png');
  });

  test('an unrevealed forme shows the base sprite; an unknown name keeps its own id', () => {
    expect(file('Greninja-*')).toBe('greninja.png');
    expect(file('Missingname-Form')).toBe('missingname-form.png');
  });

  test('checker: every species the simulator knows gets the simulator\'s sprite id', () => {
    // Cosmetic formes are the one exception: the simulator's spriteid falls
    // back to the base, while the sprite folder holds the forme (gastrodon-east).
    const cosmetic = (name: string, base: string) => Dex.species.get(base).cosmeticFormes?.includes(name) ?? false;
    const mismatches = Dex.species.all()
      .filter(species => species.exists && !cosmetic(species.name, species.baseSpecies))
      .filter(species => file(species.name) !== `${species.spriteid}.png`)
      .map(species => `${species.name}: ${file(species.name)} vs ${species.spriteid}.png`);
    expect(mismatches).toEqual([]);
  });
});
