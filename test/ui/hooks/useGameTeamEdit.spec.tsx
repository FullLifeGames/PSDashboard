import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PokemonSet } from '@pkmn/sim';
import { useGameTeamEdit } from '../../../src/hooks/useGameTeamEdit';
import { infoOfTeam } from '../../../src/hooks/useNewGame';
import { SIX, startedRecord } from '../fixtures/new-game';

/**
 * Round 89 (lane H, #105), stage H4: Edit Player and Edit Opp on a new game. The editor's team info becomes the side's sets, the
 * other side stays as the record holds it, the live branch stops and the editor closes before the record plays again; a line that
 * ends early says where. Round 89, H14a: an edit that makes played turns invalid asks first: the question names how many turns fall away
 * and that the open variation goes; Cancel changes nothing (no stop, no edit, the editor already closed).
 */
describe('useGameTeamEdit', () => {
  type Inputs = Parameters<typeof useGameTeamEdit>[0];
  /** A plan that keeps every turn unless the test says otherwise. */
  const keepAll = (record: Inputs['record']) => vi.fn().mockResolvedValue({ kept: record?.turns ?? 0, error: null });
  const edited = (index: number, move: string) => {
    const info = infoOfTeam(SIX);
    return { pokemon: info.pokemon.map((pokemon, at) => (at === index ? { ...pokemon, moves: [{ ...pokemon.moves[0], name: move }, ...pokemon.moves.slice(1)] } : pokemon)) };
  };

  test('Edit Player replaces side one only; the branch stops and the editor closes first', async () => {
    const record = await startedRecord('gen9ou');
    const order: string[] = [];
    const editTeams = vi.fn().mockImplementation(async () => { order.push('edit'); return { kept: 0, error: null }; });
    const { result } = renderHook(() => useGameTeamEdit({ record, planTeams: keepAll(record), editTeams, variationOpen: false, stopBranch: () => order.push('stop'), close: () => order.push('close') }));
    let handled = false;
    act(() => { handled = result.current.edit('p1', edited(0, 'Outrage')); });
    expect(handled).toBe(true);
    await waitFor(() => expect(order).toEqual(['close', 'stop', 'edit']));
    const teams = editTeams.mock.calls[0][0];
    expect(teams.p1[0].moves[0]).toBe('Outrage');
    expect(teams.p1.map((set: { species: string }) => set.species)).toEqual(SIX.map(set => set.species));
    expect(teams.p2).toBe(record.teams.p2);
    expect(result.current.notice).toBeNull();
  });

  test('Edit Opp replaces side two only and keeps each set\'s gender', async () => {
    const record = { ...(await startedRecord('gen9ou')), teams: { p1: SIX, p2: SIX.map(set => ({ ...set, gender: 'F' as const })) } };
    const editTeams = vi.fn().mockResolvedValue({ kept: 0, error: null });
    const { result } = renderHook(() => useGameTeamEdit({ record, planTeams: keepAll(record), editTeams, variationOpen: false, stopBranch: vi.fn(), close: vi.fn() }));
    act(() => { result.current.edit('p2', edited(1, 'Outrage')); });
    await waitFor(() => expect(editTeams).toHaveBeenCalled());
    const teams = editTeams.mock.calls[0][0];
    expect(teams.p1).toBe(record.teams.p1);
    expect(teams.p2[1].moves[0]).toBe('Outrage');
    expect(teams.p2.every((set: { gender: string }) => set.gender === 'F')).toBe(true);
  });

  test('a line that ends early says where, and a failure says so; Dismiss clears the notice', async () => {
    const record = await startedRecord('gen9ou');
    const editTeams = vi.fn().mockResolvedValueOnce({ kept: 1, error: 'Snorlax can\'t use Protect.' }).mockResolvedValueOnce({ kept: 3, error: 'x' }).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useGameTeamEdit({ record, planTeams: keepAll(record), editTeams, variationOpen: false, stopBranch: vi.fn(), close: vi.fn() }));
    act(() => { result.current.edit('p1', edited(0, 'Outrage')); });
    await waitFor(() => expect(result.current.notice).toBe('The edited team cannot play every turn. The game keeps its first turn: Snorlax can\'t use Protect.'));
    act(() => { result.current.edit('p1', edited(0, 'Outrage')); });
    await waitFor(() => expect(result.current.notice).toMatch(/first 3 turns/));
    act(() => { result.current.edit('p1', edited(0, 'Outrage')); });
    await waitFor(() => expect(result.current.notice).toBe('The edit could not be applied: boom'));
    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
  });

  test('a sets import on a game goes through the same path: both sides, a side the import left out keeps the record\'s own sets', async () => {
    const record = await startedRecord('gen9ou');
    const order: string[] = [];
    const editTeams = vi.fn().mockImplementation(async () => { order.push('edit'); return { kept: 0, error: null }; });
    const { result } = renderHook(() => useGameTeamEdit({ record, planTeams: keepAll(record), editTeams, variationOpen: false, stopBranch: () => order.push('stop'), close: () => order.push('close') }));
    let handled = false;
    act(() => { handled = result.current.editSides({ p1: edited(0, 'Outrage'), p2: edited(2, 'Outrage') }); });
    expect(handled).toBe(true);
    await waitFor(() => expect(order).toEqual(['close', 'stop', 'edit']));
    const both = editTeams.mock.calls[0][0];
    expect(both.p1[0].moves[0]).toBe('Outrage');
    expect(both.p2[2].moves[0]).toBe('Outrage');
    act(() => { result.current.editSides({ p1: null, p2: edited(1, 'Outrage') }); });
    await waitFor(() => expect(editTeams).toHaveBeenCalledTimes(2));
    const one = editTeams.mock.calls[1][0];
    expect(one.p1).toBe(record.teams.p1);
    expect(one.p2[1].moves[0]).toBe('Outrage');
  });

  test('without a game the edit is not handled, so the replay\'s own save runs', () => {
    const editTeams = vi.fn();
    const { result } = renderHook(() => useGameTeamEdit({ record: null, planTeams: vi.fn(), editTeams, variationOpen: false, stopBranch: vi.fn(), close: vi.fn() }));
    let handled = true;
    act(() => { handled = result.current.edit('p1', edited(0, 'Outrage')); });
    expect(handled).toBe(false);
    expect(editTeams).not.toHaveBeenCalled();
  });

  describe('an edit that makes played turns invalid asks before it cuts (H14a)', () => {
    const cutRecord = async (format: string) => ({ ...(await startedRecord(format)), turns: 5 });
    const setup = async (format: string, variationOpen: boolean, kept = 2) => {
      const record = await cutRecord(format);
      const order: string[] = [];
      const planTeams = vi.fn().mockResolvedValue({ kept, error: 'Snorlax can\'t use Protect.' });
      const editTeams = vi.fn().mockImplementation(async () => { order.push('edit'); return { kept, error: 'Snorlax can\'t use Protect.' }; });
      const hook = renderHook(() => useGameTeamEdit({ record, planTeams, editTeams, variationOpen, stopBranch: () => order.push('stop'), close: () => order.push('close') }));
      return { record, order, planTeams, editTeams, ...hook };
    };

    test.each([['gen9ou'], ['gen9doublesou']])('%s: the question names the turns that fall away and the open variation; nothing is cut or stopped before the answer', async format => {
      const { result, order, editTeams, planTeams } = await setup(format, true);
      act(() => { result.current.edit('p1', edited(0, 'Outrage')); });
      await waitFor(() => expect(result.current.confirm).not.toBeNull());
      expect(planTeams).toHaveBeenCalledTimes(1);
      expect(result.current.confirm!.message).toBe('This edit makes 3 played turns invalid. They fall away: the game keeps its first 2 turns, and the open variation goes.');
      // the editor closed with the click; the branch, the record and the game stay as they were
      expect(order).toEqual(['close']);
      expect(editTeams).not.toHaveBeenCalled();
      expect(result.current.notice).toBeNull();
    });

    test('without an open variation the question does not name one; one turn falling away reads in the singular', async () => {
      const { result } = await setup('gen9ou', false, 4);
      act(() => { result.current.edit('p1', edited(0, 'Outrage')); });
      await waitFor(() => expect(result.current.confirm).not.toBeNull());
      expect(result.current.confirm!.message).toBe('This edit makes 1 played turn invalid. It falls away: the game keeps its first 4 turns.');
    });

    test('Cancel leaves team and game as they were: no stop, no edit, no notice', async () => {
      const { result, order, editTeams } = await setup('gen9ou', true);
      act(() => { result.current.editSides({ p1: edited(0, 'Outrage'), p2: null }); });
      await waitFor(() => expect(result.current.confirm).not.toBeNull());
      act(() => result.current.confirm!.cancel());
      expect(result.current.confirm).toBeNull();
      expect(order).toEqual(['close']);
      expect(editTeams).not.toHaveBeenCalled();
      expect(result.current.notice).toBeNull();
    });

    test('Apply edit stops the branch, plays the record on the new teams and says where the line ends', async () => {
      const { result, order, editTeams } = await setup('gen9doublesou', true);
      act(() => { result.current.edit('p2', edited(1, 'Outrage')); });
      await waitFor(() => expect(result.current.confirm).not.toBeNull());
      act(() => result.current.confirm!.proceed());
      expect(result.current.confirm).toBeNull();
      await waitFor(() => expect(result.current.notice).toBe('The edited team cannot play every turn. The game keeps its first 2 turns: Snorlax can\'t use Protect.'));
      expect(order).toEqual(['close', 'stop', 'edit']);
      const teams: { p2: PokemonSet[] } = editTeams.mock.calls[0][0];
      expect(teams.p2[1].moves[0]).toBe('Outrage');
    });

    test('an edit that keeps every played turn applies at once and asks nothing, even with a variation open', async () => {
      const record = await cutRecord('gen9ou');
      const editTeams = vi.fn().mockResolvedValue({ kept: 5, error: null });
      const planTeams = vi.fn().mockResolvedValue({ kept: 5, error: null });
      const { result } = renderHook(() => useGameTeamEdit({ record, planTeams, editTeams, variationOpen: true, stopBranch: vi.fn(), close: vi.fn() }));
      act(() => { result.current.edit('p1', edited(0, 'Outrage')); });
      await waitFor(() => expect(editTeams).toHaveBeenCalledTimes(1));
      expect(result.current.confirm).toBeNull();
    });

    test('a plan that fails reads as a failed edit and cuts nothing', async () => {
      const record = await cutRecord('gen9ou');
      const editTeams = vi.fn();
      const planTeams = vi.fn().mockRejectedValue(new Error('boom'));
      const { result } = renderHook(() => useGameTeamEdit({ record, planTeams, editTeams, variationOpen: false, stopBranch: vi.fn(), close: vi.fn() }));
      act(() => { result.current.edit('p1', edited(0, 'Outrage')); });
      await waitFor(() => expect(result.current.notice).toBe('The edit could not be applied: boom'));
      expect(editTeams).not.toHaveBeenCalled();
    });
  });
});
