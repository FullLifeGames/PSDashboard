import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { DIE_KINDS, dieKey, type DieName, type ForcedDie } from '../src/dice/types';
import { dieLabel } from '../src/dice/die-label';
import { playClicks, standing, sweepSelection, SWEEPS_FULL, type Mode, type Rules } from './dice-fixtures';
import { clicksAccepted, dexOfRules, forcedOn, isCharge, SWEEP_CASES, sweepMoves, VGC_RULES, type DexMove } from './dice-sweep-support';
import { loggedDice } from '../src/dice/logged-results';
import { loggedOptions } from '../src/dice/turn';
import { aimOf, ofKind, pickBoard, pickClicks, publicHalf, recorded, type Recorded } from './dice-pick-support';

// Round 89 (#137): the simulator draws a random target in two places that the log shows and the rebuild does not read. A move
// that picks its foe at random (the Dex target `randomNormal`: Outrage, Thrash, Petal Dance, Uproar, Raging Fury, Struggle) draws it
// in `getTarget`, and a move that an Encore bent to the last one (`OverrideAction`) draws it in `runMove`, both through
// `getRandomTarget`, which samples the standing foes in doubles (`side.randomFoe`) and takes the one foe of singles without a draw.
// For every rule set with doubles (Gens 3 to 9 and Champions), doubles and VGC (a team of six), and for singles as the control:
// (a) every Dex move with the target `randomNormal`; (b) every one-target move the user clicked another move over, when the faster
// foe's Encore lands first. The natural turn on a copy names one `random-target` die of the user and the move, its sample holds
// the standing foes, forcing each foe makes the move line name it, and the battle the question came from stays as it was.
await loadSimMods('gen9championsou');

const CASES: { rules: Rules; mode: Mode; vgc: boolean; name: string }[] = [
  ...SWEEP_CASES.map(entry => ({ ...entry, vgc: false })),
  ...VGC_RULES.map(rules => ({ rules, mode: 'doubles' as const, vgc: true, name: `${rules.name} VGC` })),
];
const DOUBLES = CASES.filter(entry => entry.mode === 'doubles');
const FOES = ['p2a', 'p2b'];

const pick = (slot: string, moveId: string): DieName => ({ slot, moveId, kind: 'random-target' });
const slotsOf = (items: readonly unknown[] | undefined): string[] => (items ?? []).map(item => (item as { getSlot(): string }).getSlot()).sort();

/** The die of the user's move: named once, drawn over the standing foes, and each foe forced makes the move line name it. */
function checkPicked(board: ReturnType<typeof pickBoard>, clicks: { p1: string; p2: string }, turn: Recorded, moveId: string): string[] {
  const problems: string[] = [];
  const dice = ofKind(turn, 'random-target');
  const key = dieKey(pick('p1a', moveId));
  if (dice.length !== 1 || dice[0][0] !== key) return [`expected the one die ${key}, the turn named ${dice.map(([entry]) => entry).join(', ') || 'none'}`];
  const shape = turn.shapes.get(key);
  if (shape?.call !== 'sample') problems.push(`the draw is a ${shape?.call}, not a sample`);
  else if (slotsOf(shape.items).join() !== FOES.join()) problems.push(`the sample holds ${slotsOf(shape.items).join()}, not the standing foes`);
  for (const foe of FOES) {
    const forced: ForcedDie = { name: pick('p1a', moveId), result: { option: foe } };
    const { report, battle, start } = forcedOn(board, clicks, [forced]);
    const aimed = aimOf(battle.log.slice(start), 'p1a', moveId);
    const took = report.forced[0]?.took;
    // a move that turns itself on the user after `ModifyMove` (Curse of a body that is no Ghost) or fails before its target shows (Fling
    // with no item) names no foe on its line: the die was drawn and forced, the effect did not show
    const named = aimed !== undefined && FOES.includes(aimed);
    if (named && aimed !== foe) problems.push(`forcing ${foe}: the move line names ${aimed}`);
    if (named && took !== 'applied') problems.push(`forcing ${foe}: ${took} (${report.forced[0]?.reason}) although the line names ${aimed}`);
    if (!named && took !== 'blocked') problems.push(`forcing ${foe}: ${took} although the move line names ${aimed ?? 'no target'}`);
    if (named) problems.push(...readBack(board, clicks, publicHalf(battle.log.slice(start)), moveId, foe));
  }
  return problems;
}

/**
 * Round 89 (G2): the log reader answers the draw. The lines of a turn that forced `foe` give a die of the same key whose answer is that
 * foe (a reader told that the game draws a random target, as `loggedOptions` tells it), and playing the board with the reader's die makes
 * the move line name the foe again.
 */
function readBack(board: ReturnType<typeof pickBoard>, clicks: { p1: string; p2: string }, lines: readonly string[], moveId: string, foe: string): string[] {
  const key = dieKey(pick('p1a', moveId));
  const read = loggedDice(lines, { randomTargets: true }).find(die => dieKey(die.name) === key);
  if (!read) return [`the reader names no die for ${key} in the turn that aimed at ${foe}`];
  if (!('option' in read.result) || read.result.option !== foe) return [`the reader answers ${JSON.stringify(read.result)}, the line names ${foe}`];
  const again = forcedOn(board, clicks, [read]);
  const aimed = aimOf(again.battle.log.slice(again.start), 'p1a', moveId);
  return aimed === foe && again.report.forced[0]?.took === 'applied' ? [] : [`the reader's die plays ${aimed} (${again.report.forced[0]?.took}), not ${foe}`];
}

describe('what the reconstruction reads: the game type decides whether the log names a random target', () => {
  test.each(CASES)('loggedOptions in $name', ({ rules, mode, vgc }) => {
    const board = pickBoard({ rules, mode, vgc, attacker: ['tackle'] });
    const clicks = pickClicks(mode, mode === 'singles' ? 'move 1' : 'move 1 1');
    expect(loggedOptions(board, clicks).randomTargets === true).toBe(mode !== 'singles');
  });
});

describe('the kind of the die and its words', () => {
  test('both kinds are listed and read in words', () => {
    expect(DIE_KINDS).toEqual(expect.arrayContaining(['random-target', 'drag']));
    expect(dieLabel({ name: pick('p1a', 'thrash'), result: { option: 'p2b' } })).toBe('thrash: aims at p2b');
  });
});

describe.each(DOUBLES)('a random-target move draws a die: $name', ({ rules, mode, vgc }) => {
  const { moves } = sweepMoves(rules, move => move.target === 'randomNormal');
  test('the Dex has such moves', () => {
    expect(moves.length).toBeGreaterThan(0);
  });
  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    const board = pickBoard({ rules, mode, vgc, attacker: [move.id] });
    const clicks = pickClicks(mode, 'move 1');
    if (!clicksAccepted(board, clicks)) return;
    const before = standing(board);
    expect(checkPicked(board, clicks, recorded(board, clicks), move.id)).toEqual([]);
    expect(standing(board), 'the question leaves the battle as it was').toBe(before);
  });
});

/** Every one-target move: the user clicked another move; the faster foe's Encore lands first and bends the click to the last move used. */
const oneTarget = (move: DexMove): boolean => ['normal', 'adjacentFoe', 'any'].includes(move.target) && !isCharge(move);

describe.each(CASES)('an Encore that bends a click draws the target of the bent move: $name', ({ rules, mode, vgc }) => {
  const dex = dexOfRules(rules);
  const encores = dex.moves.get('encore').exists && dex.moves.get('encore').gen <= dex.gen;
  const { moves } = sweepMoves(rules, oneTarget);
  const scene = (moveId: string) => {
    const board = pickBoard({ rules, mode, vgc, attacker: [moveId, 'splash'], foe: ['encore', 'splash'] });
    const first = pickClicks(mode, mode === 'singles' ? 'move 1' : 'move 1 1', 'move 2');
    if (!clicksAccepted(board, first)) return null;
    playClicks(board, first);
    // turn two: the user clicks Splash, the faster foe's Encore lands on it first
    const clicks = pickClicks(mode, 'move 2', mode === 'singles' ? 'move 1' : 'move 1 1');
    return clicksAccepted(board, clicks) ? { board, clicks } : null;
  };
  /** The user ran the Encore's move after the Encore started on it. */
  const bent = (lines: readonly string[], moveId: string): boolean => {
    const started = lines.findIndex(line => line.startsWith('|-start|p1a') && line.endsWith('|Encore'));
    const ran = lines.findIndex(line => line.startsWith('|move|p1a') && line.split('|')[3].toLowerCase().replace(/[^a-z0-9]/g, '') === moveId);
    return started >= 0 && ran > started;
  };

  test.skipIf(!encores)('a plain Tackle, the scene of the issue', () => {
    const played = scene('tackle');
    expect(played, 'the scene plays').not.toBeNull();
    const { board, clicks } = played!;
    const before = standing(board);
    const turn = recorded(board, clicks);
    expect(bent(turn.lines, 'tackle'), 'the Encore bends the click').toBe(true);
    if (mode === 'singles') expect(ofKind(turn, 'random-target')).toEqual([]);
    else expect(checkPicked(board, clicks, turn, 'tackle')).toEqual([]);
    expect(standing(board)).toBe(before);
  });

  test.skipIf(!encores)('every one-target move', () => {
    const problems: string[] = [];
    let bends = 0;
    for (const move of sweepSelection(moves, 'moves')) {
      const played = scene(move.id);
      if (!played) continue;
      const turn = recorded(played.board, played.clicks);
      if (!bent(turn.lines, move.id)) {
        // nothing bent the click: the Splash of the user draws no target
        if (ofKind(turn, 'random-target').length > 0) problems.push(`${move.id}: a target die without a bent click`);
        continue;
      }
      bends++;
      if (mode === 'singles') {
        if (ofKind(turn, 'random-target').length > 0) problems.push(`${move.id}: singles named a target die`);
        continue;
      }
      problems.push(...checkPicked(played.board, played.clicks, turn, move.id).map(problem => `${move.id}: ${problem}`));
    }
    expect(problems).toEqual([]);
    // the full sweep bends a click for a good part of the Dex moves: a sweep that bent none proved nothing
    if (SWEEPS_FULL) expect(bends).toBeGreaterThan(20);
  });
});

describe('the control: the first foe in slot p2a of a target the user aimed', () => {
  test.each(DOUBLES)('a clicked target draws no die: $name', ({ rules, mode, vgc }) => {
    const board = pickBoard({ rules, mode, vgc, attacker: ['tackle'] });
    const clicks = pickClicks(mode, 'move 1 2');
    expect(clicksAccepted(board, clicks)).toBe(true);
    const turn = recorded(board, clicks);
    expect(ofKind(turn, 'random-target')).toEqual([]);
    expect(aimOf(turn.lines, 'p1a', 'tackle')).toBe('p2b');
  });
});
