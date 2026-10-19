import { beforeAll, describe, expect, test } from 'vitest';
import { Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { parsePastedTeam, type PastedSet } from '../src/team-paste.ts';
import { EMPTY_EVS, itemSetValue } from '../src/team-info.ts';
import type { PokemonEvs } from '../src/types.ts';
import { fixtureTexts, GENERATIONS, generatedTeams, withCorners } from './team-text-sources.ts';

/**
 * Round 72, T241 step 1b: a pasted team goes through the library. `parsePastedTeam` reads a Showdown export with
 * `Teams.import` (@pkmn/sim, which delegates to @pkmn/sets). The hand parser it replaced lives on below as
 * `legacyParsePastedTeam`, and this spec holds the library's reading to it on every "View team" export of the fixtures,
 * on simulator-generated teams of generations 1 to 9 (plain and with nicknames, genders, shiny, levels, Tera types, a
 * typed Hidden Power and a set without EVs), and on a list of awkward pastes. Census at the change (262 texts: 6 replay
 * exports, 216 generated teams, 40 with corners): equal on every field except two spellings, named as findings and pinned.
 *   F1  A typed Hidden Power: the hand parser kept "Hidden Power [Water]", the library reads the Dex name
 *       "Hidden Power Water" (43 moves in 42 texts; no reader of the sets looks at the brackets).
 *   F4  An `IVs:` line that lists no stat: the hand parser read no IVs, the library reads the default 31s (both mean the
 *       same spread; the stats panel now shows them as the paste's own).
 *   F3  A species the bundled Dex does not know: the hand parser kept the text as written ("Species Only"), the library
 *       reads its id ("speciesonly"). The census found none in 6 exports; the sim cannot build such a set either.
 * Singles and doubles do not part here: a paste carries no game type, and the generated teams cover every generation.
 */

const STAT_KEYS: Record<string, keyof PokemonEvs> = { hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe' };

function legacyStatLine(line: string, prefix: RegExp, base: PokemonEvs, max: number): PokemonEvs | undefined {
  const values: PokemonEvs = { ...base };
  let any = false;
  for (const part of line.replace(prefix, '').split('/')) {
    const match = part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
    if (!match) continue;
    const key = STAT_KEYS[match[2].toLowerCase()];
    if (!key) continue;
    values[key] = Math.min(max, Math.max(0, parseInt(match[1], 10)));
    any = true;
  }
  return any ? values : undefined;
}

function legacyHeader(header: string): { species: string; nickname?: string; item?: string } | null {
  const [nameSide, itemSide] = header.split('@').map(part => part.trim());
  if (!nameSide) return null;
  let working = nameSide.replace(/\s*\((M|F)\)\s*$/i, '').trim();
  let nickname: string | undefined;
  const nickMatch = working.match(/^(.*)\(([^()]+)\)\s*$/);
  if (nickMatch) {
    nickname = nickMatch[1].trim() || undefined;
    working = nickMatch[2].trim();
  }
  if (!working) return null;
  return { species: working, nickname, item: itemSide ? itemSetValue(itemSide) || undefined : undefined };
}

/** The hand parser as it stood before round 72 (packages/replay-core/src/team-paste.ts). */
function legacyParsePastedTeam(teamText: string): PastedSet[] {
  const sets: PastedSet[] = [];
  for (const block of teamText.replace(/\r\n?/g, '\n').split(/\n\s*\n+/)) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const moves = lines.filter(line => line.startsWith('- ')).map(line => line.slice(2).trim()).filter(Boolean);
    if (moves.length === 0) continue;
    const header = legacyHeader(lines[0]);
    if (!header) continue;
    const abilityLine = lines.find(line => /^Ability:/i.test(line));
    const teraLine = lines.find(line => /^Tera Type:/i.test(line));
    const evLine = lines.find(line => /^EVs:/i.test(line));
    const natureLine = lines.find(line => /^[A-Za-z]+\s+Nature$/i.test(line));
    const ivLine = lines.find(line => /^IVs:/i.test(line));
    const levelLine = lines.find(line => /^Level:\s*\d+$/i.test(line));
    sets.push({
      ...header,
      ability: abilityLine?.replace(/^Ability:/i, '').trim() || undefined,
      teraType: teraLine?.replace(/^Tera Type:/i, '').trim() || undefined,
      evs: evLine ? legacyStatLine(evLine, /^EVs:/i, EMPTY_EVS, 252) : undefined,
      nature: natureLine?.replace(/\s+Nature$/i, '').trim() || undefined,
      ivs: ivLine ? legacyStatLine(ivLine, /^IVs:/i, { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, 31) : undefined,
      level: levelLine ? parseInt(levelLine.replace(/^Level:/i, '').trim(), 10) : undefined,
      moves: moves.slice(0, 4),
    });
  }
  return sets;
}

/** F1: the hand parser's bracket form of a typed Hidden Power, in the library's (the Dex's) spelling. */
const dexSpelling = (sets: PastedSet[]): PastedSet[] =>
  sets.map(set => ({ ...set, moves: set.moves.map(move => move.replace(/^(Hidden Power) \[(\w+)\]$/, '$1 $2')) }));

const fixtures = fixtureTexts();

describe('parsePastedTeam reads like the hand parser did, through Teams.import', () => {
  const generated = new Map<number, PokemonSet[][]>();
  beforeAll(async () => {
    for (const gen of GENERATIONS) generated.set(gen, await generatedTeams(gen, 6));
  }, 120_000);

  test('the fixtures hold View-team exports', () => {
    expect(fixtures.exports.length).toBeGreaterThanOrEqual(1);
  });

  test.each(fixtures.exports.map((e, i) => [`${e.tag} #${i}`, e.text] as const))('replay export %s', (_tag, text) => {
    expect(parsePastedTeam(text)).toEqual(dexSpelling(legacyParsePastedTeam(text)));
  });

  test.each(GENERATIONS)('simulator-generated teams of generation %i, plain and with corner cases', (gen) => {
    const teams = generated.get(gen)!;
    expect(teams.length).toBeGreaterThanOrEqual(6);
    for (const team of teams) {
      for (const text of [Teams.export(team), Teams.export(withCorners(team))]) {
        const sets = legacyParsePastedTeam(text);
        expect(sets.length).toBeGreaterThan(0);
        expect(parsePastedTeam(text)).toEqual(dexSpelling(sets));
      }
    }
  });

  test('awkward pastes: clamps, empty lines, placeholders, five moves, a set without moves', () => {
    const pastes = [
      'Garchomp @ Loaded Dice\nAbility: Rough Skin\nLevel: 78\nTera Type: Steel\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\nIVs: 0 SpA / 29 Spe\n- Earthquake\n- Scale Shot\n- Swords Dance\n- Protect\n- Outrage',
      'Garchomp\nEVs: 300 HP / 0 Atk\nIVs: 40 Def\n- Earthquake',
      'Sneasler @ Heavy-Duty Boots (consumed)\n- Close Combat',
      'Sneasler @ (has item)\n- Close Combat',
      'Nick (Urshifu-Rapid-Strike) (F) @ Mystic Water\nAbility: Unseen Fist\n- Surging Strikes',
      'Gengar (M)\nEVs:\n- Shadow Ball',
      'Charizard-Mega-Y @ Charizardite Y\nAbility: Drought\n- Solar Beam\n\n\n\nTyranitar\n- Crunch',
      'Pikachu @ Light Ball\nAbility: Static',
      'Pikachu @ Light Ball\nAbility: Static\n\nRaichu\n- Thunderbolt',
      'asdf asdf',
      '',
    ];
    for (const text of pastes) expect(parsePastedTeam(text), text).toEqual(dexSpelling(legacyParsePastedTeam(text)));
  });

  test('Windows line endings read like Unix ones', () => {
    const text = Teams.export(generated.get(9)![0]);
    expect(parsePastedTeam(text.replace(/\n/g, '\r\n'))).toEqual(parsePastedTeam(text));
  });

  test('F1: a typed Hidden Power reads as the Dex names it', () => {
    const sets = parsePastedTeam('Starmie\n- Hidden Power [Fire]\n- Surf\n\nSalamence\n- Hidden Power Ice\n- Dragon Dance');
    expect(sets.map(set => set.moves[0])).toEqual(['Hidden Power Fire', 'Hidden Power Ice']);
  });

  test('F4: an IVs line with no stat reads as the default spread', () => {
    expect(parsePastedTeam('Gengar\nIVs: x\n- Shadow Ball')[0].ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
  });

  test('F3: a species the Dex does not know reads as its id', () => {
    expect(parsePastedTeam('Species Only (M)\n- Tackle').map(set => set.species)).toEqual(['speciesonly']);
  });
});
