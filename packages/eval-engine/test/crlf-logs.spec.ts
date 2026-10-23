import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import { logRules } from '@fulllifegames/replay-core';
import type { PokemonSet } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly,
  type ReplayData, type TurnSnapshot,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { adoptSerializedRuntime, reconstructBranchRuntime, type BranchRuntime } from '../src/branch-engine';
import { detectRolls, diceEventTurns } from '../src/dice-events';
import { normalizeLines } from '../src/line-endings';
import { parseTendencies } from '../src/opponent-model';
import { allTurnEvents, detectSacks, parseLeadSpecies, parsePlayedActions, parsePlayedActionsDoubles, turnEvents } from '../src/played';
import { serializeLiveBattle } from '../src/serialize';
import { parseRevealedTeraSpecies, resolveTeraPreference } from '../src/tera';

/**
 * Round 70 (T206 for the engine): a log with Windows line endings reads like the same log with LF at every exported function that takes
 * a log. The engine split logs at '\n' in a dozen places and kept the '\r' on every line: the lead reader found no `|start`, the
 * turn reader no `|turn|N`, and the click behind an Encore compared "Encore\r" with "Encore". replay-core normalizes once at each of
 * its doors (packages/replay-core/src/line-endings.ts). This package does the same with its own copy, because replay-core's barrel
 * does not export that helper. The fixtures are real replays, singles and doubles, each read from its LF text and its CRLF twin. The
 * Encore scenes are the rebuild's synthetic logs (encore-click.spec.ts).
 */

const lfOf = (text: string) => text.replace(/\r\n?/g, '\n');
const crlfOf = (text: string) => lfOf(text).replace(/\n/g, '\r\n');
/** The lines of a CRLF log cut at '\n': each one keeps its '\r'. */
const withCr = (lines: string[]) => lines.map(line => `${line}\r`);
const replayOf = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as ReplayData;

/** Real replays with what the readers below look at: Terastallization, a handed item, consumed items, a faint count that tells sacks. */
const FIXTURES = {
  'singles: Trick and a Bisharp (Gen 6 OU)': 'smogtours-gen6ou-655336.json',
  'singles: Tera, a handed item (Gen 9 OU)': 'smogtours-gen9ou-751536.json',
  'doubles: Tera and consumed items (Doubles OU)': 'smogtours-gen9doublesou-938276.json',
  'doubles: VGC with Tera (Regulation I)': 'gen9vgc2026regi-2630181744.json',
} as const;

describe('the readers of a log read a CRLF log like the LF log (T206)', () => {
  for (const [name, file] of Object.entries(FIXTURES)) {
    const replay = replayOf(file);
    const lf = lfOf(replay.log);
    const crlf = crlfOf(lf);
    const { observations, speedOrders } = parseReplayLogWithObservations(lf);
    const teams = buildTeamsFromReplay(lf, { observations, speedOrders });

    describe(name, () => {
      test('the CRLF twin differs from the LF log in every line ending and in nothing else', () => {
        expect(lf).not.toContain('\r');
        expect(crlf.split('\r\n')).toEqual(lf.split('\n'));
      });

      test.each(['p1', 'p2'] as const)('parseTendencies (%s)', side => {
        expect(parseTendencies(crlf, side)).toEqual(parseTendencies(lf, side));
      });

      test('parseLeadSpecies finds the leads between |start and the first |turn|', () => {
        expect(parseLeadSpecies(lf).p1.length).toBeGreaterThan(0);
        expect(parseLeadSpecies(crlf)).toEqual(parseLeadSpecies(lf));
      });

      test('turnEvents and allTurnEvents slice the log by its |turn| lines', () => {
        const turns = allTurnEvents(lf);
        expect(turns.length).toBeGreaterThan(3);
        expect(allTurnEvents(crlf)).toEqual(turns);
        for (const turn of [1, 2, 3]) expect(turnEvents(lf, turn).length).toBeGreaterThan(0);
        for (const turn of [1, 2, 3, turns.length - 1]) expect(turnEvents(crlf, turn)).toEqual(turnEvents(lf, turn));
      });

      test('parseRevealedTeraSpecies and resolveTeraPreference', () => {
        expect(parseRevealedTeraSpecies(crlf)).toEqual(parseRevealedTeraSpecies(lf));
        expect(resolveTeraPreference('auto', 'gen9customgame', crlf)).toEqual(resolveTeraPreference('auto', 'gen9customgame', lf));
        expect(resolveTeraPreference('revealed', 'gen9ou', crlf)).toEqual(resolveTeraPreference('revealed', 'gen9ou', lf));
      });

      test('buildChoiceLockContext: trails, eligibility and the items the protocol shows', () => {
        const context = buildChoiceLockContext(lf, teams, observations);
        expect(buildChoiceLockContext(crlf, teams, observations)).toEqual(context);
      });
    });
  }
});

/**
 * The readers that take a turn's lines instead of the log sit on the barrel, and a caller that splits a CRLF log at '\n' hands them
 * lines that still end in '\r'. Read that way, detectSacks found no faint (its pattern ends at the line end), detectRolls flipped the
 * KO flag of a hit and a dice marker, parsePlayedActions printed the reason "flinch\r", and diceEventTurns dropped turns; each answer
 * was wrong without a word. allTurnEvents and the snapshots cut their lines from a normalized log, so the app never hands a '\r' in;
 * a library user can. Each of these readers settles the line endings at its own door.
 */
describe('the readers of a turn\'s lines tolerate the "\\r" a CRLF log leaves on each line (T206)', () => {
  for (const [name, file] of Object.entries(FIXTURES)) {
    const lf = lfOf(replayOf(file).log);
    const turns = allTurnEvents(lf);
    const snapshots: TurnSnapshot[] = parseReplayLog(lf);

    test(`${name}: parsePlayedActions, parsePlayedActionsDoubles, detectSacks, detectRolls, diceEventTurns`, () => {
      const seen = { sackTurns: 0, hits: 0 };
      turns.forEach((lines, turn) => {
        if (!lines) return;
        const before = snapshots.find(entry => entry.turn === turn) ?? null;
        expect(parsePlayedActions(withCr(lines), logRules(''))).toEqual(parsePlayedActions(lines, logRules('')));
        expect(parsePlayedActionsDoubles(withCr(lines))).toEqual(parsePlayedActionsDoubles(lines));
        expect(detectSacks(withCr(lines), before, logRules(''))).toEqual(detectSacks(lines, before, logRules('')));
        expect(detectRolls(withCr(lines), before)).toEqual(detectRolls(lines, before));
        seen.sackTurns += Object.keys(detectSacks(lines, before, logRules(''))).length > 0 ? 1 : 0;
        seen.hits += detectRolls(lines, before).hits.length;
      });
      const index = turns.map(lines => (lines ? withCr(lines) : lines));
      expect(diceEventTurns(index)).toEqual(diceEventTurns(turns));
      // The comparison is no empty one: the LF lines hold sacks and hits for the CRLF lines to agree with.
      expect(seen.sackTurns).toBeGreaterThan(0);
      expect(seen.hits).toBeGreaterThan(0);
    });
  }

  test('diceEventTurns has dice turns to agree on in most of these games', () => {
    const withDice = Object.values(FIXTURES).filter(file => diceEventTurns(allTurnEvents(lfOf(replayOf(file).log))).size > 0);
    expect(withDice.length).toBeGreaterThanOrEqual(3);
  });

  test('a |cant| reason, the last field of its line, reads the same with and without the "\\r"', () => {
    const lines = ['|move|p2a: Gengar|Fake Out|p1a: Snorlax', '|cant|p1a: Snorlax|flinch'];
    expect(parsePlayedActions(lines, logRules('')).prevented).toEqual({ p1: 'flinch' });
    expect(parsePlayedActions(withCr(lines), logRules(''))).toEqual(parsePlayedActions(lines, logRules('')));
  });
});

describe('normalizeLines, the door of those readers (T206)', () => {
  test('lines without a "\\r" come back as the same array, so an LF log reads exactly as before', () => {
    const lines = ['|move|p1a: A|Tackle|p2a: B', '|-damage|p2a: B|50/100', ''];
    expect(normalizeLines(lines)).toBe(lines);
    expect(normalizeLines([])).toEqual([]);
  });

  test('one trailing "\\r" leaves each line that has one, and a "\\r" inside a line stays', () => {
    const lines = ['|turn|2\r', '|upkeep', '|cant|p1a: A|slp\r', '|c|a\rb', '\r'];
    expect(normalizeLines(lines)).toEqual(['|turn|2', '|upkeep', '|cant|p1a: A|slp', '|c|a\rb', '']);
    // The input stays as it was.
    expect(lines[0]).toBe('|turn|2\r');
  });
});

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (species: string, ability: string, moves: string[], spe: number): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Serious',
  evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe }, ivs, level: 100, teraType: 'Normal',
});

/** The Encore scene of encore-click.spec.ts: the Encore lands before its target moves, so the click behind it is the encored move. */
const encoreTurns = (target: string, user: string) => [
  '|turn|1',
  `|move|${target}: Snorlax|Protect|${target}: Snorlax`, `|-singleturn|${target}: Snorlax|Protect`,
  `|move|${user}: Whimsicott|Cotton Guard|${user}: Whimsicott`, `|-boost|${user}: Whimsicott|def|3`,
  '|upkeep', '|turn|2',
  `|move|${user}: Whimsicott|Encore|${target}: Snorlax`, `|-start|${target}: Snorlax|Encore`,
  `|move|${target}: Snorlax|Protect||[still]`, `|-fail|${target}: Snorlax`,
  '|upkeep', '|turn|3',
  `|move|${target}: Snorlax|Protect|${target}: Snorlax`, `|-singleturn|${target}: Snorlax|Protect`,
  `|move|${user}: Whimsicott|Cotton Guard|${user}: Whimsicott`, `|-boost|${user}: Whimsicott|def|3`,
  '|upkeep', '|turn|4',
  `|move|${target}: Snorlax|Protect||[still]`, `|-fail|${target}: Snorlax`,
  `|move|${user}: Whimsicott|Cotton Guard|${user}: Whimsicott`, `|-boost|${user}: Whimsicott|def|0`,
  `|-end|${target}: Snorlax|Encore`,
  '|upkeep', '|turn|5',
];
const snorlax = mon('Snorlax', 'Immunity', ['Tackle', 'Protect'], 0);
const whimsicott = mon('Whimsicott', 'Infiltrator', ['Encore', 'Cotton Guard'], 252);
const SINGLES_ENCORE = [
  '|gametype|singles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] OU',
  '|poke|p1|Snorlax, M|', '|poke|p2|Whimsicott, F|', '|start',
  '|switch|p1a: Snorlax|Snorlax, M|100/100', '|switch|p2a: Whimsicott|Whimsicott, F|100/100',
  ...encoreTurns('p1a', 'p2a'),
].join('\n');
const DOUBLES_ENCORE = [
  '|gametype|doubles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] Doubles OU',
  '|poke|p1|Blissey, F|', '|poke|p1|Snorlax, M|', '|poke|p2|Chansey, F|', '|poke|p2|Whimsicott, F|', '|start',
  '|switch|p1a: Blissey|Blissey, F|100/100', '|switch|p1b: Snorlax|Snorlax, M|100/100',
  '|switch|p2a: Chansey|Chansey, F|100/100', '|switch|p2b: Whimsicott|Whimsicott, F|100/100',
  ...encoreTurns('p1b', 'p2b'),
].join('\n');

/** Protocol lines without the wall-clock `|t:|` stamps two runs may straddle. */
const withoutTimestamps = (log: string[]) => log.filter(line => !line.startsWith('|t:|'));
/** The battle minus the sim's log bookkeeping, as adopt-runtime.spec.ts compares them. */
function comparable(runtime: BranchRuntime): string {
  const state = JSON.parse(serializeLiveBattle(runtime.battleStream.battle!)) as Record<string, unknown>;
  delete state.sentLogPos;
  delete state.lastMoveLine;
  delete state.formatid;
  return JSON.stringify(state);
}

interface Scene { name: string; format: string; log: string; p1: PokemonSet[]; p2: PokemonSet[]; targetTurn: number }
const SCENES: Scene[] = [
  { name: 'singles Encore', format: 'gen9ou', log: SINGLES_ENCORE, p1: [snorlax], p2: [whimsicott], targetTurn: 4 },
  {
    name: 'doubles Encore', format: 'gen9doublesou', log: DOUBLES_ENCORE, targetTurn: 4,
    p1: [mon('Blissey', 'Natural Cure', ['Soft-Boiled', 'Seismic Toss'], 0), snorlax],
    p2: [mon('Chansey', 'Natural Cure', ['Soft-Boiled', 'Seismic Toss'], 0), whimsicott],
  },
];

function rebuild(scene: Scene, log: string) {
  const snapshots = parseReplayLog(lfOf(scene.log));
  const snapshot = snapshots.find(entry => entry.turn === scene.targetTurn) ?? null;
  return reconstructBranchRuntime({
    format: scene.format, p1Team: scene.p1, p2Team: scene.p2, replayLog: log, targetTurn: scene.targetTurn, snapshot,
  }).then(runtime => ({ runtime, snapshot }));
}

describe('reconstructBranchRuntime and adoptSerializedRuntime read a CRLF replay log like the LF log (T206)', () => {
  test.each(SCENES)('$name: the same battle, the same protocol log, the same click behind the Encore', { timeout: 240000 }, async scene => {
    const lf = await rebuild(scene, scene.log);
    const crlf = await rebuild(scene, crlfOf(scene.log));
    const target = lf.runtime.battleStream.battle!.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Snorlax')!;
    // The lock of the scene: the rebuild plays the Encore as the protocol shows it, and the body stays locked into Protect on turn 4.
    expect(target.volatiles['encore']?.move).toBe('protect');
    expect(withoutTimestamps(crlf.runtime.log)).toEqual(withoutTimestamps(lf.runtime.log));
    expect(crlf.runtime.choiceErrors.count).toBe(lf.runtime.choiceErrors.count);
    expect(comparable(crlf.runtime)).toBe(comparable(lf.runtime));

    const adoptedLf = adoptSerializedRuntime({
      serialized: serializeLiveBattle(lf.runtime.battleStream.battle!), replayLog: scene.log, targetTurn: scene.targetTurn, snapshot: lf.snapshot,
    });
    const adoptedCrlf = adoptSerializedRuntime({
      serialized: serializeLiveBattle(lf.runtime.battleStream.battle!), replayLog: crlfOf(scene.log), targetTurn: scene.targetTurn, snapshot: lf.snapshot,
    });
    expect(withoutTimestamps(adoptedCrlf.log)).toEqual(withoutTimestamps(adoptedLf.log));
    expect(comparable(adoptedCrlf)).toBe(comparable(adoptedLf));
  });

  test('a real doubles replay (VGC): the same battle at turn 4 from either text', { timeout: 240000 }, async () => {
    const replay = replayOf('gen9vgc2026regi-2630181744.json');
    const lf = lfOf(replay.log);
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(lf);
    const { p1Team, p2Team } = buildTeamsFromReplay(lf, { observations, speedOrders });
    const snapshot = snapshots.find(entry => entry.turn === 4) ?? null;
    const run = (log: string) => reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: log, targetTurn: 4, snapshot,
      bringOnly: replayBringOnly(replay, parseReplayLog(lf)) ?? undefined,
      choiceLocks: buildChoiceLockContext(lf, { p1Team, p2Team }, observations),
    });
    const [fromLf, fromCrlf] = [await run(lf), await run(crlfOf(lf))];
    expect(fromLf.battleStream.battle!.turn).toBe(4);
    expect(withoutTimestamps(fromCrlf.log)).toEqual(withoutTimestamps(fromLf.log));
    expect(fromCrlf.choiceErrors.count).toBe(fromLf.choiceErrors.count);
    expect(comparable(fromCrlf)).toBe(comparable(fromLf));
  });
});
