import { describe, expect, test } from 'vitest';
import { buildTeamsFromReplay, inferOpponentTeam } from '../src/index';
import type { RevealedPokemonInfo, DamageObservation } from '../src/types';
import { solveReplaySpreads } from '../src/team-builder';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { parseShowteamSheet } from '../src/opponent-inferrer';
import type { SmogonUsageStats } from '../src/smogon/stats-types';
import { Generations, Pokemon } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';

/**
 * The inference books the name and the shiny flag the replay showed for a body, so the simulator can write the replay's own switch
 * lines. Singles name a body `p2a`, doubles `p1a` or `p1b`; the side key drops the slot. The sources are the first `switch`, `drag`
 * or `replace` line of a body and an Open Team Sheet; team preview (`|poke|`) carries no nickname and no shiny flag.
 */

const header = (kind: 'singles' | 'doubles') => [`|gametype|${kind}`, '|player|p1|A|1|', '|player|p2|B|2|', '|gen|9', '|tier|[Gen 9] Custom Game'];
const preview = ['|clearpoke', '|poke|p1|Pikachu, L50, F|', '|poke|p1|Landorus-Therian, L50, M|', '|poke|p2|Garchomp, L50, F|', '|poke|p2|Clefable, L50, F|', '|teampreview', '|start'];

const infoOf = (log: string, side: 'p1' | 'p2', species: string): RevealedPokemonInfo => {
  const info = inferOpponentTeam(log, side).pokemon.find(mon => mon.species === species);
  if (!info) throw new Error(`no ${species} on ${side}`);
  return info;
};
const identity = (info: RevealedPokemonInfo) => ({ nickname: info.nickname, shiny: info.shiny });

describe('the inference books the replay\'s name and shiny flag', () => {
  test('singles: a switch of p2a names the body; a body only in team preview stays unset', () => {
    const log = [...header('singles'), ...preview, '|switch|p1a: Mouse|Pikachu, L50, F|110/110', '|switch|p2a: Bitey|Garchomp, L50, F, shiny|183/183'].join('\n');
    expect(identity(infoOf(log, 'p2', 'Garchomp'))).toEqual({ nickname: 'Bitey', shiny: true });
    expect(identity(infoOf(log, 'p1', 'Pikachu'))).toEqual({ nickname: 'Mouse', shiny: false });
    expect(identity(infoOf(log, 'p2', 'Clefable'))).toEqual({ nickname: undefined, shiny: undefined });
    expect(identity(infoOf(log, 'p1', 'Landorus-Therian'))).toEqual({ nickname: undefined, shiny: undefined });
  });

  test('doubles: p1a and p1b book alike, from a switch and from a drag', () => {
    const log = [...header('doubles'), ...preview,
      '|switch|p1a: Mouse|Pikachu, L50, F|110/110', '|switch|p1b: NOT ICT|Landorus-Therian, L50, M, shiny|164/164',
      '|switch|p2a: Bitey|Garchomp, L50, F|183/183', '|drag|p2b: Clef|Clefable, L50, F, shiny|170/170'].join('\n');
    expect(identity(infoOf(log, 'p1', 'Pikachu'))).toEqual({ nickname: 'Mouse', shiny: false });
    expect(identity(infoOf(log, 'p1', 'Landorus-Therian'))).toEqual({ nickname: 'NOT ICT', shiny: true });
    expect(identity(infoOf(log, 'p2', 'Garchomp'))).toEqual({ nickname: 'Bitey', shiny: false });
    expect(identity(infoOf(log, 'p2', 'Clefable'))).toEqual({ nickname: 'Clef', shiny: true });
  });

  test('a replace line (Illusion) names the real body, the disguise books to the body it shows', () => {
    const log = [...header('singles'), '|clearpoke', '|poke|p1|Pikachu, L50, F|', '|poke|p1|Zoroark, L50, F|', '|poke|p1|Clefable, L50, F|', '|poke|p2|Garchomp, L50, M|', '|teampreview', '|start',
      '|switch|p1a: Mouse|Pikachu, L50, F|110/110', '|switch|p2a: Bitey|Garchomp, L50, M|183/183',
      '|switch|p1a: Clef|Clefable, L50, F|135/135', '|replace|p1a: Fox|Zoroark, L50, F, shiny'].join('\n');
    expect(identity(infoOf(log, 'p1', 'Clefable'))).toEqual({ nickname: 'Clef', shiny: false });
    expect(identity(infoOf(log, 'p1', 'Zoroark'))).toEqual({ nickname: 'Fox', shiny: true });
  });

  test('an Open Team Sheet names a body the log never showed, and the log wins when both exist', () => {
    const sheet = '|showteam|p2|Bitey|Garchomp||NoAbility|Tackle|Serious||F||S|50|]Clef|Clefable||NoAbility|Tackle|Serious||F|||50|';
    const log = [...header('singles'), sheet, ...preview, '|switch|p1a: Mouse|Pikachu, L50, F|110/110', '|switch|p2a: Landshark|Garchomp, L50, F, shiny|183/183'].join('\n');
    expect(identity(infoOf(log, 'p2', 'Garchomp'))).toEqual({ nickname: 'Landshark', shiny: true });
    expect(identity(infoOf(log, 'p2', 'Clefable'))).toEqual({ nickname: 'Clef', shiny: false });
    const sheetOnly = [...header('singles'), sheet, ...preview].join('\n');
    expect(identity(infoOf(sheetOnly, 'p2', 'Garchomp'))).toEqual({ nickname: 'Bitey', shiny: true });
  });

  test('a name that is the species\' own stays unset, and the shiny flag is still booked', () => {
    const log = [...header('singles'), ...preview, '|switch|p1a: Landorus|Landorus-Therian, L50, M, shiny|164/164', '|switch|p2a: Garchomp|Garchomp, L50, F|183/183'].join('\n');
    expect(identity(infoOf(log, 'p1', 'Landorus-Therian'))).toEqual({ nickname: undefined, shiny: true });
    expect(identity(infoOf(log, 'p2', 'Garchomp'))).toEqual({ nickname: undefined, shiny: false });
  });

  test('a name that is the species of another body of the side stays unset (a lookup by name would find the wrong body)', () => {
    const log = [...header('singles'), ...preview, '|switch|p1a: Landorus-Therian|Pikachu, L50, F|110/110', '|switch|p2a: Bitey|Garchomp, L50, F|183/183',
      '|switch|p1a: Pikachu|Landorus-Therian, L50, M|164/164'].join('\n');
    expect(infoOf(log, 'p1', 'Pikachu').nickname).toBeUndefined();
    expect(infoOf(log, 'p1', 'Landorus-Therian').nickname).toBeUndefined();
  });

  test('two bodies that share one name keep it: the lookups compare the species of the lead beside the name', () => {
    for (const kind of ['singles', 'doubles'] as const) {
      const log = [...header(kind), ...preview, '|switch|p1a: Twin|Pikachu, L50, F, shiny|110/110', '|switch|p1b: Twin|Landorus-Therian, L50, M|164/164'].join('\n');
      expect(identity(infoOf(log, 'p1', 'Pikachu'))).toEqual({ nickname: 'Twin', shiny: true });
      expect(identity(infoOf(log, 'p1', 'Landorus-Therian'))).toEqual({ nickname: 'Twin', shiny: false });
    }
  });

  test('a name the id function reduces to nothing, or to the id of another name of the side, stays: the lookups compare the exact name', () => {
    for (const kind of ['singles', 'doubles'] as const) {
      const log = [...header(kind), '|clearpoke', '|poke|p1|Pikachu, L50, F|', '|poke|p1|Landorus-Therian, L50, M|', '|poke|p1|Clefable, L50, F|', '|poke|p1|Garchomp, L50, F|',
        '|poke|p2|Garchomp, L50, F|', '|poke|p2|Clefable, L50, F|', '|teampreview', '|start',
        '|switch|p1a: 我大哥|Pikachu, L50, F, shiny|110/110', '|switch|p1b: うみのうた|Landorus-Therian, L50, M|164/164',
        '|switch|p2a: Rias!|Garchomp, L50, F|183/183', '|switch|p2b: Rias?|Clefable, L50, F|170/170', '|switch|p1a: Akeno【‿♥‿】|Clefable, L50, F|170/170',
        '|switch|p1b: Rias!|Garchomp, L50, F|183/183'].join('\n');
      expect(identity(infoOf(log, 'p1', 'Pikachu'))).toEqual({ nickname: '我大哥', shiny: true });
      expect(infoOf(log, 'p1', 'Landorus-Therian').nickname).toBe('うみのうた');
      expect(infoOf(log, 'p1', 'Clefable').nickname).toBe('Akeno【‿♥‿】');
      expect(infoOf(log, 'p2', 'Garchomp').nickname).toBe('Rias!');
      expect(infoOf(log, 'p2', 'Clefable').nickname).toBe('Rias?');
      // The same text on the other side is no clash: a name is read against its own side's bodies.
      expect(infoOf(log, 'p1', 'Garchomp').nickname).toBe('Rias!');
    }
  });

  test('a quote or a backslash in a name stays: the stream\'s JSON line is built with JSON.stringify', () => {
    const log = [...header('singles'), ...preview, '|switch|p1a: J36Venom/\\|Pikachu, L50, F|110/110', '|switch|p2a: Say "hi"|Garchomp, L50, F|183/183'].join('\n');
    expect(infoOf(log, 'p1', 'Pikachu').nickname).toBe('J36Venom/\\');
    expect(infoOf(log, 'p2', 'Garchomp').nickname).toBe('Say "hi"');
  });
});

describe('a line without a gender', () => {
  test('a body shown with no gender whose species has one is booked as genderless; a gendered or a genderless species is not', () => {
    const log = [...header('singles'), '|clearpoke', '|poke|p1|Noivern, L50|', '|poke|p1|Magnezone, L50|', '|poke|p1|Ogerpon-Cornerstone, L50, F|', '|poke|p2|Garchomp, L50, F|', '|teampreview', '|start',
      '|switch|p1a: Steve|Noivern, L50|161/161', '|switch|p2a: Bitey|Garchomp, L50, F|183/183', '|switch|p1a: Mag|Magnezone, L50|150/150', '|switch|p1a: Regi|Ogerpon-Cornerstone, L50|180/180'].join('\n');
    expect(infoOf(log, 'p1', 'Noivern').noGender).toBe(true);
    expect(infoOf(log, 'p1', 'Ogerpon-Cornerstone').noGender).toBe(true);
    expect(infoOf(log, 'p1', 'Magnezone').noGender).toBeUndefined();
    expect(infoOf(log, 'p2', 'Garchomp').noGender).toBeUndefined();
    const { p1Team, p2Team } = buildTeamsFromReplay(log);
    expect(p1Team.find(mon => mon.species === 'Noivern')?.gender).toBe('N');
    expect(p2Team.find(mon => mon.species === 'Garchomp')?.gender).toBe('F');
  });
});

describe('the built sets carry the booked name and shiny flag', () => {
  test('singles and doubles alike; an unrevealed body keeps the species and no shiny', () => {
    for (const kind of ['singles', 'doubles'] as const) {
      const log = [...header(kind), ...preview, '|switch|p1a: Mouse|Pikachu, L50, F, shiny|110/110', '|switch|p2a: Bitey|Garchomp, L50, F|183/183'].join('\n');
      const { p1Team, p2Team } = buildTeamsFromReplay(log);
      expect(p1Team.find(mon => mon.species === 'Pikachu')).toEqual(expect.objectContaining({ name: 'Mouse', shiny: true, level: 50, gender: 'F' }));
      expect(p2Team.find(mon => mon.species === 'Garchomp')).toEqual(expect.objectContaining({ name: 'Bitey' }));
      expect(p2Team.find(mon => mon.species === 'Garchomp')?.shiny).toBeFalsy();
      expect(p2Team.find(mon => mon.species === 'Clefable')).toEqual(expect.objectContaining({ name: 'Clefable' }));
      expect(p1Team.find(mon => mon.species === 'Landorus-Therian')?.shiny).toBeFalsy();
    }
  });

  test('the replay\'s name outranks a pasted team\'s nickname for a body it showed', () => {
    const log = [...header('singles'), ...preview, '|switch|p1a: Mouse|Pikachu, L50, F|110/110', '|switch|p2a: Bitey|Garchomp, L50, F|183/183'].join('\n');
    const paste = 'Pikachu Prime (Pikachu) (F) @ Light Ball\nAbility: Static\nLevel: 50\n- Tackle\n\nLandorus Hero (Landorus-Therian) (M)\nAbility: Intimidate\nLevel: 50\n- Tackle';
    const { p1Team } = buildTeamsFromReplay(log, { userTeamText: paste });
    expect(p1Team.find(mon => mon.species === 'Pikachu')?.name).toBe('Mouse');
    // The body the replay never showed keeps the paste's own name.
    expect(p1Team.find(mon => mon.species === 'Landorus-Therian')?.name).toBe('Landorus Hero');
  });
});

const contradictory = (attackerSpecies: string, defenderSpecies: string, moveId: string): DamageObservation[] =>
  [0.10, 0.60].map(observedFraction => ({
    attackerSpecies, defenderSpecies, attackerSide: 'p1' as const, moveId, observedFraction, lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  }));

const singlesLog = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU',
  '|poke|p1|Garchomp, M|', '|poke|p2|Gliscor, M|',
  '|start', '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p2a: Gliscor|Gliscor, M|100/100', '|turn|1',
  '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
  '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
].join('\n');

const doublesLog = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|gametype|doubles', '|tier|[Gen 9] Doubles OU',
  '|poke|p1|Garchomp, M|', '|poke|p1|Amoonguss, M|', '|poke|p2|Gliscor, M|', '|poke|p2|Dondozo, M|',
  '|start',
  '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p1b: Amoonguss|Amoonguss, M|100/100',
  '|switch|p2a: Gliscor|Gliscor, M|100/100', '|switch|p2b: Dondozo|Dondozo, M|100/100', '|turn|1',
  '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
  '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
].join('\n');

describe('the one-stage chain carries the pre-solve at a forfeit', () => {
  test.each([['singles', singlesLog], ['doubles', doublesLog]])('%s: raw observations build what the app chain builds', (_, log) => {
    const { speedOrders } = parseReplayLogWithObservations(log);
    expect(speedOrders).toHaveLength(1);
    const observations = contradictory('Garchomp', 'Gliscor', 'dragonclaw');

    const app = buildTeamsFromReplay(log, { inferredSpreads: solveReplaySpreads(log, observations, { speedOrders }) });
    const oneStage = buildTeamsFromReplay(log, { observations, speedOrders });
    expect(oneStage).toEqual(app);
    expect(oneStage).toEqual(buildTeamsFromReplay(log, { speedOrders }));
  });
});

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

describe('open team sheets (|showteam|) parsing', () => {
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

const gen = Generations.get(9);
const speedOf = (set: PokemonSet) =>
  new Pokemon(gen, set.species, { level: set.level, nature: set.nature, evs: set.evs, ivs: set.ivs }).stats.spe;
const find = (team: PokemonSet[], species: string) => team.find(set => set.species === species)!;

describe('the two-stage solve keeps the move orders its pre-solve repaired', () => {
  test('singles: a forfeited mon keeps the pre-solve\'s Speed', () => {
    // The species-shaped guess fields both at 252 Spe: Garchomp 303, Gliscor 289. The log says Gliscor moved first.
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU',
      '|poke|p1|Garchomp, M|', '|poke|p2|Gliscor, M|',
      '|start', '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p2a: Gliscor|Gliscor, M|100/100', '|turn|1',
      '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
      '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
    ].join('\n');
    const { speedOrders } = parseReplayLogWithObservations(log);
    expect(speedOrders).toHaveLength(1);

    const guess = buildTeamsFromReplay(log);
    expect(speedOf(find(guess.p2Team, 'Gliscor'))).toBeLessThan(speedOf(find(guess.p1Team, 'Garchomp')));

    const preSolved = buildTeamsFromReplay(log, { speedOrders });
    expect(speedOf(find(preSolved.p2Team, 'Gliscor'))).toBeGreaterThanOrEqual(speedOf(find(preSolved.p1Team, 'Garchomp')));

    const solved = solveReplaySpreads(log, contradictory('Garchomp', 'Gliscor', 'dragonclaw'), { speedOrders });
    const built = buildTeamsFromReplay(log, { inferredSpreads: solved });
    expect(speedOf(find(built.p2Team, 'Gliscor'))).toBeGreaterThanOrEqual(speedOf(find(built.p1Team, 'Garchomp')));
    // Forfeited to the pre-solve, not past it: the app's build is the pre-solve's build.
    expect(built).toEqual(preSolved);
  });

  test('doubles: a forfeited mon keeps the pre-solve\'s Speed', () => {
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|gametype|doubles', '|tier|[Gen 9] Doubles OU',
      '|poke|p1|Garchomp, M|', '|poke|p1|Amoonguss, M|', '|poke|p2|Gliscor, M|', '|poke|p2|Dondozo, M|',
      '|start',
      '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p1b: Amoonguss|Amoonguss, M|100/100',
      '|switch|p2a: Gliscor|Gliscor, M|100/100', '|switch|p2b: Dondozo|Dondozo, M|100/100', '|turn|1',
      '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
      '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
    ].join('\n');
    const { speedOrders } = parseReplayLogWithObservations(log);
    expect(speedOrders).toHaveLength(1);

    const preSolved = buildTeamsFromReplay(log, { speedOrders });
    const solved = solveReplaySpreads(log, contradictory('Garchomp', 'Gliscor', 'dragonclaw'), { speedOrders });
    const built = buildTeamsFromReplay(log, { inferredSpreads: solved });
    expect(speedOf(find(built.p2Team, 'Gliscor'))).toBeGreaterThanOrEqual(speedOf(find(built.p1Team, 'Garchomp')));
    expect(built).toEqual(preSolved);
  });

  /** The scene of the carry tests: Gliscor moves before Garchomp, each hits the other once. */
  const scene = [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] OU',
    '|poke|p1|Garchomp, M|', '|poke|p2|Gliscor, M|',
    '|start', '|switch|p1a: Garchomp|Garchomp, M|100/100', '|switch|p2a: Gliscor|Gliscor, M|100/100', '|turn|1',
    '|move|p2a: Gliscor|Knock Off|p1a: Garchomp', '|-damage|p1a: Garchomp|80/100',
    '|move|p1a: Garchomp|Dragon Claw|p2a: Gliscor', '|-damage|p2a: Gliscor|60/100', '|turn|2',
  ].join('\n');
  /** A usage spread that runs Garchomp at 0 Speed with half the EV budget open (252 Atk only). */
  const slowGarchomp: SmogonUsageStats = {
    format: 'gen9ou', month: 'test', source: 'test',
    pokemon: {
      Garchomp: {
        species: 'Garchomp', rawCount: 1, abilities: [], items: [], moves: [],
        spreads: [{
          value: 'Adamant:0/252/0/0/0/0', probability: 1, sourceDetail: 'test', nature: 'Adamant',
          evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 },
        }],
      },
    },
  };

  test('a mon the full solve keeps is still solved by the full solve', () => {
    // Clean damage lines do not forfeit: the carry must not overwrite the full solve's answer.
    // The usage guess already runs Garchomp (240) under Gliscor (289), so no order needs repair; the pre-solve tops the open half
    // of the budget up into HP, the full solve's damage lines take it back.
    const log = scene;
    const { observations, speedOrders } = parseReplayLogWithObservations(log);
    const doubled = [...observations, ...observations];
    const usageStats = slowGarchomp;
    const solved = solveReplaySpreads(log, doubled, { speedOrders, usageStats });
    const oneStage = buildTeamsFromReplay(log, { observations: doubled, speedOrders, usageStats });
    const preSolved = buildTeamsFromReplay(log, { speedOrders, usageStats });
    const built = buildTeamsFromReplay(log, { inferredSpreads: solved, usageStats });
    expect(speedOf(find(built.p2Team, 'Gliscor'))).toBeGreaterThanOrEqual(speedOf(find(built.p1Team, 'Garchomp')));
    expect(speedOf(find(oneStage.p2Team, 'Gliscor'))).toBeGreaterThanOrEqual(speedOf(find(oneStage.p1Team, 'Garchomp')));
    // Garchomp is the mon an overwriting carry would destroy: the full solve fits its damage with less HP than the pre-solve topped
    // the freed Speed up into (only the HP the damage lines allow, not 0).
    expect(built).toEqual(oneStage);
    expect(built).not.toEqual(preSolved);
    expect(find(built.p1Team, 'Garchomp').evs.hp).toBeLessThan(find(preSolved.p1Team, 'Garchomp').evs.hp);
    expect(find(preSolved.p1Team, 'Garchomp').evs.hp).toBe(252);
  });

  test('the two chains agree on the settled Garchomp: HP 60 both ways', () => {
    // The species-shaped guesses run Garchomp (303) over Gliscor (289), which moved first. The settling frees only 60 Speed EVs
    // (Garchomp 288); the pre-solve tops them up into HP, and the full solve keeps that HP because the damage lines fit it as well
    // as none, so both chains land on HP 60.
    const { observations, speedOrders } = parseReplayLogWithObservations(scene);
    const doubled = [...observations, ...observations];
    const built = buildTeamsFromReplay(scene, { inferredSpreads: solveReplaySpreads(scene, doubled, { speedOrders }) });
    const oneStage = buildTeamsFromReplay(scene, { observations: doubled, speedOrders });
    expect([find(built.p1Team, 'Garchomp').evs.hp, find(built.p1Team, 'Garchomp').evs.spe]).toEqual([60, 192]);
    expect([find(oneStage.p1Team, 'Garchomp').evs.hp, find(oneStage.p1Team, 'Garchomp').evs.spe]).toEqual([60, 192]);
    expect(speedOf(find(built.p2Team, 'Gliscor'))).toBeGreaterThan(speedOf(find(built.p1Team, 'Garchomp')));
  });
});
