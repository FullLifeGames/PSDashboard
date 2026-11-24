import { describe, expect, test } from 'vitest';
import type { BranchSlotChoice, RankedChoice } from '@fulllifegames/eval-engine';
import { engineHoldsForcedBeside, fitsBeside, overlayFill, pickFill, pickFillParts, rowOfChoices, sameChoice, slotChoicesOf } from '../../../src/lib/dock-fill';
import { rankedChoice } from '../fixtures/eval-result';
import { simState } from '../fixtures/sim-state';

/** The best ranked joint choice whose parts agree with every slot the user touched fills the rest; no agreeing choice leaves the slots empty. */

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

describe('pickFill, held slots (the rule against jumping)', () => {
  const doubles = simState('doubles');

  test('a held slot is never written, and the other slot still takes its part of the best joint choice', () => {
    const filled = pickFill('p1', doublesRanked, doubles, [null, null], [true, false]);
    expect(filled[0]).toBeNull();
    expect(filled[1]).toEqual(expect.objectContaining({ moveId: 'spore', targetLoc: 2 }));
    expect(pickFill('p1', doublesRanked, doubles, [null, null], [false, true])[1]).toBeNull();
  });

  test('a held slot puts no demand on the joint choice: it needs no agreeing part', () => {
    // Only the third choice moves Protect in the second slot; the held first slot takes no part in the choosing.
    const filled = pickFill('p1', [doublesRanked[2]], doubles, [null, null], [true, false]);
    expect(filled[0]).toBeNull();
    expect(filled[1]).toEqual(expect.objectContaining({ moveId: 'protect' }));
  });

  test('singles: the only slot held leaves the side empty', () => {
    const ranked = [rankedChoice('move earthquake', 'Earthquake', 0.35)];
    expect(pickFill('p1', ranked, simState('singles'), [null], [true])).toEqual([null]);
  });
});

describe("pickFillParts, the held slot's deferred pick", () => {
  const doubles = simState('doubles');

  test('a held slot keeps its part of the best joint choice as the deferred pick, and the other slot is filled from the same choice', () => {
    const { filled, deferred } = pickFillParts('p1', doublesRanked, doubles, [null, null], [true, false]);
    expect(filled[0]).toBeNull();
    expect(filled[1]).toEqual(expect.objectContaining({ moveId: 'spore', targetLoc: 2 }));
    expect(deferred[0]).toEqual(expect.objectContaining({ moveId: 'fakeout', targetLoc: 1 }));
    expect(deferred[1]).toBeNull();
    // pickFill is the filled half and nothing else.
    expect(pickFill('p1', doublesRanked, doubles, [null, null], [true, false])).toEqual(filled);
  });

  test('a touched slot has no deferred pick, held or not; without a held slot nothing is deferred', () => {
    const { deferred } = pickFillParts('p1', doublesRanked, doubles, [flareBlitz, null], [true, false]);
    expect(deferred).toEqual([null, null]);
    expect(pickFillParts('p1', doublesRanked, doubles, [null, null]).deferred).toEqual([null, null]);
  });

  test('singles: the only slot held defers the best choice', () => {
    const ranked = [rankedChoice('move earthquake', 'Earthquake', 0.35)];
    const { filled, deferred } = pickFillParts('p1', ranked, simState('singles'), [null], [true]);
    expect(filled).toEqual([null]);
    expect(deferred).toEqual([{ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }]);
  });

  test('no agreeing joint choice defers nothing', () => {
    const { filled, deferred } = pickFillParts('p1', doublesRanked, doubles, [protect, null], [false, true]);
    expect(filled).toEqual([null, null]);
    expect(deferred).toEqual([null, null]);
  });
});

describe('fitsBeside (a deferred pick lands after the user chose beside it)', () => {
  const heatran: BranchSlotChoice = { kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' };
  const tera: BranchSlotChoice = { ...flareBlitz, modifier: 'terastallize' };

  test('a body the partner slot already sends in does not fit; another body does', () => {
    expect(fitsBeside(heatran, [null, heatran], 0)).toBe(false);
    expect(fitsBeside(heatran, [null, { ...heatran, speciesId: 'latias', pokemonName: 'Latias' }], 0)).toBe(true);
    expect(fitsBeside(heatran, [heatran, null], 0)).toBe(true);
  });

  test('a second Tera or Mega on the side does not fit', () => {
    expect(fitsBeside({ ...protect, modifier: 'terastallize' }, [null, tera], 0)).toBe(false);
    expect(fitsBeside({ ...protect, modifier: 'mega' }, [null, tera], 0)).toBe(true);
    expect(fitsBeside(protect, [null, tera], 0)).toBe(true);
  });
});

describe('overlayFill (a replay turn: the fill under the draft and over nothing)', () => {
  const rageowder: BranchSlotChoice = { kind: 'move', moveId: 'ragepowder', moveName: 'Rage Powder' };
  const earthquake: BranchSlotChoice = { kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' };

  test('no fill, or a fill that wrote nothing, leaves the very same state', () => {
    const doubles = simState('doubles');
    expect(overlayFill(doubles, null)).toBe(doubles);
    expect(overlayFill(doubles, { p1: [null, null], p2: [null, null] })).toBe(doubles);
    expect(overlayFill(null, { p1: [earthquake], p2: [null] })).toBeNull();
  });

  test('doubles: an empty slot takes the fill, a slot that holds a choice keeps it', () => {
    const logged: BranchSlotChoice = { kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 2 };
    const state = simState('doubles', { p1Choices: [logged, null] });
    const shown = overlayFill(state, { p1: [protect, rageowder], p2: [null, null] });
    expect(shown?.p1Choices).toEqual([logged, rageowder]);
    expect(shown?.p1Choice).toBe(logged);
    expect(shown?.p2Choices).toEqual([null, null]);
    // The state it came from stays as it was.
    expect(state.p1Choices).toEqual([logged, null]);
  });

  test('singles: the empty side takes the fill and the first choice mirrors it', () => {
    const shown = overlayFill(simState('singles'), { p1: [earthquake], p2: [null] });
    expect(shown?.p1Choices).toEqual([earthquake]);
    expect(shown?.p1Choice).toBe(earthquake);
    expect(shown?.p2Choice).toBeNull();
  });

  test('the empty draft (nothing logged, nothing picked) is shorter than the slots and still takes the fill', () => {
    const state = simState('doubles', { p1Choices: [], p2Choices: [] });
    const shown = overlayFill(state, { p1: [null, rageowder], p2: [null, null] });
    expect(shown?.p1Choices).toEqual([null, rageowder]);
  });

  test('a fill choice that the picker no longer offers (the exact position replaced the snapshot) is dropped', () => {
    const gone: BranchSlotChoice = { kind: 'move', moveId: 'hyperbeam', moveName: 'Hyper Beam' };
    const state = simState('singles');
    expect(overlayFill(state, { p1: [gone], p2: [null] })).toBe(state);
  });
});

describe('engineHoldsForcedBeside', () => {
  // a bench click sends a replacement at once only when no other forced slot of the turn holds just the engine's pick.
  const marks = (p1: boolean[], p2: boolean[] = [false]) => ({ p1, p2 });

  test("doubles, both slots of P1 forced: an engine pick beside holds the click back, the user's own pick does not", () => {
    const state = simState('doubles', { p1ForceSwitch: true, p1ForceSwitches: [true, true] });
    expect(engineHoldsForcedBeside(state, marks([false, true], [false, false]), 'p1', 0)).toBe(true);
    expect(engineHoldsForcedBeside(state, marks([true, true], [false, false]), 'p1', 0)).toBe(true);
    expect(engineHoldsForcedBeside(state, marks([true, false], [false, false]), 'p1', 0)).toBe(false);
    expect(engineHoldsForcedBeside(state, marks([true, false], [false, false]), 'p1', 1)).toBe(true);
    expect(engineHoldsForcedBeside(state, marks([false, false], [false, false]), 'p1', 1)).toBe(false);
  });

  test('a slot the position does not ask about counts for nothing, even with a mark', () => {
    const state = simState('doubles', { p1ForceSwitch: true, p1ForceSwitches: [false, true] });
    expect(engineHoldsForcedBeside(state, marks([true, true], [false, false]), 'p1', 1)).toBe(false);
  });

  test('singles, one forced slot alone: nothing beside it', () => {
    const state = simState('singles', { p1ForceSwitch: true, p1ForceSwitches: [true] });
    expect(engineHoldsForcedBeside(state, marks([true]), 'p1', 0)).toBe(false);
  });

  test('both sides forced (singles and doubles): an engine pick on the other side holds the click back', () => {
    const singles = simState('singles', { p1ForceSwitch: true, p1ForceSwitches: [true], p2ForceSwitch: true, p2ForceSwitches: [true] });
    expect(engineHoldsForcedBeside(singles, marks([false], [true]), 'p1', 0)).toBe(true);
    expect(engineHoldsForcedBeside(singles, marks([false], [false]), 'p1', 0)).toBe(false);
    const doubles = simState('doubles', { p1ForceSwitch: true, p1ForceSwitches: [true, false], p2ForceSwitch: true, p2ForceSwitches: [false, true] });
    expect(engineHoldsForcedBeside(doubles, marks([false, false], [false, true]), 'p1', 0)).toBe(true);
  });
});

/** The ranked row the picks of a side stand for: the picks as they stand when one row has them all, else the row the fill itself would take beside the user's slots alone; null when no row agrees. */
describe('rowOfChoices', () => {
  const doubles = simState('doubles');
  const slot = (choices: (BranchSlotChoice | null)[]) => choices;
  const spore: BranchSlotChoice = { kind: 'move', moveId: 'spore', moveName: 'Spore', targetLoc: 2 };
  const ragePowder: BranchSlotChoice = { kind: 'move', moveId: 'ragepowder', moveName: 'Rage Powder' };

  test('singles: the row of the pick', () => {
    const ranked = [rankedChoice('move earthquake', 'Earthquake', 0.3), rankedChoice('move swordsdance', 'Swords Dance', 0.2)];
    const pick: BranchSlotChoice = { kind: 'move', moveId: 'swordsdance', moveName: 'Swords Dance' };
    expect(rowOfChoices('p1', ranked, simState('singles'), slot([pick]), slot([pick]))).toBe(ranked[1]);
    expect(rowOfChoices('p1', ranked, simState('singles'), slot([{ kind: 'move', moveId: 'scaleshot', moveName: 'Scale Shot' }]), slot([null]))).toBeNull();
  });

  test('doubles: both slots read as one joint row, the target stays the user\'s', () => {
    expect(rowOfChoices('p1', doublesRanked, doubles, slot([flareBlitz, ragePowder]), slot([flareBlitz, ragePowder]))).toBe(doublesRanked[1]);
    expect(rowOfChoices('p1', doublesRanked, doubles, slot([fakeOut, spore]), slot([fakeOut, null]))).toBe(doublesRanked[0]);
  });

  test('doubles: a pick that broke the joint choice falls back to the row beside the user\'s own slots', () => {
    // the fill wrote Spore beside the touched Fake Out; the user then picked Protect in slot 1: Fake Out + Protect is no ranked row,
    // and the row the fill takes beside Protect... is none that opens with Fake Out, so only the user's slot 1 decides
    const row = rowOfChoices('p1', doublesRanked, doubles, slot([fakeOut, protect]), slot([null, protect]));
    expect(row).toBe(doublesRanked[2]);
  });
});

describe('sameChoice', () => {
  test('the same move, target and gimmick are one pick, however the object was built', () => {
    expect(sameChoice(fakeOut, { targetLoc: 2, moveName: 'Fake Out', moveId: 'fakeout', kind: 'move' })).toBe(true);
    expect(sameChoice(fakeOut, { ...fakeOut, targetLoc: undefined } as BranchSlotChoice)).toBe(false);
    expect(sameChoice(fakeOut, { ...fakeOut, targetLoc: 1 })).toBe(false);
    expect(sameChoice(fakeOut, flareBlitz)).toBe(false);
  });

  test('forced dice and a gimmick make another pick; two switches name the body', () => {
    const forced = { ...flareBlitz, dice: [{ kind: 'crit' }] } as unknown as BranchSlotChoice;
    expect(sameChoice(flareBlitz, forced)).toBe(false);
    const heatran: BranchSlotChoice = { kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' };
    expect(sameChoice(heatran, { ...heatran })).toBe(true);
    expect(sameChoice(heatran, { kind: 'switch', speciesId: 'latias', pokemonName: 'Latias' })).toBe(false);
    expect(sameChoice(heatran, fakeOut)).toBe(false);
  });

  test('an empty slot is the same as an empty slot and as nothing else', () => {
    expect(sameChoice(null, undefined)).toBe(true);
    expect(sameChoice(null, fakeOut)).toBe(false);
    expect(sameChoice(protect, null)).toBe(false);
  });
});
