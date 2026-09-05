import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { inferOpponentTeam, type SmogonUsageStats } from '@fulllifegames/replay-core';
import { useTeamKnowledge, type TeamKnowledgeInputs } from '../../src/hooks/useTeamKnowledge';
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

  test('saving one side keeps it as the edit, closes the editor, and reports both teams', () => {
    const wired = inputs();
    const { result } = renderHook(() => useTeamKnowledge(wired));
    act(() => result.current.setEditorSide('p1'));
    expect(result.current.editorSide).toBe('p1');

    const edited = { pokemon: result.current.effectiveP1Info!.pokemon.map(mon => ({ ...mon, item: { value: 'Choice Band', source: 'manual' as const } })) };
    act(() => result.current.saveTeam('p1', edited));
    expect(result.current.editorSide).toBeNull();
    expect(result.current.editedP1Info).toBe(edited);
    expect(result.current.effectiveP1Info).toBe(edited);
    expect(wired.onTeamsEdited).toHaveBeenCalledWith({ p1: edited, p2: result.current.effectiveP2Info });
    expect(result.current.setsFingerprint).not.toBe(JSON.stringify([null, null, '']));
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
