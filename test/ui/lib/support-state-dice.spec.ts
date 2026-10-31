import { describe, expect, test } from 'vitest';
import type { DiceReport, ForcedDie } from '@fulllifegames/eval-engine';
import { SUPPORT_STATE_VERSION, buildSupportState, isSupportState, type SupportState, type SupportStateInputs } from '../../../src/lib/support-state';
import type { BranchHistoryEntry } from '../../../src/lib/branch-history';

/**
 * Round 82 (forced dice), step A6, item 5 (ADR 0001): the forced dice ride on the slot choices the support state already
 * writes, so the format keeps its version. A file with dice reads back whole; a file from before the dice reads as before.
 */

const die: ForcedDie = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'secondary', effectId: 'flinch' }, result: { happens: true } };
const report: DiceReport = { forced: [{ die, took: 'applied', chance: 0.3, logIndex: 41 }], naturalEndSeed: '1,2,3,4' };

const entry = (overrides: Partial<BranchHistoryEntry> = {}): BranchHistoryEntry => ({
  turnNumber: 13, p1Choice: 'move 1', p2Choice: 'move 2', serializedPosition: '{"a huge":"position"}',
  p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [], kind: 'turn',
  p1SlotChoices: [{ kind: 'move', moveId: 'airslash', moveName: 'Air Slash', targetLoc: 1, dice: [die] }, null],
  p2SlotChoices: [{ kind: 'switch', speciesId: 'raichu', pokemonName: 'Raichu' }], ...overrides,
});

const inputs = (history: BranchHistoryEntry[]): SupportStateInputs => ({
  createdAt: '2026-10-31T12:00:00.000Z',
  app: { version: '1.0.2', commit: 'abc1234', url: 'https://example.org/', embed: false },
  browser: { userAgent: 'test', width: 1280, height: 720, pixelRatio: 1 },
  replay: { id: 'gpl-DzBQ5azlO5l', format: '[Gen 9] OU', formatid: 'gen9ou', players: ['a', 'b'], log: '|turn|1', uploadtime: 1, rating: undefined, viewpoint: 'p1' },
  knowledge: { teamText: '', editedP1Info: null, editedP2Info: null },
  builtSets: { p1Team: [], p2Team: [] },
  variation: { startTurn: 13, branching: true, history },
  view: { turn: 13, line: 'variation', t0: false, viewingVariation: true, liveTip: false },
  choices: { draft: { p1: [{ kind: 'move', moveId: 'crunch', moveName: 'Crunch', dice: [die] }], p2: [] }, live: { p1: [], p2: [] } },
  messages: {},
  engine: { prefs: { depth: 1, samples: 1, mode: 'auto', auto: false, autoAnalyze: false } as never, fastPlayOut: false, animateBranchTurns: true, playOutActive: false },
});

describe('the support state with forced dice', () => {
  test('keeps the dice of a history entry and of the draft through the file, and the version stays 1', () => {
    const state = buildSupportState(inputs([entry({ diceReport: report })]));
    expect(SUPPORT_STATE_VERSION).toBe(1);
    expect(state.version).toBe(1);
    const read = JSON.parse(JSON.stringify(state, null, 2)) as SupportState;
    expect(isSupportState(read)).toBe(true);
    expect(read.variation.history[0].p1SlotChoices![0]).toMatchObject({ kind: 'move', dice: [die] });
    expect(read.variation.history[0].diceReport).toEqual(report);
    expect(read.choices.draft.p1[0]).toMatchObject({ dice: [die] });
    expect(JSON.stringify(read)).not.toContain('a huge');
  });

  test('a file from before the dice loads: the same shape without a dice field or a report', () => {
    const old = entry({ p1SlotChoices: [{ kind: 'move', moveId: 'airslash', moveName: 'Air Slash' }] });
    const state = buildSupportState({ ...inputs([old]), choices: { draft: { p1: [], p2: [] }, live: { p1: [], p2: [] } } });
    const read = JSON.parse(JSON.stringify(state)) as SupportState;
    expect(isSupportState(read)).toBe(true);
    expect('dice' in read.variation.history[0].p1SlotChoices![0]!).toBe(false);
    expect('diceReport' in read.variation.history[0]).toBe(false);
  });
});
