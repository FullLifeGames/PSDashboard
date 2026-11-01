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
    // Round 84 (turn dock): each move pick carries the target the log names (1 and 2 are the foe slots of the mover, negative its own side).
    expect(result.current?.p1Slots).toEqual([
      { kind: 'move', name: 'Fake Out', targetLoc: 1 },
      { kind: 'move', name: 'Moonblast', targetLoc: 2 },
    ]);
    expect(result.current?.p2Slots).toEqual([
      { kind: 'switch', name: 'Amoonguss', species: 'Amoonguss' },
      { kind: 'move', name: 'Surging Strikes', targetLoc: 2 },
    ]);
    expect(result.current?.p1).toEqual({ kind: 'move', name: 'Fake Out', targetLoc: 1 });
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
    // Round 84: the recorded choice rides along whole (target, gimmick and dice), for the dock's seed.
    expect(result.current?.p1Slots).toEqual([
      { kind: 'move', name: 'Fake Out', recorded: history[0].p1SlotChoices![0] },
      { kind: 'switch', name: 'Grimmsnarl', species: 'grimmsnarl', recorded: history[0].p1SlotChoices![1] },
    ]);
    expect(result.current?.p2Slots).toEqual([null, { kind: 'move', name: 'Protect', recorded: history[0].p2SlotChoices![1] }]);
    expect(result.current?.p2).toEqual({ kind: 'move', name: 'Protect', recorded: history[0].p2SlotChoices![1] });
  });

  test('singles keep the side pick and carry no slots', () => {
    const log = ['|move|p1a: Kyurem|Ice Beam|p2a: Garchomp', '|move|p2a: Garchomp|Earthquake|p1a: Kyurem'];
    const { result } = renderHook(() => usePlayedAtView(args({ snapshots: snapshotsWith(3, log) })));
    expect(result.current).toEqual({ p1: { kind: 'move', name: 'Ice Beam' }, p2: { kind: 'move', name: 'Earthquake' } });
  });

  test('doubles: the target, a spread move without one, and the gimmick of each slot reach the pick (round 84, turn dock)', () => {
    // The dock seeds each chip with what the log played; fromAction used to drop the target and the Tera, Mega and Ultra flags.
    const log = [
      '|move|p1a: Greninja|Rock Slide|p2a: Regigigas|[spread] p2a,p2b',
      '|-terastallize|p1b: Conkeldurr|Fighting',
      '|move|p1b: Conkeldurr|Drain Punch|p2b: Jirachi',
      '|-mega|p2a: Charizard|Charizard-Mega-Y|Charizardite Y',
      '|move|p2a: Charizard|Heat Wave|p1a: Greninja|[spread] p1a,p1b',
      '|-burst|p2b: Necrozma|Necrozma-Ultra|Ultranecrozium Z',
      '|move|p2b: Necrozma|Photon Geyser|p1b: Conkeldurr',
    ];
    const { result } = renderHook(() => usePlayedAtView(args({ doubles: true, snapshots: snapshotsWith(3, log) })));
    expect(result.current?.p1Slots?.[0]).toEqual({ kind: 'move', name: 'Rock Slide', targetLoc: 1 });
    expect(result.current?.p1Slots?.[1]).toEqual({ kind: 'move', name: 'Drain Punch', targetLoc: 2, modifier: 'terastallize' });
    expect(result.current?.p2Slots?.[0]).toMatchObject({ name: 'Heat Wave', modifier: 'mega', targetLoc: 1 });
    expect(result.current?.p2Slots?.[1]).toMatchObject({ name: 'Photon Geyser', modifier: 'ultra', targetLoc: 2 });
  });

  test('singles: a Tera, Mega or Ultra click reaches the pick and no target is named', () => {
    const tera = ['|-terastallize|p1a: Kyurem|Ice', '|move|p1a: Kyurem|Ice Beam|p2a: Garchomp'];
    const mega = ['|-mega|p1a: Charizard|Charizard-Mega-X|Charizardite X', '|move|p1a: Charizard|Flare Blitz|p2a: Garchomp'];
    const ultra = ['|-burst|p1a: Necrozma|Necrozma-Ultra|Ultranecrozium Z', '|move|p1a: Necrozma|Photon Geyser|p2a: Garchomp'];
    for (const [log, modifier] of [[tera, 'terastallize'], [mega, 'mega'], [ultra, 'ultra']] as const) {
      const { result } = renderHook(() => usePlayedAtView(args({ snapshots: snapshotsWith(3, [...log]) })));
      expect(result.current?.p1, modifier).toMatchObject({ kind: 'move', modifier });
      expect(result.current?.p1?.targetLoc, modifier).toBeUndefined();
    }
  });

  test('behind the tip: the recorded Tera and target are on the pick as well as in `recorded`', () => {
    const recorded = { kind: 'move', moveId: 'drainpunch', moveName: 'Drain Punch', moveSlot: 2, targetLoc: 2, modifier: 'terastallize' };
    const history = [{ kind: 'turn', p1SlotChoices: [null, recorded], p2SlotChoices: [null, null] }] as unknown as BranchHistoryEntry[];
    const { result } = renderHook(() => usePlayedAtView(args({
      doubles: true, viewingVariation: true, variationSpan: { startTurn: 3 } as Args['variationSpan'], viewTurn: 3, history,
    })));
    expect(result.current?.p1Slots?.[1]).toEqual({ kind: 'move', name: 'Drain Punch', targetLoc: 2, modifier: 'terastallize', recorded });
  });
});
