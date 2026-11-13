import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Battle } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  getBranchSimulatorFormat, getReplayBringCount, getReplayGameType, parseReplayLog,
} from '@fulllifegames/replay-core';
import { loadSimMods, startGameLog } from '@fulllifegames/eval-engine';
import type { BranchHistoryEntry } from '../../src/lib/branch-history';
import { assembleGameLog, bodyLines, newLines } from '../../src/lib/new-game/game-log';
import {
  appendTurn, gameReplayData, newGameId, newGameRecord, newGameSeed, withPendingTurn, type NewGameRecord,
} from '../../src/lib/new-game/record';
import { makeGameSharePayload, sameGameAsShare } from '../../src/lib/new-game/share';
import {
  GAMES_INDEX_KEY, MAX_SAVED_GAMES, deleteGame, gameKey, listGames, loadGame, saveGame,
} from '../../src/lib/new-game/store';

/**
 * Round 89 (lane H, #105), stage H2: the game record and its log (app library). The record is the truth and the log its replay:
 * header from the format's own battle, body from the simulator, no clock lines; the replay data carries the explicit format so
 * no helper infers it from the id; the store keeps at most 20 games; the format list is the registry's playable formats.
 */

const entry = (turnNumber: number, extra: Partial<BranchHistoryEntry> = {}): BranchHistoryEntry => ({
  turnNumber, p1Choice: 'move 1', p2Choice: 'move 1', serializedPosition: '{"big":true}',
  p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [], ...extra,
});

/** Six bodies that exist in every generation of the sweep; the start reads the sets and validates none (the legal teams of every format are the engine spec's). */
const SIX: PokemonSet[] = ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar', 'Snorlax', 'Starmie'].map(species => ({
  name: species, species, item: '', ability: '', moves: ['Earthquake', 'Protect'], nature: '', gender: '',
  evs: { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
}));

async function recordOf(format: string, formatName = format): Promise<NewGameRecord> {
  await loadSimMods(format);
  const start = await startGameLog({ format, p1Team: SIX, p2Team: SIX, playerNames: ['Alice', 'Bob'] });
  return newGameRecord({ start, formatName, players: ['Alice', 'Bob'], now: new Date('2026-11-12T10:00:00Z') });
}

describe('the log of a game', () => {
  const runtimeLog = ['|t:|1', '|gametype|singles', '|teampreview', '|start', '|t:|2', '|switch|p1a: A|A, L100|100/100', '|turn|1', '|t:|3', '|move|p1a: A|Tackle|p2a: B'];

  test('the body is the runtime log from the start, clock lines out', () => {
    expect(bodyLines(runtimeLog)).toEqual(['|start', '|switch|p1a: A|A, L100|100/100', '|turn|1', '|move|p1a: A|Tackle|p2a: B']);
    expect(bodyLines(['|gametype|singles'])).toEqual([]);
  });

  test('a turn adds the lines the runtime wrote after the ones the record knows', () => {
    expect(newLines(runtimeLog, 7)).toEqual(['|move|p1a: A|Tackle|p2a: B']);
    expect(newLines(runtimeLog, runtimeLog.length)).toEqual([]);
  });

  test('the assembled log is header then body, one line each, without a clock line', () => {
    expect(assembleGameLog(['|t:|0', '|gametype|singles'], ['|start', '|t:|5', '|turn|1'])).toBe('|gametype|singles\n|start\n|turn|1');
  });

  // Round 89 (#105, H7, tester finding 5): the Champions formats play on a Custom Game stand-in, whose debug flag writes "|debug|" lines
  // that Showdown prints only in a Custom Game. The frame shows what Showdown shows: the chosen format decides.
  test.each([
    ['Gen 9 OU', 'gen9ou'], ['Doubles OU', 'gen9doublesou'], ['Scarlet/Violet VGC', 'gen9vgc2025regi'],
    ['Champions VGC', 'gen9championsvgc2026regmc'], ['Champions OU', 'gen9championsou'],
  ])('%s: the log of a game holds no debug line', async (_name, format) => {
    await loadSimMods(format);
    expect(assembleGameLog(['|gametype|singles'], ['|start', '|debug|natural status immunity.', '|turn|1'], format)).toBe('|gametype|singles\n|start\n|turn|1');
  });

  test.each(['gen9customgame', 'gen9doublescustomgame', 'gen9championscustomgame'])('%s: a Custom Game keeps its debug lines, as Showdown prints them', async format => {
    await loadSimMods(format);
    expect(assembleGameLog(['|gametype|singles'], ['|start', '|debug|natural status immunity.', '|turn|1'], format)).toContain('|debug|natural status immunity.');
  });
});

describe('the record', () => {
  test('an id is newgame- and ten base36 characters, drawn from the byte source it is given', () => {
    expect(newGameId(length => new Uint8Array(length).fill(35))).toBe('newgame-zzzzzzzzzz');
    expect(newGameId(length => Uint8Array.from({ length }, (_, index) => index))).toBe('newgame-0123456789');
    expect(newGameId()).toMatch(/^newgame-[0-9a-z]{10}$/);
    expect(newGameId()).not.toBe(newGameId());
  });

  test('the seed is fixed by default and drawn on request: four 16-bit numbers the simulator accepts', () => {
    expect(newGameSeed()).toBe('1,2,3,4');
    const fresh = newGameSeed('fresh', length => Uint8Array.from({ length }, (_, index) => index * 31));
    expect(fresh).toBe(newGameSeed('fresh', length => Uint8Array.from({ length }, (_, index) => index * 31)));
    const numbers = fresh.split(',').map(Number);
    expect(numbers).toHaveLength(4);
    expect(numbers.every(number => Number.isInteger(number) && number >= 0 && number <= 65535)).toBe(true);
    expect(new Battle({ formatid: 'gen9customgame' as never, seed: numbers as [number, number, number, number] }).prng.startingSeed).toBe(fresh);
  });

  test('a turn joins the record: its entries without their positions, its lines, one more turn; the lead entry counts none', async () => {
    const record = await recordOf('gen9ou');
    expect(record.recordVersion).toBe(1);
    expect(record.seed).toBe('1,2,3,4');
    expect(record.turns).toBe(0);
    const lead = appendTurn(record, { entries: [entry(0, { leadChoices: { p1: ['A'], p2: ['B'] } })], lines: ['|start', '|turn|1'] }, new Date('2026-11-12T10:05:00Z'));
    expect(lead.turns).toBe(0);
    const first = appendTurn(lead, { entries: [entry(1)], lines: ['|move|p1a: A|Tackle|p2a: B', '|turn|2'] });
    const forced = appendTurn(first, { entries: [entry(2), entry(2, { kind: 'forced', forcedSide: 'p1' })], lines: ['|faint|p1a: A', '|turn|3'] });
    expect(forced.turns).toBe(2);
    expect(forced.entries).toHaveLength(4);
    expect(forced.entries.every(row => row.serializedPosition === undefined)).toBe(true);
    expect(forced.body).toEqual(['|start', '|turn|1', '|move|p1a: A|Tackle|p2a: B', '|turn|2', '|faint|p1a: A', '|turn|3']);
    expect(record.body).toEqual([]);
    expect(lead.updatedAt).toBe('2026-11-12T10:05:00.000Z');
    expect(lead.createdAt).toBe('2026-11-12T10:00:00.000Z');
  });

  // Round 89, H8 (wave-tester finding 8): the tip turn that waits for its replacement rides in the record's optional `pending`.
  test('a pending tip turn is kept without positions, leaves the main line alone, and the finished turn takes it away', async () => {
    const record = await recordOf('gen9ou');
    const lead = appendTurn(record, { entries: [entry(0, { leadChoices: { p1: ['A'], p2: ['B'] } })], lines: ['|start', '|turn|1'] });
    const waiting = withPendingTurn(lead, [entry(1)], new Date('2026-11-12T10:06:00Z'));
    expect(waiting.pending).toHaveLength(1);
    expect(waiting.pending![0].serializedPosition).toBeUndefined();
    expect(waiting.entries).toEqual(lead.entries);
    expect(waiting.body).toEqual(lead.body);
    expect(waiting.turns).toBe(lead.turns);
    expect(waiting.updatedAt).toBe('2026-11-12T10:06:00.000Z');
    // a second entry (the replacement of one side of a doubles turn) replaces the list as the live branch holds it
    expect(withPendingTurn(waiting, [entry(1), entry(1, { kind: 'forced', forcedSide: 'p2' })]).pending).toHaveLength(2);
    // no entries: no key at all, as in an old record
    expect('pending' in withPendingTurn(waiting, [])).toBe(false);
    const joined = appendTurn(waiting, { entries: [entry(1), entry(1, { kind: 'forced', forcedSide: 'p2' })], lines: ['|faint|p2a: B', '|turn|2'] });
    expect('pending' in joined).toBe(false);
    expect(joined.turns).toBe(1);
    // singles and doubles share the record: the entries differ only in their slot choices, which `withoutPosition` keeps
    const doubles = withPendingTurn(lead, [entry(1, { p1SlotChoices: [null, null], p2SlotChoices: [null, null] })]);
    expect(doubles.pending![0].p2SlotChoices).toEqual([null, null]);
  });

  test('a share link of a game with a pending turn reads as before: the main line only; an old record without the field is the same game', async () => {
    const record = await recordOf('gen9ou');
    const lead = appendTurn(record, { entries: [entry(0, { leadChoices: { p1: ['A'], p2: ['B'] } })], lines: ['|start', '|turn|1'] });
    const waiting = withPendingTurn(lead, [entry(1)]);
    const payload = makeGameSharePayload({ record: waiting });
    expect(payload.entries).toHaveLength(lead.entries.length);
    expect(JSON.stringify(payload)).not.toContain('pending');
    expect(sameGameAsShare(waiting, payload)).toBe(true);
    expect(sameGameAsShare(lead, payload)).toBe(true);
  });

  // Scene: id `newgame-x` with `gen9ou` plays as `gen9ou`, not as the rule-less custom game an unknown id falls back to.
  test.each(['gen9ou', 'gen9doublesou', 'gen9vgc2025regi', 'gen9championsou', 'gen9championsvgc2026regmc', 'gen4ou'])(
    'the replay data of a %s game carries its explicit format and every format helper reads it',
    async format => {
      const record = await recordOf(format);
      const data = gameReplayData({ ...record, id: 'newgame-x' });
      expect(data.formatid).toBe(format);
      expect(data.players).toEqual(['Alice', 'Bob']);
      expect(data.log).not.toContain('|t:|');
      expect(data.log.startsWith('|')).toBe(true);
      const source = { id: data.id, log: data.log, format: data.format, formatid: data.formatid };
      const branch = getBranchSimulatorFormat(source);
      // A format the app plays on its own id keeps it; doubles play Doubles OU, and Champions doubles its Custom Game (replay-core's rule).
      expect(branch).toBe(format.includes('championsvgc') ? 'gen9championsdoublescustomgame' : format.includes('doubles') || format.includes('vgc') ? 'gen9doublesou' : format);
      expect(getReplayGameType(data.log)).toBe(format.includes('doubles') || format.includes('vgc') ? 'doubles' : 'singles');
      expect(getReplayBringCount(source)).toBe(record.bringCount);
      expect(parseReplayLog(data.log)).toBeInstanceOf(Array);
    },
    60_000,
  );
});

describe('the store', () => {
  const kept = new Map<string, string>();
  let refuse = false;
  beforeEach(() => {
    kept.clear();
    refuse = false;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => { if (refuse) throw new Error('quota'); kept.set(key, value); },
      removeItem: (key: string) => kept.delete(key),
    };
  });
  afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

  const record = (index: number, extra: Partial<NewGameRecord> = {}): NewGameRecord => ({
    recordVersion: 1, id: `newgame-${String(index).padStart(10, '0')}`, format: 'gen9ou', formatName: '[Gen 9] OU', players: ['Alice', 'Bob'],
    teams: { p1: [], p2: [] }, seed: '1,2,3,4', teamPreview: true, bringCount: null, header: ['|gametype|singles'], body: [], entries: [], turns: index,
    createdAt: '2026-11-12T10:00:00.000Z', updatedAt: new Date(Date.UTC(2026, 10, 12, 10, 0, index)).toISOString(), ...extra,
  });

  test('a saved game loads back deep-equal and shows in the list with its turn count', () => {
    expect(listGames()).toEqual([]);
    expect(saveGame(record(3))).toBe(true);
    expect(loadGame(record(3).id)).toEqual(record(3));
    expect(listGames()).toEqual([{ id: record(3).id, formatName: '[Gen 9] OU', players: ['Alice', 'Bob'], turns: 3, updatedAt: record(3).updatedAt, seed: record(3).seed }]);
    expect(kept.has(gameKey(record(3).id))).toBe(true);
  });

  test('saving a game again updates its row and moves it to the front', () => {
    saveGame(record(1));
    saveGame(record(2));
    saveGame(record(1, { turns: 9 }));
    expect(listGames().map(row => [row.id, row.turns])).toEqual([[record(1).id, 9], [record(2).id, 2]]);
  });

  test('a delete removes the record, its saved variations and its set edits, and only those', () => {
    saveGame(record(1));
    saveGame(record(2));
    kept.set(`ps-replay-interceptor:branches:${record(1).id}`, '[]');
    kept.set(`ps-replay-interceptor:sets:${record(1).id}`, 'sets');
    kept.set(`ps-replay-interceptor:branches:${record(2).id}`, '[]');
    expect(deleteGame(record(1).id).map(row => row.id)).toEqual([record(2).id]);
    expect([...kept.keys()].filter(key => key.includes(record(1).id))).toEqual([]);
    expect(kept.has(`ps-replay-interceptor:branches:${record(2).id}`)).toBe(true);
    expect(loadGame(record(1).id)).toBeNull();
  });

  test('at most 20 games stay: the 21st pushes the oldest out with everything it owns', () => {
    for (let index = 1; index <= MAX_SAVED_GAMES; index++) saveGame(record(index));
    kept.set(`ps-replay-interceptor:branches:${record(1).id}`, '[]');
    saveGame(record(21));
    const rows = listGames();
    expect(rows).toHaveLength(MAX_SAVED_GAMES);
    expect(rows[0].id).toBe(record(21).id);
    expect(rows.some(row => row.id === record(1).id)).toBe(false);
    expect([...kept.keys()].filter(key => key.includes(record(1).id))).toEqual([]);
    expect(loadGame(record(2).id)).not.toBeNull();
  });

  test('an unreadable index, a record of another version and a full store do no harm', () => {
    kept.set(GAMES_INDEX_KEY, 'not json');
    expect(listGames()).toEqual([]);
    kept.set(GAMES_INDEX_KEY, '{"a":1}');
    expect(listGames()).toEqual([]);
    kept.set(gameKey(record(5).id), JSON.stringify({ ...record(5), recordVersion: 2 }));
    expect(loadGame(record(5).id)).toBeNull();
    kept.set(gameKey(record(6).id), '{broken');
    expect(loadGame(record(6).id)).toBeNull();
    refuse = true;
    expect(saveGame(record(7))).toBe(false);
  });
});
