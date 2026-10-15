import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildTeamsFromReplay, extractTeamSheets, getBranchSimulatorFormat, getReplayBringCount, getReplayDisplayFormat, getReplayGameType,
  getReplayGeneration, inferOpponentTeam, inferReplayFormatId, parsePastedTeam, parseReplayLog, parseReplayLogWithObservations,
  replayBringOnly, replayRuleset, solveReplaySpreads,
} from '../src/index';
import { parseShowteamSheet } from '../src/opponent-inferrer';
import { observedMaxHp } from '../src/spreads/max-hp';

/**
 * Round 70 (T206): a log with Windows line endings reads like the same log with LF at every exported function that takes a log.
 * The parser split at '\n' and kept the '\r' on every line: 0 damage observations against 15 for the same singles log. Four places
 * stripped the '\r' themselves (the sheet reader, the sheet extractor, the maximum-HP reader, the paste parser); the package now
 * normalizes once at each entry point, and these tests hold the entry points to LF's results: the fixtures and logs below, singles
 * and doubles, each built from one LF text and its CRLF twin.
 */

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

/** The exported functions that take a log, each reduced to one value to compare. */
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

describe('a log with Windows line endings reads like the same log with LF (T206)', () => {
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
