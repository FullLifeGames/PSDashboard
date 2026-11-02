import { describe, expect, test } from 'vitest';
import type { BranchSlotChoice, RankedChoice } from '@fulllifegames/eval-engine';
import { pickFill, slotChoicesOf } from '../../../src/lib/dock-fill';
import { rankedChoice } from '../fixtures/eval-result';
import { simState } from '../fixtures/sim-state';

/**
 * Round 84 (turn dock), lane A, step A5: what the engine fills into the untouched slots of the dock. The best ranked joint choice
 * whose parts agree with every slot the user touched supplies the rest; no agreeing choice leaves the slots empty.
 */

const fakeOut: BranchSlotChoice = { kind: 'move', moveId: 'fakeout', moveName: 'Fake Out', targetLoc: 2 };
const flareBlitz: BranchSlotChoice = { kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 2 };
const protect: BranchSlotChoice = { kind: 'move', moveId: 'protect', moveName: 'Protect' };

const doublesRanked: RankedChoice[] = [
  rankedChoice('move fakeout 1, move spore 2', 'Fake Out → Rillaboom + Spore → Tornadus', 0.3),
  rankedChoice('move flareblitz 1, move ragepowder', 'Flare Blitz → Rillaboom + Rage Powder', 0.1),
  rankedChoice('move partingshot, move protect', 'Parting Shot + Protect', 0),
];

describe('slotChoicesOf', () => {
  test('maps an engine line onto the slots of the side, null for a slot the line leaves alone', () => {
    const doubles = simState('doubles');
    const parts = slotChoicesOf(doubles, 'p1', doublesRanked[0]);
    expect(parts).toEqual([
      expect.objectContaining({ kind: 'move', moveId: 'fakeout', targetLoc: 1 }),
      expect.objectContaining({ kind: 'move', moveId: 'spore', targetLoc: 2 }),
    ]);
    expect(slotChoicesOf(simState('singles'), 'p2', rankedChoice('move leechseed', 'Leech Seed', 0))).toEqual([
      { kind: 'move', moveId: 'leechseed', moveName: 'Leech Seed' },
    ]);
    expect(slotChoicesOf(simState('singles'), 'p1', rankedChoice('move hyperbeam', 'Hyper Beam', 0))).toBeNull();
  });

  test('a doubles forced replacement is one part that belongs to the forced slot', () => {
    const forced = simState('doubles', { p1ForceSwitches: [false, true], p1ForceSwitch: true });
    const parts = slotChoicesOf(forced, 'p1', rankedChoice('switch 3', '→ Flutter Mane', 0));
    expect(parts?.[0]).toBeNull();
    expect(parts?.[1]).toEqual(expect.objectContaining({ kind: 'switch', pokemonName: 'Flutter Mane' }));
  });
});

describe('pickFill, singles', () => {
  const singles = simState('singles');
  const ranked = [
    rankedChoice('move earthquake', 'Earthquake', 0.35),
    rankedChoice('move swordsdance', 'Swords Dance', 0.2),
    rankedChoice('switch heatran', '→ Heatran', -0.05),
  ];

  test('an untouched slot takes the best ranked choice', () => {
    expect(pickFill('p1', ranked, singles, [null])).toEqual([{ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }]);
  });

  test('a touched slot is never written, and no choice that disagrees with it is read', () => {
    expect(pickFill('p1', ranked, singles, [{ kind: 'move', moveId: 'swordsdance', moveName: 'Swords Dance' }])).toEqual([null]);
    expect(pickFill('p1', ranked, singles, [{ kind: 'move', moveId: 'stoneedge', moveName: 'Stone Edge' }])).toEqual([null]);
  });

  test('a wait is skipped and the best ranked choice after it is used', () => {
    const withWait = [rankedChoice('wait', 'Wait', 0.5), ...ranked];
    expect(pickFill('p1', withWait, singles, [null])).toEqual([{ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }]);
    expect(pickFill('p1', [rankedChoice('wait', 'Wait', 0.5)], singles, [null])).toEqual([null]);
  });

  test('a choice the picker cannot map is skipped, the next one fills', () => {
    const unmapped = [rankedChoice('move hyperbeam', 'Hyper Beam', 0.5), ...ranked];
    expect(pickFill('p1', unmapped, singles, [null])).toEqual([{ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }]);
  });

  test('a touched switch is written never, whatever the ranking says', () => {
    const touched: BranchSlotChoice = { kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' };
    expect(pickFill('p1', ranked, singles, [touched])).toEqual([null]);
  });
});

describe('pickFill, doubles', () => {
  const doubles = simState('doubles');

  test('both untouched slots take the best ranked joint choice, with its targets', () => {
    const filled = pickFill('p1', doublesRanked, doubles, [null, null]);
    expect(filled[0]).toEqual(expect.objectContaining({ moveId: 'fakeout', targetLoc: 1 }));
    expect(filled[1]).toEqual(expect.objectContaining({ moveId: 'spore', targetLoc: 2 }));
  });

  test('a touched slot that agrees keeps its own target and the other slot takes its part', () => {
    const filled = pickFill('p1', doublesRanked, doubles, [fakeOut, null]);
    expect(filled[0]).toBeNull();
    expect(filled[1]).toEqual(expect.objectContaining({ moveId: 'spore', targetLoc: 2 }));
  });

  test('the first choice that disagrees with the touched slot is skipped for a lower one that agrees', () => {
    const filled = pickFill('p1', doublesRanked, doubles, [flareBlitz, null]);
    expect(filled[0]).toBeNull();
    expect(filled[1]).toEqual(expect.objectContaining({ moveId: 'ragepowder' }));
  });

  test('the touched slot may be the second one', () => {
    const filled = pickFill('p1', doublesRanked, doubles, [null, protect]);
    expect(filled[0]).toEqual(expect.objectContaining({ moveId: 'partingshot' }));
    expect(filled[1]).toBeNull();
  });

  test('no choice agrees with every touched slot: the untouched slot stays empty', () => {
    const filled = pickFill('p1', doublesRanked, doubles, [{ kind: 'move', moveId: 'wideguard', moveName: 'Wide Guard' }, null]);
    expect(filled).toEqual([null, null]);
    expect(pickFill('p1', doublesRanked, doubles, [fakeOut, protect])).toEqual([null, null]);
  });

  test('a gimmick in a touched slot clashes with the same gimmick in a filled slot: that choice is skipped', () => {
    const teraRanked = [
      rankedChoice('move fakeout 1, move spore 2 terastallize', 'Fake Out → Rillaboom + Spore → Tornadus', 0.3),
      rankedChoice('move fakeout 1, move protect', 'Fake Out → Rillaboom + Protect', 0.1),
    ];
    const touchedTera: BranchSlotChoice = { ...fakeOut, modifier: 'terastallize' };
    const filled = pickFill('p1', teraRanked, doubles, [touchedTera, null]);
    expect(filled[1]).toEqual(expect.objectContaining({ moveId: 'protect' }));
    expect(filled[1]).not.toHaveProperty('modifier');
    // A touched slot without a gimmick leaves the engine's Tera in the other slot.
    const plain = pickFill('p1', teraRanked, doubles, [fakeOut, null]);
    expect(plain[1]).toEqual(expect.objectContaining({ moveId: 'spore', modifier: 'terastallize' }));
    // A different kind of gimmick does not clash.
    const mega = pickFill('p1', teraRanked, doubles, [{ ...fakeOut, modifier: 'mega' }, null]);
    expect(mega[1]).toEqual(expect.objectContaining({ moveId: 'spore', modifier: 'terastallize' }));
  });

  test('two gimmicks of one kind in one joint choice are the engine\'s own and stay', () => {
    const both = [rankedChoice('move fakeout 1 terastallize, move spore 2', 'Fake Out → Rillaboom + Spore → Tornadus', 0.3)];
    const filled = pickFill('p1', both, doubles, [null, null]);
    expect(filled[0]).toEqual(expect.objectContaining({ modifier: 'terastallize' }));
  });

  test('a touched switch agrees with a joint choice that switches the same body', () => {
    const touched: BranchSlotChoice = { kind: 'switch', speciesId: 'fluttermane', pokemonName: 'Flutter Mane' };
    const switching = [
      rankedChoice('move fakeout 1, move spore 2', 'Fake Out → Rillaboom + Spore → Tornadus', 0.3),
      rankedChoice('switch fluttermane, move spore 2', '→ Flutter Mane + Spore → Tornadus', 0.1),
    ];
    const filled = pickFill('p1', switching, doubles, [touched, null]);
    expect(filled[0]).toBeNull();
    expect(filled[1]).toEqual(expect.objectContaining({ moveId: 'spore', targetLoc: 2 }));
    // The first choice moves in the touched slot, so it disagrees: the lower one decided.
    expect(pickFill('p1', [switching[0]], doubles, [touched, null])).toEqual([null, null]);
  });

  test('the second side reads its own slots', () => {
    const p2 = [rankedChoice('move grassyglide 1, move tailwind', 'Grassy Glide → Incineroar + Tailwind', -0.25)];
    const filled = pickFill('p2', p2, doubles, [null, null]);
    expect(filled[0]).toEqual(expect.objectContaining({ moveId: 'grassyglide', targetLoc: 1 }));
    expect(filled[1]).toEqual(expect.objectContaining({ moveId: 'tailwind' }));
  });
});
