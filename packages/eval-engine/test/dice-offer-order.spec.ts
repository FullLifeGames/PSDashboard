import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { offeredDice, offeredOrderDice, type DieOffer } from '../src/dice/offer';
import { RecordingPRNG } from '../src/dice/prng';
import { dieKey, tieName } from '../src/dice/types';
import { watchBattle } from '../src/dice/watch';
import { copyOf } from '../src/sim-ask/copy';
import { mon, PIKACHU, playClicks, sweepSelection, type Mode } from './dice-fixtures';
import { moverBoard, moverClicks, moversOf, PAIRS, SLOTS, tieBoard, tieClicks } from './dice-order-support';
import { CHECK_MOVES, CHECKS, started, attacker } from './dice-status-support';
import { dexOfRules, forcedOn, SWEEP_CASES, sweepBoard, sweepClicks } from './dice-sweep-support';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

// Round 82 (forced dice), lane A3b: the dice the panel offers for the checks and the order of a turn, held to the simulator. A
// status check is offered for the slot's choice when the body carries the condition and the condition's own handler draws a
// chance for that move; the offer names exactly the status dice the natural turn draws, and every offered die, forced to either
// answer, is drawn. The order dice read the turn on a copy: a speed tie is offered for every pair of bodies whose move actions
// the simulator shuffles together, a first mover for every holder whose die the simulator draws (Quick Claw for a move of any
// priority, Quick Draw for a damaging move), and neither for a board where nothing ties.
await loadSimMods('gen9championsou');

const NEEDS_AIM = new Set(['normal', 'any', 'adjacentFoe']);
const choiceOf = (moveId: string, target: string, mode: Mode) => ({
  kind: 'move' as const, moveId, moveName: moveId, ...(mode === 'doubles' && NEEDS_AIM.has(target) ? { targetLoc: 1 } : {}),
});

/** The dice of the natural turn for slot p1a, by key. */
function drawnKeys(board: ReturnType<typeof sweepBoard>, clicks: { p1: string; p2: string }, kind: string): string[] {
  const copy = copyOf(board);
  copy.prng ??= board.prng.clone();
  const watch = watchBattle(copy);
  const recording = new RecordingPRNG(copy.prng, watch);
  copy.prng = recording;
  try {
    playClicks(copy, clicks);
  } finally {
    watch.uninstall();
  }
  return [...recording.record.keys()].filter(key => key.startsWith('p1a:') && key.split(':')[3] === kind).sort();
}

const keysOf = (offers: DieOffer[], kind: string): string[] => offers.filter(offer => offer.name.kind === kind).map(offer => dieKey(offer.name)).sort();

describe.each(SWEEP_CASES)('the offered status checks: $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const checks = CHECKS.filter(check => rules.generation >= check.from);
  let offered = 0;

  describe.each(checks.map(check => [check.id, check] as const))('%s', (_id, check) => {
    test.each(sweepSelection(CHECK_MOVES, 'moves'))('%s: the offer is what the natural turn draws, and each offered die is drawn', moveId => {
      const move = dex.moves.get(moveId);
      if (!move.exists || move.gen > dex.gen) return;
      const board = sweepBoard(rules, moveId, mode);
      check.start(board);
      const clicks = sweepClicks(mode, move.target);
      const offers = offeredDice(board, 'p1a', choiceOf(moveId, move.target, mode));
      expect(keysOf(offers, 'status-check'), `${rules.name} ${mode} ${check.id} ${moveId}`).toEqual(drawnKeys(board, clicks, 'status-check'));
      for (const offer of offers.filter(entry => entry.name.kind === 'status-check')) {
        offered++;
        expect(offer.name.effectId).toBe(check.id);
        const yes = forcedOn(board, clicks, [{ name: offer.name, result: { happens: true } }]).report.forced[0];
        const no = forcedOn(board, clicks, [{ name: offer.name, result: { happens: false } }]).report.forced[0];
        expect(yes.took, yes.reason).not.toBe('no-draw');
        expect(no.took, no.reason).not.toBe('no-draw');
        // the offer names the chance of "the body goes on", as the report of the forced yes does
        expect(offer.chance).toBeCloseTo(yes.chance!, 9);
        expect(offer.results).toEqual([{ happens: true }, { happens: false }]);
      }
    });
  });

  test('a switch offers no die and a body with no condition offers no status check', () => {
    const board = sweepBoard(rules, 'tackle', mode);
    expect(keysOf(offeredDice(board, 'p1a', choiceOf('tackle', 'normal', mode)), 'status-check')).toEqual([]);
    expect(offeredDice(board, 'p1a', { kind: 'switch', speciesId: 'vaporeon', pokemonName: 'Vaporeon' })).toEqual([]);
  });

  test('the offer was exercised', () => {
    expect(offered).toBeGreaterThan(0);
  });
});

describe.each(SWEEP_CASES.filter(entry => entry.rules.generation <= 2))('a frozen body of Gens 1 and 2 has no thaw die in the turn: $name', ({ rules, mode }) => {
  test('no offer, nothing drawn', () => {
    const board = sweepBoard(rules, 'tackle', mode);
    started(attacker(board).setStatus('frz'), 'freeze');
    expect(keysOf(offeredDice(board, 'p1a', choiceOf('tackle', 'normal', mode)), 'status-check')).toEqual([]);
  });
});

describe.each(SWEEP_CASES)('the offered order dice: $name', ({ rules, mode }) => {
  const seed = '1,2,3,4';
  const playOf = (clicks: { p1: string; p2: string }) => (battle: Parameters<typeof playClicks>[0]) => playClicks(battle, clicks);

  test('a board where the bodies tie offers every pair in both orders, and each offered die is drawn', () => {
    const board = tieBoard(rules, mode, seed);
    const clicks = tieClicks(mode);
    const offers = offeredOrderDice(board, playOf(clicks));
    expect(keysOf(offers, 'speed-tie')).toEqual(PAIRS(SLOTS[mode]).map(([a, b]) => dieKey(tieName(a, b))).sort());
    expect(offers.filter(offer => offer.name.kind !== 'speed-tie')).toEqual([]);
    for (const offer of offers) {
      expect(offer.results).toEqual([{ first: offer.name.slot }, { first: offer.name.targetSlot }]);
      for (const result of offer.results) {
        const report = forcedOn(board, clicks, [{ name: offer.name, result }]).report.forced[0];
        expect(report.took, report.reason).toBe('applied');
      }
    }
  });

  test('a board where nothing ties offers no speed tie', () => {
    const board = moverBoard(rules, mode, null, seed);
    expect(keysOf(offeredOrderDice(board, playOf(moverClicks(mode))), 'speed-tie')).toEqual([]);
  });

  test('the offer leaves the battle as it was', () => {
    const board = tieBoard(rules, mode, seed);
    const before = JSON.stringify(board.toJSON());
    offeredOrderDice(board, playOf(tieClicks(mode)));
    expect(JSON.stringify(board.toJSON())).toBe(before);
  });

  describe.each(moversOf(rules).map(mover => [mover.label, mover] as const))('%s', (_label, mover) => {
    // the chance of the die is the simulator's: Quick Claw 1 in 5, Quick Draw 3 in 10 where a draw of the turn carries it
    const chance = mover.id === 'quickclaw' ? 1 / 5 : 3 / 10;

    test('the holder is offered the die, a body without it is not, and each answer is drawn', () => {
      const board = moverBoard(rules, mode, mover, seed);
      const offers = offeredOrderDice(board, playOf(moverClicks(mode))).filter(offer => offer.name.kind === 'move-first');
      expect(offers.map(offer => offer.name)).toEqual([{ slot: 'p1a', moveId: '', kind: 'move-first', effectId: mover.id }]);
      expect(offers[0].results).toEqual([{ happens: true }, { happens: false }]);
      // Gens 2 and 3 keep the die on the battle at the start of the turn: no draw of the turn carries a chance to name
      if (rules.generation >= 4) expect(offers[0].chance).toBeCloseTo(chance, 9);
      else expect(offers[0].chance).toBeUndefined();
      for (const result of offers[0].results) {
        const report = forcedOn(board, moverClicks(mode), [{ name: offers[0].name, result }]).report.forced[0];
        expect(report.took, report.reason).toBe('applied');
      }
      const bare = moverBoard(rules, mode, null, seed);
      expect(offeredOrderDice(bare, playOf(moverClicks(mode))).filter(offer => offer.name.kind === 'move-first')).toEqual([]);
    });
  });

  test('Quick Draw is offered for a damaging move and not for a status move', () => {
    const quickdraw = moversOf(rules).find(mover => mover.id === 'quickdraw');
    if (!quickdraw) return;
    const holder = (moveId: string) => set('Snorlax', [moveId], {
      level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), ability: 'Quick Draw', gender: 'M',
    });
    const boardWith = (moveId: string) => mode === 'singles'
      ? battleOf(rules.singles, [holder(moveId)], [mon(rules, PIKACHU(['splash']))], seed)
      : battleOf(rules.doubles!, [holder(moveId), mon(rules, { species: 'Blissey', moves: ['splash'] })], [mon(rules, PIKACHU(['splash'])), mon(rules, { species: 'Chansey', moves: ['splash'] })], seed);
    const clicks = (moveId: string) => (mode === 'singles' ? { p1: 'move 1', p2: 'move 1' } : { p1: moveId === 'tackle' ? 'move 1 1, move 1' : 'move 1, move 1', p2: 'move 1, move 1' });
    expect(keysOf(offeredOrderDice(boardWith('tackle'), playOf(clicks('tackle'))), 'move-first')).toEqual([dieKey({ slot: 'p1a', moveId: '', kind: 'move-first', effectId: 'quickdraw' })]);
    expect(keysOf(offeredOrderDice(boardWith('splash'), playOf(clicks('splash'))), 'move-first')).toEqual([]);
  });

  test('Quick Claw with a move of priority above 0 is still offered: the handler tests the relayed priority of 0, not the priority of the move', () => {
    const quickclaw = moversOf(rules).find(mover => mover.id === 'quickclaw');
    if (!quickclaw) return;
    const holder = set('Snorlax', ['quickattack'], { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), item: 'Quick Claw', gender: 'M' });
    const foe = mon(rules, PIKACHU(['splash']));
    const board = mode === 'singles'
      ? battleOf(rules.singles, [holder], [foe], seed)
      : battleOf(rules.doubles!, [holder, mon(rules, { species: 'Blissey', moves: ['splash'] })], [foe, mon(rules, { species: 'Chansey', moves: ['splash'] })], seed);
    const clicks = mode === 'singles' ? { p1: 'move 1', p2: 'move 1' } : { p1: 'move 1 1, move 1', p2: 'move 1, move 1' };
    const offers = keysOf(offeredOrderDice(board, playOf(clicks)), 'move-first');
    expect(offers.length, `${rules.name} ${mode}`).toBe(1);
  });
});
