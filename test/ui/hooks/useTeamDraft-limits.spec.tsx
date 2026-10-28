import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTeamDraft } from '../../../src/hooks/useTeamDraft';
import type { EditorPools } from '../../../src/lib/team-editor';
import { evs, revealedPokemon } from '../fixtures/team-info';

/**
 * Round 69 (T162): updateEv keeps every stat and the total inside the format's
 * limits. Pokémon Champions: 32 Stat Points per stat, 66 in total. Scarlet/Violet:
 * 252 per stat, 510 in total once the simulator's limit has arrived with the pools.
 * Singles and the VGC (doubles) format run the same code; both are tested.
 */
const blank = () => [revealedPokemon('Garchomp', { evs: evs('manual') })];
const pools = (evLimit?: number | null): EditorPools => ({
  items: [], teraTypes: [], natures: [], movesBySpecies: {}, abilitiesBySpecies: {}, ...(evLimit === undefined ? {} : { evLimit }),
});

describe('useTeamDraft.updateEv by format', () => {
  for (const [kind, format] of [['singles', 'gen9championsou'], ['doubles (VGC)', 'gen9championsvgc2026regmbbo3']] as const) {
    test(`Champions ${kind}: typing 32, 32, 32 gives 32, 32, 2 and a stat never passes 32`, () => {
      const { result } = renderHook(() => useTeamDraft(blank(), null, format));
      act(() => result.current.updateEv(0, 'hp', '32'));
      act(() => result.current.updateEv(0, 'atk', '32'));
      act(() => result.current.updateEv(0, 'def', '32'));
      expect(result.current.pokemon[0].evs.value).toMatchObject({ hp: 32, atk: 32, def: 2 });
      act(() => result.current.updateEv(0, 'spe', '50'));
      expect(result.current.pokemon[0].evs.value.spe).toBe(0);
      act(() => result.current.updateEv(0, 'hp', '40'));
      expect(result.current.pokemon[0].evs.value.hp).toBe(32);
      const total = Object.values(result.current.pokemon[0].evs.value).reduce((sum, value) => sum + value, 0);
      expect(total).toBeLessThanOrEqual(66);
      expect(result.current.limits).toMatchObject({ perStat: 32, total: 66 });
    });
  }

  for (const [kind, format] of [['singles', 'gen9ou'], ['doubles', 'gen9doublesou'], ['VGC', 'gen9vgc2026regf']] as const) {
    test(`Scarlet/Violet ${kind}: a stat keeps its 252 cap, the total follows the simulator's 510`, () => {
      const { result } = renderHook(() => useTeamDraft(blank(), pools(510), format));
      act(() => result.current.updateEv(0, 'hp', '300'));
      act(() => result.current.updateEv(0, 'atk', '252'));
      act(() => result.current.updateEv(0, 'def', '252'));
      expect(result.current.pokemon[0].evs.value).toMatchObject({ hp: 252, atk: 252, def: 6 });
    });

    test(`Scarlet/Violet ${kind}: before the pools arrive only the stat cap applies`, () => {
      const { result } = renderHook(() => useTeamDraft(blank(), null, format));
      act(() => result.current.updateEv(0, 'hp', '300'));
      act(() => result.current.updateEv(0, 'atk', '252'));
      act(() => result.current.updateEv(0, 'def', '252'));
      expect(result.current.pokemon[0].evs.value).toMatchObject({ hp: 252, atk: 252, def: 252 });
    });
  }

  test('a draft without a format keeps the old 0 to 252 clamp', () => {
    const { result } = renderHook(() => useTeamDraft(blank(), null));
    act(() => result.current.updateEv(0, 'spe', '300'));
    expect(result.current.pokemon[0].evs.value.spe).toBe(252);
  });
});
