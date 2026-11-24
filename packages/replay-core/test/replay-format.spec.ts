import './champions-mod';
import * as pkmnClient from '@pkmn/client';
import { test, expect, describe } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { Battle } from '@pkmn/sim';
import {
  formatEnforcesSleepClause,
  replayRuleset,
  getBranchSimulatorFormat,
  getReplayGameType,
  inferReplayFormatId,
  splitReplayPassword,
} from '../src/replay-format';
import { fileURLToPath } from 'node:url';
import {
  buildTeamsFromReplay,
  extractTeamSheets,
  getReplayBringCount,
  getReplayDisplayFormat,
  getReplayGeneration,
  inferOpponentTeam,
  parsePastedTeam,
  parseReplayLog,
  parseReplayLogWithObservations,
  replayBringOnly,
  solveReplaySpreads,
  generationsFor,
} from '../src/index';
import { parseShowteamSheet } from '../src/opponent-inferrer';
import { observedMaxHp } from '../src/spreads/max-hp';

const vgcReplay = {
  id: 'gen9championsvgc2026regmb-2639020147',
  format: '[Gen 9 Champions] VGC 2026 Reg M-B',
  players: ['Lacksatives', 'PleaseRememberMe'],
  log: [
    '|j|Lacksatives',
    '|j|PleaseRememberMe',
    '|gametype|doubles',
    '|player|p1|Lacksatives|swimmer-masters|1179',
    '|player|p2|PleaseRememberMe|266|1183',
    '|gen|9',
    '|tier|[Gen 9 Champions] VGC 2026 Reg M-B',
    '|clearpoke',
    '|poke|p1|Scizor, L50, F|',
    '|poke|p1|Rotom-Wash, L50|',
    '|poke|p1|Sneasler, L50, M|',
    '|poke|p1|Tyranitar, L50, M|',
    '|poke|p2|Eelektross, L50, M|',
    '|poke|p2|Annihilape, L50, F|',
    '|poke|p2|Grimmsnarl, L50, M|',
    '|poke|p2|Politoed, L50, M|',
    '|teampreview|4',
    '|start',
    '|switch|p1a: Scizor|Scizor, L50, F|100/100',
    '|switch|p1b: Sneasler|Sneasler, L50, M|100/100',
    '|switch|p2a: Eelektross|Eelektross, L50, M|100/100',
    '|switch|p2b: Annihilape|Annihilape, L50, F|100/100',
    '|turn|1',
  ].join('\n'),
  uploadtime: 1782410309,
  views: 0,
};

describe('replay format inference', () => {
  test('infers missing Showdown format ids from replay ids', () => {
    expect(inferReplayFormatId(vgcReplay)).toBe('gen9championsvgc2026regmb');
    expect(getReplayGameType(vgcReplay.log)).toBe('doubles');
  });

  test('normalizes smogtours replay ids to real format ids', () => {
    expect(inferReplayFormatId({
      id: 'smogtours-gen3ou-56583',
      log: '|gen|3\n|tier|[Gen 3] OU',
    })).toBe('gen3ou');

    // Smogtours ids can omit the generation entirely — it comes from the log.
    expect(inferReplayFormatId({
      id: 'smogtours-ubers-54583',
      log: '|gen|6\n|tier|[Gen 6] Ubers',
    })).toBe('gen6ubers');

    expect(getBranchSimulatorFormat({
      id: 'smogtours-gen3ou-56583',
      log: '|gametype|singles\n|gen|3\n|tier|[Gen 3] OU',
    })).toBe('gen3ou');
  });

  test('maps VGC replay formats to a supported doubles simulator format', () => {
    expect(getBranchSimulatorFormat({ id: 'gen9vgc2026regi-2630181744', log: '|gametype|doubles\n|gen|9\n|tier|[Gen 9] VGC 2026 Reg I' })).toBe('gen9doublesou');
    expect(getBranchSimulatorFormat({ id: 'gen9vgc2024regh-2160552710', log: '|gametype|doubles\n|gen|9' })).toBe('gen9doublesou');
  });

  // Champions branches on the Champions mod of @pkmn/mods. Singles play the mod's OU, doubles its Doubles Custom Game, which brings the
  // whole team as Doubles OU does (the reconstruction trims to the brought Pokémon itself; a VGC format's team preview would keep the
  // first four). The regulation (M-A, M-B, M-C) changes only legality, and a mod format takes no custom-rule suffix.
  test('Champions replays branch on the Champions mod\'s formats', () => {
    expect(getBranchSimulatorFormat(vgcReplay)).toBe('gen9championsdoublescustomgame');
    for (const id of ['gen9championsvgc2026regma-2604410427', 'gen9championsvgc2026regmabo3-2603652560', 'gen9championsvgc2026regmc-2695803506',
      'gen9championsvgc2026regmbbo3-2634199230']) {
      expect(getBranchSimulatorFormat({ id, log: '|gametype|doubles\n|gen|9' }), id).toBe('gen9championsdoublescustomgame');
    }
    expect(getBranchSimulatorFormat({ id: 'gen9championsou-2628340185', log: '|gametype|singles\n|gen|9\n|tier|[Gen 9 Champions] OU' }))
      .toBe('gen9championsou');
    // A Champions OU log declares Sleep Moves Clause, never Sleep Clause Mod; a rule-less one still gets no suffix.
    expect(getBranchSimulatorFormat({ id: 'gen9championsou-1', log: '|gametype|singles\n|gen|9\n|tier|[Gen 9 Champions] OU\n|rule|Sleep Clause Mod: Limit one foe put to sleep' }))
      .toBe('gen9championsou');
    expect(getBranchSimulatorFormat({ id: 'gen9championsou-2', log: '|gametype|singles\n|gen|9' })).toBe('gen9championsou');
  });

  test('preserves standard singles simulator formats', () => {
    expect(getBranchSimulatorFormat({
      ...vgcReplay,
      id: 'gen9ou-123',
      format: '[Gen 9] OU',
      formatid: 'gen9ou',
      log: vgcReplay.log.replace('|gametype|doubles', '|gametype|singles'),
    })).toBe('gen9ou');
  });

  test('unknown singles formats run as custom games with Sleep Clause resolved from the log', () => {
    expect(getBranchSimulatorFormat({
      id: 'gen9draft-123',
      log: '|gametype|singles\n|gen|9\n|rule|Sleep Clause Mod: Limit one foe put to sleep',
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    expect(getBranchSimulatorFormat({
      id: 'gen9draft-123',
      log: '|gametype|singles\n|gen|9\n|rule|OHKO Clause: OHKO moves are banned',
    })).toBe('gen9customgame');

    // A colon-less |rule| line is a pipeline watermark, not a ruleset —
    // the singles default still applies (GPL video reconstructions).
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: '|gametype|singles\n|gen|9\n|rule|Reconstructed from video by gpl-pipeline - best effort',
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    // NO rule lines at all (video pipelines): singles-standard default.
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: '|gametype|singles\n|gen|9\n|tier|[Gen 9] Custom Game',
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    // …unless the log itself shows a second simultaneous sleep.
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: [
        '|gametype|singles', '|gen|9', '|tier|[Gen 9] Custom Game',
        '|move|p1a: A|Spore|p2a: X', '|-status|p2a: X|slp',
        '|move|p1a: A|Spore|p2a: Y', '|-status|p2a: Y|slp',
      ].join('\n'),
    })).toBe('gen9customgame');

    // Rest sleeps never count against the clause detection.
    expect(getBranchSimulatorFormat({
      id: 'gen9customgame-99',
      log: [
        '|gametype|singles', '|gen|9', '|tier|[Gen 9] Custom Game',
        '|move|p1a: A|Spore|p2a: X', '|-status|p2a: X|slp',
        '|move|p2a: Y|Rest|p2a: Y', '|-status|p2a: Y|slp|[from] move: Rest',
      ].join('\n'),
    })).toBe('gen9customgame@@@Sleep Clause Mod');

    // Real formats are their own rule authority and never get suffixed:
    // gen3ou carries the clause natively; gen9 OU bans sleep moves instead.
    expect(getBranchSimulatorFormat({
      id: 'gen9ou-123',
      log: '|gametype|singles\n|gen|9\n|tier|[Gen 9] OU',
    })).toBe('gen9ou');
    expect(formatEnforcesSleepClause('gen3ou')).toBe(true);
    expect(formatEnforcesSleepClause('gen9ou')).toBe(false);
    expect(formatEnforcesSleepClause('gen9customgame')).toBe(false);
    expect(formatEnforcesSleepClause('gen9customgame@@@Sleep Clause Mod')).toBe(true);
  });

  // A draft game that declares "Terastal Clause" ran as a Custom Game that offered Tera (gen9natdexdraft-2713067801: "Tera (Psychic)"
  // in the tray, Execute Turn terastallized). The clause rides the branch format like Sleep Clause, in singles and in doubles; the
  // simulator is the oracle for what the format then offers.
  describe('Terastal Clause from the log', () => {
    const rules = '|rule|Sleep Clause Mod: Limit one foe put to sleep\n|rule|Terastal Clause: You cannot Terastallize';
    const mon = {
      name: 'Garchomp', species: 'Garchomp', item: '', ability: 'Rough Skin', moves: ['Earthquake'], nature: 'Hardy', gender: '', level: 50,
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, teraType: 'Steel',
    };
    const offersTera = (formatid: string) => {
      const battle = new Battle({ formatid: formatid as never, seed: '1,2,3,4', p1: { name: 'A', team: [mon] }, p2: { name: 'B', team: [mon] } });
      return battle.sides[0].pokemon[0].canTerastallize !== null;
    };

    test('singles draft: the Custom Game carries both clauses, and the simulator offers no Tera', () => {
      const withClause = getBranchSimulatorFormat({ id: 'gen9natdexdraft-1', log: `|gametype|singles\n|gen|9\n${rules}` });
      expect(withClause).toBe('gen9customgame@@@Sleep Clause Mod,Terastal Clause');
      expect(offersTera(withClause)).toBe(false);
      // Without the line the same game keeps Tera (the control), and the clause alone rides without Sleep Clause.
      const without = getBranchSimulatorFormat({ id: 'gen9natdexdraft-2', log: '|gametype|singles\n|gen|9\n|rule|Sleep Clause Mod: Limit one foe put to sleep' });
      expect(without).toBe('gen9customgame@@@Sleep Clause Mod');
      expect(offersTera(without)).toBe(true);
      expect(getBranchSimulatorFormat({ id: 'gen9natdexdraft-3', log: '|gametype|singles\n|gen|9\n|rule|Terastal Clause: You cannot Terastallize' }))
        .toBe('gen9customgame@@@Terastal Clause');
    });

    test('the forum replay itself (gen9natdexdraft-2713067801) declares the clause and reads as a Custom Game with both', () => {
      const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9natdexdraft-2713067801.json', import.meta.url), 'utf8')) as { id: string; log: string };
      expect(getBranchSimulatorFormat(replay)).toBe('gen9customgame@@@Sleep Clause Mod,Terastal Clause');
    });

    test('doubles draft: Doubles OU carries the clause, and the simulator offers no Tera', () => {
      const withClause = getBranchSimulatorFormat({ id: 'gen9natdexdraft-4', log: `|gametype|doubles\n|gen|9\n${rules}` });
      expect(withClause).toBe('gen9doublesou@@@Terastal Clause');
      expect(offersTera(withClause)).toBe(false);
      const without = getBranchSimulatorFormat({ id: 'gen9natdexdraft-5', log: '|gametype|doubles\n|gen|9\n|rule|Sleep Clause Mod: Limit one foe put to sleep' });
      expect(without).toBe('gen9doublesou');
      expect(offersTera(without)).toBe(true);
    });

    test('a real singles format and a CRLF log keep their own reading', () => {
      expect(getBranchSimulatorFormat({ id: 'gen9ou-1', log: `|gametype|singles\n|gen|9\n|tier|[Gen 9] OU\n${rules}` })).toBe('gen9ou');
      expect(getBranchSimulatorFormat({ id: 'gen9natdexdraft-6', log: `|gametype|singles\r\n|gen|9\r\n${rules.replace(/\n/g, '\r\n')}` }))
        .toBe('gen9customgame@@@Sleep Clause Mod,Terastal Clause');
    });
  });

  // The static weighs a replay by the tables of its rule set, named from the replay's own format: Pokémon Champions (singles and
  // doubles), VGC outside Champions, and every other format.
  test('a replay names its rule set from its own format', () => {
    expect(replayRuleset(vgcReplay)).toBe('champions');
    expect(replayRuleset({ id: 'gen9championsvgc2026regmabo3-2603652560', log: '|gametype|doubles\n|gen|9' })).toBe('champions');
    expect(replayRuleset({ id: 'gen9championsou-2695399689', log: '|gametype|singles\n|gen|9\n|tier|[Gen 9 Champions] OU' })).toBe('champions');
    expect(replayRuleset({ id: 'gen9vgc2026regi-2630181744', log: '|gametype|doubles\n|gen|9\n|tier|[Gen 9] VGC 2026 Reg I' })).toBe('vgc');
    expect(replayRuleset({ id: 'gen9vgc2024regh-2160552710', log: '|gametype|doubles\n|gen|9' })).toBe('vgc');
    expect(replayRuleset({ id: 'gen9ou-123', log: '|gametype|singles\n|gen|9\n|tier|[Gen 9] OU' })).toBe('standard');
    expect(replayRuleset({ id: 'gen9doublesou-2663093831', log: '|gametype|doubles\n|gen|9\n|tier|[Gen 9] Doubles OU' })).toBe('standard');
  });

  // A private replay link carries a 31-character password as a `-{password}pw` suffix on the id. The suffix belongs in the fetched id
  // and nowhere else: read as part of the format it produced `gen9ou2632003305e10u...pw`, so an ordinary private OU replay branched
  // as a rule-less custom game.
  const privateId = 'gen9ou-2632003305-e10u50b7xrkmn0w7j5q2bac68relhlwpw';
  const privateLog = '|gametype|singles\n|gen|9\n|tier|[Gen 9] OU\n|turn|1';

  test('splitReplayPassword parses the private-replay suffix', () => {
    expect(splitReplayPassword(privateId))
      .toEqual(['gen9ou-2632003305', 'e10u50b7xrkmn0w7j5q2bac68relhlw']);
    expect(splitReplayPassword('gen9ou-2632003305')).toEqual(['gen9ou-2632003305', null]);
    expect(splitReplayPassword('smogtours-gen3ou-56583')).toEqual(['smogtours-gen3ou-56583', null]);
  });

  test('a private replay id infers its real format, not its password', () => {
    expect(inferReplayFormatId({ id: privateId, log: privateLog })).toBe('gen9ou');
    expect(getBranchSimulatorFormat({ id: privateId, log: privateLog })).toBe('gen9ou');
  });
});

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf-8');
const lfOf = (text: string) => text.replace(/\r\n?/g, '\n');
const crlfOf = (text: string) => lfOf(text).replace(/\n/g, '\r\n');

/** A Gen 9 custom game whose switch lines print the exact HP (the maximum-HP reader pins HP EVs from them) and whose chat holds p1's team export. */
const EXACT_HP_SINGLES = [
  '|j|Alice', '|j|Bob', '|player|p1|Alice|', '|player|p2|Bob|', '|teamsize|p1|1', '|teamsize|p2|1', '|gen|9', '|tier|[Gen 9] Custom Game',
  '|rule|Sleep Clause Mod: Limit one foe put to sleep',
  '|c|Alice|/raw <details><summary>View team</summary>Garchomp @ Life Orb<br />Ability: Rough Skin<br />EVs: 252 Atk / 4 SpD / 252 Spe<br />'
  + 'Jolly Nature<br />- Earthquake<br />- Dragon Claw<br />- Swords Dance<br />- Stealth Rock</details>',
  '|start',
  '|switch|p1a: Chomp|Garchomp, F|409/409', '|switch|p2a: Lax|Snorlax, M|524/524', '|turn|1',
  '|move|p1a: Chomp|Earthquake|p2a: Lax', '|-damage|p2a: Lax|412/524', '|move|p2a: Lax|Body Slam|p1a: Chomp', '|-damage|p1a: Chomp|290/409',
  '|upkeep', '|turn|2',
  '|move|p1a: Chomp|Earthquake|p2a: Lax', '|-damage|p2a: Lax|300/524', '|move|p2a: Lax|Body Slam|p1a: Chomp', '|-damage|p1a: Chomp|170/409',
  '|upkeep', '|turn|3',
].join('\n');

/** Doubles with Open Team Sheets (the packed `|showteam|` lines end in an empty last field): damage lines of both sides follow. */
const SHEETS_DOUBLES = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|gen|9', '|tier|[Gen 9] VGC 2026', '|clearpoke',
  '|poke|p1|Swampert, L50, F|item', '|poke|p1|Pelipper, L50, M|item', '|poke|p2|Hydreigon, L50, M|item', '|poke|p2|Froslass, L50, F|item',
  '|showteam|p1|Swampert||Swampertite|Damp|WaveCrash,IcePunch,HighHorsepower,Protect|Adamant||F|||50|]Pelipper||LifeOrb|Drizzle|Tailwind,WeatherBall,Hurricane,WideGuard|Modest||M|||50|',
  '|showteam|p2|Hydreigon||ChoiceScarf|Levitate|DarkPulse,DracoMeteor,Flamethrower,EarthPower|Timid||M|||50|]Froslass||FocusSash|CursedBody|AuroraVeil,Protect,IcyWind,DestinyBond|Timid||F|||50|',
  '|teampreview', '|start',
  '|switch|p1a: Swampert|Swampert, L50, F|100/100', '|switch|p1b: Pelipper|Pelipper, L50, M|100/100',
  '|switch|p2a: Hydreigon|Hydreigon, L50, M|100/100', '|switch|p2b: Froslass|Froslass, L50, F|100/100', '|turn|1',
  '|move|p1a: Swampert|Wave Crash|p2a: Hydreigon', '|-damage|p2a: Hydreigon|52/100', '|move|p2a: Hydreigon|Dark Pulse|p1a: Swampert',
  '|-damage|p1a: Swampert|71/100', '|move|p1b: Pelipper|Hurricane|p2b: Froslass', '|-damage|p2b: Froslass|40/100', '|upkeep', '|turn|2',
  '|move|p1a: Swampert|Wave Crash|p2a: Hydreigon', '|-damage|p2a: Hydreigon|9/100', '|move|p2a: Hydreigon|Dark Pulse|p1a: Swampert',
  '|-damage|p1a: Swampert|44/100', '|upkeep', '|turn|3',
].join('\n');

/** A custom game with no rule lines and a second sleeper on one side: the Sleep Clause reading splits the log line by line. */
const TWO_SLEEPERS = [
  '|player|p1|Alice|', '|player|p2|Bob|', '|teamsize|p1|2', '|teamsize|p2|1', '|gen|9', '|tier|[Gen 9] Custom Game', '|start',
  '|switch|p1a: Para|Parasect, M|100/100', '|switch|p2a: Lax|Snorlax, M|100/100', '|turn|1',
  '|move|p1a: Para|Spore|p2a: Lax', '|-status|p2a: Lax|slp|[from] move: Spore', '|upkeep', '|turn|2',
  '|switch|p2a: Chomp|Garchomp, F|100/100', '|move|p1a: Para|Spore|p2a: Chomp', '|-status|p2a: Chomp|slp|[from] move: Spore', '|upkeep', '|turn|3',
].join('\n');

const LOGS: Record<string, string> = {
  'singles-1 (Gen 9 OU)': read('singles-1.log'),
  'singles-2 (Gen 9 OU)': read('singles-2.log'),
  'doubles (Champions VGC, two team sheets)': (JSON.parse(read('champions-vgc-2679899667.json')) as { log: string }).log,
  'doubles (VGC with Open Team Sheets and damage)': SHEETS_DOUBLES,
  'singles custom game (exact HP and a chat team export)': EXACT_HP_SINGLES,
  'singles custom game (two sleepers, no rule lines)': TWO_SLEEPERS,
};

/** The evidence a host hands the builder, read from the LF text for both twins: the build and the solve then show their own door. */
const evidenceOf = (log: string) => parseReplayLogWithObservations(lfOf(log));

const ENTRY_POINTS: Record<string, (log: string) => unknown> = {
  parseReplayLog: log => parseReplayLog(log),
  parseReplayLogWithObservations: log => parseReplayLogWithObservations(log),
  'inferOpponentTeam (p1)': log => inferOpponentTeam(log, 'p1'),
  'inferOpponentTeam (p2)': log => inferOpponentTeam(log, 'p2'),
  extractTeamSheets: log => extractTeamSheets(log),
  buildTeamsFromReplay: log => {
    const { observations, speedOrders, hpEvidence } = evidenceOf(log);
    return buildTeamsFromReplay(log, { observations, speedOrders, hpEvidence });
  },
  solveReplaySpreads: log => {
    const { observations, speedOrders } = evidenceOf(log);
    return [...solveReplaySpreads(log, observations, { speedOrders })];
  },
  getReplayGameType: log => getReplayGameType(log),
  'the format readers of a log alone': log => formatReaders({ log }),
  'the format readers of a log with a replay id': log => formatReaders({ id: 'gen9ou-123456', log }),
  'the format readers of a log with a format id': log => formatReaders({ formatid: 'gen9customgame', log }),
};

function formatReaders(source: { id?: string; formatid?: string; log: string }) {
  const formatid = inferReplayFormatId(source);
  return {
    formatid,
    generation: getReplayGeneration(source),
    display: getReplayDisplayFormat({ ...source, format: 'Ubers' }, formatid),
    bringCount: getReplayBringCount(source),
    bringOnly: replayBringOnly(source, parseReplayLog(source.log)),
    ruleset: replayRuleset(source),
    branchFormat: getBranchSimulatorFormat(source),
  };
}

describe('a log with Windows line endings reads like the same log with LF', () => {
  test('the CRLF twin differs from the LF log in every line ending and in nothing else', () => {
    for (const log of Object.values(LOGS)) {
      const lf = lfOf(log);
      expect(lf).not.toContain('\r');
      expect(crlfOf(lf).split('\r\n')).toEqual(lf.split('\n'));
    }
  });

  test('the singles log keeps its damage observations: 15 and more, not 0', () => {
    const lf = lfOf(LOGS['singles-1 (Gen 9 OU)']);
    const observed = parseReplayLogWithObservations(lf).observations;
    expect(observed.length).toBeGreaterThanOrEqual(15);
    expect(parseReplayLogWithObservations(crlfOf(lf)).observations).toHaveLength(observed.length);
  });

  for (const [logName, log] of Object.entries(LOGS)) {
    describe(logName, () => {
      const lf = lfOf(log);
      const crlf = crlfOf(lf);
      for (const [entryName, run] of Object.entries(ENTRY_POINTS)) {
        test(`${entryName}: CRLF equals LF`, () => {
          expect(run(crlf)).toEqual(run(lf));
        });
      }
    });
  }

  test('the logs exercise what the four local fixes guarded: the sheet reader, the sheet extractor, the maximum HP', () => {
    const sheets = lfOf(SHEETS_DOUBLES);
    expect(parseShowteamSheet(sheets, 'p2')?.map(mon => mon.species)).toEqual(['Hydreigon', 'Froslass']);
    expect(inferOpponentTeam(sheets, 'p2').pokemon.find(mon => mon.species === 'Hydreigon')?.item)
      .toEqual(expect.objectContaining({ value: 'Choice Scarf', source: 'revealed' }));
    expect(extractTeamSheets(sheets).p2?.map(set => set.species)).toEqual(['Hydreigon', 'Froslass']);
    expect(extractTeamSheets(lfOf(LOGS['doubles (Champions VGC, two team sheets)'])).p2).not.toBeNull();
    const exact = lfOf(EXACT_HP_SINGLES);
    expect(extractTeamSheets(exact).p1?.map(set => set.species)).toEqual(['Garchomp']);
    expect([...observedMaxHp(exact)].map(([key, seen]) => [key, seen.maxhp])).toEqual([['p1:garchomp', 409], ['p2:snorlax', 524]]);
    // The measured HP pins the EVs the solve hands out, from either twin: 409 is Garchomp's 208 HP EVs, 524 is Snorlax's 252.
    for (const log of [exact, crlfOf(exact)]) {
      const solved = solveReplaySpreads(log, evidenceOf(log).observations);
      expect(solved.get('p1:garchomp')?.evs.hp).toBe(208);
      expect(solved.get('p2:snorlax')?.evs.hp).toBe(252);
    }
  });

  test('parsePastedTeam: a pasted team with CRLF equals the same paste with LF', () => {
    const paste = [
      'Starmie @ Leftovers', 'Ability: Natural Cure', 'EVs: 252 SpA / 4 SpD / 252 Spe', 'Timid Nature', '- Psychic', '- Surf', '',
      'Snorlax @ Leftovers', 'Ability: Thick Fat', 'Tera Type: Fairy', 'EVs: 252 HP / 252 Atk', 'Adamant Nature', '- Body Slam', '- Rest', '',
    ].join('\n');
    const sets = parsePastedTeam(paste);
    expect(sets.map(set => set.species)).toEqual(['Starmie', 'Snorlax']);
    expect(parsePastedTeam(crlfOf(paste))).toEqual(sets);
  });
});

describe('header-facts', () => {
  const { Battle } = pkmnClient;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const FIXTURE_DIRS = [
    'packages/replay-core/test/fixtures',
    'test/regression/fixtures',
    'packages/eval-engine/test/fixtures',
    'packages/eval-engine/test/fixtures/champions',
    'test/e2e/fixtures',
  ];

  interface Fixture { tag: string; source: { id?: string; format?: string; formatid?: string; log: string } }

  function fixtures(): Fixture[] {
    const found: Fixture[] = [];
    for (const dir of FIXTURE_DIRS) {
      const folder = `${root}${dir}`;
      if (!existsSync(folder)) continue;
      for (const name of readdirSync(folder)) {
        if (!name.endsWith('.json')) continue;
        let parsed: { id?: string; format?: string; formatid?: string; log?: unknown };
        try { parsed = JSON.parse(readFileSync(`${folder}/${name}`, 'utf8')); } catch { continue; }
        if (typeof parsed.log !== 'string' || !parsed.log.includes('|start')) continue;
        found.push({ tag: `${dir}/${name}`, source: { id: parsed.id, format: parsed.format, formatid: parsed.formatid, log: parsed.log } });
      }
    }
    return found;
  }

  /** The oracle: the client after the header lines (everything before `|start`), as the plain `battle.add` calls read them. */
  function clientAfterHeader(source: Fixture['source']) {
    const lines = source.log.replace(/\r\n?/g, '\n').split('\n');
    const battle = new Battle(generationsFor(inferReplayFormatId(source)));
    for (const line of lines.slice(0, lines.findIndex((l) => l.startsWith('|start')))) if (line.trim()) battle.add(line);
    return { battle, hasGametype: lines.some((l) => l.startsWith('|gametype|')) };
  }

  const headerLog = (...lines: string[]) => ['|j|a', '|j|b', ...lines, '|start', '|turn|1'].join('\n');

  describe('header facts equal the client (fixtures of the four folders, singles, doubles, VGC, Champions, draft, GPL)', () => {
    const all = fixtures();

    test('the sweep finds the fixture replays', () => {
      expect(all.length).toBeGreaterThanOrEqual(20);
      const types = new Set(all.map((f) => getReplayGameType(f.source.log)));
      expect(types).toContain('singles');
      expect(types).toContain('doubles');
    });

    test.each(all.map((f) => [f.tag, f] as const))('%s', (_tag, fixture) => {
      const { source } = fixture;
      const { battle, hasGametype } = clientAfterHeader(source);
      // A log with no |gametype| line says nothing (the GPL pipeline's), where the client defaults to singles.
      expect(getReplayGameType(source.log)).toBe(hasGametype ? battle.gameType : null);
      expect(getReplayGeneration(source)).toBe(battle.gen.num);
      const brought = battle.teamPreviewCount >= 1 && battle.teamPreviewCount <= 5 ? battle.teamPreviewCount : null;
      expect(getReplayBringCount(source)).toBe(brought);
    });
  });

  describe('the log names how many each side brings', () => {
    test('doubles: a format id the Dex does not know and no "vgc" in it brings what |teampreview| says', () => {
      const log = headerLog('|gametype|doubles', '|gen|9', '|tier|[Gen 9] League Bo3', '|clearpoke', '|teampreview|4');
      expect(getReplayBringCount({ id: 'gen9leaguebo3-1', formatid: 'gen9leaguebo3', log })).toBe(4);
    });

    test('singles: Battle Stadium Singles brings three, also under an id the Dex does not know', () => {
      const log = headerLog('|gametype|singles', '|gen|9', '|tier|[Gen 9] Mystery Singles', '|clearpoke', '|teampreview|3');
      expect(getReplayBringCount({ id: 'gen9mysterysingles-1', formatid: 'gen9mysterysingles', log })).toBe(3);
    });

    test('a bare |teampreview| says no limit, so the format name still decides', () => {
      const bare = headerLog('|gametype|doubles', '|gen|9', '|tier|[Gen 9] VGC Free For All', '|clearpoke', '|teampreview');
      expect(getReplayBringCount({ id: 'gen9vgcfreeforall-1', formatid: 'gen9vgcfreeforall', log: bare })).toBe(4);
      expect(getReplayBringCount({ id: 'gen9leaguebo3-1', formatid: 'gen9leaguebo3', log: bare })).toBeNull();
    });

    test('a format the Dex knows keeps its rule table first: a hand-built log with a bare |teampreview| still brings four', () => {
      const bare = headerLog('|gametype|doubles', '|gen|9', '|tier|[Gen 9] VGC 2026 Reg I', '|clearpoke', '|teampreview');
      expect(getReplayBringCount({ id: 'gen9vgc2026regi-1', formatid: 'gen9vgc2026regi', log: bare })).toBe(4);
      expect(getReplayBringCount({ id: 'gen9ou-1', formatid: 'gen9ou', log: headerLog('|gametype|singles', '|gen|9', '|teampreview|4') })).toBeNull();
    });

    test('without a |teampreview| line the format decides: the Dex first, then the name', () => {
      const noPreview = headerLog('|gametype|doubles', '|gen|9', '|tier|[Gen 9] VGC 2099');
      expect(getReplayBringCount({ id: 'gen9vgc2099-1', formatid: 'gen9vgc2099', log: noPreview })).toBe(4);
      expect(getReplayBringCount({ id: 'gen9ou-1', formatid: 'gen9ou', log: headerLog('|gametype|singles', '|gen|9') })).toBeNull();
      expect(getReplayBringCount({ id: 'gen9vgc2099-1', formatid: 'gen9vgc2099' })).toBe(4);
      expect(getReplayBringCount({ id: 'gen9battlestadiumsingles-1', formatid: 'gen9battlestadiumsingles' })).toBe(3);
    });

    test('a |teampreview| line after |start belongs to no header', () => {
      const log = ['|gametype|doubles', '|gen|9', '|tier|[Gen 9] Doubles OU', '|start', '|teampreview|2'].join('\n');
      expect(getReplayBringCount({ id: 'gen9doublesou-1', formatid: 'gen9doublesou', log })).toBeNull();
    });
  });

  describe('the same facts from a Windows log and from odd lines', () => {
    const lines = ['|j|a', '|gametype|doubles', '|gen|9', '|tier|[Gen 9] League Bo3', '|clearpoke', '|teampreview|4', '|start', '|turn|1'];

    test('CRLF and CR logs read like LF logs', () => {
      const source = (log: string) => ({ id: 'gen9leaguebo3-1', formatid: 'gen9leaguebo3', log });
      for (const log of [lines.join('\n'), lines.join('\r\n'), lines.join('\r')]) {
        expect(getReplayGameType(log)).toBe('doubles');
        expect(getReplayGeneration(source(log))).toBe(9);
        expect(getReplayBringCount(source(log))).toBe(4);
      }
    });

    test('the generation comes from the log when the format id has none', () => {
      expect(getReplayGeneration({ log: ['|gametype|singles', '|gen|4', '|tier|[Gen 4] OU', '|start'].join('\n') })).toBe(4);
      expect(getReplayGeneration({ log: '|start' })).toBe(9);
      expect(getReplayGeneration({ format: '[Gen 5] OU', log: '|start' })).toBe(5);
    });

    test('odd |gametype| lines (the cases of test/regression/tier-census.spec.ts)', () => {
      expect(getReplayGameType(undefined)).toBeNull();
      expect(getReplayGameType('')).toBeNull();
      expect(getReplayGameType('|gametype|Doubles')).toBe('doubles');
      expect(getReplayGameType('|gametype|Free-For-All\n')).toBe('freeforall');
      expect(getReplayGameType('x|gametype|doubles')).toBeNull();
      expect(getReplayGameType('|j|a\n|gametype|triples|x\n')).toBe('triples');
      expect(getReplayGameType('|gametype|\n|turn|1')).toBeNull();
      expect(getReplayGameType('|j|a\n|start\n|turn|1')).toBeNull();
    });
  });
});
