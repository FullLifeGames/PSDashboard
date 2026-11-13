import type { Battle } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { dieKey, type DieName, type ForcedDie } from '../src/dice/types';
import { dieLabel } from '../src/dice/die-label';
import { copyOf } from '../src/sim-ask/copy';
import { playClicks, standing, sweepSelection, SWEEPS_FULL, type Mode, type Rules } from './dice-fixtures';
import { clicksAccepted, dexOfRules, forcedOn, SWEEP_CASES, VGC_RULES } from './dice-sweep-support';
import { draggedIn, ofKind, pickBoard, pickClicks, publicHalf, recorded, type Recorded } from './dice-pick-support';

// Round 89 (#137): a drag (Roar, Whirlwind, Dragon Tail and Circle Throw by the Dex flag `forceSwitch`, and an item whose holder drags
// the attacker out when it is hit: found below by playing every Dex item on a hit and keeping those under which `dragIn` ran) brings
// in a body that `getRandomSwitchable` samples from the bench. The module names the draw as a `drag` die of the dragged-out slot, its
// sample holds the bench bodies, and forcing each body makes the `|drag|` line name it. Gens 2 to 9 and Champions (Gen 1 has no drag),
// singles, doubles and VGC (a bench of four), a bench of two or more in every case.
await loadSimMods('gen9championsou');

const CASES: { rules: Rules; mode: Mode; vgc: boolean; name: string }[] = [
  ...SWEEP_CASES.filter(entry => entry.rules.generation >= 2).map(entry => ({ ...entry, vgc: false })),
  ...VGC_RULES.map(rules => ({ rules, mode: 'doubles' as const, vgc: true, name: `${rules.name} VGC` })),
];

const drag = (slot: string): DieName => ({ slot, moveId: '', kind: 'drag' });
const namesOf = (items: readonly unknown[] | undefined): string[] => (items ?? []).map(item => (item as { name: string }).name).sort();
const benchOf = (board: Battle, side: 0 | 1): string[] => board.sides[side].pokemon.filter(body => !body.isActive).map(body => body.name).sort();

/** The dice of the drags a natural turn played: one die per dragged-out slot, over the bench of its side, each body forced is the one the line names. */
function checkDragged(board: Battle, clicks: { p1: string; p2: string }, turn: Recorded): string[] {
  const problems: string[] = [];
  const lines = draggedIn(turn.lines);
  const dice = ofKind(turn, 'drag');
  if (lines.length === 0) return dice.length === 0 ? [] : [`a drag die without a drag: ${dice.map(([key]) => key).join(', ')}`];
  const expected = lines.map(line => dieKey(drag(line.slot))).sort();
  if (dice.map(([key]) => key).sort().join() !== expected.join()) return [`the dice ${dice.map(([key]) => key).join(', ') || 'none'} do not match the drags of ${expected.join(', ')}`];
  for (const line of lines) {
    const name = drag(line.slot);
    const shape = turn.shapes.get(dieKey(name));
    const bench = benchOf(board, line.slot[1] === '1' ? 0 : 1);
    if (shape?.call !== 'sample') problems.push(`${line.slot}: the draw is a ${shape?.call}, not a sample`);
    else if (namesOf(shape.items).join() !== bench.join()) problems.push(`${line.slot}: the sample holds ${namesOf(shape.items).join()}, the bench ${bench.join()}`);
    // each body of the bench forced: the drag line of the slot names it (a second drag of the turn plays under the stream)
    for (const body of bench) {
      const forced: ForcedDie = { name, result: { option: body } };
      const played = forcedOn(board, clicks, [forced]);
      const shown = draggedIn(publicHalf(played.battle.log.slice(played.start))).find(entry => entry.slot === line.slot);
      if (played.report.forced[0]?.took !== 'applied') problems.push(`${line.slot} forced ${body}: ${played.report.forced[0]?.took} (${played.report.forced[0]?.reason})`);
      if (shown?.name !== body) problems.push(`${line.slot} forced ${body}: the drag line names ${shown?.name}`);
    }
  }
  return problems;
}

describe('the words of a drag', () => {
  test('a drag die reads as the body that comes in', () => {
    expect(dieLabel({ name: drag('p2a'), result: { option: 'Chansey' } })).toBe('p2a: dragged out for Chansey');
  });
});

/** Whether the turn of these clicks runs `dragIn`, read on a copy of the board by a spy of this oracle. */
function dragsIn(board: Battle, clicks: { p1: string; p2: string }): boolean {
  const copy = copyOf(board);
  copy.prng ??= board.prng.clone();
  const actions = copy.actions as unknown as { dragIn: (...args: unknown[]) => unknown };
  const original = actions.dragIn;
  let ran = 0;
  actions.dragIn = function (this: unknown, ...args: unknown[]) {
    ran++;
    return original.apply(this, args);
  };
  playClicks(copy, clicks);
  return ran > 0;
}

describe.each(CASES)('a drag draws a die: $name', ({ rules, mode, vgc }) => {
  const dex = dexOfRules(rules);
  const legal = (entry: { exists: boolean; gen: number; isNonstandard?: string | null }): boolean =>
    entry.exists && entry.gen <= dex.gen && (entry.isNonstandard === null || entry.isNonstandard === undefined || entry.isNonstandard === 'Past');
  const moves = dex.moves.all().filter(move => legal(move) && !move.isZ && !move.isMax && !!move.forceSwitch);
  const aim = mode === 'singles' ? 'move 1' : 'move 1 1';

  test('the Dex has drag moves', () => {
    expect(moves.length).toBeGreaterThan(0);
  });

  test.each(moves.map(move => [move.id] as const))('the move %s', moveId => {
    const board = pickBoard({ rules, mode, vgc, attacker: [moveId] });
    const clicks = pickClicks(mode, aim);
    if (!clicksAccepted(board, clicks)) return;
    const before = standing(board);
    const turn = recorded(board, clicks);
    // Roar and Whirlwind of the board's Snorlax reach the foe in p2a: the drag happens
    if (moveId === 'roar' || moveId === 'whirlwind') expect(draggedIn(turn.lines).map(line => line.slot), 'the scene drags').toEqual(['p2a']);
    expect(checkDragged(board, clicks, turn)).toEqual([]);
    expect(standing(board), 'the question leaves the battle as it was').toBe(before);
  });

  // an item whose holder drags the attacker out: no item is named, the spy finds them by the hit that runs `dragIn`
  const items = sweepSelection(dex.items.all().filter(item => legal(item)), SWEEPS_FULL ? undefined : 'pool');
  test('the items that drag the attacker out', () => {
    const problems: string[] = [];
    const found: string[] = [];
    for (const item of items) {
      const board = pickBoard({ rules, mode, vgc, attacker: ['tackle'], foeItem: item.id });
      const clicks = pickClicks(mode, aim);
      if (!clicksAccepted(board, clicks) || !dragsIn(board, clicks)) continue;
      found.push(item.id);
      problems.push(...checkDragged(board, clicks, recorded(board, clicks)).map(problem => `${item.id}: ${problem}`));
    }
    expect(problems).toEqual([]);
    // the full sweep plays every item: where the Dex has a Red Card the spy finds it
    if (SWEEPS_FULL && dex.items.get('redcard').exists && dex.items.get('redcard').gen <= dex.gen) expect(found).toContain('redcard');
  });

  test.skipIf(!dex.items.get('redcard').exists || dex.items.get('redcard').gen > dex.gen)('the scene: a Red Card drags the attacker, the bench of its side stands behind', () => {
    const board = pickBoard({ rules, mode, vgc, attacker: ['tackle'], foeItem: 'redcard' });
    const clicks = pickClicks(mode, aim);
    const turn = recorded(board, clicks);
    expect(draggedIn(turn.lines).map(line => line.slot)).toEqual(['p1a']);
    expect(checkDragged(board, clicks, turn)).toEqual([]);
  });
});

describe.each(CASES.filter(entry => entry.rules.generation >= 3 && entry.mode === 'doubles'))('a draw inside the drag\'s switch-in is not the drag: $name', ({ rules, mode, vgc }) => {
  const trace = dexOfRules(rules).abilities.get('trace');
  test.skipIf(!trace.exists)('Trace of the body that comes in samples a foe, the drag die stays the one of the slot', () => {
    const board = pickBoard({ rules, mode, vgc, attacker: ['roar'], benchAbility: 'trace' });
    const clicks = pickClicks(mode, 'move 1 1');
    const turn = recorded(board, clicks);
    expect(draggedIn(turn.lines).map(line => line.slot)).toEqual(['p2a']);
    // the natural drag brings the Porygon2 (the seed's draw) or the Chansey; the forced rows below bring the Porygon2 whichever it is
    expect(ofKind(turn, 'drag').map(([key]) => key)).toEqual([dieKey(drag('p2a'))]);
    expect(ofKind(turn, 'random-target')).toEqual([]);
    const forced = forcedOn(board, clicks, [{ name: drag('p2a'), result: { option: 'Porygon2' } }]);
    expect(forced.battle.log.slice(forced.start).some(line => line.includes('ability: Trace')), 'the Trace of the switch-in drew a foe').toBe(true);
    expect(checkDragged(board, clicks, turn)).toEqual([]);
  });
});

