import { test, expect } from '@playwright/test';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { inferOpponentTeam, parseShowteamSheet } from '../src/lib/opponent-inferrer';
import type { SmogonUsageStats } from '../src/lib/smogon-stats';

// Real |showteam| payload shape from a VGC Open Team Sheets replay (B3):
// packed team format with CamelCase names and pipes inside the payload.
const showteamLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|tier|[Gen 9] VGC 2026',
  '|clearpoke',
  '|poke|p1|Swampert, L50, F|item',
  '|poke|p1|Pelipper, L50, M|item',
  '|poke|p2|Hydreigon, L50, M|item',
  '|poke|p2|Froslass, L50, F|item',
  '|showteam|p1|Swampert||Swampertite|Damp|WaveCrash,IcePunch,HighHorsepower,Protect|Adamant||F|||50|]Pelipper||LifeOrb|Drizzle|Tailwind,WeatherBall,Hurricane,WideGuard|Modest||M|||50|',
  '|showteam|p2|Hydreigon||ChoiceScarf|Levitate|DarkPulse,DracoMeteor,Flamethrower,EarthPower|Timid||M|||50|]Froslass||FocusSash|CursedBody|AuroraVeil,Protect,IcyWind,DestinyBond|Timid||F|||50|',
  '|teampreview',
  '|start',
  '|switch|p1a: Swampert|Swampert, L50, F|100/100',
  '|switch|p2a: Hydreigon|Hydreigon, L50, M|100/100',
  '|turn|1',
].join('\n');

test.describe('open team sheets (|showteam|) parsing (B3)', () => {
  test('parseShowteamSheet extracts sets with readable names', () => {
    const sheet = parseShowteamSheet(showteamLog, 'p2');
    expect(sheet).not.toBeNull();
    expect(sheet!.map(pokemon => pokemon.species)).toEqual(['Hydreigon', 'Froslass']);
    expect(sheet![0].item).toBe('Choice Scarf');
    expect(sheet![0].ability).toBe('Levitate');
    expect(sheet![1].moves).toEqual(['Aurora Veil', 'Protect', 'Icy Wind', 'Destiny Bond']);
    expect(sheet![1].level).toBe(50);
  });

  test('inferOpponentTeam marks team sheet data as revealed instead of guessing', () => {
    const info = inferOpponentTeam(showteamLog, 'p2');
    const hydreigon = info.pokemon.find(pokemon => pokemon.species === 'Hydreigon');
    const froslass = info.pokemon.find(pokemon => pokemon.species === 'Froslass');

    expect(hydreigon?.item).toEqual(expect.objectContaining({ value: 'Choice Scarf', source: 'revealed' }));
    expect(hydreigon?.ability).toEqual(expect.objectContaining({ value: 'Levitate', source: 'revealed' }));
    expect(froslass?.moves.map(move => move.name))
      .toEqual(expect.arrayContaining(['Aurora Veil', 'Protect', 'Icy Wind', 'Destiny Bond']));
    expect(froslass?.moves.every(move => move.source === 'revealed')).toBe(true);
  });

  test('buildTeamsFromReplay uses the team sheet sets instead of Smogon guesses', () => {
    const { p1Team, p2Team } = buildTeamsFromReplay(showteamLog);

    const swampert = p1Team.find(set => set.species === 'Swampert');
    expect(swampert?.item).toBe('Swampertite');
    expect(swampert?.ability).toBe('Damp');
    expect(swampert?.moves).toEqual(
      expect.arrayContaining(['Wave Crash', 'Ice Punch', 'High Horsepower', 'Protect']),
    );
    expect(swampert?.nature).toBe('Adamant');
    expect(swampert?.level).toBe(50);

    const froslass = p2Team.find(set => set.species === 'Froslass');
    expect(froslass?.moves).toEqual(
      expect.arrayContaining(['Aurora Veil', 'Protect', 'Icy Wind', 'Destiny Bond']),
    );
    expect(froslass?.item).toBe('Focus Sash');
  });

  test('manual move edits beat a full team sheet set (Kyurem/Draco Meteor report)', () => {
    const p1Info = inferOpponentTeam(showteamLog, 'p1');
    const edited = {
      pokemon: p1Info.pokemon.map(pokemon => pokemon.species !== 'Swampert' ? pokemon : {
        ...pokemon,
        moves: [
          ...pokemon.moves.filter(move => move.name !== 'Ice Punch'),
          { name: 'Earthquake', source: 'manual' as const },
        ],
      }),
    };

    const { p1Team } = buildTeamsFromReplay(showteamLog, { p1Info: edited });
    const swampert = p1Team.find(set => set.species === 'Swampert');

    expect(swampert?.moves).toContain('Earthquake');
    expect(swampert?.moves).not.toContain('Ice Punch');
    expect(swampert?.moves).toHaveLength(4);
  });

  test('team sheet EVs fall back to usage spreads instead of all-zero spreads', () => {
    const usageStats: SmogonUsageStats = {
      format: 'gen9vgc2026',
      month: '2026-06',
      source: 'test',
      pokemon: {
        hydreigon: {
          species: 'Hydreigon',
          rawCount: 100,
          abilities: [],
          items: [],
          moves: [],
          spreads: [{
            value: 'Timid:0/0/4/252/0/252',
            probability: 0.5,
            nature: 'Timid',
            evs: { hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 },
          }],
        },
      },
    };

    const { p2Team } = buildTeamsFromReplay(showteamLog, { usageStats });
    const hydreigon = p2Team.find(set => set.species === 'Hydreigon');
    expect(hydreigon?.evs).toEqual({ hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 });
  });
});
