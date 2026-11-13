import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  NEW_ISSUE_URL, SUPPORT_STATE_VERSION, buildSupportState, isSupportState, issueUrl, positionLabel, screenMessage, supportFileName,
  supportStateProblem, type SupportStateInputs,
} from '../../../src/lib/support-state';
import { savedRecord } from '../fixtures/saved-game';
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

  test('the position names the line once, and the first message on screen leads', () => {
    const state = buildSupportState(inputs());
    expect(positionLabel(state)).toBe('T28 on the main line (variation from turn 5, 1 turn)');
    // Round 77 (user report 28.10.2026): the title read "T52, variation (variation from turn 50, 2 turns)".
    const inVariation = buildSupportState(inputs({ view: { turn: 7, line: 'variation', t0: false, viewingVariation: true, liveTip: true } }));
    expect(positionLabel(inVariation)).toBe('T7 in the variation from turn 5 (1 turn)');
    expect(positionLabel(buildSupportState(inputs({ view: { turn: 1, line: 'main', t0: true, viewingVariation: false, liveTip: false } }))))
      .toBe('T0, the team preview (variation from turn 5, 1 turn)');
    expect(positionLabel(buildSupportState(inputs({ variation: { startTurn: null, branching: false, history: [] } }))))
      .toBe('T28 on the main line');
    expect(screenMessage(state)).toBe('PBA S 2 3 & 5 (Kyurem) no longer knows Brave Bird.');
    expect(screenMessage(buildSupportState(inputs({ messages: { executeError: null, branchDivergence: '  ' } })))).toBeNull();
    expect(supportFileName(state)).toBe('ps-dashboard-state-gen9draft-2058494320-2026-10-28T12-34-56Z.json');
  });

  // Round 89 (#105, H7, tester finding 11): at the end of a finished game the position reads "End", as the timeline does, not "T34".
  test('the end of a finished game reads End; a game at its tip and a replay keep their turn', async () => {
    const started = await savedRecord(['Ann', 'Ben'], 33);
    const finished = { ...started, turns: 33, body: ['|start', '|turn|33', '|win|Ann'] };
    const noVariation = { startTurn: null, branching: false, history: [] };
    const atEnd = buildSupportState(inputs({ game: finished, variation: noVariation, view: { turn: 34, line: 'main', t0: false, viewingVariation: false, liveTip: false } }));
    expect(positionLabel(atEnd)).toBe('the End of the main line');
    // the game that just finished stands on a live tip too
    expect(positionLabel(buildSupportState(inputs({ game: finished, variation: noVariation, view: { turn: 34, line: 'main', t0: false, viewingVariation: false, liveTip: true } })))).toBe('the End of the main line');
    const tip = buildSupportState(inputs({ game: { ...finished, body: ['|start', '|turn|33'] }, variation: noVariation, view: { turn: 34, line: 'main', t0: false, viewingVariation: false, liveTip: true } }));
    expect(positionLabel(tip)).toBe('T34 on the main line');
    const midGame = buildSupportState(inputs({ game: finished, variation: noVariation, view: { turn: 20, line: 'main', t0: false, viewingVariation: false, liveTip: false } }));
    expect(positionLabel(midGame)).toBe('T20 on the main line');
  });

  test('the issue link of a new game names the game and the format, not a Showdown replay that does not exist (H4h)', () => {
    const game = buildSupportState(inputs({ replay: { id: 'newgame-m7nj3hx23e', format: '[Gen 9] OU', formatid: 'gen9ou', players: ['Tidepool', 'Marrowkid'], log: '|turn|1', uploadtime: 1, rating: undefined, viewpoint: 'p1' } }));
    const url = new URL(issueUrl(game, 'state.json'));
    expect(url.searchParams.get('replay')).toBe('New game newgame-m7nj3hx23e, [Gen 9] OU (no Showdown replay)');
    expect(url.searchParams.get('body')).not.toContain('replay.pokemonshowdown.com');
    expect(url.searchParams.get('body')).toContain('**Replay:** New game newgame-m7nj3hx23e, [Gen 9] OU (no Showdown replay)');
  });

  // Round 89 (#105, H5): a game has no replay to load, so its file carries the game's record, and the issue says which game it is.
  describe('a new game in the file', () => {
    const gameReplay = { id: 'newgame-m7nj3hx23e', format: '[Gen 9] OU', formatid: 'gen9ou', players: ['Tidepool', 'Marrowkid'] as [string, string], log: '|turn|1', uploadtime: 1, rating: undefined, viewpoint: 'p1' as const };

    test('the record rides along, the version stays 1, and a replay\'s file has no game key at all', async () => {
      const record = await savedRecord(['Tidepool', 'Marrowkid'], 4, '5,6,7,8');
      const withGame = buildSupportState(inputs({ replay: { ...gameReplay, id: record.id }, game: record }));
      expect(withGame.game).toEqual(record);
      expect(withGame.version).toBe(1);
      expect(SUPPORT_STATE_VERSION).toBe(1);
      expect(isSupportState(JSON.parse(JSON.stringify(withGame)))).toBe(true);
      const replayFile = buildSupportState(inputs());
      expect('game' in replayFile).toBe(false);
      expect(Object.keys(buildSupportState(inputs({ game: null })))).toEqual(Object.keys(replayFile));
    }, 60_000);

    test('the issue link names the game, its format, seed and turns, and links no replay', async () => {
      const record = await savedRecord(['Tidepool', 'Marrowkid'], 4, '5,6,7,8');
      const state = buildSupportState(inputs({ replay: { ...gameReplay, id: record.id }, game: record }));
      const url = new URL(issueUrl(state, 'state.json'));
      const named = `New game ${record.id}, [Gen 9] OU, seed 5,6,7,8, 4 turns played (no Showdown replay)`;
      expect(url.searchParams.get('replay')).toBe(named);
      expect(url.searchParams.get('body')).toContain(`**Replay:** ${named}`);
      expect(url.searchParams.get('body')).not.toContain('pokemonshowdown.com');
    }, 60_000);

    test('a file of a newer version says so, a file of no kind says what a state file is', () => {
      expect(supportStateProblem(buildSupportState(inputs()))).toBeNull();
      expect(supportStateProblem({ kind: 'ps-dashboard-state', version: 2 })).toBe('This state file has version 2; this app reads version 1. Open it in a newer PS Dashboard.');
      expect(supportStateProblem({ kind: 'something else' })).toBe('Not a PS Dashboard state file (kind ps-dashboard-state, version 1).');
      expect(supportStateProblem(null)).toBe('Not a PS Dashboard state file (kind ps-dashboard-state, version 1).');
    });
  });

  test('the issue link fills the form fields by their ids, carries the same facts as a description, and clips long text', () => {
    const state = buildSupportState(inputs());
    const url = new URL(issueUrl(state, 'state.json'));
    expect(`${url.origin}${url.pathname}`).toBe(NEW_ISSUE_URL);
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('version')).toBe('0.7.1 (abc1234)');
    expect(url.searchParams.get('replay')).toBe('https://replay.pokemonshowdown.com/gen9draft-2058494320');
    expect(url.searchParams.get('position')).toBe('T28 on the main line (variation from turn 5, 1 turn)');
    expect(url.searchParams.get('message')).toBe('PBA S 2 3 & 5 (Kyurem) no longer knows Brave Bird.');
    expect(url.searchParams.get('title')).toBe('gen9draft-2058494320: PBA S 2 3 & 5 (Kyurem) no longer knows Brave Bird.');
    // Round 88 (user report 08.11.2026): the form takes the state file in an upload field, which a link cannot fill
    expect(url.searchParams.get('state-file')).toBeNull();
    // Round 77 (user report 28.10.2026): GitHub reads issue forms from the default branch only; without the form the link
    // opened a blank issue with the title alone. The description carries the facts for that case.
    const body = url.searchParams.get('body') ?? '';
    for (const fact of ['0.7.1 (abc1234)', 'https://replay.pokemonshowdown.com/gen9draft-2058494320', 'T28 on the main line', 'no longer knows Brave Bird', 'state.json']) {
      expect(body).toContain(fact);
    }

    const long = buildSupportState(inputs({ messages: { executeError: 'x'.repeat(5000) } }));
    const clipped = new URL(issueUrl(long, 'state.json')).searchParams.get('message') ?? '';
    expect(clipped.length).toBeLessThanOrEqual(600);
    expect(clipped.endsWith('…')).toBe(true);
    expect(issueUrl(long, 'state.json').length).toBeLessThan(8000);
  });

  // Round 88 (user report 08.11.2026): GitHub took no .json file in the form's text box on a new issue (#108 carries the
  // instruction instead of the file). An issue form's upload field takes .json files.
  test('the issue form takes the state file in an upload field that accepts .json', () => {
    const form = readFileSync(join('.github', 'ISSUE_TEMPLATE', 'bug_report.yml'), 'utf-8').replace(/\r\n/g, '\n');
    const field = /- type: (\w+)\n\s+id: state-file\n([\s\S]*?)(?=\n {2}- type:|$)/.exec(form);
    expect(field?.[1]).toBe('upload');
    expect(field?.[2]).toMatch(/accept: "\.json"/);
  });
});
