import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useGameTeamEdit } from '../../../src/hooks/useGameTeamEdit';
import { infoOfTeam } from '../../../src/hooks/useNewGame';
import { SIX, startedRecord } from '../fixtures/new-game';

/**
 * Round 89 (lane H, #105), stage H4: Edit Player and Edit Opp on a new game. The editor's team info becomes the side's sets, the
 * other side stays as the record holds it, the live branch stops and the editor closes before the record plays again; a line that
 * ends early says where.
 */
describe('useGameTeamEdit', () => {
  const edited = (index: number, move: string) => {
    const info = infoOfTeam(SIX);
    return { pokemon: info.pokemon.map((pokemon, at) => (at === index ? { ...pokemon, moves: [{ ...pokemon.moves[0], name: move }, ...pokemon.moves.slice(1)] } : pokemon)) };
  };

  test('Edit Player replaces side one only; the branch stops and the editor closes first', async () => {
    const record = await startedRecord('gen9ou');
    const order: string[] = [];
    const editTeams = vi.fn().mockImplementation(async () => { order.push('edit'); return { kept: 0, error: null }; });
    const { result } = renderHook(() => useGameTeamEdit({ record, editTeams, stopBranch: () => order.push('stop'), close: () => order.push('close') }));
    let handled = false;
    act(() => { handled = result.current.edit('p1', edited(0, 'Outrage')); });
    expect(handled).toBe(true);
    expect(order).toEqual(['stop', 'close', 'edit']);
    const teams = editTeams.mock.calls[0][0];
    expect(teams.p1[0].moves[0]).toBe('Outrage');
    expect(teams.p1.map((set: { species: string }) => set.species)).toEqual(SIX.map(set => set.species));
    expect(teams.p2).toBe(record.teams.p2);
    expect(result.current.notice).toBeNull();
  });

  test('Edit Opp replaces side two only and keeps each set\'s gender', async () => {
    const record = { ...(await startedRecord('gen9ou')), teams: { p1: SIX, p2: SIX.map(set => ({ ...set, gender: 'F' as const })) } };
    const editTeams = vi.fn().mockResolvedValue({ kept: 0, error: null });
    const { result } = renderHook(() => useGameTeamEdit({ record, editTeams, stopBranch: vi.fn(), close: vi.fn() }));
    act(() => { result.current.edit('p2', edited(1, 'Outrage')); });
    const teams = editTeams.mock.calls[0][0];
    expect(teams.p1).toBe(record.teams.p1);
    expect(teams.p2[1].moves[0]).toBe('Outrage');
    expect(teams.p2.every((set: { gender: string }) => set.gender === 'F')).toBe(true);
  });

  test('a line that ends early says where, and a failure says so; Dismiss clears the notice', async () => {
    const record = await startedRecord('gen9ou');
    const editTeams = vi.fn().mockResolvedValueOnce({ kept: 1, error: 'Snorlax can\'t use Protect.' }).mockResolvedValueOnce({ kept: 3, error: 'x' }).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useGameTeamEdit({ record, editTeams, stopBranch: vi.fn(), close: vi.fn() }));
    act(() => { result.current.edit('p1', edited(0, 'Outrage')); });
    await waitFor(() => expect(result.current.notice).toBe('The edited team cannot play every turn. The game keeps its first 1 turn: Snorlax can\'t use Protect.'));
    act(() => { result.current.edit('p1', edited(0, 'Outrage')); });
    await waitFor(() => expect(result.current.notice).toMatch(/first 3 turns/));
    act(() => { result.current.edit('p1', edited(0, 'Outrage')); });
    await waitFor(() => expect(result.current.notice).toBe('The edit could not be applied: boom'));
    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
  });

  test('without a game the edit is not handled, so the replay\'s own save runs', () => {
    const editTeams = vi.fn();
    const { result } = renderHook(() => useGameTeamEdit({ record: null, editTeams, stopBranch: vi.fn(), close: vi.fn() }));
    let handled = true;
    act(() => { handled = result.current.edit('p1', edited(0, 'Outrage')); });
    expect(handled).toBe(false);
    expect(editTeams).not.toHaveBeenCalled();
  });
});
