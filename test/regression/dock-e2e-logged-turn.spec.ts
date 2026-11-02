import { describe, expect, test } from 'vitest';
import { logRules, parseReplayLog } from '@fulllifegames/replay-core';
import { parsePlayedActions, parsePlayedActionsDoubles } from '@fulllifegames/eval-engine';
import { playedFromLines } from '../../src/hooks/usePositionPicker';
import { dockReplays, fixtureReplay } from '../e2e/helpers';
import { loggedTurn } from '../e2e/dock-helpers';

/**
 * Round 84 (turn dock), step A6c: the task e2e compares the dock with the log through `loggedTurn`, which reads the lines apart
 * from the app. Here that reader is held against the app's played record on every turn of the e2e fixtures, so a wrong
 * expectation shows as a unit failure and not as a red e2e run: the same slots acted, with the same move or body, the same
 * gimmick, and a target label where the seed carries a target.
 */
const replays = [fixtureReplay, ...dockReplays];

describe.each(replays.map(replay => [replay.id, replay] as const))('%s', (_id, replay) => {
  const snapshots = parseReplayLog(replay.log);
  const doubles = /\|gametype\|doubles/.test(replay.log);
  const rules = logRules(replay.log);

  let compared = 0;

  test('loggedTurn names the slots, moves, bodies and gimmicks the app\'s played record holds', () => {
    for (let turn = 1; turn < snapshots.length; turn++) {
      const record = playedFromLines(snapshots[turn]?.log, doubles, lines => parsePlayedActions(lines, rules), parsePlayedActionsDoubles);
      const read = loggedTurn(replay, turn);
      for (const side of ['p1', 'p2'] as const) {
        // A singles record holds the one pick of a side in `p1` and `p2`; a doubles record holds a slot list.
        const slots = doubles ? (side === 'p1' ? record?.p1Slots : record?.p2Slots) ?? [] : [side === 'p1' ? record?.p1 ?? null : record?.p2 ?? null];
        slots.forEach((pick, index) => {
          const slot = `${side}${'ab'[index]}` as 'p1a';
          const action = read.find(item => item.slot === slot);
          const where = `${replay.id} turn ${turn} ${slot}`;
          if (!pick) {
            expect(action, where).toBeUndefined();
            return;
          }
          expect(action, where).toBeDefined();
          compared += 1;
          expect(action!.kind, where).toBe(pick.kind);
          expect(action!.name, where).toBe(pick.name);
          expect(action!.tera, `${where} Tera`).toBe(pick.modifier === 'terastallize');
          expect(action!.mega, `${where} Mega`).toBe(pick.modifier === 'mega');
        });
      }
    }
    expect(compared, `${replay.id}: picks compared`).toBeGreaterThan(0);
  });

  test('a target label is read only for a single-target move on another slot of a doubles game', () => {
    for (let turn = 1; turn < snapshots.length; turn++) {
      for (const action of loggedTurn(replay, turn)) {
        if (!doubles) expect(action.target, `${replay.id} turn ${turn} ${action.slot}`).toBeNull();
        if (action.target) expect(action.target, `${replay.id} turn ${turn}`).not.toBe(action.slot);
      }
    }
  });
});

describe('the turns the task e2e stands on', () => {
  const byId = (id: string) => dockReplays.find(replay => replay.id === id)!;
  const slotsOf = (replay: typeof fixtureReplay, turn: number) => loggedTurn(replay, turn).map(action => action.slot).sort();
  const four = ['p1a', 'p1b', 'p2a', 'p2b'];

  test('every active slot acted in each of them', () => {
    expect(slotsOf(byId('gen9doublesou-2693620934'), 5)).toEqual(four);
    expect(slotsOf(byId('gen9vgc2026regi-2573391549'), 3)).toEqual(four);
    expect(slotsOf(byId('gen9championsvgc2026regma-2625939941'), 1)).toEqual(four);
    expect(slotsOf(byId('gen9championsvgc2026regma-2625939941'), 2)).toEqual(four);
    expect(slotsOf(fixtureReplay, 1)).toEqual(['p1a', 'p2a']);
  });

  test('the gimmicks and targets the specs name come from the log', () => {
    const doubles = loggedTurn(byId('gen9doublesou-2693620934'), 5);
    expect(doubles.find(action => action.slot === 'p1a')).toMatchObject({ name: 'Knock Off', target: 'p2a' });
    expect(doubles.find(action => action.slot === 'p1b')).toMatchObject({ name: 'Rock Slide', target: null });
    const vgc = loggedTurn(byId('gen9vgc2026regi-2573391549'), 3);
    expect(vgc.filter(action => action.tera).map(action => action.slot)).toEqual(['p2a']);
    expect(vgc.find(action => action.slot === 'p2a')).toMatchObject({ name: 'Tera Blast', target: 'p1b' });
    const champions = loggedTurn(byId('gen9championsvgc2026regma-2625939941'), 2);
    expect(champions.filter(action => action.mega).map(action => action.slot).sort()).toEqual(['p1b', 'p2a']);
    expect(champions.find(action => action.slot === 'p2b')).toMatchObject({ kind: 'switch', name: 'Farigiraf' });
  });
});
