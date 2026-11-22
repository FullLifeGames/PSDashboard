import { readFileSync } from 'node:fs';
import * as simulator from '@pkmn/sim';
import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { inferOpponentTeam, type SmogonUsageStats } from '@fulllifegames/replay-core';
import { useTeamKnowledge, type TeamKnowledgeInputs } from '../../../src/hooks/useTeamKnowledge';
import { replayFixture } from '../fixtures/replay';
import { fakeReplayWorkerClient } from '../fixtures/worker';

const { replayData, observations, speedOrders, hpEvidence } = replayFixture('singles');
const p1Info = inferOpponentTeam(replayData.log, 'p1');
const opponentInfo = inferOpponentTeam(replayData.log, 'p2');
const p1Lead = p1Info.pokemon[0].species;

const usageWith = (species: string, moves: string[]): SmogonUsageStats => ({
  format: 'gen9ou', month: 'test', source: 'test',
  pokemon: {
    [species.toLowerCase().replace(/[^a-z0-9]/g, '')]: {
      species, rawCount: 100, abilities: [{ value: 'Rough Skin', probability: 0.9, sourceDetail: 'test' }],
      items: [{ value: 'Loaded Dice', probability: 0.6, sourceDetail: 'test' }],
      spreads: [], moves: moves.map((value, index) => ({ value, probability: 0.9 - index * 0.1, sourceDetail: 'test' })),
    },
  },
});

function inputs(overrides: Partial<TeamKnowledgeInputs> = {}): TeamKnowledgeInputs {
  return {
    replayData, p1Info, opponentInfo, observations, speedOrders, hpEvidence,
    usageStats: { stats: null, loading: false, error: null }, setAssumptions: { assumptions: null, loading: false, error: null },
    onTeamsEdited: vi.fn(), replayWorker: fakeReplayWorkerClient(() => []).client,
    ...overrides,
  };
}

const setsText = (p1Species: string) => [
  `=== p1: ${replayData.players[0]} ===`, '', `${p1Species} @ Choice Band`, 'Ability: Rough Skin', '- Earthquake', '',
  `=== p2: ${replayData.players[1]} ===`, '',
].join('\n');

const NL = '\n';

describe('useTeamKnowledge', () => {
  test('the effective teams start as the enriched inferred teams and carry a fingerprint of the edits', () => {
    const { result } = renderHook(() => useTeamKnowledge(inputs()));
    expect(result.current.effectiveP1Info?.pokemon.map(mon => mon.species)).toEqual(p1Info.pokemon.map(mon => mon.species));
    expect(result.current.effectiveP2Info?.pokemon).toHaveLength(opponentInfo.pokemon.length);
    expect(result.current.editedP1Info).toBeNull();
    expect(result.current.editorSide).toBeNull();
    expect(result.current.setsPanelOpen).toBe(false);
    expect(result.current.setsFingerprint).toBe(JSON.stringify([null, null, '']));
    expect(result.current.replayGenNumber).toBe(9);
  });

  test('usage stats fill guessed moves into the effective team', () => {
    const stats = usageWith(p1Lead, ['Earthquake', 'Swords Dance', 'Scale Shot', 'Fire Fang']);
    const { result } = renderHook(() => useTeamKnowledge(inputs({ usageStats: { stats, loading: false, error: null } })));
    const lead = result.current.effectiveP1Info!.pokemon[0];
    expect(lead.moves.some(move => move.source === 'guessed')).toBe(true);
    expect(lead.item.value).toBe('Loaded Dice');
  });

  test('saving one side keeps it as the edit, closes the editor, and reports both teams', async () => {
    const wired = inputs({ replayWorker: fakeReplayWorkerClient(() => [{ type: 'solveSpreadsResult', entries: [] }]).client });
    const { result } = renderHook(() => useTeamKnowledge(wired));
    act(() => { void result.current.setEditorSide('p1'); });
    await waitFor(() => expect(result.current.editorSide).toBe('p1'));
    expect(result.current.editorSide).toBe('p1');

    const edited = { pokemon: result.current.effectiveP1Info!.pokemon.map(mon => ({ ...mon, item: { value: 'Choice Band', source: 'manual' as const } })) };
    act(() => result.current.saveTeam('p1', edited));
    expect(result.current.editorSide).toBeNull();
    expect(result.current.editedP1Info).toBe(edited);
    expect(result.current.effectiveP1Info).toBe(edited);
    expect(wired.onTeamsEdited).toHaveBeenCalledWith({ p1: edited, p2: result.current.effectiveP2Info });
    expect(result.current.setsFingerprint).not.toBe(JSON.stringify([null, null, '']));
  });

  // Round 76 (T234): a panel that opens before the first solve would show and export the usage guesses.
  test.each(['editor', 'sets panel'] as const)('the %s opens when the first spread solve has settled, and closes at once', async kind => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { client, requests } = fakeReplayWorkerClient(async () => {
      await gate;
      return [{ type: 'solveSpreadsResult', entries: [] }];
    });
    const { result } = renderHook(() => useTeamKnowledge(inputs({
      replayWorker: client, usageStats: { stats: usageWith(p1Lead, ['Earthquake']), loading: false, error: null },
    })));
    const isOpen = () => (kind === 'editor' ? result.current.editorSide === 'p1' : result.current.setsPanelOpen);
    const open = () => (kind === 'editor' ? result.current.setEditorSide('p1') : result.current.setSetsPanelOpen(true));
    const close = () => (kind === 'editor' ? result.current.setEditorSide(null) : result.current.setSetsPanelOpen(false));

    await act(async () => open());
    await waitFor(() => expect(requests.filter(request => request.type === 'solveSpreads')).toHaveLength(1));
    expect(isOpen()).toBe(false);
    await act(async () => release());
    await waitFor(() => expect(isOpen()).toBe(true));
    act(() => close());
    expect(isOpen()).toBe(false);
  });

  test('a new replay forgets the edits', () => {
    const { result, rerender } = renderHook((props: TeamKnowledgeInputs) => useTeamKnowledge(props), { initialProps: inputs() });
    act(() => result.current.saveTeam('p2', result.current.effectiveP2Info!));
    expect(result.current.editedP2Info).not.toBeNull();
    rerender(inputs({ replayData: { ...replayData, id: 'other' } }));
    expect(result.current.editedP2Info).toBeNull();
    expect(result.current.editorSide).toBeNull();
  });

  test('a sets import overlays both sides as manual knowledge, persists per replay, and is restored on the next load', () => {
    const wired = inputs();
    const { result } = renderHook(() => useTeamKnowledge(wired));
    let outcome: string | null = 'unset';
    act(() => { outcome = result.current.applySetsText(setsText(p1Lead)); });
    expect(outcome).toBeNull();
    const lead = result.current.effectiveP1Info!.pokemon[0];
    expect(lead.item).toMatchObject({ value: 'Choice Band', source: 'manual' });
    expect(wired.onTeamsEdited).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`ps-replay-interceptor:sets:${replayData.id}`)).toContain('Choice Band');

    const restored = renderHook(() => useTeamKnowledge(inputs()));
    expect(restored.result.current.effectiveP1Info!.pokemon[0].item.value).toBe('Choice Band');
  });

  test('a sets import that is routed (a game) hands the checked infos over and overlays, stores and refreshes nothing; a side the text leaves out is null', () => {
    const wired = inputs();
    const { result } = renderHook(() => useTeamKnowledge(wired));
    const route = vi.fn();
    let outcome: string | null = 'unset';
    act(() => { outcome = result.current.applySetsText(setsText(p1Lead), route); });
    expect(outcome).toBeNull();
    expect(route).toHaveBeenCalledTimes(1);
    const { p1, p2 } = route.mock.calls[0][0];
    expect(p1.pokemon[0].item).toMatchObject({ value: 'Choice Band', source: 'manual' });
    expect(p2).toBeNull();
    expect(result.current.editedP1Info).toBeNull();
    expect(wired.onTeamsEdited).not.toHaveBeenCalled();
    expect(localStorage.getItem(`ps-replay-interceptor:sets:${replayData.id}`)).toBeNull();
    // a refused text reaches nobody
    act(() => { outcome = result.current.applySetsText('Garchomp @ Leftovers\n- Earthquake', route); });
    expect(outcome).toMatch(/No side headers found/);
    expect(route).toHaveBeenCalledTimes(1);
  });

  test('an import without side headers is refused with the explanation', () => {
    const { result } = renderHook(() => useTeamKnowledge(inputs()));
    let outcome: string | null = null;
    act(() => { outcome = result.current.applySetsText('Garchomp @ Leftovers\n- Earthquake'); });
    expect(outcome).toMatch(/No side headers found/);
    expect(result.current.editedP1Info).toBeNull();

    const empty = renderHook(() => useTeamKnowledge(inputs({ replayData: null, p1Info: null, opponentInfo: null })));
    act(() => { outcome = empty.result.current.applySetsText(setsText(p1Lead)); });
    expect(outcome).toBe('Load a replay first.');
  });

  // Round 77 (D5): the import names what the game cannot use and applies nothing until the text is fixed.
  describe.each(['singles', 'doubles'] as const)('a sets import with values the game does not have (%s)', kind => {
    test('is refused with every value named, and nothing is applied or stored', async () => {
      const fixture = replayFixture(kind);
      const team1 = inferOpponentTeam(fixture.replayData.log, 'p1');
      const team2 = inferOpponentTeam(fixture.replayData.log, 'p2');
      const lead = team1.pokemon[0].species;
      const wired = inputs({
        replayData: fixture.replayData, p1Info: team1, opponentInfo: team2, observations: fixture.observations,
        speedOrders: fixture.speedOrders, hpEvidence: fixture.hpEvidence,
        replayWorker: fakeReplayWorkerClient(() => [{ type: 'solveSpreadsResult', entries: [] }]).client,
      });
      const { result } = renderHook(() => useTeamKnowledge(wired));
      await act(async () => result.current.setSetsPanelOpen(true));
      await waitFor(() => expect(result.current.setsPanelOpen).toBe(true));

      const bad = [
        `=== p1: A ===`, '', `${lead} @ Choice Band`, 'Ability: Foo Bar', '- Moon Landing', '- Sky Cannon', '',
        'Foo Mon', '- Splash', '', `=== p2: B ===`, '',
      ].join(NL);
      let outcome: string | null = null;
      act(() => { outcome = result.current.applySetsText(bad); });
      expect(outcome).toMatch(/Foo Bar/);
      expect(outcome).toMatch(/Moon Landing/);
      expect(outcome).toMatch(/Sky Cannon/);
      expect(outcome).toMatch(/foomon/i);
      expect(result.current.editedP1Info).toBeNull();
      expect(wired.onTeamsEdited).not.toHaveBeenCalled();
      expect(localStorage.getItem(`ps-replay-interceptor:sets:${fixture.replayData.id}`)).toBeNull();

      const legalMove = (await (await import('../../../src/lib/pokemon-options')).getMovePool(lead, 9))[0];
      const good = ['=== p1: A ===', '', `${lead} @ Choice Band`, `- ${legalMove}`, '', '=== p2: B ===', ''].join(NL);
      act(() => { outcome = result.current.applySetsText(good); });
      expect(outcome).toBeNull();
      expect(wired.onTeamsEdited).toHaveBeenCalledTimes(1);
    });
  });

  test('a pasted team reports its match with the replay and applies to the effective team', () => {
    const { result } = renderHook(() => useTeamKnowledge(inputs()));
    act(() => result.current.handleTeamLoad(`${p1Lead} @ Leftovers\nAbility: Rough Skin\n- Earthquake\n- Protect`));
    expect(result.current.teamPasteStatus).toBe('Team loaded (1 Pokémon, 1 match this replay)');
    expect(result.current.teamPasteError).toBeNull();
    expect(result.current.effectiveP1Info!.pokemon[0].item.value).toBe('Leftovers');

    act(() => result.current.handleTeamLoad('Mew @ Leftovers\n- Psychic'));
    expect(result.current.teamPasteStatus).toBe('Team loaded (1 Pokémon, 0 match this replay)');
    expect(result.current.teamPasteError).toMatch(/None of the pasted Pokémon appear in this replay/);
  });

  test('the stats view applies solved spreads once the worker answers', async () => {
    const candidate = { evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, nature: 'Jolly' };
    const { client } = fakeReplayWorkerClient(request => (request.type === 'solveSpreads'
      ? [{ type: 'solveSpreadsResult', id: request.id, entries: [[`p1:${p1Lead.toLowerCase().replace(/[^a-z0-9]/g, '')}`, candidate]] }]
      : []));
    const { result } = renderHook(() => useTeamKnowledge(inputs({ replayWorker: client })));
    await result.current.getInferredSpreads();
    await waitFor(() => expect(result.current.solvedSpreads).not.toBeNull());
    expect(result.current.statsP1Info?.pokemon[0].evs.value.atk).toBe(252);
    expect(result.current.sensitivityTargetsFor('p1')).toEqual([]);
  });
});

/**
 * Round 88 (F, #101): a game without team preview where a side showed fewer bodies than its |teamsize|. The panel's infos carry the
 * stand-ins the format's teammate statistics name, flagged; a pasted team fills the open slots first, and the paste's own sets overlay
 * them as manual knowledge; an edit of a stand-in takes the flag off. Gen 4 OU stands for singles, a simulator-made Gen 4 Doubles OU log
 * for doubles (neither has a preview).
 */
describe('useTeamKnowledge, stand-ins for the bodies a side never showed', () => {
  const fixture = (name: string) => JSON.parse(readFileSync(`test/regression/fixtures/${name}.json`, 'utf-8'));
  const sceneLog: string = fixture('smogtours-gen4ou-544639').log;
  const stats = (() => {
    const payload = fixture('stats-gen4ou-trimmed') as { pokemon: Record<string, { count: number; teammates: Record<string, number> }> };
    const pokemon: SmogonUsageStats['pokemon'] = {};
    for (const [name, entry] of Object.entries(payload.pokemon)) {
      pokemon[name.toLowerCase().replace(/[^a-z0-9]/g, '')] = {
        species: name, rawCount: entry.count, abilities: [], items: [], moves: [], spreads: [],
        teammates: Object.entries(entry.teammates).map(([value, probability]) => ({ value, probability, sourceDetail: 'test' })),
      };
    }
    return { format: 'gen4ou', month: 'test', source: 'test', pokemon } as SmogonUsageStats;
  })();

  const sceneInputs = (overrides: Partial<TeamKnowledgeInputs> = {}) => inputs({
    replayData: { ...replayData, id: 'smogtours-gen4ou-544639', format: '[Gen 4] OU', formatid: 'gen4ou', log: sceneLog },
    p1Info: inferOpponentTeam(sceneLog, 'p1'), opponentInfo: inferOpponentTeam(sceneLog, 'p2'),
    usageStats: { stats, loading: false, error: null }, ...overrides,
  });

  test('P1 shows 3 of 6: the panel lists six, the three guesses flagged and last, P2 untouched', () => {
    const { result } = renderHook(wired => useTeamKnowledge(wired), { initialProps: sceneInputs() });
    const p1 = result.current.effectiveP1Info!.pokemon;
    expect(p1).toHaveLength(6);
    expect(p1.slice(0, 3).map(mon => mon.species)).toEqual(['Azelf', 'Gyarados', 'Metagross']);
    expect(p1.map(mon => !!mon.standIn)).toEqual([false, false, false, true, true, true]);
    expect(result.current.effectiveP2Info!.pokemon.some(mon => mon.standIn)).toBe(false);
  });

  test('without the format\'s statistics the panel stays at the three bodies the log shows', () => {
    const { result } = renderHook(wired => useTeamKnowledge(wired), { initialProps: sceneInputs({ usageStats: { stats: null, loading: false, error: null } }) });
    expect(result.current.effectiveP1Info!.pokemon).toHaveLength(3);
  });

  test('a pasted six-body team fills the three open slots with its own sets, and no guess is left', () => {
    const { result } = renderHook(wired => useTeamKnowledge(wired), { initialProps: sceneInputs() });
    const paste = [['Azelf', 'Nasty Plot'], ['Gyarados', 'Dragon Dance'], ['Metagross', 'Meteor Mash'], ['Heatran', 'Fire Blast'], ['Scizor', 'Bullet Punch'], ['Dragonite', 'Outrage']]
      .map(([species, move]) => `${species} @ Leftovers\nAbility: Pressure\n- ${move}`).join('\n\n');
    act(() => result.current.handleTeamLoad(paste));
    const p1 = result.current.effectiveP1Info!.pokemon;
    expect(p1.map(mon => mon.species)).toEqual(['Azelf', 'Gyarados', 'Metagross', 'Heatran', 'Scizor', 'Dragonite']);
    expect(p1.some(mon => mon.standIn)).toBe(false);
    expect(p1[4].moves).toEqual([{ name: 'Bullet Punch', source: 'manual' }]);
    expect(result.current.teamPasteStatus).toBe('Team loaded (6 Pokémon, 3 match this replay)');
  });

  test('a simulator-made Doubles OU log fills both sides to six', () => {
    const { Battle, Teams } = simulator;
    const set = (species: string) => ({
      name: species, species, item: '', ability: '', moves: ['tackle'], nature: '', gender: '',
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
    });
    const team = Teams.pack(['Azelf', 'Gyarados', 'Metagross', 'Heatran', 'Latias', 'Tyranitar'].map(set) as never);
    const battle = new Battle({ formatid: 'gen4doublesou' as never, seed: [1, 2, 3, 4], p1: { name: 'a', team }, p2: { name: 'b', team } });
    battle.makeChoices('default', 'default');
    const log = battle.log.join('\n');
    const doubles = sceneInputs({
      replayData: { ...replayData, id: 'gen4doublesou-1', format: '[Gen 4] Doubles OU', formatid: 'gen4doublesou', log },
      p1Info: inferOpponentTeam(log, 'p1'), opponentInfo: inferOpponentTeam(log, 'p2'),
    });
    const { result } = renderHook(wired => useTeamKnowledge(wired), { initialProps: doubles });
    expect(result.current.effectiveP1Info!.pokemon).toHaveLength(6);
    expect(result.current.effectiveP2Info!.pokemon).toHaveLength(6);
    expect(result.current.effectiveP1Info!.pokemon.filter(mon => mon.standIn)).toHaveLength(4);
  });
});

/**
 * Round 89 (lane B, #117): a game whose format generates its team fills the bodies a side never showed from the format's random-set
 * file, which the set fetch carries (`setAssumptions.assumptions.randomSets`). Gen 3 Random Battle for singles, Gen 9 Random Doubles
 * for doubles: logs the simulator played (packages/replay-core/test/fixtures/random-*.json).
 */
describe.each([
  { label: 'Gen 3 Random Battle', id: 'gen3randombattle-1', missing: 3 },
  { label: 'Gen 9 Random Doubles Battle', id: 'gen9randomdoublesbattle-11', missing: 2 },
])('useTeamKnowledge, random-set stand-ins: $label', ({ id, missing }) => {
  const game = JSON.parse(readFileSync(`packages/replay-core/test/fixtures/random-${id}.json`, 'utf-8')) as {
    formatid: string; log: string; randomSets: Record<string, never>;
  };
  const randomInputs = (withFile: boolean) => inputs({
    replayData: { ...replayData, id, format: game.formatid, formatid: game.formatid, log: game.log },
    p1Info: inferOpponentTeam(game.log, 'p1'), opponentInfo: inferOpponentTeam(game.log, 'p2'),
    setAssumptions: {
      assumptions: withFile ? { format: game.formatid, source: 'test', pokemon: {}, randomSets: game.randomSets } : null,
      loading: false, error: null,
    },
  });

  test('the side that showed fewer bodies gets guesses with the file\'s moves, the other side stays', () => {
    const { result } = renderHook(wired => useTeamKnowledge(wired), { initialProps: randomInputs(true) });
    const p1 = result.current.effectiveP1Info!.pokemon;
    expect(p1).toHaveLength(6);
    expect(p1.filter(mon => mon.standIn)).toHaveLength(missing);
    for (const guess of p1.filter(mon => mon.standIn)) expect(guess.moves.length).toBeGreaterThan(0);
    expect(result.current.effectiveP2Info!.pokemon).toHaveLength(6);
    expect(result.current.effectiveP2Info!.pokemon.some(mon => mon.standIn)).toBe(false);
  });

  test('without the file the panel stays at the bodies the log shows', () => {
    const { result } = renderHook(wired => useTeamKnowledge(wired), { initialProps: randomInputs(false) });
    expect(result.current.effectiveP1Info!.pokemon).toHaveLength(6 - missing);
  });
});
