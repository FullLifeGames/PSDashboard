import { describe, expect, test } from 'vitest';
import { logRules } from '@fulllifegames/replay-core';
import { loggedMoves, parsePlayedActions, parsePlayedActionsDoubles } from '../src/played';

/**
 * Round 89 (#108): the parse marks a body that fell before it acted (singles and doubles alike), with what the order bound reads: the
 * move actions the log shows before the fall, whether a line before it can have moved a speed, and the turn's activation lines.
 */
const rules = logRules('');

describe('singles: a side that falls before acting', () => {
  const lines = ['|move|p2a: Valiant|Psyshock|p1a: Grafaiai', '|-damage|p1a: Grafaiai|0 fnt', '|faint|p1a: Grafaiai', '|upkeep'];

  test('carries the moves before the fall', () => {
    const turn = parsePlayedActions(lines, rules);
    expect(turn.prevented).toEqual({ p1: 'faint' });
    expect(turn.fell).toEqual({
      p1: [{ before: [{ slot: 'p2a', move: 'Psyshock' }], speedMoved: false, activations: [] }],
    });
  });

  test('a side that acted before it fainted carries no mark', () => {
    const turn = parsePlayedActions(['|move|p1a: Grafaiai|Gunk Shot|p2a: Valiant', '|move|p2a: Valiant|Psyshock|p1a: Grafaiai', '|faint|p1a: Grafaiai'], rules);
    expect(turn.fell).toBeUndefined();
  });

  test('a cant line is no fall', () => {
    expect(parsePlayedActions(['|cant|p1a: Grafaiai|slp', '|move|p2a: Valiant|Psyshock|p1a: Grafaiai'], rules).fell).toBeUndefined();
  });

  test('a move another effect ran is no action, a locked move is', () => {
    const turn = parsePlayedActions([
      '|move|p2a: Valiant|Fiery Dance|p1a: Grafaiai|[from]ability: Dancer',
      '|move|p2a: Valiant|Outrage|p1a: Grafaiai|[from]lockedmove',
      '|faint|p1a: Grafaiai',
    ], rules);
    expect(turn.fell?.p1?.[0]?.before).toEqual([{ slot: 'p2a', move: 'Outrage' }]);
  });

  test('a speed line before the fall marks it, one after does not', () => {
    const early = parsePlayedActions(['|move|p2a: Valiant|Icy Wind|p1a: Grafaiai', '|-unboost|p1a: Grafaiai|spe|1', '|faint|p1a: Grafaiai'], rules);
    const late = parsePlayedActions(['|move|p2a: Valiant|Psyshock|p1a: Grafaiai', '|faint|p1a: Grafaiai', '|-unboost|p2a: Valiant|spe|1'], rules);
    expect([early.fell?.p1?.[0]?.speedMoved, late.fell?.p1?.[0]?.speedMoved]).toEqual([true, false]);
  });

  test('the whole turn\'s activation lines travel with the mark', () => {
    const activate = '|-activate|p2a: Valiant|item: Quick Claw';
    const turn = parsePlayedActions([activate, '|move|p2a: Valiant|Psyshock|p1a: Grafaiai', '|faint|p1a: Grafaiai'], rules);
    expect(turn.fell?.p1?.[0]?.activations).toEqual([activate]);
  });
});

describe('doubles: a slot that falls before acting', () => {
  test('marks that slot only and leaves the partner and the foes unmarked', () => {
    const turn = parsePlayedActionsDoubles([
      '|move|p2a: Floette|Dazzling Gleam|p1a: Dragonite|[spread] p1a,p1b',
      '|-damage|p1a: Dragonite|0 fnt',
      '|faint|p1a: Dragonite',
      '|move|p1b: Empoleon|Flash Cannon|p2a: Floette',
    ]);
    expect(turn.p1Slots?.[0]).toBeNull();
    expect(turn.fell).toEqual({
      p1: [{ before: [{ slot: 'p2a', move: 'Dazzling Gleam' }], speedMoved: false, activations: [] }, null],
    });
  });

  test('a mark names the partner\'s move when it ran before the fall, and leaves out the slot\'s own', () => {
    const turn = parsePlayedActionsDoubles([
      '|move|p1b: Empoleon|Flash Cannon|p2a: Floette',
      '|move|p2b: Ally|Surf|p1a: Dragonite',
      '|faint|p1a: Dragonite',
    ]);
    expect(turn.fell?.p1?.[0]?.before).toEqual([{ slot: 'p1b', move: 'Flash Cannon' }, { slot: 'p2b', move: 'Surf' }]);
  });

  test('a slot that acted before it fainted, and a cant line, carry no mark', () => {
    const turn = parsePlayedActionsDoubles([
      '|cant|p2a: Floette|flinch',
      '|move|p1a: Dragonite|Dragon Pulse|p2a: Floette',
      '|faint|p1a: Dragonite',
    ]);
    expect(turn.fell).toBeUndefined();
  });

  test('both sides can fall: each slot gets its own earlier moves', () => {
    const turn = parsePlayedActionsDoubles([
      '|move|p1b: A|Surf|p2a: B',
      '|faint|p2a: B',
      '|move|p2b: C|Surf|p1a: D',
      '|faint|p1a: D',
    ]);
    expect(turn.fell?.p2?.[0]?.before).toEqual([{ slot: 'p1b', move: 'Surf' }]);
    expect(turn.fell?.p1?.[0]?.before).toEqual([{ slot: 'p1b', move: 'Surf' }, { slot: 'p2b', move: 'Surf' }]);
  });
});

describe('the shared extractor', () => {
  test('lists the action moves of a stretch of lines', () => {
    expect(loggedMoves(['|move|p1a: A|Surf|p2a: B', '|move|p2a: B|Copycat|p2a: B|[from]move: Copycat', '|-damage|p2a: B|10/100']))
      .toEqual([{ slot: 'p1a', move: 'Surf' }]);
  });
});
