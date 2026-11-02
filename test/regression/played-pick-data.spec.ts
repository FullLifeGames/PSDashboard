import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logRules, parseReplayLog } from '@fulllifegames/replay-core';
import { parsePlayedActions, parsePlayedActionsDoubles } from '@fulllifegames/eval-engine';
import { playedFromLines } from '../../src/hooks/usePositionPicker';
import type { PlayedAtPosition, PlayedPick } from '../../src/lib/played-pick';

/**
 * Round 84 (turn dock), lane A, step A2: the played record of real games carries what the dock seeds from. For every turn of the
 * three committed fixtures (a Doubles OU game with Tera and flinches, a Regulation I VGC game with Tera, a Champions VGC game
 * with two Mega Evolutions) and of a sample of .fit-corpus, the pick of each slot has the target the log names for a
 * single-target move and the gimmick the log shows before the move. The expectation is read from the raw lines here, apart from
 * the parser, so a field that fromAction drops shows as a difference.
 */
const FIXTURES = [
  'test/e2e/fixtures/dock-doublesou-2662153814.json',
  'test/e2e/fixtures/dock-vgcregi-2573391549.json',
  'test/e2e/fixtures/dock-championsvgc-2625939941.json',
  'test/e2e/fixtures/dock-doublesou-2693620934.json',
];

type Replay = { id: string; log: string };

interface Expected {
  kind: 'move' | 'switch';
  name: string;
  targetLoc?: number | null;
  modifier?: 'terastallize' | 'mega' | 'ultra';
}

const SLOT = /^(p[12])([ab]): /;

/** The pick the lines show for one slot (a doubles slot), or null when a |cant| or a faint came first. */
function expectedPick(lines: string[], side: 'p1' | 'p2', slot: number): Expected | null {
  const ref = `${side}${'ab'[slot]}`;
  let modifier: Expected['modifier'];
  for (const line of lines) {
    const parts = line.split('|');
    const tag = parts[1];
    if (!(parts[2] ?? '').startsWith(`${ref}: `)) continue;
    if (tag === '-terastallize') modifier = 'terastallize';
    else if (tag === '-mega') modifier = 'mega';
    else if (tag === '-burst') modifier = 'ultra';
    else if (tag === 'cant' || tag === 'faint') return null;
    else if (tag === 'move') {
      const target = SLOT.exec(parts[4] ?? '');
      const targetLoc = target ? (target[1] === side ? -(target[2].charCodeAt(0) - 97 + 1) : target[2].charCodeAt(0) - 97 + 1) : null;
      return { kind: 'move', name: parts[3], targetLoc, ...(modifier ? { modifier } : {}) };
    } else if (tag === 'switch') return { kind: 'switch', name: parts[2].replace(SLOT, '') };
  }
  return null;
}

function playedRecord(replay: Replay, turn: number, snapshots: ReturnType<typeof parseReplayLog>): PlayedAtPosition | null {
  const doubles = /\|gametype\|doubles/.test(replay.log);
  const rules = logRules(replay.log);
  return playedFromLines(snapshots[turn]?.log, doubles, lines => parsePlayedActions(lines, rules), parsePlayedActionsDoubles);
}

function expectSlotsToMatch(replay: Replay): { turns: number; picks: PlayedPick[] } {
  const snapshots = parseReplayLog(replay.log);
  const picks: PlayedPick[] = [];
  let turns = 0;
  for (let turn = 1; turn < snapshots.length; turn++) {
    const record = playedRecord(replay, turn, snapshots);
    const lines = snapshots[turn]?.log ?? [];
    for (const side of ['p1', 'p2'] as const) {
      const slots = (side === 'p1' ? record?.p1Slots : record?.p2Slots) ?? [];
      for (let slot = 0; slot < 2; slot++) {
        const want = expectedPick(lines, side, slot);
        const got = slots[slot] ?? null;
        const where = `${replay.id} turn ${turn} ${side}${'ab'[slot]}`;
        if (!want) {
          expect(got, where).toBeNull();
          continue;
        }
        expect(got, where).not.toBeNull();
        expect({ kind: got!.kind, name: got!.name }, where).toEqual({ kind: want.kind, name: want.kind === 'move' ? want.name : got!.name });
        if (want.kind === 'move') {
          expect(got!.targetLoc, `${where} target`).toBe(want.targetLoc);
          expect(got!.modifier, `${where} gimmick`).toBe(want.modifier);
          picks.push(got!);
        }
      }
    }
    turns += 1;
  }
  return { turns, picks };
}

describe('the played record of the committed dock fixtures', () => {
  const read = (path: string): Replay => JSON.parse(readFileSync(path, 'utf-8')) as Replay;

  test('Doubles OU: every move carries the log\'s target; the Tera of turn 3 is swallowed with its slot (faint before the move)', () => {
    const replay = read(FIXTURES[0]);
    const { turns, picks } = expectSlotsToMatch(replay);
    expect(turns).toBe(4);
    // Peek-At-You terastallizes in turn 3 and faints before it moves: no move line, so no pick carries the Tera (plan C2).
    expect(picks.filter(pick => pick.modifier === 'terastallize')).toHaveLength(0);
    // Greninja's Rock Slide names the first foe it hits, though the move takes no target: the seed drops it (dock-seed.spec.ts).
    expect(picks.filter(pick => pick.name === 'Rock Slide').every(pick => pick.targetLoc === 1 || pick.targetLoc === 2)).toBe(true);
    const snapshots = parseReplayLog(replay.log);
    const turn2 = playedRecord(replay, 2, snapshots)!;
    expect(turn2.p2Slots![0]).toBeNull();
    const turn3 = playedRecord(replay, 3, snapshots)!;
    expect(turn3.p2Slots![1]).toBeNull();
    expect(turn3.p2Slots![0]).toBeNull();
  });

  test('Regulation I VGC: Tera on the first slot of turn 3', () => {
    const replay = read(FIXTURES[1]);
    const { picks } = expectSlotsToMatch(replay);
    expect(picks.filter(pick => pick.modifier === 'terastallize')).toHaveLength(1);
    expect(playedRecord(replay, 3, parseReplayLog(replay.log))!.p2Slots![0]).toMatchObject({ kind: 'move', modifier: 'terastallize' });
  });

  test('Champions VGC: both Mega Evolutions of turn 2 reach the pick (Champions logs |-mega| after the |detailschange|)', () => {
    const replay = read(FIXTURES[2]);
    const { picks } = expectSlotsToMatch(replay);
    expect(picks.filter(pick => pick.modifier === 'mega').length).toBeGreaterThanOrEqual(2);
    expect(picks.some(pick => pick.modifier === 'terastallize')).toBe(false);
    const record = playedRecord(replay, 2, parseReplayLog(replay.log))!;
    expect(record.p2Slots![0]).toMatchObject({ kind: 'move', modifier: 'mega' });
    expect(record.p1Slots![1]).toMatchObject({ kind: 'move', modifier: 'mega' });
  });
});

describe('the second Doubles OU fixture of the task e2e', () => {
  test('turn 5: all four slots acted, with Knock Off and Rock Slide on the first side', () => {
    const replay = JSON.parse(readFileSync(FIXTURES[3], 'utf-8')) as Replay;
    expectSlotsToMatch(replay);
    const record = playedRecord(replay, 5, parseReplayLog(replay.log))!;
    for (const side of [record.p1Slots!, record.p2Slots!]) for (const pick of side) expect(pick).not.toBeNull();
    expect(record.p1Slots!.map(pick => pick!.name)).toEqual(['Knock Off', 'Rock Slide']);
    expect(record.p1Slots![0]).toMatchObject({ kind: 'move', targetLoc: 1 });
    // Rock Slide hits both foes: the seed drops the target the log names for the first (dock-seed.spec.ts).
    expect(record.p2Slots!.map(pick => pick!.name)).toEqual(['Trick Room', 'Sludge Bomb']);
  });
});

const CORPUS = '.fit-corpus';
const sampled = existsSync(CORPUS)
  ? readdirSync(CORPUS).filter(name => name.endsWith('.json') && /doubles|vgc/.test(name)).sort().filter((_, index) => index % 40 === 0)
  : [];

describe.skipIf(sampled.length === 0)(`a sample of .fit-corpus (${sampled.length} doubles and VGC games; skipped without the folder: it is local data)`, () => {
  test.each(sampled)('%s', name => {
    const replay = JSON.parse(readFileSync(join(CORPUS, name), 'utf-8')) as Replay;
    const { turns } = expectSlotsToMatch(replay);
    expect(turns).toBeGreaterThan(0);
  });
});
