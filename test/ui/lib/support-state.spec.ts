import { describe, expect, test } from 'vitest';
import {
  NEW_ISSUE_URL, buildSupportState, isSupportState, issueUrl, positionLabel, screenMessage, supportFileName,
  type SupportStateInputs,
} from '../../../src/lib/support-state';
import type { BranchHistoryEntry } from '../../../src/lib/branch-history';

const entry = (turnNumber: number, overrides: Partial<BranchHistoryEntry> = {}): BranchHistoryEntry => ({
  turnNumber, p1Choice: 'move 1', p2Choice: 'move 2', serializedPosition: '{"a huge":"position"}',
  p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [],
  kind: 'turn', p1SlotChoices: [{ kind: 'move', moveId: 'icebeam', moveName: 'Ice Beam' }], ...overrides,
});

function inputs(overrides: Partial<SupportStateInputs> = {}): SupportStateInputs {
  return {
    createdAt: '2026-10-28T12:34:56.789Z',
    app: { version: '0.7.1', commit: 'abc1234', url: 'https://example.org/', embed: false },
    browser: { userAgent: 'test', width: 1280, height: 720, pixelRatio: 1 },
    replay: { id: 'gen9draft-2058494320', format: '[Gen 9] Draft', formatid: 'gen9draft', players: ['puffelmaedchen', 'Bene'], log: '|turn|1', uploadtime: 1, rating: undefined, viewpoint: 'p1' },
    knowledge: { teamText: '', editedP1Info: null, editedP2Info: null },
    builtSets: { p1Team: [], p2Team: [] },
    variation: { startTurn: 5, branching: true, history: [entry(5), entry(5, { kind: 'forced', forcedSide: 'p2' })] },
    view: { turn: 28, line: 'variation', t0: false, viewingVariation: false, liveTip: false },
    choices: { draft: { p1: [{ kind: 'move', moveId: 'bravebird', moveName: 'Brave Bird' }], p2: [] }, live: { p1: [], p2: [] } },
    messages: { executeError: 'PBA S 2 3 & 5 (Kyurem) no longer knows Brave Bird.', branchDivergence: null },
    engine: { prefs: { depth: 1, samples: 1, mode: 'auto', auto: false, autoAnalyze: false } as never, fastPlayOut: false, animateBranchTurns: true, playOutActive: false },
    ...overrides,
  };
}

describe('the support state file (round 77, user gate 28.10.2026)', () => {
  test('names its kind and version, keeps every choice, and drops the recorded positions', () => {
    const state = buildSupportState(inputs());
    expect(isSupportState(state)).toBe(true);
    expect(isSupportState({ kind: 'something else' })).toBe(false);
    expect(state.app).toEqual({ version: '0.7.1', commit: 'abc1234', url: 'https://example.org/', embed: false });
    expect(state.variation.history).toHaveLength(2);
    expect(state.variation.history[0].p1SlotChoices).toEqual([{ kind: 'move', moveId: 'icebeam', moveName: 'Ice Beam' }]);
    expect(state.variation.history[1]).toMatchObject({ kind: 'forced', forcedSide: 'p2' });
    expect(JSON.stringify(state)).not.toContain('a huge');
  });

  test('the position reads as the timeline bar names it, and the first message on screen leads', () => {
    const state = buildSupportState(inputs());
    expect(positionLabel(state)).toBe('T28, main line (variation from turn 5, 1 turn)');
    expect(positionLabel(buildSupportState(inputs({ view: { turn: 1, line: 'main', t0: true, viewingVariation: false, liveTip: false } }))))
      .toBe('T0 (team preview) (variation from turn 5, 1 turn)');
    expect(positionLabel(buildSupportState(inputs({ variation: { startTurn: null, branching: false, history: [] } }))))
      .toBe('T28, main line');
    expect(screenMessage(state)).toBe('PBA S 2 3 & 5 (Kyurem) no longer knows Brave Bird.');
    expect(screenMessage(buildSupportState(inputs({ messages: { executeError: null, branchDivergence: '  ' } })))).toBeNull();
    expect(supportFileName(state)).toBe('ps-dashboard-state-gen9draft-2058494320-2026-10-28T12-34-56Z.json');
  });

  test('the issue link fills the form fields by their ids and clips long text', () => {
    const state = buildSupportState(inputs());
    const url = new URL(issueUrl(state, 'state.json'));
    expect(`${url.origin}${url.pathname}`).toBe(NEW_ISSUE_URL);
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('version')).toBe('0.7.1 (abc1234)');
    expect(url.searchParams.get('replay')).toBe('https://replay.pokemonshowdown.com/gen9draft-2058494320');
    expect(url.searchParams.get('position')).toBe('T28, main line (variation from turn 5, 1 turn)');
    expect(url.searchParams.get('message')).toBe('PBA S 2 3 & 5 (Kyurem) no longer knows Brave Bird.');
    expect(url.searchParams.get('title')).toBe('gen9draft-2058494320: PBA S 2 3 & 5 (Kyurem) no longer knows Brave Bird.');
    expect(url.searchParams.get('state-file')).toContain('state.json');

    const long = buildSupportState(inputs({ messages: { executeError: 'x'.repeat(5000) } }));
    const clipped = new URL(issueUrl(long, 'state.json')).searchParams.get('message') ?? '';
    expect(clipped.length).toBeLessThanOrEqual(600);
    expect(clipped.endsWith('…')).toBe(true);
    expect(issueUrl(long, 'state.json').length).toBeLessThan(8000);
  });
});
