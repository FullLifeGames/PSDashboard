import { describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEditorPools, useTeamDraft } from '../../../src/hooks/useTeamDraft';
import type { EditorPools } from '../../../src/lib/team-editor';
import { teamInfo } from '../fixtures/team-info';

const pools: EditorPools = {
  items: ['Choice Scarf', 'Leftovers'],
  teraTypes: ['Fire', 'Steel'],
  natures: ['Jolly', 'Timid'],
  movesBySpecies: { Garchomp: ['Earthquake', 'Fire Fang', 'Scale Shot', 'Stone Edge', 'Swords Dance'] },
  abilitiesBySpecies: { Garchomp: ['Sand Veil', 'Rough Skin'] },
  allMoves: ['Earthquake', 'Fire Fang', 'Power Whip', 'Scale Shot', 'Spore', 'Stone Edge', 'Swords Dance'],
  allAbilities: ['Intimidate', 'Rough Skin', 'Sand Veil'],
};

const initial = () => teamInfo('singles', 'p1').pokemon;

describe('useTeamDraft', () => {
  test('starts from the revealed team and edits one field as manual knowledge', () => {
    const { result } = renderHook(() => useTeamDraft(initial(), pools));
    expect(result.current.pokemon.map(mon => mon.species)[0]).toBe('Garchomp');
    act(() => result.current.updateField(0, 'item', 'Choice Scarf'));
    expect(result.current.pokemon[0].item).toEqual({ value: 'Choice Scarf', source: 'manual' });
    expect(result.current.pokemon[1].item.source).toBe('manual');
    expect(result.current.pokemon[0].ability.source).toBe('guessed');
  });

  test('EV edits clamp to the 0 to 252 range and keep the other stats', () => {
    const { result } = renderHook(() => useTeamDraft(initial(), pools));
    act(() => result.current.updateEv(0, 'spe', '300'));
    expect(result.current.pokemon[0].evs.value).toMatchObject({ spe: 252, hp: 252, def: 4 });
    expect(result.current.pokemon[0].evs.source).toBe('manual');
    act(() => result.current.updateEv(0, 'atk', 'abc'));
    expect(result.current.pokemon[0].evs.value.atk).toBe(0);
  });

  test('a legal move joins under its pool spelling, a move of the Dex the species cannot learn joins too, an unknown name is refused', () => {
    const { result } = renderHook(() => useTeamDraft(initial(), pools));
    let added = false;
    act(() => { added = result.current.addMove(0, ' fire fang '); });
    expect(added).toBe(true);
    expect(result.current.pokemon[0].moves.map(move => move.name)).toEqual(['Protect', 'Earthquake', 'Fire Fang']);
    expect(result.current.pokemon[0].moves[2].source).toBe('manual');
    expect(result.current.moveError[0]).toBeNull();

    // Round 83 (T308, GitHub issue #2): Spore is in the generation's Dex, not in Garchomp's learnset, and still joins.
    act(() => { added = result.current.addMove(0, ' power whip'); });
    expect(added).toBe(true);
    expect(result.current.pokemon[0].moves.map(move => move.name)).toEqual(['Protect', 'Earthquake', 'Fire Fang', 'Power Whip']);
    expect(result.current.pokemon[0].moves[3].source).toBe('manual');
    expect(result.current.moveError[0]).toBeNull();
    act(() => result.current.removeMove(0, 3));

    act(() => { added = result.current.addMove(0, 'Moon Landing'); });
    expect(added).toBe(false);
    expect(result.current.moveError[0]).toBe('"Moon Landing" is not a known move.');
    expect(result.current.pokemon[0].moves).toHaveLength(3);

    act(() => { added = result.current.addMove(0, '   '); });
    expect(added).toBe(false);
  });

  test('a set holds four moves and no duplicates; removeMove drops one by index', () => {
    const { result } = renderHook(() => useTeamDraft(initial(), pools));
    act(() => {
      result.current.addMove(0, 'Scale Shot');
      result.current.addMove(0, 'Stone Edge');
    });
    expect(result.current.pokemon[0].moves).toHaveLength(4);
    act(() => { result.current.addMove(0, 'Swords Dance'); });
    expect(result.current.pokemon[0].moves).toHaveLength(4);
    act(() => { result.current.addMove(0, 'earthquake'); });
    expect(result.current.pokemon[0].moves.filter(move => move.name === 'Earthquake')).toHaveLength(1);
    act(() => result.current.removeMove(0, 0));
    expect(result.current.pokemon[0].moves.map(move => move.name)).toEqual(['Earthquake', 'Scale Shot', 'Stone Edge']);
  });

  test('without loaded pools the editor accepts any move as typed', () => {
    const { result } = renderHook(() => useTeamDraft(initial(), null));
    act(() => { result.current.addMove(1, 'Magma Storm'); });
    expect(result.current.pokemon[1].moves.map(move => move.name)).toContain('Magma Storm');
    expect(result.current.moveError[1]).toBeNull();
  });
});

describe('useEditorPools', () => {
  test('loads the legal pools per species for gen 9 and no tera types for gen 3', async () => {
    const { result } = renderHook(() => useEditorPools(teamInfo('doubles', 'p1'), 9));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull(), { timeout: 30_000 });
    const loaded = result.current!;
    expect(Object.keys(loaded.movesBySpecies).sort()).toEqual(['Amoonguss', 'Flutter Mane', 'Incineroar', 'Urshifu']);
    expect(loaded.movesBySpecies.Amoonguss).toContain('Spore');
    expect(loaded.abilitiesBySpecies.Incineroar).toContain('Intimidate');
    // The whole lists of the generation come with the species' own pools (T308).
    expect(loaded.allMoves).toEqual(expect.arrayContaining(['Spore', 'Power Whip']));
    expect(loaded.allAbilities).toEqual(expect.arrayContaining(['Intimidate', 'Rough Skin']));
    expect(loaded.items).toContain('Leftovers');
    expect(loaded.teraTypes).toContain('Fire');
    expect(loaded.natures).toContain('Jolly');

    const gen3 = renderHook(() => useEditorPools(teamInfo('singles', 'p2'), 3));
    await waitFor(() => expect(gen3.result.current).not.toBeNull(), { timeout: 30_000 });
    expect(gen3.result.current!.teraTypes).toEqual([]);
    expect(gen3.result.current!.allMoves).toContain('Spore');
    expect(gen3.result.current!.allMoves).not.toContain('Scale Shot');
  }, 60_000);
});
