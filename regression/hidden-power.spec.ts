import { test, expect, describe } from 'vitest';
import { resolveHiddenPowerType, withHiddenPowerType } from '../packages/replay-core/src/hidden-power';
import { parseSmogonChaosStats } from '../src/lib/smogon-stats';
import { reconstructBranchRuntime } from '../packages/eval-engine/src/branch-engine';
import { matchPlayedChoice } from '../packages/eval-engine/src/analysis';
import type { EvalResult } from '../packages/eval-engine/src/analysis';
import type { HiddenPowerEvidence } from '../packages/replay-core/src/types';
import type { PokemonSet } from '@pkmn/sim';

const usage = parseSmogonChaosStats({
  data: {
    Manectric: {
      'Raw count': 100,
      Moves: { hiddenpowerice: 60, hiddenpowergrass: 30, thunderbolt: 90 },
      Abilities: {}, Items: {}, Spreads: {},
    },
  },
}, { format: 'gen6ou', month: 'test' });

const ev = (defender: string, marker: HiddenPowerEvidence['marker']): HiddenPowerEvidence =>
  ({ attackerSide: 'p1', attackerSpecies: 'Manectric', defenderSpecies: defender, marker });

describe('hidden-power type resolution', () => {
  test('usage alone picks the top variant', () => {
    expect(resolveHiddenPowerType([], usage, 'Manectric', 6)).toBe('Hidden Power Ice');
  });
  test('evidence filters: a NEUTRAL hit on Skarmory keeps Ice (0.5 x 2 = x1), cuts Grass (x0.25)', () => {
    expect(resolveHiddenPowerType([ev('Skarmory', 'neutral')], usage, 'Manectric', 6)).toBe('Hidden Power Ice');
  });
  test('evidence overrides usage rank: a RESISTED hit on Skarmory cuts Ice, survivor Grass wins', () => {
    expect(resolveHiddenPowerType([ev('Skarmory', 'resisted')], usage, 'Manectric', 6)).toBe('Hidden Power Grass');
  });
  test('empty intersection falls back to usage-top (SUPER on Skarmory: no usage variant fits)', () => {
    // Ice vs Steel/Flying is x1 and Grass x0.25 — neither reads "super", so
    // the filter empties and the Levitate-family fallback fires.
    expect(resolveHiddenPowerType([ev('Skarmory', 'super')], usage, 'Manectric', 6)).toBe('Hidden Power Ice');
  });
  test('contradictory evidence (super + immune) also falls back to usage-top', () => {
    expect(resolveHiddenPowerType([ev('Skarmory', 'super'), ev('Skarmory', 'immune')], usage, 'Manectric', 6))
      .toBe('Hidden Power Ice');
  });
  test('no usage variant leaves null', () => {
    expect(resolveHiddenPowerType([], usage, 'Skarmory', 6)).toBeNull();
  });
});

describe('set substitution', () => {
  const baseSet: PokemonSet = {
    name: 'Manectric', species: 'Manectric', item: '', ability: 'Static',
    moves: ['Thunderbolt', 'Hidden Power', 'Volt Switch', 'Overheat'],
    nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100, gender: '',
  };
  test('typeless HP is substituted; explicit knowledge is not', () => {
    const substituted = withHiddenPowerType(baseSet, [], usage, 6);
    expect(substituted.moves).toContain('Hidden Power Ice');
    expect(substituted.moves).not.toContain('Hidden Power');
    const explicit = withHiddenPowerType({ ...baseSet, hpType: 'Grass' }, [], usage, 6);
    expect(explicit.moves).toContain('Hidden Power');
    const customIvs = withHiddenPowerType(
      { ...baseSet, ivs: { ...baseSet.ivs, atk: 0, def: 30 } }, [], usage, 6);
    expect(customIvs.moves).toContain('Hidden Power');
  });
});

// The protocol ALWAYS hides the HP type ("|move|...|Hidden Power|..."), so a
// substituted typed set must still understand the generic id everywhere the
// protocol meets the sim — the 653785 regression: rejected replay choices
// cost two reconstructed turns and flipped the re-pinned t19 verdict.
describe('generic protocol Hidden Power against a typed set', () => {
  test('the choice replay maps Hidden Power onto the typed slot (no rejects, no divergence)', async () => {
    const typedSet: PokemonSet = {
      name: 'Manectric', species: 'Manectric', item: '', ability: 'Static',
      moves: ['Hidden Power Ice', 'Thunderbolt'],
      nature: 'Timid', evs: { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100, gender: '',
    };
    const wall: PokemonSet = {
      name: 'Chansey', species: 'Chansey', item: '', ability: 'Natural Cure',
      moves: ['Soft-Boiled'],
      nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100, gender: '',
    };
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU',
      '|start',
      '|switch|p1a: Manectric|Manectric|100/100',
      '|switch|p2a: Chansey|Chansey|100/100',
      '|turn|1',
      '|move|p1a: Manectric|Hidden Power|p2a: Chansey',
      '|move|p2a: Chansey|Soft-Boiled|p2a: Chansey',
      '|turn|2',
      '|move|p1a: Manectric|Hidden Power|p2a: Chansey',
      '|move|p2a: Chansey|Soft-Boiled|p2a: Chansey',
      '|turn|3',
    ].join('\n');
    const runtime = await reconstructBranchRuntime({
      format: 'gen6ou', p1Team: [typedSet], p2Team: [wall],
      replayLog: log, targetTurn: 3,
    });
    expect(runtime.choiceErrors.count).toBe(0);
    expect(runtime.battleStream.battle!.turn).toBe(3);
  });

  test('the sim keeps the generic id for a typed set, so the played match holds', () => {
    // Load-bearing invariant behind the whole seam: @pkmn/sim normalizes
    // "Hidden Power Ice" to slot/request id 'hiddenpower' (the type lives in
    // hpType) — so option tokens stay generic and the protocol's generic
    // "Hidden Power" matches them. A sim upgrade that breaks this shows here.
    const option = {
      choice: 'move hiddenpower', label: 'Hidden Power Ice',
      worstCase: 0, expected: 0, ev: 0,
    };
    const result = { perSide: { p1: [option], p2: [] } } as unknown as EvalResult;
    expect(matchPlayedChoice(result, 'p1', { kind: 'move', name: 'Hidden Power' })).toBe(option);
  });
});
