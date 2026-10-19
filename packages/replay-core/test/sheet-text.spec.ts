import { beforeAll, describe, expect, test } from 'vitest';
import { Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { parseShowteamSheet } from '../src/opponent-inferrer.ts';
import { toId } from '../src/ids.ts';
import { fixtureTexts, GENERATIONS, generatedTeams, withCorners } from './team-text-sources.ts';

/**
 * Round 72, T241 step 1b: an Open Team Sheet (`|showteam|`) goes through the library. `parseShowteamSheet` reads the
 * packed team with `Teams.unpack`, the reader `extractEmbeddedShowteamExports` already used for the built sets. The hand
 * reader it replaced lives on below as `legacyParseShowteamSheet`, and this spec holds the library to it on every
 * `|showteam|` side of the fixtures and on simulator-generated teams of generations 1 to 9 (plain and with corners, on
 * both sides, so singles and doubles teams alike). Census at the change (1,734 sides of fixtures and fit corpus, 1,462
 * equal): the 272 others differ in one finding.
 *   F2  Packed move names with two capitals in a row: the hand splitter wrote "Will OWisp" and "XScissor", the library
 *       writes "Will O Wisp" and "X Scissor" (283 moves, those two spellings only; both give the same id).
 *   F5  A species the sheet writes in its own field, where the library has no Dex to split by: "Porygon2" would come back
 *       "Porygon 2" and "Zygarde-10%" "Zygarde- 10 %". The species reads the Dex's name instead; the real sheets (the
 *       server writes the species into the name field, which the library leaves as it is) read the same as before.
 *       Items and abilities with a digit still split ("TR41" reads "tr 41"; none on a sheet of a format that has them).
 */

interface LegacySheetPokemon { species: string; item: string; ability: string; moves: string[]; teraType: string; level: number; gender: string }

const legacySplitPackedName = (value: string): string => value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();

/** The hand reader as it stood before round 72 (packages/replay-core/src/opponent-inferrer.ts). */
function legacyParseShowteamSheet(log: string, side: 'p1' | 'p2'): LegacySheetPokemon[] | null {
  const prefix = `|showteam|${side}|`;
  const line = log.split('\n').find(candidate => candidate.startsWith(prefix));
  if (!line) return null;
  const pokemon: LegacySheetPokemon[] = [];
  for (const entry of line.slice(prefix.length).split(']')) {
    const fields = entry.split('|');
    const species = fields[1]?.trim() || (fields[0]?.trim() ?? '');
    if (!species) continue;
    const misc = (fields[11] ?? '').split(',');
    pokemon.push({
      species: legacySplitPackedName(species),
      item: legacySplitPackedName(fields[2] ?? ''),
      ability: legacySplitPackedName(fields[3] ?? ''),
      moves: (fields[4] ?? '').split(',').map(move => legacySplitPackedName(move)).filter(Boolean),
      teraType: misc[5]?.trim() ?? '',
      level: parseInt(fields[10] ?? '', 10) || 100,
      gender: fields[7] === 'M' || fields[7] === 'F' ? fields[7] : '',
    });
  }
  return pokemon.length > 0 ? pokemon : null;
}

/**
 * Equal on every field. The names of species, item, ability and moves compare as ids, because the two readers spell a
 * packed name differently (F2, F5); `exact` also holds the species and the item and ability to the old text.
 */
function expectSameSheet(log: string, side: 'p1' | 'p2', exact: boolean) {
  const old = legacyParseShowteamSheet(log, side);
  const now = parseShowteamSheet(log, side);
  expect(now === null).toBe(old === null);
  if (!old || !now) return;
  const reading = (mon: LegacySheetPokemon) => ({
    ...mon,
    species: exact ? mon.species : toId(mon.species),
    item: exact ? mon.item : toId(mon.item),
    ability: exact ? mon.ability : toId(mon.ability),
    moves: mon.moves.map(toId),
  });
  expect(now.map(reading)).toEqual(old.map(reading));
}

const fixtures = fixtureTexts();

describe('parseShowteamSheet reads like the hand reader did, through Teams.unpack', () => {
  const generated = new Map<number, PokemonSet[][]>();
  beforeAll(async () => {
    for (const gen of GENERATIONS) generated.set(gen, await generatedTeams(gen, 6));
  }, 120_000);

  test('the fixtures hold showteam lines', () => {
    expect(fixtures.sheets.length).toBeGreaterThanOrEqual(2);
  });

  test.each(fixtures.sheets.map((s, i) => [`${s.tag} ${s.side} #${i}`, s] as const))('sheet %s', (_tag, sheet) => {
    expectSameSheet(sheet.log, sheet.side, true);
  });

  test.each(GENERATIONS)('simulator-generated teams of generation %i, plain and with corner cases, on both sides', (gen) => {
    for (const team of generated.get(gen)!) {
      for (const variant of [team, withCorners(team)]) {
        const log = `|showteam|p1|${Teams.pack(variant)}\n|showteam|p2|${Teams.pack(variant.slice().reverse())}`;
        expectSameSheet(log, 'p1', false);
        expectSameSheet(log, 'p2', false);
      }
    }
  });

  test('no sheet, a sheet of no species, and the other side', () => {
    expect(parseShowteamSheet('|turn|1', 'p1')).toBeNull();
    expect(parseShowteamSheet('|showteam|p1|]]', 'p1')).toBeNull();
    expect(parseShowteamSheet('|showteam|p1|Hydreigon||ChoiceScarf|Levitate|DarkPulse|Timid||M|||50|', 'p2')).toBeNull();
  });

  test('an entry with fewer fields than a full one reads, and does not swallow the entries after it', () => {
    // The line of unknown-forme-marker.spec.ts: Miraidon's entry has ten pipes where a full entry has eleven.
    const log = '|showteam|p2|Miraidon||ChoiceSpecs|HadronEngine|ElectroDrift,DracoMeteor,VoltSwitch,Protect|Timid||||50|]' +
      'Urshifu-Rapid-Strike||FocusSash|UnseenFist|SurgingStrikes,CloseCombat,AquaJet,Protect|Jolly||M|||50|]' +
      'Incineroar||SafetyGoggles|Intimidate|FakeOut,KnockOff,FlareBlitz,PartingShot|Careful||F|||50|';
    expect(parseShowteamSheet(log, 'p2')!.map(mon => mon.species)).toEqual(['Miraidon', 'Urshifu-Rapid-Strike', 'Incineroar']);
    expectSameSheet(log, 'p2', true);
    // Cut off after the moves: the rest reads as empty, as the hand reader did.
    const cut = '|showteam|p1|Gengar||BlackSludge|CursedBody|ShadowBall,SludgeBomb]Pikachu||LightBall|Static|Thunderbolt|Timid||F|||50|';
    expect(parseShowteamSheet(cut, 'p1')!.map(mon => [mon.species, mon.level, mon.gender])).toEqual([['Gengar', 100, ''], ['Pikachu', 50, 'F']]);
    expectSameSheet(cut, 'p1', true);
  });

  test('F5: a species in its own field reads the Dex name, a species in the name field as written', () => {
    const sheet = parseShowteamSheet('|showteam|p1|Pillar|Porygon2|Eviolite|Download|Recover|Bold||||||]Rotom-Wash||Sitrus Berry|Levitate|Protect|Bold||||||]Zygarde|Zygarde-10%||Power Construct|Glare|Adamant||||||', 'p1');
    expect(sheet!.map(mon => mon.species)).toEqual(['Porygon2', 'Rotom-Wash', 'Zygarde-10%']);
  });

  test('F2: packed move names with two capitals in a row read as spaced words', () => {
    const sheet = parseShowteamSheet('|showteam|p1|Whimsicott||FocusSash|Prankster|WillOWisp,XScissor,Protect,Tailwind|Timid||F|||50|', 'p1');
    expect(sheet![0].moves).toEqual(['Will O Wisp', 'X Scissor', 'Protect', 'Tailwind']);
    expect(sheet![0].moves.map(toId)).toEqual(['willowisp', 'xscissor', 'protect', 'tailwind']);
    expect(sheet![0]).toEqual(expect.objectContaining({ species: 'Whimsicott', item: 'Focus Sash', ability: 'Prankster', level: 50, gender: 'F', teraType: '' }));
  });
});
