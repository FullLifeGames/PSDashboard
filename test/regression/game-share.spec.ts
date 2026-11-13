import { describe, expect, test } from 'vitest';
import { Teams } from '@pkmn/sim';
import * as branchEngine from '../../src/lib/lazy/branch-engine';
import { encodeBranchShare, encodeShareJson, readShare } from '../../src/lib/branch-share';
import { historyOfShare, makeGameSharePayload, sameGameAsShare, shareEntry, type GameSharePayload } from '../../src/lib/new-game/share';
import { recordOfShare } from '../../src/hooks/branch/share-open';
import { withoutPosition } from '../../src/lib/new-game/record';
import { V1_SHARE_LINK } from '../ui/fixtures/v1-share-link';
import { sharedBranchPayload } from '../e2e/fixtures/shared-branch';
import type { BranchHistoryEntry } from '../../src/lib/branch-history';
import { FAMILIES, bareEntry, playRecord } from './new-game-play';

/**
 * Round 89 (lane H, #105), stage H5: the share link of a game, version 2. The link holds what the game is made of (the format,
 * both teams, the seed, the leads and every choice) and nothing the reader can play again: the log, the positions and the names a
 * Dex knows stay out. The reader plays the entries on the format's own simulator and gets the record the sharer had. Version 1
 * links (a replay's branch) read as they did; a version this app does not know reads as a newer link.
 */

/** What a rebuild replays of an entry: the rest is what the rebuild writes again. */
const core = (entry: BranchHistoryEntry) => JSON.parse(JSON.stringify({
  kind: entry.kind ?? 'turn', forcedSide: entry.forcedSide, leadChoices: entry.leadChoices, p1SlotChoices: entry.p1SlotChoices, p2SlotChoices: entry.p2SlotChoices,
}));

describe('a game link (version 2)', () => {
  for (const family of FAMILIES) {
    test(`${family.name}: the payload round-trips and the reader rebuilds the sharer's game`, async () => {
      const record = await playRecord(family, 8);
      expect(record.turns).toBeGreaterThanOrEqual(3);
      const payload = makeGameSharePayload({ record, now: new Date('2026-11-13T11:00:00Z') });
      expect(payload).toMatchObject({ version: 2, kind: 'game', format: record.format, formatName: record.formatName, players: record.players, seed: '7,8,9,10', gameId: record.id });
      expect(payload.teams).toEqual({ p1: Teams.pack(record.teams.p1), p2: Teams.pack(record.teams.p2) });
      const read = readShare(encodeBranchShare(payload));
      expect(read).toEqual({ kind: 'game', payload });
      expect(historyOfShare(payload.entries).map(core)).toEqual(record.entries.map(core));

      const opened = await recordOfShare(branchEngine, payload, { id: 'newgame-opened0001', now: new Date('2026-11-13T12:00:00Z') });
      if ('error' in opened) throw new Error(opened.error);
      expect(opened).toMatchObject({
        id: 'newgame-opened0001', format: record.format, formatName: record.formatName, players: record.players, seed: record.seed,
        teamPreview: record.teamPreview, bringCount: record.bringCount, header: record.header, body: record.body, turns: record.turns,
      });
      // `Teams.unpack` leaves out an empty gender: the teams are the sharer's by their packed text (what the battle reads)
      expect({ p1: Teams.pack(opened.teams.p1), p2: Teams.pack(opened.teams.p2) }).toEqual(payload.teams);
      expect(opened.entries.map(core)).toEqual(record.entries.map(core));
      expect(opened.entries).toEqual(record.entries.map(withoutPosition).map((entry, index) => ({ ...entry, ...opened.entries[index] })));
    }, 240_000);
  }

  test('a game still at team preview carries no entry and opens with none', async () => {
    const record = await playRecord(FAMILIES[0], 0);
    const payload = makeGameSharePayload({ record: { ...record, entries: [], body: [], turns: 0 } });
    expect(payload.entries).toEqual([]);
    const opened = await recordOfShare(branchEngine, payload, { id: 'newgame-preview001' });
    if ('error' in opened) throw new Error(opened.error);
    expect(opened).toMatchObject({ entries: [], body: [], turns: 0, header: record.header });
  }, 60_000);

  test('the branch the sharer had open and the turn he stood on ride along; the saved row names them', async () => {
    const record = await playRecord(FAMILIES[1], 5);
    const tail = record.entries.slice(3);
    const payload = makeGameSharePayload({
      record: { ...record, entries: record.entries.slice(0, 3), turns: 2 },
      variation: { startTurn: 3, history: tail }, view: { turn: 4, line: 'variation' },
    });
    expect(payload.variation).toEqual({ startTurn: 3, entries: tail.map(shareEntry) });
    expect(payload.view).toEqual({ turn: 4, line: 'variation' });
    expect(payload.branchTurn).toBe(3);
    const read = readShare(encodeBranchShare(payload));
    if (read.kind !== 'game') throw new Error('not a game');
    expect(historyOfShare(read.payload.variation!.entries).map(core)).toEqual(tail.map(core));
  }, 120_000);

  test('a forced die and a move whose name does not spell its id keep their full form', () => {
    const die = { name: { slot: 'p1a', moveId: 'earthquake', kind: 'accuracy' as const }, result: { kind: 'yes' as const } };
    const slots = [
      { kind: 'move' as const, moveId: 'hiddenpower', moveName: 'Hidden Power Fire' },
      { kind: 'move' as const, moveId: 'earthquake', moveName: 'Earthquake', dice: [die] },
      { kind: 'move' as const, moveId: 'closecombat', moveName: 'Close Combat', targetLoc: 1, modifier: 'terastallize' as const },
      { kind: 'switch' as const, speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' },
      { kind: 'switch' as const, speciesId: 'rotomwash', pokemonName: 'Sudsy' },
      null,
    ];
    const entry = bareEntry(4, { kind: 'turn', p1SlotChoices: slots, p2SlotChoices: [slots[2]] });
    const shared = shareEntry(entry);
    expect(historyOfShare([shared])[0]).toMatchObject({ p1SlotChoices: slots, p2SlotChoices: [slots[2]] });
    // the plain forms are short: a move with its target and modifier is one string, a plain switch another
    expect(JSON.stringify(shared)).toContain('"Close Combat@1#terastallize"');
    expect(JSON.stringify(shared)).toContain('">Rotom-Wash"');
  });

  test('a forced replacement and a lead entry have their own forms', () => {
    const forced = bareEntry(6, { kind: 'forced', forcedSide: 'p2', p2SlotChoices: [{ kind: 'switch', speciesId: 'gengar', pokemonName: 'Gengar' }] });
    const lead = bareEntry(0, { leadChoices: { p1: ['Garchomp'], p2: ['Gengar'], bring: true } });
    expect(historyOfShare([shareEntry(lead), shareEntry(forced)]).map(core)).toEqual([core(lead), core(forced)]);
  });
});

describe('a link that holds a game this browser has (H7, finding 4)', () => {
  for (const family of [FAMILIES[0], FAMILIES[1]]) {
    test(`${family.name}: only a link of the very same game equals the saved one`, async () => {
      const record = await playRecord(family, 2);
      const payload = makeGameSharePayload({ record });
      expect(sameGameAsShare(record, payload)).toBe(true);
      // the sharer's open branch and the pointer do not make another game
      expect(sameGameAsShare(record, makeGameSharePayload({ record, view: { turn: 1, line: 'main' } }))).toBe(true);
      // another seed, format, player, team, or main line is another game
      expect(sameGameAsShare(record, { ...payload, seed: '1,2,3,4' })).toBe(false);
      expect(sameGameAsShare(record, { ...payload, format: 'gen9customgame' })).toBe(false);
      expect(sameGameAsShare(record, { ...payload, players: ['Alice', 'Carol'] })).toBe(false);
      expect(sameGameAsShare(record, { ...payload, teams: { ...payload.teams, p2: payload.teams.p1.replace('Garchomp', 'Gengar') } })).toBe(false);
      expect(sameGameAsShare(record, { ...payload, entries: payload.entries.slice(0, -1) })).toBe(false);
      expect(sameGameAsShare({ ...record, entries: record.entries.slice(0, -1) }, payload)).toBe(false);
      expect(sameGameAsShare(record, { ...payload, entries: [...payload.entries.slice(0, -1), payload.entries[0]] })).toBe(false);
    }, 120_000);
  }
});

describe('a game link measures', () => {
  test('30 doubles turns stay under 8,000 characters, and a VGC game and 30 singles turns are shorter than the doubles game', async () => {
    const doubles = FAMILIES[1];
    const long = await playRecord(doubles, 30);
    const link = encodeBranchShare(makeGameSharePayload({ record: long }));
    expect(long.turns).toBeGreaterThanOrEqual(20);
    expect(link.length).toBeLessThan(8000);
    const vgc = await playRecord(FAMILIES[2], 30);
    const singles = await playRecord(FAMILIES[0], 30);
    const lengths = [singles, vgc].map(record => encodeBranchShare(makeGameSharePayload({ record })).length);
    expect(Math.max(...lengths)).toBeLessThan(8000);
  }, 600_000);
});

describe('what a reader makes of a link', () => {
  const game = (version: unknown, extra: Record<string, unknown> = {}) => encodeShareJson({
    version, kind: 'game', gameId: 'newgame-x', format: 'gen9ou', formatName: '[Gen 9] OU', players: ['A', 'B'], teams: { p1: '', p2: '' }, seed: '1,2,3,4',
    entries: [], branchTurn: 1, createdAt: '2026-11-13T10:00:00.000Z', ...extra,
  });

  test('version 1 links read as a replay branch, the recorded one byte for byte', () => {
    const read = readShare(V1_SHARE_LINK);
    expect(read.kind).toBe('branch');
    if (read.kind === 'branch') expect(encodeBranchShare(read.payload)).toBe(V1_SHARE_LINK);
    const own = readShare(encodeBranchShare(sharedBranchPayload));
    expect(own).toEqual({ kind: 'branch', payload: sharedBranchPayload });
  });

  test('a version 1 link with the dice labels of a multi-hit move reads unchanged', () => {
    const withDice = { ...sharedBranchPayload, choices: [{ turnNumber: 2, p1Choice: 'move 1', p2Choice: 'move 2', p1DiceLabels: ['Triple Axel: 2 hits'], p2Label: 'Protect' }] };
    expect(readShare(encodeBranchShare(withDice))).toEqual({ kind: 'branch', payload: withDice });
  });

  test('a version above 2 reads as a newer link and names its version', () => {
    expect(readShare(game(3))).toEqual({ kind: 'newer', version: 3 });
    expect(readShare(encodeShareJson({ version: 7, anything: true }))).toEqual({ kind: 'newer', version: 7 });
  });

  test.each([
    ['no version', encodeShareJson({ kind: 'game' })],
    ['version 0', encodeShareJson({ version: 0 })],
    ['a version that is no whole number', encodeShareJson({ version: '2' })],
    ['version 2 of another kind', game(2, { kind: 'replay' })],
    ['version 2 without teams', game(2, { teams: undefined })],
    ['version 2 with entries that are no list', game(2, { entries: 'x' })],
    ['version 1 without its log', encodeShareJson({ ...sharedBranchPayload, finalLog: '' })],
    ['text that is no payload', 'not-a-payload'],
  ])('%s is damaged', (_name, link) => {
    expect(() => readShare(link)).toThrow();
  });

  test('a version 2 link with an empty team reads, and the reader names the problem when it starts the game', async () => {
    const read = readShare(game(2));
    expect(read.kind).toBe('game');
    if (read.kind !== 'game') return;
    const opened = await recordOfShare(branchEngine, read.payload as GameSharePayload, { id: 'newgame-x' });
    expect('error' in opened).toBe(true);
  }, 60_000);
});
