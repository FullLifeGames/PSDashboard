import { describe, expect, test } from 'vitest';
import { renderHook } from '@testing-library/react';
import { logRules, type TurnSnapshot } from '@fulllifegames/replay-core';
import { parsePlayedActions, parsePlayedActionsDoubles } from '@fulllifegames/eval-engine';
import { usePlayedAtView } from '../../../src/hooks/usePositionPicker';
import type { BranchHistoryEntry } from '../../../src/hooks/useBranch';

/**
 * Round 77 (branching swarm, B3): in doubles the "played" hint showed on slot A only, and on the main line not at all.
 * parsePlayedActionsDoubles reads one action per slot (`p1Slots`, `p2Slots`) and leaves `p1`/`p2` empty, so the hook
 * returned nothing for every doubles turn of the replay; behind the tip of a variation it kept the first slot's pick.
 */
type Args = Parameters<typeof usePlayedAtView>[0];

const RULES = logRules('|gen|9\n|tier|[Gen 9] OU');

const snapshotsWith = (turn: number, log: string[]) => {
  const snapshots: TurnSnapshot[] = [];
  snapshots[turn] = { turn, log } as unknown as TurnSnapshot;
  return snapshots;
};

function args(overrides: Partial<Args>): Args {
  return {
    viewingVariation: false, variationSpan: null, viewTurn: 3, history: [], snapshots: [], doubles: false,
    parseSingles: lines => parsePlayedActions(lines, RULES), parseDoubles: parsePlayedActionsDoubles, ...overrides,
  };
}

describe('usePlayedAtView', () => {
  test('doubles, main line: every slot shows what it played', () => {
    const log = [
      '|move|p1a: Incineroar|Fake Out|p2a: Rillaboom',
      '|move|p2b: Urshifu|Surging Strikes|p1b: Flutter Mane',
      '|switch|p2a: Amoonguss|Amoonguss, L50|100/100',
      '|move|p1b: Flutter Mane|Moonblast|p2b: Urshifu',
    ];
    const { result } = renderHook(() => usePlayedAtView(args({ doubles: true, snapshots: snapshotsWith(3, log) })));
    expect(result.current?.p1Slots).toEqual([{ kind: 'move', name: 'Fake Out' }, { kind: 'move', name: 'Moonblast' }]);
    expect(result.current?.p2Slots).toEqual([
      { kind: 'switch', name: 'Amoonguss', species: 'Amoonguss' },
      { kind: 'move', name: 'Surging Strikes' },
    ]);
    expect(result.current?.p1).toEqual({ kind: 'move', name: 'Fake Out' });
  });

  test('doubles, behind the tip of a variation: every slot shows its recorded choice', () => {
    const history = [{
      kind: 'turn',
      p1SlotChoices: [
        { kind: 'move', moveName: 'Fake Out', moveSlot: 1 },
        { kind: 'switch', pokemonName: 'Grimmsnarl', speciesId: 'grimmsnarl' },
      ],
      p2SlotChoices: [null, { kind: 'move', moveName: 'Protect', moveSlot: 4 }],
    }] as unknown as BranchHistoryEntry[];
    const { result } = renderHook(() => usePlayedAtView(args({
      doubles: true, viewingVariation: true, variationSpan: { startTurn: 3 } as Args['variationSpan'], viewTurn: 3, history,
    })));
    expect(result.current?.p1Slots).toEqual([
      { kind: 'move', name: 'Fake Out' },
      { kind: 'switch', name: 'Grimmsnarl', species: 'grimmsnarl' },
    ]);
    expect(result.current?.p2Slots).toEqual([null, { kind: 'move', name: 'Protect' }]);
    expect(result.current?.p2).toEqual({ kind: 'move', name: 'Protect' });
  });

  test('singles keep the side pick and carry no slots', () => {
    const log = ['|move|p1a: Kyurem|Ice Beam|p2a: Garchomp', '|move|p2a: Garchomp|Earthquake|p1a: Kyurem'];
    const { result } = renderHook(() => usePlayedAtView(args({ snapshots: snapshotsWith(3, log) })));
    expect(result.current).toEqual({ p1: { kind: 'move', name: 'Ice Beam' }, p2: { kind: 'move', name: 'Earthquake' } });
  });
});
